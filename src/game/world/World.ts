import * as THREE from 'three';
import { CHUNK, HEIGHT, CHUNK_AREA, Dim, chunkKey, DIRS } from '../constants';
import { BLOCKS, B, SOLID, OPAQUE, LIGHT_EMIT, emission, type BlockDef } from '../registry/blocks';
import type { GenFeature } from './gen/writer';
import type { MeshLayer } from './mesher';
import { loadChunk, saveChunks, type ChunkRecord } from '../save/db';
import type { ItemStack } from '../registry/items';
import { Terrain } from './gen/terrain';
import GenWorker from '../workers/gen.worker?worker&inline';
import MeshWorker from '../workers/mesh.worker?worker&inline';

export interface BlockEntity { type: string; items?: (ItemStack | null)[]; [k: string]: unknown }

export class Chunk {
  meshes: (THREE.Mesh | null)[] = [null, null, null];
  sky: Uint8Array | null = null;
  blk: Uint8Array | null = null;
  skyMax: Uint8Array | null = null;
  be = new Map<number, BlockEntity>();
  ents: unknown[] = [];
  dataVersion = 0;
  meshVersion = -1;
  meshPending = false;
  saveDirty = false;
  constructor(public cx: number, public cz: number, public blocks: Uint8Array, public meta: Uint8Array, public biomes: Uint8Array) {}
}

export interface WorldHooks {
  onFeatures(dim: Dim, c: Chunk, f: GenFeature[]): void;
  onChunkEntities(dim: Dim, c: Chunk, ents: unknown[]): void;
  onBlockChanged(x: number, y: number, z: number, oldId: number, newId: number): void;
}

interface GenJob { cx: number; cz: number; dim: Dim }
type Pool = { w: Worker; busy: boolean }[];

export const SAVE_MOD = 'mod';

/** All loaded chunks of one dimension + streaming */
export class World {
  chunks = new Map<string, Chunk>();
  loading = new Set<string>();
  savedKeys = new Set<string>();
  group = new THREE.Group();
  renderDistance = 8;
  private genPool: Pool = [];
  private meshPool: Pool = [];
  private genQueue: GenJob[] = [];
  private jobId = 1;
  private meshQueue = new Map<string, number>(); // key -> priority
  private pcx = 0; private pcz = 0;
  private materials: THREE.Material[];
  hasSky: boolean;
  tick = 0;
  private scheduled = new Map<number, Map<string, number>>(); // tick -> (pos key -> kind)
  hooks!: WorldHooks;
  private lastCx = 1e9; private lastCz = 1e9; private lastC: Chunk | null = null;

  constructor(public worldId: string, public seed: number, public dim: Dim, materials: THREE.Material[], workers: number) {
    this.materials = materials;
    this.hasSky = dim !== Dim.Ember;
    for (let i = 0; i < Math.max(1, Math.min(2, workers)); i++) this.genPool.push({ w: this.mkGen(), busy: false });
    for (let i = 0; i < Math.max(1, workers); i++) this.meshPool.push({ w: this.mkMesh(), busy: false });
  }
  private mkGen() {
    const w = new GenWorker();
    w.onmessage = (e) => { const s = this.genPool.find((p) => p.w === w); if (s) s.busy = false; this.onGenerated(e.data); };
    return w;
  }
  private mkMesh() {
    const w = new MeshWorker();
    w.onmessage = (e) => { const s = this.meshPool.find((p) => p.w === w); if (s) s.busy = false; this.onMeshed(e.data); };
    return w;
  }
  dispose() {
    for (const p of [...this.genPool, ...this.meshPool]) p.w.terminate();
    for (const c of this.chunks.values()) this.dropMeshes(c);
    this.chunks.clear();
  }

  /* ------------------------------------------------ access */
  chunkAt(x: number, z: number): Chunk | null {
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    if (cx === this.lastCx && cz === this.lastCz) return this.lastC;
    const c = this.chunks.get(chunkKey(cx, cz)) ?? null;
    if (c) { this.lastCx = cx; this.lastCz = cz; this.lastC = c; }
    return c;
  }
  get(x: number, y: number, z: number): number {
    if (y < 0) return B.bedrock;
    if (y >= HEIGHT) return 0;
    const c = this.chunkAt(x, z);
    if (!c) return -1;
    return c.blocks[(x - c.cx * CHUNK) + (z - c.cz * CHUNK) * CHUNK + y * CHUNK_AREA];
  }
  /** like get() but unloaded chunks read as air */
  id(x: number, y: number, z: number): number { const v = this.get(x, y, z); return v < 0 ? 0 : v; }
  meta(x: number, y: number, z: number): number {
    if (y < 0 || y >= HEIGHT) return 0;
    const c = this.chunkAt(x, z);
    if (!c) return 0;
    return c.meta[(x - c.cx * CHUNK) + (z - c.cz * CHUNK) * CHUNK + y * CHUNK_AREA];
  }
  def(x: number, y: number, z: number): BlockDef { return BLOCKS[this.id(x, y, z)]; }
  loaded(x: number, z: number) { return !!this.chunkAt(x, z); }
  solid(x: number, y: number, z: number) { const v = this.get(x, y, z); return v < 0 ? true : SOLID[v] === 1; }
  skyLight(x: number, y: number, z: number): number {
    if (!this.hasSky) return 0;
    if (y >= HEIGHT) return 15;
    if (y < 0) return 0;
    const c = this.chunkAt(x, z);
    if (!c || !c.sky) return 15;
    return c.sky[(x - c.cx * CHUNK) + (z - c.cz * CHUNK) * CHUNK + y * CHUNK_AREA];
  }
  blockLight(x: number, y: number, z: number): number {
    if (y < 0 || y >= HEIGHT) return 0;
    const c = this.chunkAt(x, z);
    if (!c || !c.blk) return 0;
    return c.blk[(x - c.cx * CHUNK) + (z - c.cz * CHUNK) * CHUNK + y * CHUNK_AREA];
  }
  surfaceY(x: number, z: number): number {
    const c = this.chunkAt(x, z);
    if (!c) return -1;
    if (c.skyMax) return c.skyMax[(x - c.cx * CHUNK) + (z - c.cz * CHUNK) * CHUNK];
    for (let y = HEIGHT - 1; y > 0; y--) { const id = this.id(x, y, z); if (OPAQUE[id] || id === B.water) return y; }
    return 0;
  }
  biomeAt(x: number, z: number): number {
    const c = this.chunkAt(x, z);
    return c ? c.biomes[(x - c.cx * CHUNK) + (z - c.cz * CHUNK) * CHUNK] : 0;
  }

  /** raw set without side effects (used by structures and systems) */
  set(x: number, y: number, z: number, id: number, meta = 0, notify = true): boolean {
    if (y < 0 || y >= HEIGHT) return false;
    const c = this.chunkAt(x, z);
    if (!c) return false;
    const lx = x - c.cx * CHUNK, lz = z - c.cz * CHUNK, i = lx + lz * CHUNK + y * CHUNK_AREA;
    const old = c.blocks[i], oldMeta = c.meta[i];
    if (old === id && oldMeta === meta) return false;
    c.blocks[i] = id; c.meta[i] = meta;
    if (old !== id && c.be.has(i) && !BLOCKS[id].container) c.be.delete(i);
    c.dataVersion++;
    c.saveDirty = true;
    const lightChange = OPAQUE[old] !== OPAQUE[id] || emission(old, oldMeta) !== emission(id, meta) || BLOCKS[old].filter !== BLOCKS[id].filter;
    this.requestRemesh(c, 0);
    if (lightChange) {
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (dx || dz) { const n = this.chunks.get(chunkKey(c.cx + dx, c.cz + dz)); if (n) this.requestRemesh(n, 1); }
    } else {
      if (lx === 0) this.remeshKey(c.cx - 1, c.cz); if (lx === 15) this.remeshKey(c.cx + 1, c.cz);
      if (lz === 0) this.remeshKey(c.cx, c.cz - 1); if (lz === 15) this.remeshKey(c.cx, c.cz + 1);
    }
    if (notify) {
      this.hooks?.onBlockChanged(x, y, z, old, id);
    }
    return true;
  }
  setMeta(x: number, y: number, z: number, meta: number) { this.set(x, y, z, this.id(x, y, z), meta, false); }
  private remeshKey(cx: number, cz: number) { const n = this.chunks.get(chunkKey(cx, cz)); if (n) this.requestRemesh(n, 0); }

  blockEntity(x: number, y: number, z: number, create?: string): BlockEntity | null {
    const c = this.chunkAt(x, z);
    if (!c) return null;
    const i = (x - c.cx * CHUNK) + (z - c.cz * CHUNK) * CHUNK + y * CHUNK_AREA;
    let be = c.be.get(i) ?? null;
    if (!be && create) { be = { type: create }; c.be.set(i, be); c.saveDirty = true; }
    return be;
  }
  touchBE(x: number, z: number) { const c = this.chunkAt(x, z); if (c) c.saveDirty = true; }
  allBlockEntities(): [number, number, number, BlockEntity][] {
    const out: [number, number, number, BlockEntity][] = [];
    for (const c of this.chunks.values()) for (const [i, be] of c.be) {
      const y = Math.floor(i / CHUNK_AREA), r = i % CHUNK_AREA, z = Math.floor(r / CHUNK), x = r % CHUNK;
      out.push([c.cx * CHUNK + x, y, c.cz * CHUNK + z, be]);
    }
    return out;
  }

  /* ------------------------------------------------ scheduled ticks */
  schedule(x: number, y: number, z: number, delay: number, kind = 0) {
    const t = this.tick + Math.max(1, delay);
    let m = this.scheduled.get(t);
    if (!m) { m = new Map(); this.scheduled.set(t, m); }
    m.set(`${x},${y},${z}`, kind);
  }
  takeScheduled(): [number, number, number, number][] {
    const m = this.scheduled.get(this.tick);
    if (!m) return [];
    this.scheduled.delete(this.tick);
    return [...m].map(([k, kind]) => { const [x, y, z] = k.split(',').map(Number); return [x, y, z, kind]; });
  }

  /* ------------------------------------------------ streaming */
  update(px: number, pz: number) {
    this.pcx = Math.floor(px / CHUNK); this.pcz = Math.floor(pz / CHUNK);
    const R = this.renderDistance;
    // request missing chunks (data radius R+1 so border chunks can mesh)
    const want: [number, number, number][] = [];
    for (let dz = -R - 1; dz <= R + 1; dz++) for (let dx = -R - 1; dx <= R + 1; dx++) {
      const d = dx * dx + dz * dz;
      if (d > (R + 1.5) * (R + 1.5)) continue;
      const cx = this.pcx + dx, cz = this.pcz + dz, k = chunkKey(cx, cz);
      if (!this.chunks.has(k) && !this.loading.has(k)) want.push([cx, cz, d]);
    }
    want.sort((a, b) => a[2] - b[2]);
    for (const [cx, cz] of want.slice(0, 24)) this.requestChunk(cx, cz);
    this.pumpGen();
    // meshes: anything loaded with all neighbours present and not yet meshed
    for (const c of this.chunks.values()) {
      const dx = c.cx - this.pcx, dz = c.cz - this.pcz;
      if (dx * dx + dz * dz > (R + 0.5) * (R + 0.5)) continue;
      if (c.meshVersion !== c.dataVersion && !c.meshPending && !this.meshQueue.has(chunkKey(c.cx, c.cz))) this.requestRemesh(c, 2);
    }
    this.pumpMesh();
  }
  private requestChunk(cx: number, cz: number) {
    const k = chunkKey(cx, cz);
    this.loading.add(k);
    const sk = `${this.worldId}|${this.dim}|${cx}|${cz}`;
    if (this.savedKeys.has(sk)) {
      loadChunk(sk).then((rec) => {
        if (!this.loading.has(k)) return;
        if (rec) this.addChunk(cx, cz, rec.blocks, rec.meta, new Uint8Array(CHUNK_AREA), [], rec);
        else this.genQueue.push({ cx, cz, dim: this.dim });
      }).catch(() => this.genQueue.push({ cx, cz, dim: this.dim }));
    } else this.genQueue.push({ cx, cz, dim: this.dim });
  }
  private pumpGen() {
    // closest first
    this.genQueue.sort((a, b) => ((a.cx - this.pcx) ** 2 + (a.cz - this.pcz) ** 2) - ((b.cx - this.pcx) ** 2 + (b.cz - this.pcz) ** 2));
    for (const p of this.genPool) {
      if (p.busy || !this.genQueue.length) continue;
      const j = this.genQueue.shift()!;
      p.busy = true;
      p.w.postMessage({ id: this.jobId++, seed: this.seed, dim: this.dim, cx: j.cx, cz: j.cz });
    }
  }
  private onGenerated(d: { cx: number; cz: number; dim: number; blocks: Uint8Array; meta: Uint8Array; features: GenFeature[]; biomes: Uint8Array }) {
    if (d.dim !== this.dim) return;
    const k = chunkKey(d.cx, d.cz);
    if (!this.loading.has(k)) return;
    this.addChunk(d.cx, d.cz, d.blocks, d.meta, d.biomes, d.features, null);
    this.pumpGen();
  }
  private addChunk(cx: number, cz: number, blocks: Uint8Array, meta: Uint8Array, biomes: Uint8Array, features: GenFeature[], rec: ChunkRecord | null) {
    const k = chunkKey(cx, cz);
    this.loading.delete(k);
    const c = new Chunk(cx, cz, blocks, meta, biomes);
    this.chunks.set(k, c);
    this.lastCx = 1e9;
    if (rec) {
      for (const [i, be] of Object.entries(rec.be ?? {})) c.be.set(Number(i), be as BlockEntity);
      if (rec.biomes && rec.biomes.length === CHUNK_AREA) c.biomes = rec.biomes;
      else this.genBiomes(c);
      if (rec.ents?.length) this.hooks?.onChunkEntities(this.dim, c, rec.ents);
    } else {
      this.hooks?.onFeatures(this.dim, c, features);
    }
  }
  private terrain: Terrain | null = null;
  private genBiomes(c: Chunk) {
    if (this.dim !== Dim.Overworld) { c.biomes.fill(this.dim === Dim.Ember ? 255 : 254); return; }
    this.terrain ??= new Terrain(this.seed);
    for (let z = 0; z < CHUNK; z++) for (let x = 0; x < CHUNK; x++) c.biomes[x + z * CHUNK] = this.terrain.sample(c.cx * CHUNK + x, c.cz * CHUNK + z).biome;
  }
  requestRemesh(c: Chunk, priority: number) {
    const k = chunkKey(c.cx, c.cz);
    const cur = this.meshQueue.get(k);
    if (cur === undefined || priority < cur) this.meshQueue.set(k, priority);
  }
  private neighboursReady(c: Chunk) {
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (!this.chunks.has(chunkKey(c.cx + dx, c.cz + dz))) return false;
    return true;
  }
  private pumpMesh() {
    if (!this.meshQueue.size) return;
    const free = this.meshPool.filter((p) => !p.busy);
    if (!free.length) return;
    const entries = [...this.meshQueue].map(([k, pr]) => {
      const c = this.chunks.get(k);
      const d = c ? (c.cx - this.pcx) ** 2 + (c.cz - this.pcz) ** 2 : 1e9;
      return { k, c, score: pr * 1000 + d };
    }).sort((a, b) => a.score - b.score);
    for (const e of entries) {
      if (!free.length) break;
      if (!e.c) { this.meshQueue.delete(e.k); continue; }
      if (e.c.meshPending) continue;
      if (!this.neighboursReady(e.c)) continue;
      this.meshQueue.delete(e.k);
      const p = free.shift()!;
      p.busy = true;
      e.c.meshPending = true;
      const blocks: (Uint8Array | null)[] = [], meta: (Uint8Array | null)[] = [];
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const n = this.chunks.get(chunkKey(e.c.cx + dx, e.c.cz + dz))!;
        blocks.push(n.blocks.slice()); meta.push(n.meta.slice());
      }
      p.w.postMessage({ id: this.jobId++, blocks, meta, hasSky: this.hasSky, cx: e.c.cx, cz: e.c.cz, dim: this.dim, version: e.c.dataVersion });
    }
  }
  private onMeshed(d: { cx: number; cz: number; dim: number; version: number; layers: MeshLayer[]; skyMax: Uint8Array; sky: Uint8Array; blk: Uint8Array }) {
    this.pumpMesh();
    if (d.dim !== this.dim) return;
    const c = this.chunks.get(chunkKey(d.cx, d.cz));
    if (!c) return;
    c.meshPending = false;
    c.sky = d.sky; c.blk = d.blk; c.skyMax = d.skyMax;
    this.dropMeshes(c);
    d.layers.forEach((l, li) => {
      if (!l.idx.length) return;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(l.pos, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(l.uv, 2));
      g.setAttribute('attr', new THREE.BufferAttribute(l.attr, 4));
      g.setIndex(new THREE.BufferAttribute(l.idx, 1));
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, this.materials[li]);
      m.position.set(c.cx * CHUNK, 0, c.cz * CHUNK);
      m.updateMatrix();
      m.matrixAutoUpdate = false;
      m.renderOrder = li === 2 ? 2 : 0;
      this.group.add(m);
      c.meshes[li] = m;
    });
    c.meshVersion = d.version;
    if (c.meshVersion !== c.dataVersion) this.requestRemesh(c, 0);
    this.pumpMesh();
  }
  private dropMeshes(c: Chunk) {
    for (let i = 0; i < 3; i++) {
      const m = c.meshes[i];
      if (m) { this.group.remove(m); m.geometry.dispose(); c.meshes[i] = null; }
    }
  }
  /** unload far chunks, returning records that must be persisted */
  unloadFar(collectEntities: (c: Chunk) => unknown[]): ChunkRecord[] {
    const R = this.renderDistance + 3;
    const out: ChunkRecord[] = [];
    for (const [k, c] of this.chunks) {
      const dx = c.cx - this.pcx, dz = c.cz - this.pcz;
      if (dx * dx + dz * dz <= R * R) continue;
      const ents = collectEntities(c);
      if (c.saveDirty || ents.length || c.ents.length) out.push(this.record(c, ents));
      this.dropMeshes(c);
      this.chunks.delete(k);
      this.meshQueue.delete(k);
    }
    this.lastCx = 1e9;
    for (const k of this.loading) {
      const [cx, cz] = k.split(',').map(Number);
      if ((cx - this.pcx) ** 2 + (cz - this.pcz) ** 2 > R * R) { this.loading.delete(k); this.genQueue = this.genQueue.filter((j) => chunkKey(j.cx, j.cz) !== k); }
    }
    return out;
  }
  record(c: Chunk, ents: unknown[]): ChunkRecord {
    const be: Record<string, unknown> = {};
    for (const [i, v] of c.be) be[i] = v;
    const key = `${this.worldId}|${this.dim}|${c.cx}|${c.cz}`;
    this.savedKeys.add(key);
    c.saveDirty = false;
    return { key, world: this.worldId, blocks: c.blocks.slice(), meta: c.meta.slice(), be: structuredClone(be), ents, generatedFeatures: true, biomes: c.biomes.slice() };
  }
  dirtyRecords(collectEntities: (c: Chunk) => unknown[], all = false): ChunkRecord[] {
    const out: ChunkRecord[] = [];
    for (const c of this.chunks.values()) {
      const ents = collectEntities(c);
      if (c.saveDirty || (all && ents.length)) out.push(this.record(c, ents));
    }
    return out;
  }
  async flush(collectEntities: (c: Chunk) => unknown[], all = false) {
    await saveChunks(this.dirtyRecords(collectEntities, all));
  }
  pendingCount() { return this.loading.size + this.meshQueue.size; }
  isReadyAround(x: number, z: number, r = 1) {
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      const c = this.chunks.get(chunkKey(cx + dx, cz + dz));
      if (!c || c.meshVersion < 0) return false;
    }
    return true;
  }
  forEachNeighbour(x: number, y: number, z: number, fn: (x: number, y: number, z: number, d: number) => void) {
    for (let d = 0; d < 6; d++) fn(x + DIRS[d][0], y + DIRS[d][1], z + DIRS[d][2], d);
  }
  get emitLight() { return LIGHT_EMIT; }
}
