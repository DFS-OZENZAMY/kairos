/**
 * Kairos — Worker Cloudflare
 * Sert l'application (dossier public/) et une petite API de synchronisation
 * adossée à D1. Le coffre est chiffré dans le navigateur (AES-256-GCM) :
 * le serveur ne reçoit que du texte chiffré et un jeton d'accès dérivé
 * du mot de passe maître, dont il ne garde que l'empreinte SHA-256.
 */
const MAX_CT = 1_800_000;          // D1 limite une ligne à ~2 Mo
const ID_RE = /^[a-z0-9][a-z0-9._-]{2,63}$/;
const B64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const MAX_FAILS = 10;
const FAIL_WINDOW = 15 * 60 * 1000;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS vaults (id TEXT PRIMARY KEY, auth_hash TEXT NOT NULL, salt TEXT NOT NULL, iter INTEGER NOT NULL, iv TEXT NOT NULL, ct TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS attempts (id TEXT PRIMARY KEY, fails INTEGER NOT NULL, window_start INTEGER NOT NULL)`,
];
let schemaReady = null;
const ensureSchema = (db) => (schemaReady ||= db.batch(SCHEMA.map((s) => db.prepare(s))).catch((e) => { schemaReady = null; throw e; }));

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  },
});
const err = (message, status) => json({ error: message }, status);

async function sha256Hex(s) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
const validToken = (t) => typeof t === 'string' && /^[0-9a-f]{64}$/.test(t);
const validB64 = (s, max) => typeof s === 'string' && s.length > 0 && s.length <= max && B64_RE.test(s);

async function readBody(req) {
  const len = Number(req.headers.get('content-length') || 0);
  if (len > MAX_CT + 10_000) throw Object.assign(new Error('Coffre trop volumineux (2 Mo maximum)'), { status: 413 });
  try { return await req.json(); } catch { throw Object.assign(new Error('Requête invalide'), { status: 400 }); }
}

/** Vérifie l'identifiant + jeton, avec limitation des essais ratés. */
async function authenticate(req, db) {
  const id = (req.headers.get('x-vault-id') || '').toLowerCase();
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!ID_RE.test(id) || !validToken(token)) return { error: err('Identifiants manquants', 401) };

  const now = Date.now();
  const att = await db.prepare('SELECT fails, window_start FROM attempts WHERE id = ?').bind(id).first();
  if (att && att.fails >= MAX_FAILS && now - att.window_start < FAIL_WINDOW) {
    return { error: err('Trop d’essais. Réessaie dans quelques minutes.', 429) };
  }
  const row = await db.prepare('SELECT * FROM vaults WHERE id = ?').bind(id).first();
  const hash = await sha256Hex(token);
  if (!row || !safeEqual(hash, row.auth_hash)) {
    const reset = !att || now - att.window_start >= FAIL_WINDOW;
    await db.prepare('INSERT INTO attempts (id, fails, window_start) VALUES (?, 1, ?) ON CONFLICT(id) DO UPDATE SET fails = CASE WHEN ? THEN 1 ELSE fails + 1 END, window_start = CASE WHEN ? THEN ? ELSE window_start END')
      .bind(id, now, reset ? 1 : 0, reset ? 1 : 0, now).run();
    return { error: err('Identifiant ou mot de passe incorrect', 401) };
  }
  if (att) await db.prepare('DELETE FROM attempts WHERE id = ?').bind(id).run();
  return { id, row };
}

const publicVault = (r) => ({ id: r.id, salt: r.salt, iter: r.iter, iv: r.iv, ct: r.ct, version: r.version, updatedAt: r.updated_at });

async function api(req, env, url) {
  const db = env.DB;
  const path = url.pathname.replace(/\/+$/, '');

  if (path === '/api/health') return json({ ok: true, sync: !!db, app: 'kairos' });
  if (!db) return err('Base de données non configurée (binding DB manquant)', 503);
  await ensureSchema(db);

  // Sel public d'un coffre : nécessaire pour dériver la clé sur un nouvel appareil
  if (path === '/api/vault/salt' && req.method === 'GET') {
    const id = (url.searchParams.get('id') || '').toLowerCase();
    if (!ID_RE.test(id)) return err('Identifiant invalide', 400);
    const r = await db.prepare('SELECT salt, iter FROM vaults WHERE id = ?').bind(id).first();
    return r ? json({ salt: r.salt, iter: r.iter }) : err('Aucun coffre avec cet identifiant', 404);
  }

  if (path !== '/api/vault') return err('Route inconnue', 404);

  // Création
  if (req.method === 'POST') {
    const b = await readBody(req);
    const id = String(b.id || '').toLowerCase();
    if (!ID_RE.test(id)) return err('Identifiant invalide : 3 à 64 caractères, lettres minuscules, chiffres, point, tiret ou tiret bas', 400);
    if (!validToken(b.auth) || !validB64(b.salt, 64) || !validB64(b.iv, 32) || !validB64(b.ct, MAX_CT)) return err('Données invalides', 400);
    const iter = Number(b.iter);
    if (!Number.isInteger(iter) || iter < 100_000 || iter > 5_000_000) return err('Paramètres de chiffrement invalides', 400);
    const now = Date.now();
    const res = await db.prepare('INSERT INTO vaults (id, auth_hash, salt, iter, iv, ct, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?) ON CONFLICT(id) DO NOTHING')
      .bind(id, await sha256Hex(b.auth), b.salt, iter, b.iv, b.ct, now, now).run();
    if (!res.meta.changes) return err('Cet identifiant est déjà pris', 409);
    return json({ ok: true, version: 1, updatedAt: now }, 201);
  }

  const auth = await authenticate(req, db);
  if (auth.error) return auth.error;

  if (req.method === 'GET') return json(publicVault(auth.row));

  // Mise à jour avec contrôle de version (pas d'écrasement silencieux)
  if (req.method === 'PUT') {
    const b = await readBody(req);
    if (!validB64(b.iv, 32) || !validB64(b.ct, MAX_CT)) return err('Données invalides', 400);
    const base = Number(b.baseVersion);
    const now = Date.now();
    let authHash = auth.row.auth_hash, salt = auth.row.salt, iter = auth.row.iter;
    if (b.newAuth !== undefined) {
      if (!validToken(b.newAuth) || !validB64(b.salt, 64)) return err('Données invalides', 400);
      const it = Number(b.iter);
      if (!Number.isInteger(it) || it < 100_000 || it > 5_000_000) return err('Paramètres de chiffrement invalides', 400);
      authHash = await sha256Hex(b.newAuth); salt = b.salt; iter = it;
    }
    const res = await db.prepare('UPDATE vaults SET iv = ?, ct = ?, auth_hash = ?, salt = ?, iter = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?')
      .bind(b.iv, b.ct, authHash, salt, iter, now, auth.id, base).run();
    if (!res.meta.changes) {
      const cur = await db.prepare('SELECT * FROM vaults WHERE id = ?').bind(auth.id).first();
      return json({ error: 'Version en conflit', current: publicVault(cur) }, 409);
    }
    return json({ ok: true, version: base + 1, updatedAt: now });
  }

  if (req.method === 'DELETE') {
    await db.batch([
      db.prepare('DELETE FROM vaults WHERE id = ?').bind(auth.id),
      db.prepare('DELETE FROM attempts WHERE id = ?').bind(auth.id),
    ]);
    return json({ ok: true });
  }

  return err('Méthode non autorisée', 405);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req);
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const origin = req.headers.get('origin');
      if (origin && origin !== url.origin) return err('Origine non autorisée', 403);
    }
    try {
      return await api(req, env, url);
    } catch (e) {
      if (e.status) return err(e.message, e.status);
      console.error(e);
      return err('Erreur serveur', 500);
    }
  },
};
