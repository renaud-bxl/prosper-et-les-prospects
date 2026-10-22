// La mémoire de l'équipe : une base SQLite locale (data/agents.db).
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(join(ROOT, 'data'), { recursive: true });

export const db = new DatabaseSync(join(ROOT, 'data', 'agents.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY, metier TEXT, ville TEXT, started_at INTEGER, ended_at INTEGER, status TEXT
  );
  CREATE TABLE IF NOT EXISTS places (
    id TEXT, run_id TEXT, name TEXT, address TEXT, lat REAL, lon REAL, rating REAL, reviews INTEGER,
    website TEXT, phone TEXT, type TEXT, maps_uri TEXT,
    status TEXT, score INTEGER, signals TEXT, emails TEXT, to_email TEXT, excerpt TEXT,
    constat TEXT, objet TEXT, mail TEXT, mail_langue TEXT, mail_langue_source TEXT, decided_at INTEGER, updated_at INTEGER,
    PRIMARY KEY (run_id, id)
  );
  CREATE TABLE IF NOT EXISTS events (
    seq INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT, t INTEGER, agent TEXT, type TEXT, place_id TEXT, data TEXT
  );
`);
// Colonnes ajoutées après coup (la base existante est complétée sans rien perdre).
for (const [table, col] of [
  ['runs', 'lat REAL'], ['runs', 'lon REAL'], ['runs', 'rayon INTEGER'], ['runs', 'nombre INTEGER'], ['runs', 'pays TEXT'],
  ['places', 'gid TEXT'], ['places', 'horaires TEXT'], ['places', 'email_source TEXT'],
]) {
  try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${col}`); } catch {}
}

// Provenance figée avec chaque nouveau brouillon. Les anciens mails restent NULL :
// leurs réglages actuels ne permettent pas de reconstruire leur langue d'origine.
const placeColumns = new Set(db.prepare('PRAGMA table_info(places)').all().map((column) => column.name));
for (const column of ['mail_langue', 'mail_langue_source']) {
  if (!placeColumns.has(column)) db.exec(`ALTER TABLE places ADD COLUMN ${column} TEXT`);
}

const JSON_COLS = ['signals', 'emails'];

export function rowToPlace(r) {
  if (!r) return null;
  const p = { ...r };
  for (const c of JSON_COLS) p[c] = r[c] ? JSON.parse(r[c]) : null;
  return p;
}

export function upsertPlace(runId, p) {
  const cols = ['id', 'run_id', 'name', 'address', 'lat', 'lon', 'rating', 'reviews', 'website', 'phone', 'type', 'maps_uri', 'gid', 'horaires', 'status', 'updated_at'];
  db.prepare(`INSERT OR IGNORE INTO places (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(
    p.id, runId, p.name, p.address, p.lat, p.lon, p.rating ?? null, p.reviews ?? null, p.website ?? null,
    p.phone ?? null, p.type ?? null, p.maps_uri ?? null, p.gid ?? null, p.horaires ?? null, p.status ?? 'trouve', Date.now(),
  );
}

export function updatePlace(runId, id, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  const vals = keys.map((k) => (JSON_COLS.includes(k) && fields[k] != null ? JSON.stringify(fields[k]) : fields[k]));
  db.prepare(`UPDATE places SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE run_id = ? AND id = ?`)
    .run(...vals, Date.now(), runId, id);
}

export function getPlace(runId, id) {
  return rowToPlace(db.prepare('SELECT * FROM places WHERE run_id = ? AND id = ?').get(runId, id));
}

export function listPlaces(runId) {
  return db.prepare('SELECT * FROM places WHERE run_id = ? ORDER BY rowid').all(runId).map(rowToPlace);
}

// Les sessions d'avant l'enregistrement du centre : on le relit dans le premier geste du chef.
function withCentre(run) {
  if (!run || run.lat != null) return run;
  const e = db.prepare("SELECT data FROM events WHERE run_id = ? AND agent = 'chef' AND type = 'start'").get(run.id);
  const d = e ? JSON.parse(e.data) : {};
  return { ...run, lat: d.centre?.lat ?? null, lon: d.centre?.lon ?? null, nombre: run.nombre ?? d.nombre ?? null };
}

export function lastRun() {
  return withCentre(db.prepare('SELECT * FROM runs ORDER BY started_at DESC LIMIT 1').get() ?? null);
}

export function getRun(id) {
  return withCentre(db.prepare('SELECT * FROM runs WHERE id = ?').get(id) ?? null);
}

export function listRuns() {
  return db.prepare(`SELECT r.*, (SELECT COUNT(*) FROM places p WHERE p.run_id = r.id) AS n
    FROM runs r ORDER BY started_at DESC LIMIT 20`).all().map(withCentre);
}

export function insertEvent(e) {
  const { lastInsertRowid } = db.prepare('INSERT INTO events (run_id, t, agent, type, place_id, data) VALUES (?, ?, ?, ?, ?, ?)')
    .run(e.run_id, e.t, e.agent, e.type, e.place_id ?? null, JSON.stringify(e.data ?? {}));
  return Number(lastInsertRowid);
}

export function listEvents(runId) {
  return db.prepare('SELECT * FROM events WHERE run_id = ? ORDER BY seq').all(runId)
    .map((e) => ({ ...e, data: JSON.parse(e.data) }));
}

