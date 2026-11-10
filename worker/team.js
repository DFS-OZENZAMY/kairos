/**
 * Kairos — Équipes : comptes, équipes, invitations, projets, tâches assignées,
 * et chat en direct par projet (Durable Object `ProjectRoom`, WebSocket).
 *
 * Contrairement au coffre personnel (chiffré de bout en bout), les données
 * d'équipe sont lisibles par le serveur : c'est nécessaire pour les partager
 * entre plusieurs personnes. Les mots de passe sont hachés (PBKDF2-SHA256 +
 * sel) et les sessions sont des jetons aléatoires dont seule l'empreinte est
 * stockée, dans un cookie HttpOnly.
 */
export const TEAM_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS tm_users (id TEXT PRIMARY KEY, handle TEXT NOT NULL UNIQUE, name TEXT NOT NULL, pw_hash TEXT NOT NULL, salt TEXT NOT NULL, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS tm_sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS tm_teams (id TEXT PRIMARY KEY, name TEXT NOT NULL, owner_id TEXT NOT NULL, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS tm_members (team_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL, joined_at INTEGER NOT NULL, PRIMARY KEY (team_id, user_id))`,
  `CREATE TABLE IF NOT EXISTS tm_invites (code TEXT PRIMARY KEY, team_id TEXT NOT NULL, created_by TEXT NOT NULL, expires_at INTEGER NOT NULL, max_uses INTEGER NOT NULL, uses INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS tm_projects (id TEXT PRIMARY KEY, team_id TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS tm_tasks (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'todo', assignee_id TEXT, priority INTEGER NOT NULL DEFAULT 0, due TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS tm_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL, user_id TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_tm_tasks_project ON tm_tasks (project_id)`,
  `CREATE INDEX IF NOT EXISTS idx_tm_messages_project ON tm_messages (project_id, id)`,
  `CREATE INDEX IF NOT EXISTS idx_tm_members_user ON tm_members (user_id)`,
];

const COOKIE = 'kt_session';
const SESSION_MS = 30 * 24 * 3600 * 1000;
const HANDLE_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/;
const STATUSES = ['todo', 'doing', 'done'];
const MAX_FAILS = 10, FAIL_WINDOW = 15 * 60 * 1000;

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers },
});
const err = (message, status = 400) => json({ error: message }, status);
const fail = (message, status) => { throw Object.assign(new Error(message), { status }); };

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const randHex = (n) => hex(crypto.getRandomValues(new Uint8Array(n)));
async function sha256Hex(s) { return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))); }
async function hashPassword(password, salt) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  // 100 000 : maximum accepté par les Workers pour PBKDF2.
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations: 100000, hash: 'SHA-256' }, base, 256));
}
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
const str = (v, min, max, label) => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (s.length < min || s.length > max) fail(`${label} : ${min === 0 ? '' : `${min} à `}${max} caractères maximum`, 400);
  return s;
};
const cookieOf = (req, name) => (req.headers.get('cookie') || '').split(/;\s*/).map((c) => c.split('=')).find(([k]) => k === name)?.[1] || '';

async function readJson(req) {
  if (Number(req.headers.get('content-length') || 0) > 50_000) fail('Requête trop volumineuse', 413);
  try { return await req.json(); } catch { return fail('Requête invalide', 400); }
}

async function userFromRequest(req, db) {
  const token = cookieOf(req, COOKIE);
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  const row = await db.prepare('SELECT u.id, u.handle, u.name FROM tm_sessions s JOIN tm_users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?')
    .bind(await sha256Hex(token), Date.now()).first();
  return row || null;
}
async function startSession(db, userId, secure) {
  const token = randHex(32);
  await db.prepare('INSERT INTO tm_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').bind(await sha256Hex(token), userId, Date.now() + SESSION_MS).run();
  return `${COOKIE}=${token}; Path=/; Max-Age=${SESSION_MS / 1000}; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`;
}
const clearCookie = (secure) => `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`;

const roleIn = async (db, teamId, userId) => (await db.prepare('SELECT role FROM tm_members WHERE team_id = ? AND user_id = ?').bind(teamId, userId).first())?.role || null;
const isAdmin = (role) => role === 'owner' || role === 'admin';
async function projectAccess(db, projectId, userId) {
  const p = await db.prepare('SELECT * FROM tm_projects WHERE id = ?').bind(projectId).first();
  if (!p) fail('Projet introuvable', 404);
  const role = await roleIn(db, p.team_id, userId);
  if (!role) fail('Projet introuvable', 404); // ne révèle pas l'existence aux non-membres
  return { project: p, role };
}
async function notify(env, projectId, event) {
  if (!env.ROOM) return;
  try { await env.ROOM.get(env.ROOM.idFromName(projectId)).fetch('https://room/broadcast', { method: 'POST', body: JSON.stringify(event) }); } catch { /* le temps réel est un bonus */ }
}

const taskOut = (t) => ({ id: t.id, projectId: t.project_id, title: t.title, description: t.description, status: t.status, assigneeId: t.assignee_id, priority: t.priority, due: t.due, createdAt: t.created_at, updatedAt: t.updated_at });

function validateTask(b, partial) {
  const out = {};
  if (!partial || b.title !== undefined) out.title = str(b.title, 1, 200, 'Titre');
  if (b.description !== undefined) out.description = str(b.description ?? '', 0, 2000, 'Description');
  if (b.status !== undefined) { if (!STATUSES.includes(b.status)) fail('Statut invalide', 400); out.status = b.status; }
  if (b.priority !== undefined) { if (![0, 2, 3].includes(Number(b.priority))) fail('Priorité invalide', 400); out.priority = Number(b.priority); }
  if (b.due !== undefined) { if (b.due !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(b.due)) fail('Échéance invalide', 400); out.due = b.due; }
  if (b.assigneeId !== undefined) out.assigneeId = b.assigneeId || null;
  return out;
}

export async function handleTeam(req, env, url) {
  const db = env.DB;
  const path = url.pathname.replace(/^\/api\/team/, '').replace(/\/+$/, '') || '/';
  const m = req.method;
  const secure = url.protocol === 'https:';
  const seg = path.split('/').filter(Boolean);

  // ---- Comptes ------------------------------------------------------------
  if (path === '/register' && m === 'POST') {
    const b = await readJson(req);
    const handle = String(b.handle || '').trim().toLowerCase();
    if (!HANDLE_RE.test(handle)) fail('Identifiant invalide : 3 à 32 caractères, lettres minuscules, chiffres, point, tiret ou tiret bas', 400);
    const name = str(b.name, 1, 60, 'Nom');
    const password = typeof b.password === 'string' ? b.password : '';
    if (password.length < 8 || password.length > 200) fail('Mot de passe : 8 caractères minimum', 400);
    const id = crypto.randomUUID(), salt = randHex(16);
    const res = await db.prepare('INSERT INTO tm_users (id, handle, name, pw_hash, salt, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(handle) DO NOTHING')
      .bind(id, handle, name, await hashPassword(password, salt), salt, Date.now()).run();
    if (!res.meta.changes) fail('Cet identifiant est déjà pris', 409);
    return json({ user: { id, handle, name } }, 201, { 'set-cookie': await startSession(db, id, secure) });
  }
  if (path === '/login' && m === 'POST') {
    const b = await readJson(req);
    const handle = String(b.handle || '').trim().toLowerCase();
    const key = `login:${handle.slice(0, 40)}`, now = Date.now();
    const att = await db.prepare('SELECT fails, window_start FROM attempts WHERE id = ?').bind(key).first();
    if (att && att.fails >= MAX_FAILS && now - att.window_start < FAIL_WINDOW) fail('Trop d’essais. Réessaie dans quelques minutes.', 429);
    const u = await db.prepare('SELECT * FROM tm_users WHERE handle = ?').bind(handle).first();
    const hash = await hashPassword(typeof b.password === 'string' ? b.password.slice(0, 200) : '', u ? u.salt : 'x'.repeat(32));
    if (!u || !safeEqual(hash, u.pw_hash)) {
      const reset = !att || now - att.window_start >= FAIL_WINDOW;
      await db.prepare('INSERT INTO attempts (id, fails, window_start) VALUES (?, 1, ?) ON CONFLICT(id) DO UPDATE SET fails = CASE WHEN ? THEN 1 ELSE fails + 1 END, window_start = CASE WHEN ? THEN ? ELSE window_start END')
        .bind(key, now, reset ? 1 : 0, reset ? 1 : 0, now).run();
      fail('Identifiant ou mot de passe incorrect', 401);
    }
    if (att) await db.prepare('DELETE FROM attempts WHERE id = ?').bind(key).run();
    return json({ user: { id: u.id, handle: u.handle, name: u.name } }, 200, { 'set-cookie': await startSession(db, u.id, secure) });
  }
  if (path === '/logout' && m === 'POST') {
    const token = cookieOf(req, COOKIE);
    if (/^[0-9a-f]{64}$/.test(token)) await db.prepare('DELETE FROM tm_sessions WHERE token_hash = ?').bind(await sha256Hex(token)).run();
    return json({ ok: true }, 200, { 'set-cookie': clearCookie(secure) });
  }

  // ---- Tout le reste exige une session --------------------------------------
  const user = await userFromRequest(req, db);
  if (!user) return err('Connexion requise', 401);

  if (path === '/me' && m === 'GET') {
    const { results } = await db.prepare('SELECT t.id, t.name, mb.role FROM tm_members mb JOIN tm_teams t ON t.id = mb.team_id WHERE mb.user_id = ? ORDER BY t.created_at').bind(user.id).all();
    return json({ user, teams: results });
  }

  if (path === '/teams' && m === 'POST') {
    const name = str((await readJson(req)).name, 1, 60, 'Nom de l’équipe');
    const id = crypto.randomUUID(), now = Date.now();
    await db.batch([
      db.prepare('INSERT INTO tm_teams (id, name, owner_id, created_at) VALUES (?, ?, ?, ?)').bind(id, name, user.id, now),
      db.prepare('INSERT INTO tm_members (team_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)').bind(id, user.id, 'owner', now),
    ]);
    return json({ team: { id, name, role: 'owner' } }, 201);
  }

  if (path === '/join' && m === 'POST') {
    const code = String((await readJson(req)).code || '').trim().toLowerCase();
    if (!/^[0-9a-f]{24}$/.test(code)) fail('Code d’invitation invalide', 400);
    const inv = await db.prepare('SELECT * FROM tm_invites WHERE code = ?').bind(code).first();
    if (!inv || inv.expires_at < Date.now() || inv.uses >= inv.max_uses) fail('Invitation expirée ou invalide', 404);
    if (!(await roleIn(db, inv.team_id, user.id))) {
      await db.batch([
        db.prepare('INSERT INTO tm_members (team_id, user_id, role, joined_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING').bind(inv.team_id, user.id, 'member', Date.now()),
        db.prepare('UPDATE tm_invites SET uses = uses + 1 WHERE code = ?').bind(code),
      ]);
    }
    const team = await db.prepare('SELECT id, name FROM tm_teams WHERE id = ?').bind(inv.team_id).first();
    return json({ team });
  }

  if (seg[0] === 'teams' && seg[1]) {
    const teamId = seg[1];
    const role = await roleIn(db, teamId, user.id);
    if (!role) return err('Équipe introuvable', 404);

    if (seg.length === 2 && m === 'GET') {
      const team = await db.prepare('SELECT id, name, owner_id FROM tm_teams WHERE id = ?').bind(teamId).first();
      const members = (await db.prepare('SELECT u.id, u.handle, u.name, mb.role FROM tm_members mb JOIN tm_users u ON u.id = mb.user_id WHERE mb.team_id = ? ORDER BY mb.joined_at').bind(teamId).all()).results;
      const projects = (await db.prepare(`SELECT p.id, p.name, p.description, p.created_at,
          COUNT(t.id) AS total, COALESCE(SUM(t.status = 'done'), 0) AS done, COALESCE(SUM(t.status = 'doing'), 0) AS doing
        FROM tm_projects p LEFT JOIN tm_tasks t ON t.project_id = p.id WHERE p.team_id = ? GROUP BY p.id ORDER BY p.created_at`).bind(teamId).all()).results;
      return json({ team, role, members, projects });
    }
    if (seg.length === 2 && m === 'DELETE') {
      if (role !== 'owner') return err('Seul le propriétaire peut supprimer l’équipe', 403);
      const ids = (await db.prepare('SELECT id FROM tm_projects WHERE team_id = ?').bind(teamId).all()).results.map((r) => r.id);
      const stmts = [];
      for (const pid of ids) stmts.push(db.prepare('DELETE FROM tm_tasks WHERE project_id = ?').bind(pid), db.prepare('DELETE FROM tm_messages WHERE project_id = ?').bind(pid));
      stmts.push(db.prepare('DELETE FROM tm_projects WHERE team_id = ?').bind(teamId), db.prepare('DELETE FROM tm_invites WHERE team_id = ?').bind(teamId),
        db.prepare('DELETE FROM tm_members WHERE team_id = ?').bind(teamId), db.prepare('DELETE FROM tm_teams WHERE id = ?').bind(teamId));
      await db.batch(stmts);
      return json({ ok: true });
    }
    if (seg[2] === 'invites' && m === 'POST') {
      if (!isAdmin(role)) return err('Réservé aux administrateurs', 403);
      const code = randHex(12);
      await db.prepare('INSERT INTO tm_invites (code, team_id, created_by, expires_at, max_uses) VALUES (?, ?, ?, ?, 20)').bind(code, teamId, user.id, Date.now() + 7 * 24 * 3600 * 1000).run();
      return json({ code, expiresInDays: 7, maxUses: 20 }, 201);
    }
    if (seg[2] === 'members' && seg[3] && m === 'DELETE') {
      const target = seg[3];
      if (target !== user.id && !isAdmin(role)) return err('Réservé aux administrateurs', 403);
      const tRole = await roleIn(db, teamId, target);
      if (!tRole) return err('Membre introuvable', 404);
      if (tRole === 'owner') return err('Le propriétaire ne peut pas quitter l’équipe', 400);
      if (tRole === 'admin' && role !== 'owner' && target !== user.id) return err('Seul le propriétaire retire un administrateur', 403);
      await db.batch([
        db.prepare('DELETE FROM tm_members WHERE team_id = ? AND user_id = ?').bind(teamId, target),
        db.prepare('UPDATE tm_tasks SET assignee_id = NULL WHERE assignee_id = ? AND project_id IN (SELECT id FROM tm_projects WHERE team_id = ?)').bind(target, teamId),
      ]);
      return json({ ok: true });
    }
    if (seg[2] === 'projects' && m === 'POST') {
      const b = await readJson(req);
      const name = str(b.name, 1, 80, 'Nom du projet'), description = str(b.description ?? '', 0, 500, 'Description');
      const id = crypto.randomUUID();
      await db.prepare('INSERT INTO tm_projects (id, team_id, name, description, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(id, teamId, name, description, user.id, Date.now()).run();
      return json({ project: { id, name, description } }, 201);
    }
  }

  if (seg[0] === 'projects' && seg[1]) {
    const { project, role } = await projectAccess(db, seg[1], user.id);

    if (seg.length === 2 && m === 'GET') {
      const members = (await db.prepare('SELECT u.id, u.handle, u.name, mb.role FROM tm_members mb JOIN tm_users u ON u.id = mb.user_id WHERE mb.team_id = ? ORDER BY mb.joined_at').bind(project.team_id).all()).results;
      const tasks = (await db.prepare('SELECT * FROM tm_tasks WHERE project_id = ? ORDER BY created_at').bind(project.id).all()).results.map(taskOut);
      const messages = (await db.prepare('SELECT m.id, m.user_id AS userId, u.name, u.handle, m.body, m.created_at AS createdAt FROM tm_messages m JOIN tm_users u ON u.id = m.user_id WHERE m.project_id = ? ORDER BY m.id DESC LIMIT 100').bind(project.id).all()).results.reverse();
      return json({ project: { id: project.id, teamId: project.team_id, name: project.name, description: project.description }, role, members, tasks, messages });
    }
    if (seg.length === 2 && m === 'DELETE') {
      if (!isAdmin(role)) return err('Réservé aux administrateurs', 403);
      await db.batch([
        db.prepare('DELETE FROM tm_tasks WHERE project_id = ?').bind(project.id),
        db.prepare('DELETE FROM tm_messages WHERE project_id = ?').bind(project.id),
        db.prepare('DELETE FROM tm_projects WHERE id = ?').bind(project.id),
      ]);
      return json({ ok: true });
    }
    if (seg[2] === 'tasks' && m === 'POST') {
      const v = validateTask(await readJson(req), false);
      if (v.assigneeId && !(await roleIn(db, project.team_id, v.assigneeId))) fail('Ce membre ne fait pas partie de l’équipe', 400);
      const id = crypto.randomUUID(), now = Date.now();
      await db.prepare('INSERT INTO tm_tasks (id, project_id, title, description, status, assignee_id, priority, due, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(id, project.id, v.title, v.description ?? '', v.status ?? 'todo', v.assigneeId ?? null, v.priority ?? 0, v.due ?? '', user.id, now, now).run();
      const task = taskOut(await db.prepare('SELECT * FROM tm_tasks WHERE id = ?').bind(id).first());
      await notify(env, project.id, { type: 'task', action: 'upsert', task, by: user.id });
      return json({ task }, 201);
    }
    if (seg[2] === 'ws' && m === 'GET') {
      if (req.headers.get('upgrade') !== 'websocket') return err('WebSocket requis', 426);
      const origin = req.headers.get('origin');
      if (origin && origin !== url.origin) return err('Origine non autorisée', 403);
      if (!env.ROOM) return err('Chat indisponible (Durable Object manquant)', 503);
      const fwd = new Request('https://room/ws', { headers: { upgrade: 'websocket', 'x-user-id': user.id, 'x-user-name': encodeURIComponent(user.name), 'x-user-handle': user.handle, 'x-project-id': project.id } });
      return env.ROOM.get(env.ROOM.idFromName(project.id)).fetch(fwd);
    }
  }

  if (seg[0] === 'tasks' && seg[1] && (m === 'PATCH' || m === 'DELETE')) {
    const t = await db.prepare('SELECT * FROM tm_tasks WHERE id = ?').bind(seg[1]).first();
    if (!t) return err('Tâche introuvable', 404);
    const { project } = await projectAccess(db, t.project_id, user.id);
    if (m === 'DELETE') {
      await db.prepare('DELETE FROM tm_tasks WHERE id = ?').bind(t.id).run();
      await notify(env, project.id, { type: 'task', action: 'delete', id: t.id, by: user.id });
      return json({ ok: true });
    }
    const v = validateTask(await readJson(req), true);
    if (v.assigneeId && !(await roleIn(db, project.team_id, v.assigneeId))) fail('Ce membre ne fait pas partie de l’équipe', 400);
    const next = { title: v.title ?? t.title, description: v.description ?? t.description, status: v.status ?? t.status, assignee_id: v.assigneeId !== undefined ? v.assigneeId : t.assignee_id, priority: v.priority ?? t.priority, due: v.due ?? t.due };
    await db.prepare('UPDATE tm_tasks SET title = ?, description = ?, status = ?, assignee_id = ?, priority = ?, due = ?, updated_at = ? WHERE id = ?')
      .bind(next.title, next.description, next.status, next.assignee_id, next.priority, next.due, Date.now(), t.id).run();
    const task = taskOut(await db.prepare('SELECT * FROM tm_tasks WHERE id = ?').bind(t.id).first());
    await notify(env, project.id, { type: 'task', action: 'upsert', task, by: user.id });
    return json({ task });
  }

  return err('Route inconnue', 404);
}

/** Salon de chat d'un projet : un Durable Object par projet (WebSockets hibernables). */
export class ProjectRoom {
  constructor(state, env) { this.state = state; this.env = env; }

  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/broadcast') { this.broadcast(await req.text()); return new Response('ok'); }
    if (req.headers.get('upgrade') !== 'websocket') return new Response('WebSocket requis', { status: 426 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.state.acceptWebSocket(server);
    server.serializeAttachment({
      uid: req.headers.get('x-user-id'), name: decodeURIComponent(req.headers.get('x-user-name') || ''),
      handle: req.headers.get('x-user-handle'), pid: req.headers.get('x-project-id'), last: 0,
    });
    this.presence();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, raw) {
    const a = ws.deserializeAttachment();
    if (!a || typeof raw !== 'string' || raw.length > 4000) return;
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    if (msg?.type !== 'chat') return;
    const body = typeof msg.body === 'string' ? msg.body.trim() : '';
    if (!body || body.length > 2000) return;
    const now = Date.now();
    if (now - (a.last || 0) < 300) return; // anti-flood
    ws.serializeAttachment({ ...a, last: now });
    // L'appartenance est revérifiée à chaque message (membre retiré = plus d'écriture).
    const proj = await this.env.DB.prepare('SELECT team_id FROM tm_projects WHERE id = ?').bind(a.pid).first();
    const ok = proj && await this.env.DB.prepare('SELECT 1 AS x FROM tm_members WHERE team_id = ? AND user_id = ?').bind(proj.team_id, a.uid).first();
    if (!ok) { try { ws.close(4403, 'Accès retiré'); } catch { /* déjà fermé */ } return; }
    const res = await this.env.DB.prepare('INSERT INTO tm_messages (project_id, user_id, body, created_at) VALUES (?, ?, ?, ?)').bind(a.pid, a.uid, body, now).run();
    this.broadcast(JSON.stringify({ type: 'chat', message: { id: res.meta.last_row_id, userId: a.uid, name: a.name, handle: a.handle, body, createdAt: now } }));
  }

  webSocketClose(ws) { try { ws.close(); } catch { /* rien */ } this.presence(ws); }
  webSocketError(ws) { this.presence(ws); }

  presence(except) {
    const online = [...new Set(this.state.getWebSockets().filter((s) => s !== except).map((s) => s.deserializeAttachment()?.uid).filter(Boolean))];
    this.broadcast(JSON.stringify({ type: 'presence', online }));
  }
  broadcast(text) { for (const s of this.state.getWebSockets()) { try { s.send(text); } catch { /* socket fermé */ } } }
}
