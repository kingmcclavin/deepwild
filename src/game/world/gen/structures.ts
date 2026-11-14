import { B } from '../../registry/blocks';
import { SEA_LEVEL, CHUNK } from '../../constants';
import { hash32, mulberry, type Rng } from '../noise';
import { Bi, type Terrain } from './terrain';
import type { Writer } from './writer';

/** Local frame with rotation: local -Z is the "front" of a building. */
class Frame {
  constructor(public w: Writer, public ox: number, public oy: number, public oz: number, public r: number) {}
  pos(lx: number, lz: number): [number, number] {
    switch (this.r & 3) {
      case 0: return [this.ox + lx, this.oz + lz];
      case 1: return [this.ox - lz, this.oz + lx];
      case 2: return [this.ox - lx, this.oz - lz];
      default: return [this.ox + lz, this.oz - lx];
    }
  }
  f(facing: number) { return (facing + this.r) & 3; }
  set(lx: number, ly: number, lz: number, id: number, meta = 0) { const [x, z] = this.pos(lx, lz); this.w.set(x, this.oy + ly, z, id, meta); }
  setF(lx: number, ly: number, lz: number, id: number, facing: number, extra = 0) { this.set(lx, ly, lz, id, this.f(facing) | extra); }
  get(lx: number, ly: number, lz: number) { const [x, z] = this.pos(lx, lz); return this.w.get(x, this.oy + ly, z); }
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, id: number, meta = 0) {
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) this.set(x, y, z, id, meta);
  }
  walls(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, id: number, corner?: number) {
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const ex = x === x0 || x === x1, ez = z === z0 || z === z1;
      if (ex || ez) this.set(x, y, z, corner !== undefined && ex && ez ? corner : id, corner !== undefined && ex && ez ? 0 : 0);
    }
  }
  wallTorch(lx: number, ly: number, lz: number, towardWall: number) { this.set(lx, ly, lz, B.torch, 1 + this.f(towardWall)); }
  ladder(lx: number, ly: number, lz: number, towardWall: number) { this.set(lx, ly, lz, B.ladder, this.f(towardWall)); }
  door(lx: number, ly: number, lz: number, facing: number, id = B.wood_door) {
    this.setF(lx, ly, lz, id, facing);
    this.setF(lx, ly + 1, lz, id, facing, 8);
  }
  chest(lx: number, ly: number, lz: number, loot: string, facing = 0) {
    const [x, z] = this.pos(lx, lz);
    this.w.chest(x, this.oy + ly, z, loot, this.f(facing));
  }
  feature(kind: 'npc' | 'cage' | 'boss' | 'village' | 'chest', lx: number, ly: number, lz: number, data: string) {
    const [x, z] = this.pos(lx, lz);
    this.w.feature(kind, x, this.oy + ly, z, data);
  }
  /** fill foundation down from local y=-1 to ground and clear air above footprint */
  foundation(x0: number, z0: number, x1: number, z1: number, mat: number, clear = 8) {
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      for (let y = -1; y >= -8; y--) {
        const cur = this.get(x, y, z);
        if (cur > 0 && cur !== B.water && cur !== B.tall_grass && cur !== B.snow_layer && y < -1) break;
        this.set(x, y, z, mat);
      }
      for (let y = 0; y <= clear; y++) this.set(x, y, z, 0);
    }
  }
}

interface Style { wall: number; frame: number; floor: number; roof: number; log: number }
function villageStyle(biome: Bi): Style {
  switch (biome) {
    case Bi.Desert: case Bi.Badlands: return { wall: B.sandstone, frame: B.sandstone, floor: B.sandstone, roof: B.sandstone, log: B.sandstone };
    case Bi.Savanna: return { wall: B.thorn_planks, frame: B.thorn_log, floor: B.thorn_planks, roof: B.wood_slab, log: B.thorn_log };
    case Bi.SnowyForest: case Bi.Tundra: return { wall: B.pine_planks, frame: B.pine_log, floor: B.cobblestone, roof: B.pine_planks, log: B.pine_log };
    default: return { wall: B.oak_planks, frame: B.oak_log, floor: B.cobblestone, roof: B.wood_slab, log: B.oak_log };
  }
}

/* ---------------- village buildings ---------------- */
function smallHouse(f: Frame, s: Style, rng: Rng, prof: string) {
  f.foundation(0, 0, 4, 4, B.cobblestone);
  f.box(0, 0, 0, 4, 0, 4, s.floor);
  f.walls(0, 1, 0, 4, 3, 4, s.wall, s.frame);
  f.box(0, 4, 0, 4, 4, 4, s.roof === B.wood_slab ? B.oak_planks : s.roof);
  f.box(1, 5, 1, 3, 5, 3, s.roof === B.wood_slab ? B.wood_slab : s.roof);
  f.door(2, 1, 0, 0);
  f.set(0, 2, 2, B.glass_pane); f.set(4, 2, 2, B.glass_pane); f.set(2, 2, 4, B.glass_pane);
  f.setF(3, 1, 3, B.bed, 2);
  f.wallTorch(2, 3, 3, 2);
  if (rng() < 0.5) f.set(1, 1, 3, B.crafting_table);
  f.feature('npc', 2, 1, 2, prof);
}
function bigHouse(f: Frame, s: Style, rng: Rng, prof: string) {
  f.foundation(0, 0, 6, 5, B.cobblestone);
  f.box(0, 0, 0, 6, 0, 5, s.floor);
  f.walls(0, 1, 0, 6, 4, 5, s.wall, s.frame);
  f.box(0, 5, 0, 6, 5, 5, s.wall);
  f.box(1, 6, 1, 5, 6, 4, s.roof === B.wood_slab ? B.wood_slab : s.roof);
  f.door(3, 1, 0, 0);
  for (const [x, z] of [[0, 2], [0, 3], [6, 2], [6, 3], [2, 5], [4, 5]]) f.set(x, 2, z, B.glass_pane);
  f.setF(1, 1, 4, B.bed, 2);
  f.setF(5, 1, 4, B.furnace, 0);
  f.set(5, 1, 3, B.crafting_table);
  f.chest(4, 1, 4, 'village_house');
  f.wallTorch(3, 4, 4, 2);
  f.set(3, 1, 2, 0);
  if (rng() < 0.4) f.set(1, 1, 1, B.lantern);
  f.feature('npc', 3, 1, 2, prof);
  f.feature('npc', 2, 1, 3, 'farmer');
}
function farm(f: Frame, s: Style, rng: Rng) {
  f.foundation(0, 0, 6, 8, B.dirt, 3);
  f.walls(0, 0, 0, 6, 0, 8, s.log);
  const crops = [B.wheat_crop, B.carrot_crop, B.potato_crop, B.beet_crop];
  const c1 = crops[Math.floor(rng() * 4)], c2 = crops[Math.floor(rng() * 4)];
  for (let z = 1; z <= 7; z++) {
    f.set(3, 0, z, B.water);
    for (const x of [1, 2, 4, 5]) {
      f.set(x, 0, z, B.farmland, 7);
      const c = x < 3 ? c1 : c2;
      f.set(x, 1, z, c, c === B.wheat_crop ? Math.floor(rng() * 8) : Math.floor(rng() * 4));
    }
  }
  f.feature('npc', 0, 1, 4, 'farmer');
}
function smithy(f: Frame, _s: Style, _rng: Rng) {
  f.foundation(0, 0, 6, 6, B.cobblestone);
  f.box(0, 0, 0, 6, 0, 6, B.cobblestone);
  f.walls(0, 1, 0, 6, 4, 6, B.cobblestone, B.oak_log);
  f.box(0, 5, 0, 6, 5, 6, B.stone_slab);
  for (let x = 1; x <= 5; x++) for (const y of [1, 2, 3, 4]) f.set(x, y, 0, 0);
  for (const x of [0, 6]) f.set(x, 1, 0, B.oak_log);
  f.setF(1, 1, 5, B.furnace, 0); f.setF(2, 1, 5, B.blast_furnace, 0);
  f.setF(4, 1, 4, B.anvil, 0);
  f.box(4, 0, 5, 5, 0, 5, B.lava);
  f.set(4, 1, 5, B.iron_bars); f.set(5, 1, 5, B.iron_bars);
  f.chest(1, 1, 3, 'smithy', 1);
  f.wallTorch(3, 3, 5, 2);
  f.feature('npc', 3, 1, 2, 'smith');
}
function library(f: Frame, s: Style, _rng: Rng) {
  f.foundation(0, 0, 6, 6, B.cobblestone);
  f.box(0, 0, 0, 6, 0, 6, s.floor);
  f.walls(0, 1, 0, 6, 4, 6, s.wall, s.frame);
  f.box(0, 5, 0, 6, 5, 6, s.wall);
  for (let x = 1; x <= 5; x++) { f.set(x, 1, 5, B.bookshelf); f.set(x, 2, 5, B.bookshelf); }
  for (let z = 2; z <= 4; z++) { f.set(1, 1, z, B.bookshelf); f.set(5, 1, z, B.bookshelf); }
  f.door(3, 1, 0, 0);
  f.set(0, 2, 3, B.glass_pane); f.set(6, 2, 3, B.glass_pane);
  f.chest(3, 1, 4, 'library');
  f.wallTorch(3, 4, 5, 2);
  f.feature('npc', 3, 1, 2, 'librarian');
}
function pen(f: Frame, _s: Style, _rng: Rng) {
  f.foundation(0, 0, 6, 6, B.dirt, 3);
  f.box(0, 0, 0, 6, 0, 6, B.grass);
  for (let i = 0; i <= 6; i++) { f.set(i, 1, 0, B.wood_fence); f.set(i, 1, 6, B.wood_fence); f.set(0, 1, i, B.wood_fence); f.set(6, 1, i, B.wood_fence); }
  f.setF(3, 1, 0, B.wood_fence_gate, 0);
  f.set(5, 1, 5, B.hay_bale);
  f.feature('npc', 3, 1, 3, 'herder');
}

const VILLAGE_BUILDINGS = [smallHouse, smallHouse, bigHouse, farm, farm, smithy, library, pen];
const PROFS = ['farmer', 'shepherd', 'butcher', 'cartographer'];

export function buildVillage(w: Writer, T: Terrain, ox: number, oz: number, rng: Rng) {
  const col = T.sample(ox, oz);
  const s = villageStyle(col.biome);
  const gy = col.h + 1;
  // well
  const fw = new Frame(w, ox - 2, gy, oz - 2, 0);
  fw.foundation(0, 0, 4, 4, B.cobblestone, 6);
  fw.box(0, -1, 0, 4, -1, 4, B.cobblestone);
  fw.walls(0, 0, 0, 4, 0, 4, B.cobblestone);
  fw.box(1, -3, 1, 3, 0, 3, B.water);
  for (const [x, z] of [[0, 0], [4, 0], [0, 4], [4, 4]]) fw.box(x, 1, z, x, 3, z, B.wood_fence);
  fw.box(0, 4, 0, 4, 4, 4, B.cobblestone);
  fw.set(2, 5, 2, B.lantern);
  w.feature('village', ox, gy, oz, String(hash32(ox, oz, T.seed)));
  // roads + buildings
  let bi = 0;
  for (let dir = 0; dir < 4; dir++) {
    const [dx, dz] = [[0, -1], [1, 0], [0, 1], [-1, 0]][dir];
    const len = 18 + Math.floor(rng() * 14);
    for (let i = 3; i < len; i++) {
      for (let s2 = -1; s2 <= 1; s2++) {
        const x = ox + dx * i + (dz !== 0 ? s2 : 0), z = oz + dz * i + (dx !== 0 ? s2 : 0);
        const h = T.sample(x, z).h;
        if (h < SEA_LEVEL) { w.set(x, SEA_LEVEL, z, s.wall); continue; }
        w.set(x, h, z, col.biome === Bi.Desert ? B.sandstone : B.path);
        w.set(x, h + 1, z, 0);
      }
      if (i % 9 === 6) {
        for (const side of [-1, 1]) {
          if (rng() < 0.2) continue;
          const kind = VILLAGE_BUILDINGS[(Math.floor(rng() * VILLAGE_BUILDINGS.length) + bi++) % VILLAGE_BUILDINGS.length];
          // building sits 3 blocks off the road with its front (local -Z) facing the road
          const px = dz !== 0 ? side : 0, pz = dx !== 0 ? side : 0;
          const bx = ox + dx * i + px * 3, bz = oz + dz * i + pz * 3;
          const rot = [[0, -1], [1, 0], [0, 1], [-1, 0]].findIndex(([a, c]) => a === -px && c === -pz);
          const h = T.sample(bx, bz).h;
          if (h < SEA_LEVEL) continue;
          const fr = new Frame(w, bx, h + 1, bz, rot);
          const [sx, sz] = fr.pos(-3, 0);
          const shift = new Frame(w, sx, h + 1, sz, rot);
          kind(shift, s, rng, PROFS[Math.floor(rng() * PROFS.length)]);
          // lamp post near the road
          if (rng() < 0.4) {
            const lx = ox + dx * (i + 2), lz = oz + dz * (i + 2);
            const lh = T.sample(lx, lz).h;
            w.set(lx, lh + 1, lz, B.wood_fence); w.set(lx, lh + 2, lz, B.wood_fence); w.set(lx, lh + 3, lz, B.lantern);
          }
        }
      }
    }
  }
}

/* ---------------- other overworld structures ---------------- */
export function buildRuin(w: Writer, T: Terrain, ox: number, oz: number, rng: Rng) {
  const h = T.sample(ox, oz).h;
  const f = new Frame(w, ox, h + 1, oz, Math.floor(rng() * 4));
  f.foundation(0, 0, 6, 6, B.cobblestone, 5);
  f.box(0, 0, 0, 6, 0, 6, B.mossy_cobblestone);
  for (let y = 1; y <= 3; y++) for (let i = 0; i <= 6; i++) {
    for (const [x, z] of [[i, 0], [i, 6], [0, i], [6, i]]) {
      if (rng() < 0.25 + y * 0.18) continue;
      f.set(x, y, z, rng() < 0.4 ? B.mossy_cobblestone : B.cobblestone);
    }
  }
  f.chest(3, 1, 4, 'ruin');
  f.set(1, 1, 1, B.cobweb);
  if (rng() < 0.5) f.set(5, 1, 2, B.crafting_table);
}
export function buildTower(w: Writer, T: Terrain, ox: number, oz: number, rng: Rng) {
  const h = T.sample(ox, oz).h;
  const f = new Frame(w, ox, h + 1, oz, Math.floor(rng() * 4));
  f.foundation(-1, -1, 5, 5, B.stone_bricks, 18);
  f.box(-1, 0, -1, 5, 0, 5, B.stone_bricks);
  for (let y = 1; y <= 15; y++) f.walls(0, y, 0, 4, y, 4, rng() < 0.15 ? B.mossy_stone_bricks : rng() < 0.08 ? B.cracked_stone_bricks : B.stone_bricks);
  f.box(1, 1, 1, 3, 15, 3, 0);
  for (let y = 1; y <= 16; y++) f.ladder(2, y, 3, 2);
  f.door(2, 1, 0, 0);
  for (const y of [5, 10]) { f.set(0, y, 2, B.glass_pane); f.set(4, y, 2, B.glass_pane); f.box(1, y, 1, 3, y, 2, B.oak_planks); }
  f.box(-1, 16, -1, 5, 16, 5, B.stone_bricks);
  f.set(2, 16, 3, 0);
  for (let i = -1; i <= 5; i += 2) { f.set(i, 17, -1, B.cobble_wall); f.set(i, 17, 5, B.cobble_wall); f.set(-1, 17, i, B.cobble_wall); f.set(5, 17, i, B.cobble_wall); }
  f.chest(1, 17, 1, 'tower');
  f.set(3, 17, 1, B.lantern);
  f.set(1, 6, 1, B.cobweb); f.set(3, 11, 1, B.cobweb);
  f.feature('cage', 2, 6, 1, 'rattler');
  f.set(2, 6, 1, B.mob_cage);
}
export function buildShipwreck(w: Writer, T: Terrain, ox: number, oz: number, rng: Rng) {
  const h = T.sample(ox, oz).h;
  const f = new Frame(w, ox, h + 1, oz, Math.floor(rng() * 4));
  const wood = [B.oak_planks, B.pine_planks, B.teak_planks][Math.floor(rng() * 3)];
  for (let z = 0; z < 13; z++) {
    const half = z < 2 || z > 10 ? 1 : 2;
    for (let x = -half; x <= half; x++) {
      if (rng() < 0.1) continue;
      f.set(x, 0, z, wood);
      if (Math.abs(x) === half) for (let y = 1; y <= 2; y++) if (rng() > 0.2) f.set(x, y, z, wood);
    }
    if (z > 1 && z < 11) for (let x = -half + 1; x <= half - 1; x++) for (let y = 1; y <= 2; y++) f.set(x, y, z, B.water);
  }
  for (let y = 1; y < 7; y++) if (y < 5 || rng() < 0.5) f.set(0, y, 6, B.oak_log);
  f.chest(0, 1, 2, 'ship');
  f.chest(1, 1, 9, 'ship_supply');
}
export function buildCache(w: Writer, T: Terrain, ox: number, oz: number, _rng: Rng) {
  const h = T.sample(ox, oz).h;
  w.chest(ox, h - 3, oz, 'treasure');
}
export function buildTemple(w: Writer, T: Terrain, ox: number, oz: number, rng: Rng) {
  const h = T.sample(ox, oz).h;
  const f = new Frame(w, ox - 7, h, oz - 7, 0);
  f.foundation(0, 0, 14, 14, B.sandstone, 12);
  for (let l = 0; l < 7; l++) f.walls(l, l, l, 14 - l, l, 14 - l, B.sandstone);
  for (let l = 0; l < 7; l++) f.box(l, l, l, 14 - l, l, 14 - l, B.sandstone);
  f.box(2, 1, 2, 12, 4, 12, 0);
  f.box(1, 1, 7, 1, 2, 7, 0); // entrance
  f.set(0, 1, 7, 0); f.set(0, 2, 7, 0);
  f.box(5, 1, 5, 9, 1, 9, B.terracotta_orange);
  f.set(7, 1, 7, B.concrete_blue);
  // hidden chamber
  f.box(5, -6, 5, 9, -1, 9, B.sandstone);
  f.box(6, -5, 6, 8, -2, 8, 0);
  f.set(7, 1, 7, B.concrete_blue);
  f.set(7, 0, 7, 0); f.set(7, -1, 7, 0);
  f.chest(6, -5, 7, 'temple', 1); f.chest(8, -5, 7, 'temple', 3); f.chest(7, -5, 6, 'temple', 2); f.chest(7, -5, 8, 'temple', 0);
  f.set(7, -5, 7, B.pressure_plate);
  f.set(7, -7, 7, B.powder_keg);
  for (const [x, z] of [[6, 6], [8, 8], [6, 8], [8, 6]]) f.set(x, -7, z, B.powder_keg);
  f.box(5, -8, 5, 9, -8, 9, B.sandstone);
  // chimneys / towers
  for (const [x, z] of [[0, 0], [12, 0], [0, 12], [12, 12]]) { f.box(x, 1, z, x + 2, 8, z + 2, B.sandstone); f.set(x + 1, 8, z + 1, B.terracotta_orange); }
}
export function buildShrine(w: Writer, T: Terrain, ox: number, oz: number, rng: Rng) {
  const h = T.sample(ox, oz).h;
  const f = new Frame(w, ox - 4, h, oz - 4, Math.floor(rng() * 4));
  f.foundation(0, 0, 8, 8, B.mossy_cobblestone, 10);
  f.box(0, 0, 0, 8, 0, 8, B.mossy_cobblestone);
  f.walls(0, 1, 0, 8, 4, 8, B.cobblestone);
  f.box(1, 5, 1, 7, 5, 7, B.mossy_cobblestone);
  f.walls(2, 6, 2, 6, 8, 6, B.mossy_cobblestone);
  f.box(2, 9, 2, 6, 9, 6, B.cobblestone);
  f.set(4, 1, 0, 0); f.set(4, 2, 0, 0);
  for (let i = 0; i < 20; i++) f.set(Math.floor(rng() * 9), 1 + Math.floor(rng() * 4), rng() < 0.5 ? 0 : 8, B.mossy_cobblestone);
  f.chest(2, 1, 7, 'shrine');
  f.chest(4, 6, 5, 'shrine');
  f.set(4, 5, 7, 0);
  for (let y = 1; y <= 5; y++) f.ladder(4, y, 7, 2);
  for (let i = 0; i < 10; i++) f.set(rng() < 0.5 ? -1 : 9, 1 + Math.floor(rng() * 6), Math.floor(rng() * 9), B.vine, 0);
  f.set(2, 1, 2, B.stone_button, 0);
  f.feature('cage', 6, 1, 2, 'skitterfang');
  f.set(6, 1, 2, B.mob_cage);
}
export function buildDungeon(w: Writer, T: Terrain, ox: number, oz: number, rng: Rng) {
  const top = T.sample(ox, oz).h;
  const y = 12 + Math.floor(rng() * Math.max(1, Math.min(40, top - 22)));
  w.hollow(ox - 4, y - 1, oz - 4, ox + 4, y + 4, oz + 4, B.cobblestone, 0);
  for (let x = ox - 4; x <= ox + 4; x++) for (let z = oz - 4; z <= oz + 4; z++) if (rng() < 0.4) w.set(x, y - 1, z, B.mossy_cobblestone);
  const mob = ['shambler', 'shambler', 'rattler', 'skitterfang'][Math.floor(rng() * 4)];
  w.set(ox, y, oz, B.mob_cage);
  w.feature('cage', ox, y, oz, mob);
  w.chest(ox - 3, y, oz, 'dungeon', 1);
  if (rng() < 0.6) w.chest(ox + 3, y, oz + 1, 'dungeon', 3);
  for (const [dx, dz] of [[-4, 0], [4, 0], [0, -4], [0, 4]]) if (rng() < 0.5) { w.set(ox + dx, y, oz + dz, 0); w.set(ox + dx, y + 1, oz + dz, 0); }
}
export function buildMineshaft(w: Writer, T: Terrain, ox: number, oz: number, rng: Rng) {
  const baseY = 22 + Math.floor(rng() * 16);
  const segs: [number, number, number, number, number][] = []; // x,z,dirX,dirZ,len
  const queue: [number, number, number][] = [[ox, oz, 0]];
  w.box(ox - 3, baseY, oz - 3, ox + 3, baseY + 3, oz + 3, 0);
  w.box(ox - 3, baseY - 1, oz - 3, ox + 3, baseY - 1, oz + 3, B.oak_planks);
  let n = 0;
  while (queue.length && n < 14) {
    const [sx, sz, depth] = queue.shift()!;
    for (let d = 0; d < 4; d++) {
      if (rng() < 0.35 || depth > 3) continue;
      const [dx, dz] = [[1, 0], [-1, 0], [0, 1], [0, -1]][d];
      const len = 12 + Math.floor(rng() * 22);
      segs.push([sx, sz, dx, dz, len]);
      queue.push([sx + dx * len, sz + dz * len, depth + 1]);
      n++;
    }
  }
  for (const [sx, sz, dx, dz, len] of segs) {
    for (let i = 0; i <= len; i++) {
      const x = sx + dx * i, z = sz + dz * i;
      const px = dz !== 0 ? 1 : 0, pz = dx !== 0 ? 1 : 0;
      for (let s = -1; s <= 1; s++) for (let y = 0; y < 3; y++) w.set(x + px * s, baseY + y, z + pz * s, 0);
      for (let s = -1; s <= 1; s++) { const fl = w.get(x + px * s, baseY - 1, z + pz * s); if (fl === 0 || fl === B.water || fl === B.lava) w.set(x + px * s, baseY - 1, z + pz * s, B.oak_planks); }
      if (i % 4 === 0) {
        w.set(x - px, baseY, z - pz, B.wood_fence); w.set(x - px, baseY + 1, z - pz, B.wood_fence);
        w.set(x + px, baseY, z + pz, B.wood_fence); w.set(x + px, baseY + 1, z + pz, B.wood_fence);
        for (let s = -1; s <= 1; s++) w.set(x + px * s, baseY + 2, z + pz * s, B.oak_planks);
        if (rng() < 0.25 && w.get(x, baseY, z) === 0) w.set(x, baseY, z, B.torch, 0);
      } else if (rng() < 0.6) w.set(x, baseY, z, B.rail);
      if (rng() < 0.07) w.set(x + px * (rng() < 0.5 ? -1 : 1), baseY + 2, z + pz * (rng() < 0.5 ? -1 : 1), B.cobweb);
      if (rng() < 0.025) w.chest(x + px, baseY, z + pz, 'mineshaft');
      if (rng() < 0.01) { w.set(x - px, baseY, z - pz, B.mob_cage); w.feature('cage', x - px, baseY, z - pz, 'skitterfang'); }
    }
  }
}
export function buildCrater(w: Writer, T: Terrain, ox: number, oz: number, rng: Rng) {
  const h = T.sample(ox, oz).h;
  const R = 9;
  for (let dz = -R - 2; dz <= R + 2; dz++) for (let dx = -R - 2; dx <= R + 2; dx++) {
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d > R + 2) continue;
    const depth = d < R ? Math.round(Math.cos((d / R) * Math.PI / 2) * 6) : 0;
    const col = T.sample(ox + dx, oz + dz).h;
    for (let y = col; y > h - depth && y > 2; y--) w.set(ox + dx, y, oz + dz, 0);
    for (let y = col + 1; y < col + 6; y++) w.set(ox + dx, y, oz + dz, 0);
    const floor = Math.min(col, h - depth);
    if (d < R) w.set(ox + dx, floor, oz + dz, d < 3 ? B.obsidian : rng() < 0.3 ? B.magma_block : B.cobbled_darkstone);
    else if (d < R + 2 && rng() < 0.4) w.set(ox + dx, col, oz + dz, B.gravel);
  }
  const fy = h - 6;
  for (let i = 0; i < 9; i++) w.set(ox + Math.floor(rng() * 3) - 1, fy - Math.floor(rng() * 3), oz + Math.floor(rng() * 3) - 1, B.starmetal_ore);
  w.set(ox + 2, fy + 1, oz, B.void_bloom);
  w.chest(ox - 2, fy + 1, oz, 'starfall');
}

/* ---------------- Emberdeep ---------------- */
export function buildBastion(w: Writer, ox: number, oz: number, rng: Rng) {
  const y0 = 56;
  const BR = B.ember_bricks;
  // central keep
  w.box(ox - 12, y0 - 1, oz - 12, ox + 12, y0 - 1, oz + 12, BR);
  w.box(ox - 12, y0, oz - 12, ox + 12, y0 + 14, oz + 12, 0);
  for (let y = y0; y < y0 + 8; y++) for (let i = -12; i <= 12; i++) {
    for (const [x, z] of [[i, -12], [i, 12], [-12, i], [12, i]]) if (y < y0 + 6 || i % 3 === 0) w.set(ox + x, y, oz + z, BR);
  }
  // support pillars to the lava sea
  for (const [x, z] of [[-12, -12], [12, -12], [-12, 12], [12, 12], [0, -12], [0, 12], [-12, 0], [12, 0]]) for (let y = y0 - 2; y > 20; y--) w.set(ox + x, y, oz + z, BR);
  // gates
  for (const [x, z] of [[0, -12], [0, 12], [-12, 0], [12, 0]]) for (let y = y0; y < y0 + 4; y++) for (let s = -1; s <= 1; s++) w.set(ox + x + (z ? s : 0), y, oz + z + (x ? s : 0), 0);
  // throne dais
  w.box(ox - 4, y0, oz - 4, ox + 4, y0, oz + 4, B.obsidian);
  w.box(ox - 2, y0 + 1, oz + 3, ox + 2, y0 + 3, oz + 3, B.basalt);
  w.feature('boss', ox, y0 + 1, oz, 'colossus');
  for (const [x, z] of [[-9, -9], [9, -9], [-9, 9], [9, 9]]) { w.set(ox + x, y0, oz + z, B.mob_cage); w.feature('cage', ox + x, y0, oz + z, 'cinder_imp'); }
  w.chest(ox - 10, y0, oz + 10, 'bastion', 2); w.chest(ox + 10, y0, oz - 10, 'bastion', 0);
  if (rng() < 0.6) w.chest(ox + 10, y0, oz + 10, 'bastion', 2);
  for (const [x, z] of [[-6, -11], [6, -11], [-6, 11], [6, 11]]) w.set(ox + x, y0 + 3, oz + z, B.lantern);
  // bridges
  for (let d = 0; d < 4; d++) {
    const [dx, dz] = [[1, 0], [-1, 0], [0, 1], [0, -1]][d];
    for (let i = 13; i < 44; i++) {
      for (let s = -1; s <= 1; s++) {
        const x = ox + dx * i + (dz ? s : 0), z = oz + dz * i + (dx ? s : 0);
        w.set(x, y0 - 1, z, BR);
        for (let y = y0; y < y0 + 4; y++) w.set(x, y, z, 0);
      }
      const ex = ox + dx * i + (dz ? 2 : 0), ez = oz + dz * i + (dx ? 2 : 0);
      const fx = ox + dx * i - (dz ? 2 : 0), fz = oz + dz * i - (dx ? 2 : 0);
      w.set(ex, y0, ez, BR); w.set(fx, y0, fz, BR);
      if (i % 8 === 0) for (let y = y0 - 2; y > 24; y--) w.set(ox + dx * i, y, oz + dz * i, BR);
    }
  }
}

/* ---------------- placement grid ---------------- */
export interface StructType {
  key: string; spacing: number; chance: number; radius: number;
  ok: (T: Terrain, x: number, z: number) => boolean;
  build: (w: Writer, T: Terrain, x: number, z: number, rng: Rng) => void;
}
const landBiome = (allowed: Bi[]) => (T: Terrain, x: number, z: number) => {
  const c = T.sample(x, z);
  return c.h >= SEA_LEVEL && allowed.includes(c.biome);
};
export const OVERWORLD_STRUCTS: StructType[] = [
  { key: 'village', spacing: 336, chance: 0.75, radius: 48, ok: landBiome([Bi.Plains, Bi.Savanna, Bi.Desert, Bi.Meadow, Bi.SnowyForest, Bi.Tundra]), build: buildVillage },
  { key: 'ruin', spacing: 176, chance: 0.35, radius: 8, ok: landBiome([Bi.Plains, Bi.Forest, Bi.BirchForest, Bi.Meadow, Bi.Swamp, Bi.Savanna, Bi.Tundra]), build: buildRuin },
  { key: 'tower', spacing: 288, chance: 0.4, radius: 7, ok: landBiome([Bi.Plains, Bi.Forest, Bi.Mountains, Bi.Meadow, Bi.SnowyForest, Bi.Badlands]), build: buildTower },
  { key: 'shipwreck', spacing: 224, chance: 0.5, radius: 14, ok: (T, x, z) => { const c = T.sample(x, z); return c.h < SEA_LEVEL - 4 && (c.biome === Bi.Ocean || c.biome === Bi.DeepOcean); }, build: buildShipwreck },
  { key: 'cache', spacing: 160, chance: 0.4, radius: 1, ok: landBiome([Bi.Beach]), build: buildCache },
  { key: 'temple', spacing: 400, chance: 0.55, radius: 10, ok: landBiome([Bi.Desert]), build: buildTemple },
  { key: 'shrine', spacing: 352, chance: 0.6, radius: 10, ok: landBiome([Bi.Jungle]), build: buildShrine },
  { key: 'dungeon', spacing: 64, chance: 0.4, radius: 5, ok: (T, x, z) => T.sample(x, z).h > 34, build: buildDungeon },
  { key: 'mineshaft', spacing: 208, chance: 0.45, radius: 72, ok: (T, x, z) => T.sample(x, z).h > 50, build: buildMineshaft },
  { key: 'crater', spacing: 704, chance: 0.4, radius: 12, ok: landBiome([Bi.Plains, Bi.Desert, Bi.Tundra, Bi.Savanna, Bi.Badlands, Bi.Meadow]), build: buildCrater },
];

const UNDERGROUND = new Set(['dungeon', 'mineshaft', 'cache']);
/** builds the parts of nearby structures inside this chunk; returns surface footprints near the chunk so trees can avoid them */
export function placeStructures(w: Writer, T: Terrain, list: StructType[], seed: number): [number, number, number][] {
  const x0 = w.cx * CHUNK, z0 = w.cz * CHUNK;
  const near: [number, number, number][] = [];
  const M = 6; // tree margin
  for (let si = 0; si < list.length; si++) {
    const st = list[si];
    const R = st.radius + M;
    const c0x = Math.floor((x0 - R) / st.spacing), c1x = Math.floor((x0 + 15 + R) / st.spacing);
    const c0z = Math.floor((z0 - R) / st.spacing), c1z = Math.floor((z0 + 15 + R) / st.spacing);
    for (let gx = c0x; gx <= c1x; gx++) for (let gz = c0z; gz <= c1z; gz++) {
      const hsh = hash32(seed, gx, gz, si * 7919 + 13);
      if ((hsh & 0xffff) / 65536 > st.chance) continue;
      const margin = Math.min(st.radius, st.spacing / 4);
      const px = gx * st.spacing + margin + Math.floor(((hsh >>> 16) / 65536) * (st.spacing - 2 * margin));
      const pz = gz * st.spacing + margin + Math.floor((hash32(hsh, 3) / 4294967296) * (st.spacing - 2 * margin));
      if (px + R < x0 || px - R > x0 + 15 || pz + R < z0 || pz - R > z0 + 15) continue;
      if (!st.ok(T, px, pz)) continue;
      if (!UNDERGROUND.has(st.key)) near.push([px, pz, st.radius + 2]);
      if (px + st.radius < x0 || px - st.radius > x0 + 15 || pz + st.radius < z0 || pz - st.radius > z0 + 15) continue;
      st.build(w, T, px, pz, mulberry(hsh));
    }
  }
  return near;
}
/** returns nearest structure origin of a type (used by Wayfolk cartographers) */
export function nearestStructure(T: Terrain, key: string, x: number, z: number, seed: number, maxCells = 6): [number, number] | null {
  const si = OVERWORLD_STRUCTS.findIndex((s) => s.key === key);
  if (si < 0) return null;
  const st = OVERWORLD_STRUCTS[si];
  let best: [number, number] | null = null, bd = Infinity;
  const gx0 = Math.floor(x / st.spacing), gz0 = Math.floor(z / st.spacing);
  for (let gx = gx0 - maxCells; gx <= gx0 + maxCells; gx++) for (let gz = gz0 - maxCells; gz <= gz0 + maxCells; gz++) {
    const hsh = hash32(seed, gx, gz, si * 7919 + 13);
    if ((hsh & 0xffff) / 65536 > st.chance) continue;
    const margin = Math.min(st.radius, st.spacing / 4);
    const px = gx * st.spacing + margin + Math.floor(((hsh >>> 16) / 65536) * (st.spacing - 2 * margin));
    const pz = gz * st.spacing + margin + Math.floor((hash32(hsh, 3) / 4294967296) * (st.spacing - 2 * margin));
    const d = (px - x) ** 2 + (pz - z) ** 2;
    if (d < bd && st.ok(T, px, pz)) { bd = d; best = [px, pz]; }
  }
  return best;
}
