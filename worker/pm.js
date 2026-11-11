/**
 * Kairos — Gestion de projet (façon ClickUp), pour les équipes.
 *
 * Hiérarchie : équipe (espace de travail) → espaces → dossiers (facultatifs) → listes → tâches → sous-tâches.
 * Tâches : statuts personnalisables par liste, plusieurs responsables, observateurs, priorité, début/échéance,
 * estimation et suivi du temps, étiquettes, champs personnalisés, checklist, dépendances, jalons, récurrence,
 * commentaires (@mentions), historique d'activité. Transversal : mes tâches, boîte de réception, vues
 * enregistrées, tableau de bord, documents d'espace, objectifs. Temps réel : Durable Object `ProjectRoom`.
 *
 * Les anciens « projets » (tm_projects / tm_tasks) sont migrés automatiquement en listes, avec les mêmes
 * identifiants : leurs tâches et leur chat sont conservés.
 */
import { json, err, fail, str, readJson, userFromRequest, roleIn, isAdmin, notify } from './team.js';

export const PM_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS pm_spaces (id TEXT PRIMARY KEY, team_id TEXT NOT NULL, name TEXT NOT NULL, color TEXT NOT NULL DEFAULT '#2F45D8', position REAL NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0, created_by TEXT NOT NULL, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS pm_folders (id TEXT PRIMARY KEY, space_id TEXT NOT NULL, name TEXT NOT NULL, position REAL NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS pm_lists (id TEXT PRIMARY KEY, space_id TEXT NOT NULL, folder_id TEXT, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', color TEXT NOT NULL DEFAULT '', statuses TEXT NOT NULL, position REAL NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0, created_by TEXT NOT NULL, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS pm_tasks (id TEXT PRIMARY KEY, list_id TEXT NOT NULL, parent_id TEXT, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', status TEXT NOT NULL, priority INTEGER NOT NULL DEFAULT 0, start_date TEXT NOT NULL DEFAULT '', due_date TEXT NOT NULL DEFAULT '', estimate_min INTEGER NOT NULL DEFAULT 0, tags TEXT NOT NULL DEFAULT '[]', custom TEXT NOT NULL DEFAULT '{}', position REAL NOT NULL DEFAULT 0, milestone INTEGER NOT NULL DEFAULT 0, recurrence TEXT NOT NULL DEFAULT '', archived INTEGER NOT NULL DEFAULT 0, created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, completed_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS pm_assignees (task_id TEXT NOT NULL, user_id TEXT NOT NULL, PRIMARY KEY (task_id, user_id))`,
  `CREATE TABLE IF NOT EXISTS pm_watchers (task_id TEXT NOT NULL, user_id TEXT NOT NULL, PRIMARY KEY (task_id, user_id))`,
  `CREATE TABLE IF NOT EXISTS pm_checklist (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, text TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0, position REAL NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS pm_deps (task_id TEXT NOT NULL, blocked_by TEXT NOT NULL, PRIMARY KEY (task_id, blocked_by))`,
  `CREATE TABLE IF NOT EXISTS pm_comments (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, user_id TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL, edited_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS pm_activity (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL, list_id TEXT NOT NULL, user_id TEXT NOT NULL, kind TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS pm_time (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, user_id TEXT NOT NULL, started_at INTEGER NOT NULL, ended_at INTEGER, minutes INTEGER NOT NULL DEFAULT 0, note TEXT NOT NULL DEFAULT '')`,
  `CREATE TABLE IF NOT EXISTS pm_fields (id TEXT PRIMARY KEY, list_id TEXT NOT NULL, name TEXT NOT NULL, type TEXT NOT NULL, options TEXT NOT NULL DEFAULT '[]', position REAL NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS pm_notifications (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, team_id TEXT NOT NULL, kind TEXT NOT NULL, task_id TEXT, actor_id TEXT, text TEXT NOT NULL, read_at INTEGER, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS pm_views (id TEXT PRIMARY KEY, team_id TEXT NOT NULL, scope TEXT NOT NULL, owner_id TEXT NOT NULL, name TEXT NOT NULL, type TEXT NOT NULL, config TEXT NOT NULL DEFAULT '{}', shared INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS pm_docs (id TEXT PRIMARY KEY, space_id TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', updated_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS pm_goals (id TEXT PRIMARY KEY, team_id TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', due_date TEXT NOT NULL DEFAULT '', owner_id TEXT, color TEXT NOT NULL DEFAULT '#2F45D8', targets TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_pm_spaces_team ON pm_spaces (team_id)`,
  `CREATE INDEX IF NOT EXISTS idx_pm_lists_space ON pm_lists (space_id)`,
  `CREATE INDEX IF NOT EXISTS idx_pm_tasks_list ON pm_tasks (list_id, archived)`,
  `CREATE INDEX IF NOT EXISTS idx_pm_tasks_parent ON pm_tasks (parent_id)`,
  `CREATE INDEX IF NOT EXISTS idx_pm_assignees_user ON pm_assignees (user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_pm_activity_task ON pm_activity (task_id, id)`,
  `CREATE INDEX IF NOT EXISTS idx_pm_comments_task ON pm_comments (task_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_pm_time_task ON pm_time (task_id)`,
  `CREATE INDEX IF NOT EXISTS idx_pm_time_user ON pm_time (user_id, ended_at)`,
  `CREATE INDEX IF NOT EXISTS idx_pm_notif_user ON pm_notifications (user_id, read_at, created_at)`,
];

export const DEFAULT_STATUSES = [
  { key: 'todo', name: 'À faire', color: '#8C94AD', type: 'open' },
  { key: 'doing', name: 'En cours', color: '#2F45D8', type: 'active' },
  { key: 'review', name: 'En revue', color: '#C27A08', type: 'active' },
  { key: 'done', name: 'Terminé', color: '#17865A', type: 'closed' },
];
const FIELD_TYPES = ['text', 'number', 'select', 'date', 'checkbox', 'url'];
const RECURRENCES = ['', 'daily', 'weekly', 'monthly'];
const VIEW_TYPES = ['list', 'board', 'table', 'calendar', 'gantt'];
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ID_RE = /^[0-9a-zA-Z-]{8,64}$/;
const now = () => Date.now();
const uuid = () => crypto.randomUUID();
const parse = (s, fallback) => { try { return JSON.parse(s); } catch { return fallback; } };
const color = (v, fallback) => (COLOR_RE.test(v || '') ? v : fallback);
const date = (v, label) => { if (v === undefined) return undefined; if (v === '' || v === null) return ''; if (!DATE_RE.test(v)) fail(`${label} invalide`, 400); return v; };
const intIn = (v, min, max, label) => { const n = Number(v); if (!Number.isInteger(n) || n < min || n > max) fail(`${label} invalide`, 400); return n; };

/* ===========================================================================
   Accès
   =========================================================================== */
async function teamRole(db, teamId, userId) {
  const role = await roleIn(db, teamId, userId);
  if (!role) fail('Espace de travail introuvable', 404);   // ne révèle pas l'existence aux non-membres
  return role;
}
async function spaceAccess(db, spaceId, userId) {
  const space = await db.prepare('SELECT * FROM pm_spaces WHERE id = ?').bind(spaceId).first();
  if (!space) fail('Espace introuvable', 404);
  return { space, role: await teamRole(db, space.team_id, userId) };
}
async function listAccess(db, listId, userId) {
  const list = await db.prepare('SELECT l.*, s.team_id FROM pm_lists l JOIN pm_spaces s ON s.id = l.space_id WHERE l.id = ?').bind(listId).first();
  if (!list) fail('Liste introuvable', 404);
  return { list, role: await teamRole(db, list.team_id, userId) };
}
async function taskAccess(db, taskId, userId) {
  const task = await db.prepare('SELECT t.*, s.team_id, l.statuses FROM pm_tasks t JOIN pm_lists l ON l.id = t.list_id JOIN pm_spaces s ON s.id = l.space_id WHERE t.id = ?').bind(taskId).first();
  if (!task) fail('Tâche introuvable', 404);
  return { task, role: await teamRole(db, task.team_id, userId) };
}
const members = async (db, teamId) => (await db.prepare('SELECT u.id, u.handle, u.name, mb.role FROM tm_members mb JOIN tm_users u ON u.id = mb.user_id WHERE mb.team_id = ? ORDER BY mb.joined_at').bind(teamId).all()).results;

/* ===========================================================================
   Migration automatique des anciens projets d'équipe (même identifiants)
   =========================================================================== */
async function migrateTeam(db, teamId, userId) {
  const legacy = (await db.prepare('SELECT p.* FROM tm_projects p WHERE p.team_id = ? AND NOT EXISTS (SELECT 1 FROM pm_lists l WHERE l.id = p.id)').bind(teamId).all()).results;
  let space = await db.prepare('SELECT id FROM pm_spaces WHERE team_id = ? ORDER BY position, created_at LIMIT 1').bind(teamId).first();
  if (!space) {
    space = { id: uuid() };
    await db.prepare('INSERT INTO pm_spaces (id, team_id, name, color, position, created_by, created_at) VALUES (?, ?, ?, ?, 0, ?, ?)').bind(space.id, teamId, 'Général', '#2F45D8', userId, now()).run();
  }
  if (!legacy.length) return;
  const stmts = [];
  const prio = { 3: 1, 2: 2, 0: 0 };
  for (const [i, p] of legacy.entries()) {
    stmts.push(db.prepare('INSERT INTO pm_lists (id, space_id, folder_id, name, description, statuses, position, created_by, created_at) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?)')
      .bind(p.id, space.id, p.name, p.description || '', JSON.stringify(DEFAULT_STATUSES), i + 1, p.created_by, p.created_at));
    const tasks = (await db.prepare('SELECT * FROM tm_tasks WHERE project_id = ?').bind(p.id).all()).results;
    for (const [j, t] of tasks.entries()) {
      stmts.push(db.prepare(`INSERT INTO pm_tasks (id, list_id, title, description, status, priority, due_date, position, created_by, created_at, updated_at, completed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`)
        .bind(t.id, p.id, t.title, t.description || '', ['todo', 'doing', 'done'].includes(t.status) ? t.status : 'todo', prio[t.priority] ?? 0, t.due || '', j + 1, t.created_by, t.created_at, t.updated_at, t.status === 'done' ? t.updated_at : null));
      if (t.assignee_id) stmts.push(db.prepare('INSERT INTO pm_assignees (task_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING').bind(t.id, t.assignee_id));
    }
  }
  for (let i = 0; i < stmts.length; i += 80) await db.batch(stmts.slice(i, i + 80));
}

/* ===========================================================================
   Lecture des tâches (avec responsables, sous-tâches, checklist, dépendances…)
   =========================================================================== */
function scopeSql(scope) {
  // scope : { team } | { space } | { list } | { mine: userId, team? } ; renvoie [where, binds]
  const w = ['1 = 1'], b = [];
  if (scope.team) { w.push('s.team_id = ?'); b.push(scope.team); }
  if (scope.space) { w.push('l.space_id = ?'); b.push(scope.space); }
  if (scope.folder) { w.push('l.folder_id = ?'); b.push(scope.folder); }
  if (scope.list) { w.push('t.list_id = ?'); b.push(scope.list); }
  if (scope.mine) { w.push('t.id IN (SELECT task_id FROM pm_assignees WHERE user_id = ?)'); b.push(scope.mine); }
  if (scope.teams) { w.push(`s.team_id IN (${scope.teams.map(() => '?').join(',')})`); b.push(...scope.teams); }
  if (!scope.archived) w.push('t.archived = 0 AND l.archived = 0 AND s.archived = 0');
  return [w.join(' AND '), b];
}
const FROM = 'FROM pm_tasks t JOIN pm_lists l ON l.id = t.list_id JOIN pm_spaces s ON s.id = l.space_id';

function taskOut(t, aux) {
  const statuses = parse(t.statuses, DEFAULT_STATUSES);
  const st = statuses.find((x) => x.key === t.status) || statuses[0];
  return {
    id: t.id, listId: t.list_id, parentId: t.parent_id, title: t.title, description: t.description, status: t.status,
    statusType: st?.type || 'open', priority: t.priority, start: t.start_date, due: t.due_date, estimate: t.estimate_min,
    tags: parse(t.tags, []), custom: parse(t.custom, {}), position: t.position, milestone: !!t.milestone, recurrence: t.recurrence,
    archived: !!t.archived, createdBy: t.created_by, createdAt: t.created_at, updatedAt: t.updated_at, completedAt: t.completed_at,
    assignees: aux?.assignees?.get(t.id) || [], subtasks: aux?.subs?.get(t.id) || { total: 0, done: 0 },
    checklist: aux?.check?.get(t.id) || { total: 0, done: 0 }, blockedBy: aux?.deps?.get(t.id) || [],
    comments: aux?.comments?.get(t.id) || 0, timeSpent: aux?.time?.get(t.id) || 0,
  };
}

async function loadTasks(db, scope) {
  const [where, binds] = scopeSql(scope);
  const q = (sql) => db.prepare(sql).bind(...binds);
  const [rows, asg, chk, dep, com, tim] = await db.batch([
    q(`SELECT t.*, l.statuses ${FROM} WHERE ${where} ORDER BY t.position, t.created_at LIMIT 5000`),
    q(`SELECT a.task_id, a.user_id ${FROM} JOIN pm_assignees a ON a.task_id = t.id WHERE ${where}`),
    q(`SELECT c.task_id, COUNT(*) AS total, SUM(c.done) AS done ${FROM} JOIN pm_checklist c ON c.task_id = t.id WHERE ${where} GROUP BY c.task_id`),
    q(`SELECT d.task_id, d.blocked_by ${FROM} JOIN pm_deps d ON d.task_id = t.id WHERE ${where}`),
    q(`SELECT c.task_id, COUNT(*) AS n ${FROM} JOIN pm_comments c ON c.task_id = t.id WHERE ${where} GROUP BY c.task_id`),
    q(`SELECT m.task_id, SUM(CASE WHEN m.ended_at IS NULL THEN 0 ELSE m.minutes END) AS mins ${FROM} JOIN pm_time m ON m.task_id = t.id WHERE ${where} GROUP BY m.task_id`),
  ]);
  const group = (r, k, v) => { const m = new Map(); for (const x of r) { if (!m.has(x[k])) m.set(x[k], []); m.get(x[k]).push(x[v]); } return m; };
  const aux = {
    assignees: group(asg.results, 'task_id', 'user_id'),
    check: new Map(chk.results.map((x) => [x.task_id, { total: x.total, done: x.done || 0 }])),
    deps: group(dep.results, 'task_id', 'blocked_by'),
    comments: new Map(com.results.map((x) => [x.task_id, x.n])),
    time: new Map(tim.results.map((x) => [x.task_id, x.mins || 0])),
    subs: new Map(),
  };
  const tasks = rows.results;
  const typeOf = new Map(tasks.map((t) => [t.id, (parse(t.statuses, DEFAULT_STATUSES).find((x) => x.key === t.status) || {}).type]));
  for (const t of tasks) if (t.parent_id) {
    const s = aux.subs.get(t.parent_id) || { total: 0, done: 0 };
    s.total++; if (typeOf.get(t.id) === 'closed') s.done++;
    aux.subs.set(t.parent_id, s);
  }
  return tasks.map((t) => taskOut(t, aux));
}

/* ===========================================================================
   Activité, notifications, temps réel
   =========================================================================== */
const log = (db, task, userId, kind, detail = '') => db.prepare('INSERT INTO pm_activity (task_id, list_id, user_id, kind, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)')
  .bind(task.id, task.list_id, userId, kind, typeof detail === 'string' ? detail : JSON.stringify(detail), now());
function notifyUsers(db, teamId, userIds, actor, kind, taskId, text) {
  return [...new Set(userIds)].filter((u) => u && u !== actor.id)
    .map((u) => db.prepare('INSERT INTO pm_notifications (id, user_id, team_id, kind, task_id, actor_id, text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(uuid(), u, teamId, kind, taskId, actor.id, text.slice(0, 300), now()));
}
async function broadcastTask(env, db, listId, taskId, action = 'upsert') {
  if (action === 'delete') return notify(env, listId, { type: 'pm', action, id: taskId });
  const [task] = await loadTasks(db, { list: listId, archived: true }).then((all) => all.filter((t) => t.id === taskId));
  if (task) await notify(env, listId, { type: 'pm', action, task });
}

/* ===========================================================================
   Validation d'une tâche
   =========================================================================== */
function validateTask(b, { partial, statuses, fields }) {
  const out = {};
  if (!partial || b.title !== undefined) out.title = str(b.title, 1, 250, 'Titre');
  if (b.description !== undefined) out.description = str(b.description ?? '', 0, 20000, 'Description');
  if (b.status !== undefined) { if (!statuses.some((s) => s.key === b.status)) fail('Statut inconnu pour cette liste', 400); out.status = b.status; }
  if (b.priority !== undefined) out.priority = intIn(b.priority, 0, 4, 'Priorité');
  if (b.start !== undefined) out.start = date(b.start, 'Date de début');
  if (b.due !== undefined) out.due = date(b.due, 'Échéance');
  if (out.start && out.due && out.start > out.due) fail('La date de début doit précéder l’échéance', 400);
  if (b.estimate !== undefined) out.estimate = intIn(b.estimate || 0, 0, 100000, 'Estimation');
  if (b.tags !== undefined) {
    if (!Array.isArray(b.tags) || b.tags.length > 20) fail('Étiquettes invalides', 400);
    out.tags = [...new Set(b.tags.map((x) => String(x).trim().toLowerCase().slice(0, 30)).filter(Boolean))];
  }
  if (b.custom !== undefined) {
    if (!b.custom || typeof b.custom !== 'object' || Array.isArray(b.custom)) fail('Champs personnalisés invalides', 400);
    const c = {};
    for (const [k, v] of Object.entries(b.custom)) {
      const f = fields.find((x) => x.id === k); if (!f) continue;
      if (v === null || v === '') continue;
      if (f.type === 'number') { const n = Number(v); if (!Number.isFinite(n)) fail(`${f.name} : nombre attendu`, 400); c[k] = n; }
      else if (f.type === 'checkbox') c[k] = !!v;
      else if (f.type === 'date') c[k] = date(String(v), f.name);
      else if (f.type === 'select') { const opts = parse(f.options, []); if (!opts.some((o) => o.id === v)) fail(`${f.name} : option inconnue`, 400); c[k] = v; }
      else if (f.type === 'url') { const s = String(v).slice(0, 500); if (!/^https?:\/\//i.test(s)) fail(`${f.name} : lien http(s) attendu`, 400); c[k] = s; }
      else c[k] = String(v).slice(0, 1000);
    }
    out.custom = c;
  }
  if (b.milestone !== undefined) out.milestone = b.milestone ? 1 : 0;
  if (b.recurrence !== undefined) { if (!RECURRENCES.includes(b.recurrence)) fail('Récurrence invalide', 400); out.recurrence = b.recurrence; }
  if (b.archived !== undefined) out.archived = b.archived ? 1 : 0;
  if (b.position !== undefined) { const n = Number(b.position); if (!Number.isFinite(n)) fail('Position invalide', 400); out.position = n; }
  if (b.assignees !== undefined) { if (!Array.isArray(b.assignees) || b.assignees.length > 20) fail('Responsables invalides', 400); out.assignees = [...new Set(b.assignees.map(String))]; }
  return out;
}
const shiftDate = (d, rec) => {
  if (!d) return '';
  const x = new Date(d + 'T12:00:00Z');
  if (rec === 'daily') x.setUTCDate(x.getUTCDate() + 1); else if (rec === 'weekly') x.setUTCDate(x.getUTCDate() + 7); else if (rec === 'monthly') x.setUTCMonth(x.getUTCMonth() + 1);
  return x.toISOString().slice(0, 10);
};

/* ===========================================================================
   Mise à jour d'une tâche (utilisée par PATCH et les actions groupées)
   =========================================================================== */
async function applyTaskPatch(env, db, user, task, body) {
  const statuses = parse(task.statuses, DEFAULT_STATUSES);
  const fields = (await db.prepare('SELECT * FROM pm_fields WHERE list_id = ?').bind(task.list_id).all()).results;
  let targetList = null;
  if (body.listId !== undefined && body.listId !== task.list_id) {
    const { list } = await listAccess(db, String(body.listId), user.id);
    if (list.team_id !== task.team_id) fail('Déplacement vers un autre espace de travail impossible', 400);
    targetList = list;
  }
  const v = validateTask(body, { partial: true, statuses: targetList ? parse(targetList.statuses, DEFAULT_STATUSES) : statuses, fields });
  if (body.parentId !== undefined) {
    if (body.parentId === null || body.parentId === '') v.parentId = null;
    else {
      if (body.parentId === task.id) fail('Une tâche ne peut pas être sa propre sous-tâche', 400);
      const p = await db.prepare('SELECT id, list_id, parent_id FROM pm_tasks WHERE id = ?').bind(String(body.parentId)).first();
      if (!p || p.list_id !== (targetList?.id || task.list_id)) fail('Tâche parente introuvable dans cette liste', 400);
      if (p.parent_id) fail('Une sous-tâche ne peut pas avoir de sous-tâches', 400);
      v.parentId = p.id;
    }
  }
  const team = await members(db, task.team_id);
  if (v.assignees) for (const a of v.assignees) if (!team.some((m) => m.id === a)) fail('Ce membre ne fait pas partie de l’équipe', 400);

  const nextStatuses = targetList ? parse(targetList.statuses, DEFAULT_STATUSES) : statuses;
  let status = v.status ?? task.status;
  if (targetList && !nextStatuses.some((s) => s.key === status)) status = nextStatuses[0].key;   // statut inconnu dans la liste cible
  const wasClosed = (statuses.find((s) => s.key === task.status) || {}).type === 'closed';
  const isClosed = (nextStatuses.find((s) => s.key === status) || {}).type === 'closed';

  // Dépendances : fermer une tâche encore bloquée demande confirmation (force)
  if (isClosed && !wasClosed && !body.force) {
    const blockers = (await db.prepare(`SELECT b.id, b.title, b.status, l.statuses FROM pm_deps d JOIN pm_tasks b ON b.id = d.blocked_by JOIN pm_lists l ON l.id = b.list_id WHERE d.task_id = ?`).bind(task.id).all()).results
      .filter((b) => (parse(b.statuses, DEFAULT_STATUSES).find((s) => s.key === b.status) || {}).type !== 'closed');
    if (blockers.length) return { conflict: { error: 'Cette tâche est bloquée par des tâches non terminées', blockers: blockers.map((b) => ({ id: b.id, title: b.title })) } };
  }

  const start = v.start ?? task.start_date, due = v.due ?? task.due_date;
  if (start && due && start > due) fail('La date de début doit précéder l’échéance', 400);
  const n = {
    title: v.title ?? task.title, description: v.description ?? task.description, status, priority: v.priority ?? task.priority,
    start_date: start, due_date: due, estimate_min: v.estimate ?? task.estimate_min, tags: JSON.stringify(v.tags ?? parse(task.tags, [])),
    custom: JSON.stringify(v.custom !== undefined ? { ...parse(task.custom, {}), ...v.custom, ...Object.fromEntries(Object.entries(body.custom || {}).filter(([, x]) => x === null || x === '').map(([k]) => [k, undefined])) } : parse(task.custom, {})),
    position: v.position ?? task.position, milestone: v.milestone ?? task.milestone, recurrence: v.recurrence ?? task.recurrence,
    archived: v.archived ?? task.archived, list_id: targetList?.id || task.list_id, parent_id: v.parentId !== undefined ? v.parentId : (targetList ? null : task.parent_id),
    completed_at: isClosed ? (wasClosed ? task.completed_at : now()) : null,
  };
  const stmts = [db.prepare(`UPDATE pm_tasks SET title = ?, description = ?, status = ?, priority = ?, start_date = ?, due_date = ?, estimate_min = ?, tags = ?, custom = ?, position = ?,
      milestone = ?, recurrence = ?, archived = ?, list_id = ?, parent_id = ?, completed_at = ?, updated_at = ? WHERE id = ?`)
    .bind(n.title, n.description, n.status, n.priority, n.start_date, n.due_date, n.estimate_min, n.tags, n.custom, n.position, n.milestone, n.recurrence, n.archived, n.list_id, n.parent_id, n.completed_at, now(), task.id)];
  if (targetList) stmts.push(db.prepare('UPDATE pm_tasks SET list_id = ? WHERE parent_id = ?').bind(targetList.id, task.id));

  // Historique
  const changes = [];
  if (v.title !== undefined && v.title !== task.title) changes.push(['rename', v.title]);
  if (status !== task.status) changes.push(['status', { from: task.status, to: status }]);
  if (v.priority !== undefined && v.priority !== task.priority) changes.push(['priority', v.priority]);
  if (v.due !== undefined && v.due !== task.due_date) changes.push(['due', v.due]);
  if (v.start !== undefined && v.start !== task.start_date) changes.push(['start', v.start]);
  if (targetList) changes.push(['move', targetList.name]);
  if (v.archived !== undefined && v.archived !== task.archived) changes.push([v.archived ? 'archive' : 'unarchive', '']);
  for (const [k, d] of changes) stmts.push(log(db, { id: task.id, list_id: n.list_id }, user.id, k, d));

  // Responsables
  let added = [];
  if (v.assignees) {
    const before = (await db.prepare('SELECT user_id FROM pm_assignees WHERE task_id = ?').bind(task.id).all()).results.map((r) => r.user_id);
    added = v.assignees.filter((a) => !before.includes(a));
    stmts.push(db.prepare('DELETE FROM pm_assignees WHERE task_id = ?').bind(task.id));
    for (const a of v.assignees) stmts.push(db.prepare('INSERT INTO pm_assignees (task_id, user_id) VALUES (?, ?)').bind(task.id, a));
    if (added.length || v.assignees.length !== before.length) stmts.push(log(db, { id: task.id, list_id: n.list_id }, user.id, 'assignees', v.assignees));
    stmts.push(...notifyUsers(db, task.team_id, added, user, 'assigned', task.id, `${user.name} vous a assigné « ${n.title} »`));
    for (const a of added) stmts.push(db.prepare('INSERT INTO pm_watchers (task_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING').bind(task.id, a));
  }
  if (status !== task.status) {
    const watchers = (await db.prepare('SELECT user_id FROM pm_watchers WHERE task_id = ?').bind(task.id).all()).results.map((r) => r.user_id);
    const label = (nextStatuses.find((s) => s.key === status) || {}).name || status;
    stmts.push(...notifyUsers(db, task.team_id, watchers.filter((w) => !added.includes(w)), user, 'status', task.id, `« ${n.title} » est passée à « ${label} »`));
  }
  // Récurrence : à la clôture, la prochaine occurrence est créée
  if (isClosed && !wasClosed && n.recurrence && !body.force_no_recur) {
    const nid = uuid(), t = now();
    stmts.push(db.prepare(`INSERT INTO pm_tasks (id, list_id, parent_id, title, description, status, priority, start_date, due_date, estimate_min, tags, custom, position, milestone, recurrence, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(nid, n.list_id, n.parent_id, n.title, n.description, nextStatuses[0].key, n.priority, shiftDate(n.start_date, n.recurrence), shiftDate(n.due_date || new Date().toISOString().slice(0, 10), n.recurrence),
        n.estimate_min, n.tags, n.custom, n.position + 0.001, n.milestone, n.recurrence, user.id, t, t));
    stmts.push(db.prepare('INSERT INTO pm_assignees (task_id, user_id) SELECT ?, user_id FROM pm_assignees WHERE task_id = ?').bind(nid, task.id));
    stmts.push(log(db, { id: nid, list_id: n.list_id }, user.id, 'recurred', task.id));
  }
  await db.batch(stmts);
  return { listId: n.list_id, fromList: targetList ? task.list_id : null };
}

/* ===========================================================================
   Routeur /api/pm
   =========================================================================== */
export async function handlePm(req, env, url) {
  const db = env.DB, m = req.method;
  const path = url.pathname.replace(/^\/api\/pm/, '').replace(/\/+$/, '') || '/';
  const seg = path.split('/').filter(Boolean);
  const user = await userFromRequest(req, db);
  if (!user) return err('Connexion requise', 401);
  const body = () => readJson(req);

  /* ---------- Arborescence d'une équipe ---------- */
  if (seg[0] === 'teams' && seg[1] && seg[2] === 'tree' && m === 'GET') {
    const teamId = seg[1]; const role = await teamRole(db, teamId, user.id);
    await migrateTeam(db, teamId, user.id);
    const [spaces, folders, lists, counts, tags, unread] = await db.batch([
      db.prepare('SELECT id, name, color, position, archived FROM pm_spaces WHERE team_id = ? ORDER BY position, created_at').bind(teamId),
      db.prepare('SELECT f.id, f.space_id AS spaceId, f.name, f.position, f.archived FROM pm_folders f JOIN pm_spaces s ON s.id = f.space_id WHERE s.team_id = ? ORDER BY f.position, f.created_at').bind(teamId),
      db.prepare('SELECT l.id, l.space_id AS spaceId, l.folder_id AS folderId, l.name, l.description, l.color, l.statuses, l.position, l.archived FROM pm_lists l JOIN pm_spaces s ON s.id = l.space_id WHERE s.team_id = ? ORDER BY l.position, l.created_at').bind(teamId),
      db.prepare(`SELECT t.list_id, t.status, COUNT(*) AS n FROM pm_tasks t JOIN pm_lists l ON l.id = t.list_id JOIN pm_spaces s ON s.id = l.space_id WHERE s.team_id = ? AND t.archived = 0 AND t.parent_id IS NULL GROUP BY t.list_id, t.status`).bind(teamId),
      db.prepare(`SELECT DISTINCT j.value AS tag FROM pm_tasks t JOIN pm_lists l ON l.id = t.list_id JOIN pm_spaces s ON s.id = l.space_id, json_each(t.tags) j WHERE s.team_id = ? LIMIT 300`).bind(teamId),
      db.prepare('SELECT COUNT(*) AS n FROM pm_notifications WHERE user_id = ? AND team_id = ? AND read_at IS NULL').bind(user.id, teamId),
    ]);
    const team = await db.prepare('SELECT id, name, owner_id FROM tm_teams WHERE id = ?').bind(teamId).first();
    const byList = new Map();
    for (const c of counts.results) { const x = byList.get(c.list_id) || {}; x[c.status] = c.n; byList.set(c.list_id, x); }
    const running = await db.prepare('SELECT m.id, m.task_id AS taskId, m.started_at AS startedAt, t.title FROM pm_time m JOIN pm_tasks t ON t.id = m.task_id WHERE m.user_id = ? AND m.ended_at IS NULL').bind(user.id).first();
    return json({
      team, role, me: user, members: await members(db, teamId), unread: unread.results[0].n, running: running || null,
      spaces: spaces.results.map((s) => ({ ...s, archived: !!s.archived })), folders: folders.results.map((f) => ({ ...f, archived: !!f.archived })),
      lists: lists.results.map((l) => ({ ...l, statuses: parse(l.statuses, DEFAULT_STATUSES), archived: !!l.archived, counts: byList.get(l.id) || {} })),
      tags: tags.results.map((r) => r.tag).sort(),
    });
  }

  /* ---------- Espaces ---------- */
  if (seg[0] === 'teams' && seg[1] && seg[2] === 'spaces' && m === 'POST') {
    await teamRole(db, seg[1], user.id);
    const b = await body(); const id = uuid();
    const pos = (await db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM pm_spaces WHERE team_id = ?').bind(seg[1]).first()).p;
    await db.prepare('INSERT INTO pm_spaces (id, team_id, name, color, position, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(id, seg[1], str(b.name, 1, 60, 'Nom de l’espace'), color(b.color, '#2F45D8'), pos, user.id, now()).run();
    return json({ space: { id } }, 201);
  }
  if (seg[0] === 'spaces' && seg[1] && seg.length === 2) {
    const { space, role } = await spaceAccess(db, seg[1], user.id);
    if (m === 'PATCH') {
      const b = await body();
      await db.prepare('UPDATE pm_spaces SET name = ?, color = ?, position = ?, archived = ? WHERE id = ?').bind(
        b.name !== undefined ? str(b.name, 1, 60, 'Nom de l’espace') : space.name, b.color !== undefined ? color(b.color, space.color) : space.color,
        b.position !== undefined ? Number(b.position) || 0 : space.position, b.archived !== undefined ? (b.archived ? 1 : 0) : space.archived, space.id).run();
      return json({ ok: true });
    }
    if (m === 'DELETE') {
      if (!isAdmin(role)) return err('Réservé aux administrateurs', 403);
      const lists = (await db.prepare('SELECT id FROM pm_lists WHERE space_id = ?').bind(space.id).all()).results.map((r) => r.id);
      for (const lid of lists) await deleteList(db, lid);
      await db.batch([db.prepare('DELETE FROM pm_folders WHERE space_id = ?').bind(space.id), db.prepare('DELETE FROM pm_docs WHERE space_id = ?').bind(space.id), db.prepare('DELETE FROM pm_spaces WHERE id = ?').bind(space.id)]);
      return json({ ok: true });
    }
  }

  /* ---------- Dossiers ---------- */
  if (seg[0] === 'spaces' && seg[1] && seg[2] === 'folders' && m === 'POST') {
    const { space } = await spaceAccess(db, seg[1], user.id); const b = await body(); const id = uuid();
    await db.prepare('INSERT INTO pm_folders (id, space_id, name, position, created_at) VALUES (?, ?, ?, ?, ?)').bind(id, space.id, str(b.name, 1, 60, 'Nom du dossier'), now(), now()).run();
    return json({ folder: { id } }, 201);
  }
  if (seg[0] === 'folders' && seg[1] && seg.length === 2) {
    const f = await db.prepare('SELECT * FROM pm_folders WHERE id = ?').bind(seg[1]).first(); if (!f) return err('Dossier introuvable', 404);
    const { role } = await spaceAccess(db, f.space_id, user.id);
    if (m === 'PATCH') {
      const b = await body();
      await db.prepare('UPDATE pm_folders SET name = ?, position = ?, archived = ? WHERE id = ?').bind(b.name !== undefined ? str(b.name, 1, 60, 'Nom du dossier') : f.name, b.position !== undefined ? Number(b.position) || 0 : f.position, b.archived !== undefined ? (b.archived ? 1 : 0) : f.archived, f.id).run();
      return json({ ok: true });
    }
    if (m === 'DELETE') {
      if (!isAdmin(role)) return err('Réservé aux administrateurs', 403);
      await db.prepare('UPDATE pm_lists SET folder_id = NULL WHERE folder_id = ?').bind(f.id).run();   // les listes remontent dans l'espace
      await db.prepare('DELETE FROM pm_folders WHERE id = ?').bind(f.id).run();
      return json({ ok: true });
    }
  }

  /* ---------- Listes ---------- */
  if (seg[0] === 'spaces' && seg[1] && seg[2] === 'lists' && m === 'POST') {
    const { space } = await spaceAccess(db, seg[1], user.id); const b = await body(); const id = uuid();
    let folder = null;
    if (b.folderId) { folder = await db.prepare('SELECT id FROM pm_folders WHERE id = ? AND space_id = ?').bind(String(b.folderId), space.id).first(); if (!folder) fail('Dossier introuvable', 400); }
    await db.prepare('INSERT INTO pm_lists (id, space_id, folder_id, name, description, color, statuses, position, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, space.id, folder?.id || null, str(b.name, 1, 80, 'Nom de la liste'), str(b.description ?? '', 0, 1000, 'Description'), color(b.color, ''), JSON.stringify(validStatuses(b.statuses) || DEFAULT_STATUSES), now(), user.id, now()).run();
    return json({ list: { id } }, 201);
  }
  if (seg[0] === 'lists' && seg[1]) {
    const { list, role } = await listAccess(db, seg[1], user.id);
    if (seg.length === 2 && m === 'GET') {
      const fields = (await db.prepare('SELECT id, name, type, options, position FROM pm_fields WHERE list_id = ? ORDER BY position').bind(list.id).all()).results.map((f) => ({ ...f, options: parse(f.options, []) }));
      const messages = (await db.prepare('SELECT m.id, m.user_id AS userId, u.name, u.handle, m.body, m.created_at AS createdAt FROM tm_messages m JOIN tm_users u ON u.id = m.user_id WHERE m.project_id = ? ORDER BY m.id DESC LIMIT 100').bind(list.id).all()).results.reverse();
      return json({ list: { id: list.id, spaceId: list.space_id, folderId: list.folder_id, name: list.name, description: list.description, color: list.color, statuses: parse(list.statuses, DEFAULT_STATUSES) }, fields, messages, role });
    }
    if (seg.length === 2 && m === 'PATCH') {
      const b = await body();
      let statuses = parse(list.statuses, DEFAULT_STATUSES);
      const stmts = [];
      if (b.statuses !== undefined) {
        const next = validStatuses(b.statuses); if (!next) fail('Statuts invalides : au moins un statut ouvert et un statut terminé', 400);
        // statut supprimé : ses tâches sont déplacées vers le statut de remplacement (ou le premier)
        for (const s of statuses) if (!next.some((x) => x.key === s.key)) {
          const to = next.some((x) => x.key === b.remap?.[s.key]) ? b.remap[s.key] : next[0].key;
          stmts.push(db.prepare('UPDATE pm_tasks SET status = ?, updated_at = ? WHERE list_id = ? AND status = ?').bind(to, now(), list.id, s.key));
        }
        statuses = next;
      }
      let folderId = list.folder_id;
      if (b.folderId !== undefined) {
        if (!b.folderId) folderId = null;
        else { const f = await db.prepare('SELECT id FROM pm_folders WHERE id = ? AND space_id = ?').bind(String(b.folderId), b.spaceId || list.space_id).first(); if (!f) fail('Dossier introuvable', 400); folderId = f.id; }
      }
      let spaceId = list.space_id;
      if (b.spaceId !== undefined && b.spaceId !== list.space_id) { const { space } = await spaceAccess(db, String(b.spaceId), user.id); if (space.team_id !== list.team_id) fail('Espace invalide', 400); spaceId = space.id; if (b.folderId === undefined) folderId = null; }
      stmts.push(db.prepare('UPDATE pm_lists SET name = ?, description = ?, color = ?, statuses = ?, folder_id = ?, space_id = ?, position = ?, archived = ? WHERE id = ?').bind(
        b.name !== undefined ? str(b.name, 1, 80, 'Nom de la liste') : list.name, b.description !== undefined ? str(b.description ?? '', 0, 1000, 'Description') : list.description,
        b.color !== undefined ? color(b.color, '') : list.color, JSON.stringify(statuses), folderId, spaceId,
        b.position !== undefined ? Number(b.position) || 0 : list.position, b.archived !== undefined ? (b.archived ? 1 : 0) : list.archived, list.id));
      await db.batch(stmts);
      await notify(env, list.id, { type: 'pm', action: 'list' });
      return json({ ok: true, statuses });
    }
    if (seg.length === 2 && m === 'DELETE') {
      if (!isAdmin(role)) return err('Réservé aux administrateurs', 403);
      await deleteList(db, list.id);
      return json({ ok: true });
    }
    if (seg[2] === 'fields' && m === 'POST') {
      const b = await body(); const type = String(b.type || '');
      if (!FIELD_TYPES.includes(type)) fail('Type de champ invalide', 400);
      const count = (await db.prepare('SELECT COUNT(*) AS n FROM pm_fields WHERE list_id = ?').bind(list.id).first()).n;
      if (count >= 30) fail('30 champs personnalisés au maximum par liste', 400);
      const id = uuid();
      await db.prepare('INSERT INTO pm_fields (id, list_id, name, type, options, position) VALUES (?, ?, ?, ?, ?, ?)').bind(id, list.id, str(b.name, 1, 40, 'Nom du champ'), type, JSON.stringify(type === 'select' ? validOptions(b.options) : []), count + 1).run();
      return json({ field: { id } }, 201);
    }
    if (seg[2] === 'tasks' && m === 'POST') {
      const b = await body();
      const statuses = parse(list.statuses, DEFAULT_STATUSES);
      const fields = (await db.prepare('SELECT * FROM pm_fields WHERE list_id = ?').bind(list.id).all()).results;
      const v = validateTask(b, { partial: false, statuses, fields });
      let parentId = null;
      if (b.parentId) { const p = await db.prepare('SELECT id, parent_id FROM pm_tasks WHERE id = ? AND list_id = ?').bind(String(b.parentId), list.id).first(); if (!p || p.parent_id) fail('Tâche parente invalide', 400); parentId = p.id; }
      const team = await members(db, list.team_id);
      for (const a of v.assignees || []) if (!team.some((x) => x.id === a)) fail('Ce membre ne fait pas partie de l’équipe', 400);
      const id = uuid(), t = now();
      const pos = v.position ?? (await db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM pm_tasks WHERE list_id = ?').bind(list.id).first()).p;
      const st = v.status ?? statuses[0].key, closed = (statuses.find((s) => s.key === st) || {}).type === 'closed';
      const stmts = [db.prepare(`INSERT INTO pm_tasks (id, list_id, parent_id, title, description, status, priority, start_date, due_date, estimate_min, tags, custom, position, milestone, recurrence, created_by, created_at, updated_at, completed_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(id, list.id, parentId, v.title, v.description ?? '', st, v.priority ?? 0, v.start ?? '', v.due ?? '', v.estimate ?? 0, JSON.stringify(v.tags || []), JSON.stringify(v.custom || {}), pos, v.milestone ?? 0, v.recurrence ?? '', user.id, t, t, closed ? t : null),
        log(db, { id, list_id: list.id }, user.id, 'created', parentId ? 'subtask' : ''),
        db.prepare('INSERT INTO pm_watchers (task_id, user_id) VALUES (?, ?)').bind(id, user.id)];
      for (const a of v.assignees || []) stmts.push(db.prepare('INSERT INTO pm_assignees (task_id, user_id) VALUES (?, ?)').bind(id, a), db.prepare('INSERT INTO pm_watchers (task_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING').bind(id, a));
      stmts.push(...notifyUsers(db, list.team_id, v.assignees || [], user, 'assigned', id, `${user.name} vous a assigné « ${v.title} »`));
      await db.batch(stmts);
      await broadcastTask(env, db, list.id, id);
      return json({ task: (await loadTasks(db, { list: list.id, archived: true })).find((x) => x.id === id) }, 201);
    }
    if (seg[2] === 'ws' && m === 'GET') {
      if (req.headers.get('upgrade') !== 'websocket') return err('WebSocket requis', 426);
      const origin = req.headers.get('origin');
      if (origin && origin !== url.origin) return err('Origine non autorisée', 403);
      if (!env.ROOM) return err('Temps réel indisponible', 503);
      const fwd = new Request('https://room/ws', { headers: { upgrade: 'websocket', 'x-user-id': user.id, 'x-user-name': encodeURIComponent(user.name), 'x-user-handle': user.handle, 'x-project-id': list.id } });
      return env.ROOM.get(env.ROOM.idFromName(list.id)).fetch(fwd);
    }
  }
  if (seg[0] === 'fields' && seg[1] && seg.length === 2) {
    const f = await db.prepare('SELECT * FROM pm_fields WHERE id = ?').bind(seg[1]).first(); if (!f) return err('Champ introuvable', 404);
    await listAccess(db, f.list_id, user.id);
    if (m === 'PATCH') {
      const b = await body();
      await db.prepare('UPDATE pm_fields SET name = ?, options = ?, position = ? WHERE id = ?').bind(b.name !== undefined ? str(b.name, 1, 40, 'Nom du champ') : f.name,
        f.type === 'select' && b.options !== undefined ? JSON.stringify(validOptions(b.options)) : f.options, b.position !== undefined ? Number(b.position) || 0 : f.position, f.id).run();
      return json({ ok: true });
    }
    if (m === 'DELETE') { await db.prepare('DELETE FROM pm_fields WHERE id = ?').bind(f.id).run(); return json({ ok: true }); }
  }

  /* ---------- Tâches : lecture transversale ---------- */
  if (path === '/tasks' && m === 'GET') {
    const p = url.searchParams, scope = { archived: p.get('archived') === '1' };
    if (p.get('list')) { const { list } = await listAccess(db, p.get('list'), user.id); scope.list = list.id; }
    else if (p.get('folder')) { const f = await db.prepare('SELECT * FROM pm_folders WHERE id = ?').bind(p.get('folder')).first(); if (!f) return err('Dossier introuvable', 404); await spaceAccess(db, f.space_id, user.id); scope.folder = f.id; }
    else if (p.get('space')) { const { space } = await spaceAccess(db, p.get('space'), user.id); scope.space = space.id; }
    else if (p.get('team')) { await teamRole(db, p.get('team'), user.id); scope.team = p.get('team'); }
    else {   // « Mes tâches » sur toutes mes équipes
      const teams = (await db.prepare('SELECT team_id FROM tm_members WHERE user_id = ?').bind(user.id).all()).results.map((r) => r.team_id);
      if (!teams.length) return json({ tasks: [] });
      scope.teams = teams;
    }
    if (p.get('mine') === '1' || !(p.get('list') || p.get('folder') || p.get('space') || p.get('team'))) scope.mine = user.id;
    return json({ tasks: await loadTasks(db, scope) });
  }
  if (path === '/tasks/bulk' && m === 'POST') {
    const b = await body();
    if (!Array.isArray(b.ids) || !b.ids.length || b.ids.length > 200) fail('Sélection invalide (200 tâches maximum)', 400);
    const res = { updated: 0, conflicts: [] }, lists = new Set();
    for (const id of b.ids) {
      const { task } = await taskAccess(db, String(id), user.id);
      if (b.delete) { await deleteTasks(db, [task.id]); lists.add(task.list_id); await notify(env, task.list_id, { type: 'pm', action: 'delete', id: task.id }); res.updated++; continue; }
      const r = await applyTaskPatch(env, db, user, task, b.patch || {});
      if (r.conflict) { res.conflicts.push({ id: task.id, ...r.conflict }); continue; }
      res.updated++; await broadcastTask(env, db, r.listId, task.id);
    }
    return json(res);
  }

  /* ---------- Tâche : détail et actions ---------- */
  if (seg[0] === 'tasks' && seg[1]) {
    const { task, role } = await taskAccess(db, seg[1], user.id);
    const others = seg.slice(2);
    if (!others.length && m === 'GET') {
      const all = await loadTasks(db, { list: task.list_id, archived: true });
      const me = all.find((t) => t.id === task.id);
      const [check, comments, activity, time, deps, blocking, watchers, fields] = await db.batch([
        db.prepare('SELECT id, text, done, position FROM pm_checklist WHERE task_id = ? ORDER BY position').bind(task.id),
        db.prepare('SELECT c.id, c.user_id AS userId, u.name, u.handle, c.body, c.created_at AS createdAt, c.edited_at AS editedAt FROM pm_comments c JOIN tm_users u ON u.id = c.user_id WHERE c.task_id = ? ORDER BY c.created_at').bind(task.id),
        db.prepare('SELECT a.id, a.user_id AS userId, u.name, a.kind, a.detail, a.created_at AS createdAt FROM pm_activity a JOIN tm_users u ON u.id = a.user_id WHERE a.task_id = ? ORDER BY a.id DESC LIMIT 100').bind(task.id),
        db.prepare('SELECT m.id, m.user_id AS userId, u.name, m.started_at AS startedAt, m.ended_at AS endedAt, m.minutes, m.note FROM pm_time m JOIN tm_users u ON u.id = m.user_id WHERE m.task_id = ? ORDER BY m.started_at DESC').bind(task.id),
        db.prepare('SELECT b.id, b.title, b.status, b.list_id AS listId, l.statuses FROM pm_deps d JOIN pm_tasks b ON b.id = d.blocked_by JOIN pm_lists l ON l.id = b.list_id WHERE d.task_id = ?').bind(task.id),
        db.prepare('SELECT b.id, b.title, b.status, b.list_id AS listId, l.statuses FROM pm_deps d JOIN pm_tasks b ON b.id = d.task_id JOIN pm_lists l ON l.id = b.list_id WHERE d.blocked_by = ?').bind(task.id),
        db.prepare('SELECT user_id FROM pm_watchers WHERE task_id = ?').bind(task.id),
        db.prepare('SELECT id, name, type, options, position FROM pm_fields WHERE list_id = ? ORDER BY position').bind(task.list_id),
      ]);
      const depOut = (r) => r.results.map((b) => { const s = parse(b.statuses, DEFAULT_STATUSES).find((x) => x.key === b.status) || {}; return { id: b.id, title: b.title, listId: b.listId, status: b.status, statusName: s.name, closed: s.type === 'closed' }; });
      return json({
        task: me, role, subtasks: all.filter((t) => t.parentId === task.id), checklist: check.results.map((c) => ({ ...c, done: !!c.done })),
        comments: comments.results, activity: activity.results.map((a) => ({ ...a, detail: parse(a.detail, a.detail) })), time: time.results,
        blockedBy: depOut(deps), blocking: depOut(blocking), watchers: watchers.results.map((w) => w.user_id),
        fields: fields.results.map((f) => ({ ...f, options: parse(f.options, []) })), statuses: parse(task.statuses, DEFAULT_STATUSES),
      });
    }
    if (!others.length && m === 'PATCH') {
      const r = await applyTaskPatch(env, db, user, task, await body());
      if (r.conflict) return json(r.conflict, 409);
      if (r.fromList) await notify(env, r.fromList, { type: 'pm', action: 'delete', id: task.id });
      await broadcastTask(env, db, r.listId, task.id);
      return json({ task: (await loadTasks(db, { list: r.listId, archived: true })).find((x) => x.id === task.id) });
    }
    if (!others.length && m === 'DELETE') {
      await deleteTasks(db, [task.id]);
      await notify(env, task.list_id, { type: 'pm', action: 'delete', id: task.id });
      return json({ ok: true });
    }
    if (others[0] === 'duplicate' && m === 'POST') {
      const id = uuid(), t = now();
      const stmts = [db.prepare(`INSERT INTO pm_tasks (id, list_id, parent_id, title, description, status, priority, start_date, due_date, estimate_min, tags, custom, position, milestone, recurrence, created_by, created_at, updated_at)
          SELECT ?, list_id, parent_id, title || ' (copie)', description, status, priority, start_date, due_date, estimate_min, tags, custom, position + 0.001, milestone, recurrence, ?, ?, ? FROM pm_tasks WHERE id = ?`).bind(id, user.id, t, t, task.id),
        db.prepare('INSERT INTO pm_assignees (task_id, user_id) SELECT ?, user_id FROM pm_assignees WHERE task_id = ?').bind(id, task.id),
        db.prepare('INSERT INTO pm_checklist (id, task_id, text, done, position) SELECT lower(hex(randomblob(16))), ?, text, 0, position FROM pm_checklist WHERE task_id = ?').bind(id, task.id),
        log(db, { id, list_id: task.list_id }, user.id, 'created', 'duplicate')];
      await db.batch(stmts);
      await broadcastTask(env, db, task.list_id, id);
      return json({ task: { id } }, 201);
    }
    if (others[0] === 'comments' && m === 'POST') {
      const text = str((await body()).body, 1, 5000, 'Commentaire'), id = uuid();
      const team = await members(db, task.team_id);
      const mentioned = [...text.matchAll(/@([a-z0-9][a-z0-9._-]{2,31})/gi)].map((x) => team.find((u) => u.handle === x[1].toLowerCase())?.id).filter(Boolean);
      const watchers = (await db.prepare('SELECT user_id FROM pm_watchers WHERE task_id = ?').bind(task.id).all()).results.map((r) => r.user_id);
      await db.batch([
        db.prepare('INSERT INTO pm_comments (id, task_id, user_id, body, created_at) VALUES (?, ?, ?, ?, ?)').bind(id, task.id, user.id, text, now()),
        db.prepare('INSERT INTO pm_watchers (task_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING').bind(task.id, user.id),
        log(db, task, user.id, 'comment', text.slice(0, 120)),
        ...notifyUsers(db, task.team_id, mentioned, user, 'mention', task.id, `${user.name} vous a mentionné dans « ${task.title} » : ${text.slice(0, 140)}`),
        ...notifyUsers(db, task.team_id, watchers.filter((w) => !mentioned.includes(w)), user, 'comment', task.id, `${user.name} a commenté « ${task.title} » : ${text.slice(0, 140)}`),
      ]);
      await broadcastTask(env, db, task.list_id, task.id);
      return json({ comment: { id, userId: user.id, name: user.name, handle: user.handle, body: text, createdAt: now() } }, 201);
    }
    if (others[0] === 'checklist' && m === 'POST') {
      const text = str((await body()).text, 1, 300, 'Élément'), id = uuid();
      const n = (await db.prepare('SELECT COUNT(*) AS n FROM pm_checklist WHERE task_id = ?').bind(task.id).first()).n;
      if (n >= 100) fail('100 éléments au maximum', 400);
      await db.prepare('INSERT INTO pm_checklist (id, task_id, text, position) VALUES (?, ?, ?, ?)').bind(id, task.id, text, n + 1).run();
      await broadcastTask(env, db, task.list_id, task.id);
      return json({ item: { id, text, done: false, position: n + 1 } }, 201);
    }
    if (others[0] === 'deps' && m === 'POST') {
      const other = String((await body()).blockedBy || '');
      if (other === task.id) fail('Une tâche ne peut pas dépendre d’elle-même', 400);
      const { task: o } = await taskAccess(db, other, user.id);
      if (o.team_id !== task.team_id) fail('Dépendance hors de l’espace de travail', 400);
      // pas de cycle : `other` ne doit pas (indirectement) dépendre de `task`
      const seen = new Set([other]); let frontier = [other];
      while (frontier.length) {
        const rows = (await db.prepare(`SELECT blocked_by FROM pm_deps WHERE task_id IN (${frontier.map(() => '?').join(',')})`).bind(...frontier).all()).results.map((r) => r.blocked_by);
        if (rows.includes(task.id)) fail('Cette dépendance créerait une boucle', 400);
        frontier = rows.filter((x) => !seen.has(x)); frontier.forEach((x) => seen.add(x));
      }
      await db.batch([db.prepare('INSERT INTO pm_deps (task_id, blocked_by) VALUES (?, ?) ON CONFLICT DO NOTHING').bind(task.id, other), log(db, task, user.id, 'dep', o.title)]);
      await broadcastTask(env, db, task.list_id, task.id);
      return json({ ok: true }, 201);
    }
    if (others[0] === 'deps' && others[1] && m === 'DELETE') {
      await db.prepare('DELETE FROM pm_deps WHERE task_id = ? AND blocked_by = ?').bind(task.id, others[1]).run();
      await broadcastTask(env, db, task.list_id, task.id);
      return json({ ok: true });
    }
    if (others[0] === 'watch' && m === 'POST') {
      const on = !!(await db.prepare('SELECT 1 AS x FROM pm_watchers WHERE task_id = ? AND user_id = ?').bind(task.id, user.id).first());
      await db.prepare(on ? 'DELETE FROM pm_watchers WHERE task_id = ? AND user_id = ?' : 'INSERT INTO pm_watchers (task_id, user_id) VALUES (?, ?)').bind(task.id, user.id).run();
      return json({ watching: !on });
    }
    if (others[0] === 'time' && others[1] === 'start' && m === 'POST') {
      const t = now();
      const running = (await db.prepare('SELECT * FROM pm_time WHERE user_id = ? AND ended_at IS NULL').bind(user.id).all()).results;
      const stmts = running.map((r) => db.prepare('UPDATE pm_time SET ended_at = ?, minutes = ? WHERE id = ?').bind(t, Math.max(1, Math.round((t - r.started_at) / 60000)), r.id));
      const id = uuid();
      stmts.push(db.prepare('INSERT INTO pm_time (id, task_id, user_id, started_at) VALUES (?, ?, ?, ?)').bind(id, task.id, user.id, t));
      await db.batch(stmts);
      return json({ running: { id, taskId: task.id, startedAt: t, title: task.title } }, 201);
    }
    if (others[0] === 'time' && !others[1] && m === 'POST') {
      const b = await body(); const minutes = intIn(b.minutes, 1, 24 * 60, 'Durée'); const day = date(b.date || new Date().toISOString().slice(0, 10), 'Date');
      const started = Date.parse(day + 'T09:00:00Z'), id = uuid();
      await db.batch([db.prepare('INSERT INTO pm_time (id, task_id, user_id, started_at, ended_at, minutes, note) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(id, task.id, user.id, started, started + minutes * 60000, minutes, str(b.note ?? '', 0, 200, 'Note')),
        log(db, task, user.id, 'time', minutes)]);
      await broadcastTask(env, db, task.list_id, task.id);
      return json({ entry: { id, minutes } }, 201);
    }
  }
  if (seg[0] === 'time' && seg[1] === 'stop' && m === 'POST') {
    const t = now();
    const r = await db.prepare('SELECT m.*, t.list_id FROM pm_time m JOIN pm_tasks t ON t.id = m.task_id WHERE m.user_id = ? AND m.ended_at IS NULL').bind(user.id).first();
    if (!r) return json({ stopped: null });
    const minutes = Math.max(1, Math.round((t - r.started_at) / 60000));
    await db.batch([db.prepare('UPDATE pm_time SET ended_at = ?, minutes = ? WHERE id = ?').bind(t, minutes, r.id), log(db, { id: r.task_id, list_id: r.list_id }, user.id, 'time', minutes)]);
    await broadcastTask(env, db, r.list_id, r.task_id);
    return json({ stopped: { id: r.id, taskId: r.task_id, minutes } });
  }
  if (seg[0] === 'time' && seg[1] && seg.length === 2 && m === 'DELETE') {
    const r = await db.prepare('SELECT m.*, t.list_id FROM pm_time m JOIN pm_tasks t ON t.id = m.task_id WHERE m.id = ?').bind(seg[1]).first();
    if (!r) return err('Entrée introuvable', 404);
    const { role } = await taskAccess(db, r.task_id, user.id);
    if (r.user_id !== user.id && !isAdmin(role)) return err('Vous ne pouvez supprimer que vos propres entrées', 403);
    await db.prepare('DELETE FROM pm_time WHERE id = ?').bind(r.id).run();
    await broadcastTask(env, db, r.list_id, r.task_id);
    return json({ ok: true });
  }
  if (seg[0] === 'checklist' && seg[1]) {
    const c = await db.prepare('SELECT * FROM pm_checklist WHERE id = ?').bind(seg[1]).first(); if (!c) return err('Élément introuvable', 404);
    const { task } = await taskAccess(db, c.task_id, user.id);
    if (m === 'PATCH') {
      const b = await body();
      await db.prepare('UPDATE pm_checklist SET text = ?, done = ?, position = ? WHERE id = ?').bind(b.text !== undefined ? str(b.text, 1, 300, 'Élément') : c.text, b.done !== undefined ? (b.done ? 1 : 0) : c.done, b.position !== undefined ? Number(b.position) || 0 : c.position, c.id).run();
    } else if (m === 'DELETE') await db.prepare('DELETE FROM pm_checklist WHERE id = ?').bind(c.id).run();
    else return err('Méthode non prise en charge', 405);
    await broadcastTask(env, db, task.list_id, task.id);
    return json({ ok: true });
  }
  if (seg[0] === 'comments' && seg[1]) {
    const c = await db.prepare('SELECT * FROM pm_comments WHERE id = ?').bind(seg[1]).first(); if (!c) return err('Commentaire introuvable', 404);
    const { role, task } = await taskAccess(db, c.task_id, user.id);
    if (c.user_id !== user.id && !(m === 'DELETE' && isAdmin(role))) return err('Vous ne pouvez modifier que vos commentaires', 403);
    if (m === 'PATCH') await db.prepare('UPDATE pm_comments SET body = ?, edited_at = ? WHERE id = ?').bind(str((await body()).body, 1, 5000, 'Commentaire'), now(), c.id).run();
    else if (m === 'DELETE') await db.prepare('DELETE FROM pm_comments WHERE id = ?').bind(c.id).run();
    else return err('Méthode non prise en charge', 405);
    await broadcastTask(env, db, task.list_id, task.id);
    return json({ ok: true });
  }

  /* ---------- Boîte de réception ---------- */
  if (path === '/notifications' && m === 'GET') {
    const team = url.searchParams.get('team');
    const rows = (await db.prepare(`SELECT n.id, n.kind, n.task_id AS taskId, n.text, n.read_at AS readAt, n.created_at AS createdAt, n.team_id AS teamId, u.name AS actor, t.list_id AS listId
        FROM pm_notifications n LEFT JOIN tm_users u ON u.id = n.actor_id LEFT JOIN pm_tasks t ON t.id = n.task_id WHERE n.user_id = ? ${team ? 'AND n.team_id = ?' : ''} ORDER BY n.created_at DESC LIMIT 200`)
      .bind(...(team ? [user.id, team] : [user.id])).all()).results;
    return json({ notifications: rows });
  }
  if (path === '/notifications/read' && m === 'POST') {
    const b = await body();
    if (b.all) await db.prepare('UPDATE pm_notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').bind(now(), user.id).run();
    else if (Array.isArray(b.ids)) for (const id of b.ids.slice(0, 200)) await db.prepare('UPDATE pm_notifications SET read_at = ? WHERE id = ? AND user_id = ?').bind(now(), String(id), user.id).run();
    return json({ ok: true });
  }

  /* ---------- Vues enregistrées ---------- */
  if (path === '/views' && m === 'GET') {
    const scope = String(url.searchParams.get('scope') || ''), team = String(url.searchParams.get('team') || '');
    await teamRole(db, team, user.id);
    const rows = (await db.prepare('SELECT id, scope, owner_id AS ownerId, name, type, config, shared FROM pm_views WHERE team_id = ? AND scope = ? AND (owner_id = ? OR shared = 1) ORDER BY created_at').bind(team, scope, user.id).all()).results;
    return json({ views: rows.map((v) => ({ ...v, shared: !!v.shared, config: parse(v.config, {}) })) });
  }
  if (path === '/views' && m === 'POST') {
    const b = await body(); await teamRole(db, String(b.team || ''), user.id);
    if (!VIEW_TYPES.includes(b.type)) fail('Type de vue invalide', 400);
    if (!/^(list|space|folder|team|mine):[0-9a-zA-Z-]{1,64}$/.test(String(b.scope || ''))) fail('Portée invalide', 400);
    const cfg = JSON.stringify(b.config || {}); if (cfg.length > 5000) fail('Configuration trop volumineuse', 400);
    const id = uuid();
    await db.prepare('INSERT INTO pm_views (id, team_id, scope, owner_id, name, type, config, shared, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(id, b.team, b.scope, user.id, str(b.name, 1, 40, 'Nom de la vue'), b.type, cfg, b.shared ? 1 : 0, now()).run();
    return json({ view: { id } }, 201);
  }
  if (seg[0] === 'views' && seg[1] && m === 'DELETE') {
    const v = await db.prepare('SELECT * FROM pm_views WHERE id = ?').bind(seg[1]).first(); if (!v) return err('Vue introuvable', 404);
    const role = await teamRole(db, v.team_id, user.id);
    if (v.owner_id !== user.id && !isAdmin(role)) return err('Seul l’auteur peut supprimer cette vue', 403);
    await db.prepare('DELETE FROM pm_views WHERE id = ?').bind(v.id).run();
    return json({ ok: true });
  }

  /* ---------- Tableau de bord ---------- */
  if (seg[0] === 'teams' && seg[1] && seg[2] === 'dashboard' && m === 'GET') {
    const teamId = seg[1]; await teamRole(db, teamId, user.id);
    const space = url.searchParams.get('space');
    const tasks = await loadTasks(db, space ? { space } : { team: teamId });
    if (space) { const { space: s } = await spaceAccess(db, space, user.id); if (s.team_id !== teamId) fail('Espace invalide', 400); }
    const today = new Date().toISOString().slice(0, 10);
    const team = await members(db, teamId);
    const open = tasks.filter((t) => t.statusType !== 'closed');
    const weekAgo = now() - 7 * 86400000;
    const time = (await db.prepare(`SELECT m.user_id, SUM(m.minutes) AS mins FROM pm_time m JOIN pm_tasks t ON t.id = m.task_id JOIN pm_lists l ON l.id = t.list_id JOIN pm_spaces s ON s.id = l.space_id
        WHERE s.team_id = ? AND m.ended_at IS NOT NULL AND m.started_at >= ? GROUP BY m.user_id`).bind(teamId, weekAgo).all()).results;
    const weeks = [];
    for (let i = 7; i >= 0; i--) {
      const end = now() - i * 7 * 86400000, start = end - 7 * 86400000;
      weeks.push({ end: new Date(end).toISOString().slice(0, 10), done: tasks.filter((t) => t.completedAt && t.completedAt > start && t.completedAt <= end).length, created: tasks.filter((t) => t.createdAt > start && t.createdAt <= end).length });
    }
    return json({
      totals: { total: tasks.length, open: open.length, done: tasks.length - open.length, overdue: open.filter((t) => t.due && t.due < today).length,
        dueToday: open.filter((t) => t.due === today).length, unassigned: open.filter((t) => !t.assignees.length).length, milestones: tasks.filter((t) => t.milestone).length },
      byStatusType: { open: tasks.filter((t) => t.statusType === 'open').length, active: tasks.filter((t) => t.statusType === 'active').length, closed: tasks.filter((t) => t.statusType === 'closed').length },
      byPriority: [1, 2, 3, 4, 0].map((p) => ({ priority: p, count: open.filter((t) => t.priority === p).length })),
      workload: team.map((u) => {
        const mine = open.filter((t) => t.assignees.includes(u.id));
        return { userId: u.id, name: u.name, handle: u.handle, open: mine.length, overdue: mine.filter((t) => t.due && t.due < today).length,
          estimate: mine.reduce((a, t) => a + (t.estimate || 0), 0), minutesWeek: time.find((x) => x.user_id === u.id)?.mins || 0 };
      }),
      weeks,
      upcoming: open.filter((t) => t.due && t.due >= today).sort((a, b) => (a.due < b.due ? -1 : 1)).slice(0, 10).map((t) => ({ id: t.id, title: t.title, due: t.due, listId: t.listId, assignees: t.assignees, priority: t.priority })),
      overdueList: open.filter((t) => t.due && t.due < today).sort((a, b) => (a.due < b.due ? -1 : 1)).slice(0, 10).map((t) => ({ id: t.id, title: t.title, due: t.due, listId: t.listId, assignees: t.assignees, priority: t.priority })),
    });
  }

  /* ---------- Documents d'espace ---------- */
  if (seg[0] === 'spaces' && seg[1] && seg[2] === 'docs') {
    const { space } = await spaceAccess(db, seg[1], user.id);
    if (m === 'GET') return json({ docs: (await db.prepare('SELECT d.id, d.title, d.updated_at AS updatedAt, u.name AS updatedBy FROM pm_docs d LEFT JOIN tm_users u ON u.id = d.updated_by WHERE d.space_id = ? ORDER BY d.updated_at DESC').bind(space.id).all()).results });
    if (m === 'POST') {
      const b = await body(), id = uuid(), t = now();
      await db.prepare('INSERT INTO pm_docs (id, space_id, title, body, updated_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(id, space.id, str(b.title || 'Sans titre', 1, 120, 'Titre'), str(b.body ?? '', 0, 100000, 'Contenu'), user.id, t, t).run();
      return json({ doc: { id } }, 201);
    }
  }
  if (seg[0] === 'docs' && seg[1]) {
    const d = await db.prepare('SELECT * FROM pm_docs WHERE id = ?').bind(seg[1]).first(); if (!d) return err('Document introuvable', 404);
    const { role } = await spaceAccess(db, d.space_id, user.id);
    if (m === 'GET') return json({ doc: { id: d.id, spaceId: d.space_id, title: d.title, body: d.body, updatedAt: d.updated_at } });
    if (m === 'PATCH') {
      const b = await body();
      await db.prepare('UPDATE pm_docs SET title = ?, body = ?, updated_by = ?, updated_at = ? WHERE id = ?').bind(b.title !== undefined ? str(b.title, 1, 120, 'Titre') : d.title, b.body !== undefined ? str(b.body ?? '', 0, 100000, 'Contenu') : d.body, user.id, now(), d.id).run();
      return json({ ok: true });
    }
    if (m === 'DELETE') { if (!isAdmin(role) && d.updated_by !== user.id) return err('Réservé aux administrateurs', 403); await db.prepare('DELETE FROM pm_docs WHERE id = ?').bind(d.id).run(); return json({ ok: true }); }
  }

  /* ---------- Objectifs ---------- */
  if (seg[0] === 'teams' && seg[1] && seg[2] === 'goals') {
    const teamId = seg[1]; await teamRole(db, teamId, user.id);
    if (m === 'GET') {
      const goals = (await db.prepare('SELECT * FROM pm_goals WHERE team_id = ? ORDER BY created_at').bind(teamId).all()).results;
      const tasks = await loadTasks(db, { team: teamId, archived: true });
      return json({ goals: goals.map((g) => goalOut(g, tasks)) });
    }
    if (m === 'POST') {
      const b = await body(), id = uuid(), t = now();
      await db.prepare('INSERT INTO pm_goals (id, team_id, name, description, due_date, owner_id, color, targets, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(id, teamId, str(b.name, 1, 100, 'Nom de l’objectif'), str(b.description ?? '', 0, 1000, 'Description'), date(b.due ?? '', 'Échéance') || '', user.id, color(b.color, '#2F45D8'), JSON.stringify(validTargets(b.targets)), t, t).run();
      return json({ goal: { id } }, 201);
    }
  }
  if (seg[0] === 'goals' && seg[1]) {
    const g = await db.prepare('SELECT * FROM pm_goals WHERE id = ?').bind(seg[1]).first(); if (!g) return err('Objectif introuvable', 404);
    const role = await teamRole(db, g.team_id, user.id);
    if (m === 'PATCH') {
      const b = await body();
      await db.prepare('UPDATE pm_goals SET name = ?, description = ?, due_date = ?, color = ?, targets = ?, updated_at = ? WHERE id = ?').bind(
        b.name !== undefined ? str(b.name, 1, 100, 'Nom de l’objectif') : g.name, b.description !== undefined ? str(b.description ?? '', 0, 1000, 'Description') : g.description,
        b.due !== undefined ? date(b.due, 'Échéance') : g.due_date, b.color !== undefined ? color(b.color, g.color) : g.color,
        b.targets !== undefined ? JSON.stringify(validTargets(b.targets)) : g.targets, now(), g.id).run();
      return json({ ok: true });
    }
    if (m === 'DELETE') { if (!isAdmin(role) && g.owner_id !== user.id) return err('Réservé aux administrateurs', 403); await db.prepare('DELETE FROM pm_goals WHERE id = ?').bind(g.id).run(); return json({ ok: true }); }
  }

  return err('Route inconnue', 404);
}

/* ===========================================================================
   Utilitaires internes
   =========================================================================== */
function validStatuses(v) {
  if (!Array.isArray(v) || v.length < 2 || v.length > 15) return null;
  const out = [], keys = new Set();
  for (const s of v) {
    const name = String(s?.name || '').trim().slice(0, 30); if (!name) return null;
    let key = String(s.key || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 30) || name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) || 's';
    while (keys.has(key)) key += '_';
    if (!['open', 'active', 'closed'].includes(s.type)) return null;
    keys.add(key); out.push({ key, name, color: color(s.color, '#8C94AD'), type: s.type });
  }
  if (!out.some((s) => s.type !== 'closed') || !out.some((s) => s.type === 'closed')) return null;
  return out;
}
function validOptions(v) {
  if (!Array.isArray(v) || v.length > 50) fail('Options invalides (50 maximum)', 400);
  return v.map((o) => ({ id: String(o?.id || uuid()).slice(0, 40), name: String(o?.name || '').trim().slice(0, 40) || 'Option', color: color(o?.color, '#8C94AD') }));
}
function validTargets(v) {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > 20) fail('Cibles invalides (20 maximum)', 400);
  return v.map((x) => {
    const kind = x?.kind === 'tasks' ? 'tasks' : x?.kind === 'boolean' ? 'boolean' : 'number';
    const t = { id: String(x?.id || uuid()).slice(0, 40), name: String(x?.name || '').trim().slice(0, 80) || 'Cible', kind };
    if (kind === 'number') { t.start = Number(x.start) || 0; t.target = Number(x.target) || 1; t.current = Number(x.current) || 0; t.unit = String(x.unit || '').slice(0, 10); }
    if (kind === 'boolean') t.done = !!x.done;
    if (kind === 'tasks') t.taskIds = Array.isArray(x.taskIds) ? x.taskIds.slice(0, 200).map(String) : [];
    return t;
  });
}
function goalOut(g, tasks) {
  const targets = parse(g.targets, []).map((t) => {
    let progress = 0;
    if (t.kind === 'number') progress = t.target === t.start ? 1 : (t.current - t.start) / (t.target - t.start);
    if (t.kind === 'boolean') progress = t.done ? 1 : 0;
    if (t.kind === 'tasks') { const linked = tasks.filter((x) => t.taskIds.includes(x.id)); t.total = linked.length; t.done = linked.filter((x) => x.statusType === 'closed').length; progress = linked.length ? t.done / linked.length : 0; }
    return { ...t, progress: Math.max(0, Math.min(1, progress)) };
  });
  return { id: g.id, name: g.name, description: g.description, due: g.due_date, ownerId: g.owner_id, color: g.color, targets,
    progress: targets.length ? targets.reduce((a, t) => a + t.progress, 0) / targets.length : 0, updatedAt: g.updated_at };
}
async function deleteTasks(db, ids) {
  // une tâche emporte ses sous-tâches et toutes ses données liées
  const subs = (await db.prepare(`SELECT id FROM pm_tasks WHERE parent_id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all()).results.map((r) => r.id);
  const all = [...ids, ...subs], stmts = [];
  for (const id of all) for (const t of ['pm_assignees', 'pm_watchers', 'pm_checklist', 'pm_comments', 'pm_activity', 'pm_time']) stmts.push(db.prepare(`DELETE FROM ${t} WHERE task_id = ?`).bind(id));
  for (const id of all) stmts.push(db.prepare('DELETE FROM pm_deps WHERE task_id = ? OR blocked_by = ?').bind(id, id), db.prepare('DELETE FROM pm_notifications WHERE task_id = ?').bind(id), db.prepare('DELETE FROM pm_tasks WHERE id = ?').bind(id));
  for (let i = 0; i < stmts.length; i += 90) await db.batch(stmts.slice(i, i + 90));
}
async function deleteList(db, listId) {
  const ids = (await db.prepare('SELECT id FROM pm_tasks WHERE list_id = ? AND parent_id IS NULL').bind(listId).all()).results.map((r) => r.id);
  for (let i = 0; i < ids.length; i += 40) await deleteTasks(db, ids.slice(i, i + 40));
  await db.batch([db.prepare('DELETE FROM pm_tasks WHERE list_id = ?').bind(listId), db.prepare('DELETE FROM pm_fields WHERE list_id = ?').bind(listId),
    db.prepare('DELETE FROM tm_messages WHERE project_id = ?').bind(listId), db.prepare('DELETE FROM pm_lists WHERE id = ?').bind(listId),
    db.prepare('DELETE FROM tm_tasks WHERE project_id = ?').bind(listId), db.prepare('DELETE FROM tm_projects WHERE id = ?').bind(listId)]);
}
