// Crée la base D1 « kairos-db » si elle n'existe pas et inscrit son ID dans wrangler.jsonc.
import fs from 'node:fs';

const NAME = 'kairos-db';
const FILE = 'wrangler.jsonc';
const token = process.env.CLOUDFLARE_API_TOKEN;
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!token || !account) { console.error('CLOUDFLARE_API_TOKEN et CLOUDFLARE_ACCOUNT_ID sont requis'); process.exit(1); }

const api = async (path, init = {}) => {
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}${path}`, {
    ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.success === false) throw new Error(`${r.status} ${JSON.stringify(j.errors || j)}`);
  return j.result;
};

let db = (await api(`/d1/database?name=${NAME}`)).find((d) => d.name === NAME);
if (!db) {
  console.log(`Création de la base D1 ${NAME}…`);
  db = await api('/d1/database', { method: 'POST', body: JSON.stringify({ name: NAME }) });
}
const id = db.uuid;
const cfg = fs.readFileSync(FILE, 'utf8').replace(/"database_id":\s*"[^"]*"/, `"database_id": "${id}"`);
fs.writeFileSync(FILE, cfg);
console.log(`Base D1 prête : ${NAME} (${id})`);
