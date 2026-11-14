import { CHUNK, HEIGHT, CHUNK_AREA, CHUNK_VOL } from '../../constants';
import { BLOCKS, B } from '../../registry/blocks';
import type { Rng } from '../noise';

export interface GenFeature { kind: 'chest' | 'cage' | 'village' | 'boss' | 'sign' | 'npc'; x: number; y: number; z: number; data: string }

/** Writes into one chunk; world coordinates outside the chunk are silently clipped. */
export class Writer {
  blocks = new Uint8Array(CHUNK_VOL);
  meta = new Uint8Array(CHUNK_VOL);
  features: GenFeature[] = [];
  readonly x0: number; readonly z0: number;
  constructor(public cx: number, public cz: number) { this.x0 = cx * CHUNK; this.z0 = cz * CHUNK; }
  inside(x: number, y: number, z: number) {
    const lx = x - this.x0, lz = z - this.z0;
    return lx >= 0 && lx < CHUNK && lz >= 0 && lz < CHUNK && y >= 0 && y < HEIGHT;
  }
  get(x: number, y: number, z: number): number {
    if (!this.inside(x, y, z)) return -1;
    return this.blocks[(x - this.x0) + (z - this.z0) * CHUNK + y * CHUNK_AREA];
  }
  set(x: number, y: number, z: number, id: number, meta = 0) {
    if (!this.inside(x, y, z)) return;
    const i = (x - this.x0) + (z - this.z0) * CHUNK + y * CHUNK_AREA;
    this.blocks[i] = id; this.meta[i] = meta;
  }
  /** set only if the target is air or replaceable vegetation */
  soft(x: number, y: number, z: number, id: number, meta = 0) {
    const cur = this.get(x, y, z);
    if (cur < 0) return;
    if (cur === 0 || BLOCKS[cur].replaceable || BLOCKS[cur].plant || BLOCKS[cur].key.endsWith('_leaves')) this.set(x, y, z, id, meta);
  }
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, id: number, meta = 0) {
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) this.set(x, y, z, id, meta);
  }
  hollow(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, wall: number, inside = 0) {
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const edge = x === x0 || x === x1 || y === y0 || y === y1 || z === z0 || z === z1;
      this.set(x, y, z, edge ? wall : inside);
    }
  }
  feature(kind: GenFeature['kind'], x: number, y: number, z: number, data: string) {
    if (this.inside(x, y, z)) this.features.push({ kind, x, y, z, data });
  }
  chest(x: number, y: number, z: number, loot: string, facing = 0) {
    this.set(x, y, z, B.chest, facing);
    this.feature('chest', x, y, z, loot);
  }
}

/* ---------------- trees ---------------- */
export interface TreeWriter { get(x: number, y: number, z: number): number; set(x: number, y: number, z: number, id: number, meta?: number): void; soft(x: number, y: number, z: number, id: number, meta?: number): void }
function leafBlob(w: TreeWriter, leaf: number, cx: number, cy: number, cz: number, r: number, rng: Rng, squash = 1) {
  for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
    const d = (dx * dx + (dy * dy) / (squash * squash) + dz * dz);
    if (d <= r * r + 0.5 && !(d > r * r - 1 && rng() < 0.35)) w.soft(cx + dx, cy + dy, cz + dz, leaf);
  }
}

export function growTree(w: TreeWriter, species: string, x: number, y: number, z: number, rng: Rng) {
  const log = B[`${species}_log`], leaf = B[`${species}_leaves`];
  switch (species) {
    case 'oak': {
      const h = 4 + Math.floor(rng() * 3);
      for (let i = 0; i < h; i++) w.set(x, y + i, z, log);
      for (let dy = -2; dy <= 1; dy++) {
        const r = dy >= 0 ? 1 : 2;
        for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) === r && Math.abs(dz) === r && (dy === 1 || rng() < 0.5)) continue;
          w.soft(x + dx, y + h + dy, z + dz, leaf);
        }
      }
      w.soft(x, y + h + 1, z, leaf);
      break;
    }
    case 'birch': {
      const h = 5 + Math.floor(rng() * 3);
      for (let i = 0; i < h; i++) w.set(x, y + i, z, log);
      for (let dy = -3; dy <= 1; dy++) {
        const r = dy >= -1 ? 1 : 2;
        for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) === r && Math.abs(dz) === r && rng() < 0.7) continue;
          w.soft(x + dx, y + h + dy, z + dz, leaf);
        }
      }
      break;
    }
    case 'pine': {
      const h = 7 + Math.floor(rng() * 5);
      for (let i = 0; i < h; i++) w.set(x, y + i, z, log);
      let r = 0;
      for (let yy = y + h + 1; yy >= y + 3; yy--) {
        for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) + Math.abs(dz) > r + (r > 1 ? 1 : 0)) continue;
          if (dx || dz || yy >= y + h) w.soft(x + dx, yy, z + dz, leaf);
        }
        r = r >= 3 || (yy % 2 === 0 && r > 0) ? Math.max(1, r - 1) : r + 1;
        if (yy > y + h - 1) r = 1;
      }
      break;
    }
    case 'teak': {
      const h = 9 + Math.floor(rng() * 7);
      for (let i = 0; i < h; i++) w.set(x, y + i, z, log);
      leafBlob(w, leaf, x, y + h, z, 3, rng, 0.6);
      // branches
      for (let k = 0; k < 2; k++) {
        const a = rng() * Math.PI * 2, by = y + Math.floor(h * 0.55) + k * 2;
        const bx = x + Math.round(Math.cos(a) * 2), bz = z + Math.round(Math.sin(a) * 2);
        w.set(bx, by, bz, log, a % 2 < 1 ? 1 : 2);
        leafBlob(w, leaf, bx, by + 1, bz, 2, rng, 0.6);
      }
      // hanging vines
      for (let i = 0; i < 14; i++) {
        const a = rng() * Math.PI * 2, vx = x + Math.round(Math.cos(a) * 4), vz = z + Math.round(Math.sin(a) * 4);
        const len = 2 + Math.floor(rng() * 5);
        for (let j = 0; j < len; j++) w.soft(vx, y + h - 1 - j, vz, B.vine, Math.floor(rng() * 4));
      }
      break;
    }
    case 'thorn': {
      const h = 4 + Math.floor(rng() * 3);
      const dx = rng() < 0.5 ? 1 : -1, dz = rng() < 0.5 ? 1 : -1;
      let tx = x, tz = z;
      for (let i = 0; i < h; i++) {
        if (i === Math.floor(h / 2)) { tx += dx; tz += dz; }
        w.set(tx, y + i, tz, log);
      }
      for (let ddz = -3; ddz <= 3; ddz++) for (let ddx = -3; ddx <= 3; ddx++) {
        if (Math.abs(ddx) + Math.abs(ddz) > 4) continue;
        w.soft(tx + ddx, y + h, tz + ddz, leaf);
        if (Math.abs(ddx) + Math.abs(ddz) <= 2) w.soft(tx + ddx, y + h + 1, tz + ddz, leaf);
      }
      break;
    }
    case 'willow': {
      const h = 5 + Math.floor(rng() * 2);
      for (let i = 0; i < h; i++) w.set(x, y + i, z, log);
      for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
        const d = dx * dx + dz * dz;
        if (d > 10) continue;
        w.soft(x + dx, y + h, z + dz, leaf);
        if (d <= 4) w.soft(x + dx, y + h + 1, z + dz, leaf);
        if (d >= 7 && rng() < 0.6) {
          const len = 1 + Math.floor(rng() * 4);
          for (let j = 1; j <= len; j++) w.soft(x + dx, y + h - j, z + dz, j === len ? B.vine : leaf, 0);
        }
      }
      break;
    }
  }
}

export function giantMushroom(w: TreeWriter, x: number, y: number, z: number, rng: Rng) {
  const red = rng() < 0.5;
  const h = 5 + Math.floor(rng() * 3);
  for (let i = 0; i < h; i++) w.set(x, y + i, z, B.mushroom_stem);
  const cap = red ? B.mushroom_cap_red : B.mushroom_cap_brown;
  if (red) {
    for (let dy = -2; dy <= 0; dy++) {
      const r = dy === 0 ? 1 : 2;
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (dy < 0 && Math.abs(dx) < 2 && Math.abs(dz) < 2) continue;
        if (Math.abs(dx) === 2 && Math.abs(dz) === 2) continue;
        w.soft(x + dx, y + h + dy, z + dz, cap);
      }
    }
  } else {
    for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) if (!(Math.abs(dx) === 3 && Math.abs(dz) === 3)) w.soft(x + dx, y + h, z + dz, cap);
  }
}
