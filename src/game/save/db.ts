// IndexedDB persistence. Worlds are independent; only modified chunks are stored.
export interface WorldMeta {
  id: string;
  name: string;
  seed: number;
  mode: 'survival' | 'creative';
  difficulty: 0 | 1 | 2 | 3; // peaceful, easy, normal, hard
  created: number;
  lastPlayed: number;
  rules: GameRules;
  version: number;
  playTime: number;
  bonusChest: boolean;
}
export interface GameRules {
  keepInventory: boolean;
  daylightCycle: boolean;
  weatherCycle: boolean;
  mobSpawning: boolean;
  mobGriefing: boolean;
  fireSpread: boolean;
  naturalRegen: boolean;
  allowModeSwitch: boolean;
}
export const DEFAULT_RULES: GameRules = {
  keepInventory: false, daylightCycle: true, weatherCycle: true, mobSpawning: true, mobGriefing: true, fireSpread: true, naturalRegen: true, allowModeSwitch: false,
};

export interface ChunkRecord {
  key: string; // worldId|dim|cx|cz
  world: string;
  blocks: Uint8Array;
  meta: Uint8Array;
  be: Record<string, unknown>; // block entities keyed by "x,y,z" local
  ents: unknown[]; // persistent entities in this chunk
  generatedFeatures: boolean;
  biomes?: Uint8Array;
}

export interface StateRecord { world: string; data: unknown }

const DB_NAME = 'deepwild';
const DB_VER = 1;
let dbp: Promise<IDBDatabase> | null = null;

export function openDB(): Promise<IDBDatabase> {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, DB_VER);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('worlds')) db.createObjectStore('worlds', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('chunks')) {
        const s = db.createObjectStore('chunks', { keyPath: 'key' });
        s.createIndex('world', 'world');
      }
      if (!db.objectStoreNames.contains('state')) db.createObjectStore('state', { keyPath: 'world' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.onblocked = () => rej(new Error('Database is blocked by another tab'));
  });
  return dbp;
}
function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}
function done(tx: IDBTransaction): Promise<void> {
  return new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error ?? new Error('aborted')); });
}

export async function listWorlds(): Promise<WorldMeta[]> {
  const db = await openDB();
  const all = await req(db.transaction('worlds').objectStore('worlds').getAll()) as WorldMeta[];
  return all.filter(validMeta).sort((a, b) => b.lastPlayed - a.lastPlayed);
}
function validMeta(m: unknown): m is WorldMeta {
  const w = m as WorldMeta;
  return !!w && typeof w.id === 'string' && typeof w.seed === 'number' && typeof w.name === 'string';
}
export async function putWorld(m: WorldMeta) {
  const db = await openDB();
  const tx = db.transaction('worlds', 'readwrite');
  tx.objectStore('worlds').put(m);
  await done(tx);
}
export async function getWorld(id: string): Promise<WorldMeta | undefined> {
  const db = await openDB();
  return req(db.transaction('worlds').objectStore('worlds').get(id));
}
export async function deleteWorld(id: string) {
  const db = await openDB();
  const keys = await req(db.transaction('chunks').objectStore('chunks').index('world').getAllKeys(IDBKeyRange.only(id)));
  const tx = db.transaction(['worlds', 'chunks', 'state'], 'readwrite');
  tx.objectStore('worlds').delete(id);
  tx.objectStore('state').delete(id);
  const cs = tx.objectStore('chunks');
  for (const k of keys) cs.delete(k);
  await done(tx);
}
export async function savedChunkKeys(world: string): Promise<Set<string>> {
  const db = await openDB();
  const keys = await req(db.transaction('chunks').objectStore('chunks').index('world').getAllKeys(IDBKeyRange.only(world)));
  return new Set(keys as string[]);
}
export async function loadChunk(key: string): Promise<ChunkRecord | null> {
  const db = await openDB();
  try {
    const r = await req(db.transaction('chunks').objectStore('chunks').get(key)) as ChunkRecord | undefined;
    if (!r || !(r.blocks instanceof Uint8Array) || r.blocks.length !== 16 * 16 * 128) return null;
    return r;
  } catch (e) {
    console.warn('Chunk record unreadable, regenerating', key, e);
    return null;
  }
}
export async function saveChunks(recs: ChunkRecord[]) {
  if (!recs.length) return;
  const db = await openDB();
  const tx = db.transaction('chunks', 'readwrite');
  const s = tx.objectStore('chunks');
  for (const r of recs) s.put(r);
  await done(tx);
}
export async function loadState(world: string): Promise<unknown | null> {
  const db = await openDB();
  const r = await req(db.transaction('state').objectStore('state').get(world)) as StateRecord | undefined;
  return r?.data ?? null;
}
export async function saveState(world: string, data: unknown) {
  const db = await openDB();
  const tx = db.transaction('state', 'readwrite');
  tx.objectStore('state').put({ world, data });
  await done(tx);
}

/* ---------- export / import / duplicate ---------- */
const b64 = (u: Uint8Array) => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s: string) => { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };

export async function exportWorld(id: string): Promise<string> {
  const db = await openDB();
  const meta = await getWorld(id);
  if (!meta) throw new Error('World not found');
  const chunks = await req(db.transaction('chunks').objectStore('chunks').index('world').getAll(IDBKeyRange.only(id))) as ChunkRecord[];
  const state = await loadState(id);
  return JSON.stringify({
    format: 'deepwild-world', version: 1, meta, state,
    chunks: chunks.map((c) => ({ key: c.key.split('|').slice(1).join('|'), blocks: b64(c.blocks), meta: b64(c.meta), be: c.be, ents: c.ents, gf: c.generatedFeatures })),
  });
}
export async function importWorld(json: string, newName?: string): Promise<WorldMeta> {
  let data: { format: string; meta: WorldMeta; state: unknown; chunks: { key: string; blocks: string; meta: string; be: Record<string, unknown>; ents: unknown[]; gf: boolean }[] };
  try { data = JSON.parse(json); } catch { throw new Error('That file is not a Deepwild world export.'); }
  if (data.format !== 'deepwild-world' || !validMeta(data.meta)) throw new Error('That file is not a Deepwild world export.');
  const id = newId();
  const meta: WorldMeta = { ...data.meta, id, name: newName ?? data.meta.name, lastPlayed: Date.now() };
  const recs: ChunkRecord[] = [];
  for (const c of data.chunks ?? []) {
    try {
      const blocks = unb64(c.blocks), m = unb64(c.meta);
      if (blocks.length !== 32768) continue;
      recs.push({ key: `${id}|${c.key}`, world: id, blocks, meta: m, be: c.be ?? {}, ents: c.ents ?? [], generatedFeatures: c.gf ?? true });
    } catch { /* skip damaged chunk */ }
  }
  await putWorld(meta);
  for (let i = 0; i < recs.length; i += 200) await saveChunks(recs.slice(i, i + 200));
  if (data.state) await saveState(id, data.state);
  return meta;
}
export async function duplicateWorld(id: string, name: string): Promise<WorldMeta> {
  return importWorld(await exportWorld(id), name);
}
export function newId() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }
