import { CHUNK, HEIGHT, SEA_LEVEL, CHUNK_AREA, Dim } from '../../constants';
import { B } from '../../registry/blocks';
import { Simplex, hash32, hashf, mulberry, smoothstep, type Rng } from '../noise';
import { Terrain, Bi, BIOMES, type Column } from './terrain';
import { Writer, growTree, giantMushroom, type GenFeature } from './writer';
import { placeStructures, OVERWORLD_STRUCTS, buildBastion } from './structures';

export interface GenResult { blocks: Uint8Array; meta: Uint8Array; features: GenFeature[]; biomes: Uint8Array }

interface Ctx { seed: number; T: Terrain; cave1: Simplex; cave2: Simplex; cave3: Simplex; lakeN: Simplex; misc: Simplex; ember: Simplex; ember2: Simplex; hollow: Simplex }
let ctx: Ctx | null = null;
function getCtx(seed: number): Ctx {
  if (ctx && ctx.seed === seed) return ctx;
  ctx = {
    seed, T: new Terrain(seed),
    cave1: new Simplex(seed ^ 0xa1), cave2: new Simplex(seed ^ 0xa2), cave3: new Simplex(seed ^ 0xa3),
    lakeN: new Simplex(seed ^ 0xa4), misc: new Simplex(seed ^ 0xa5),
    ember: new Simplex(seed ^ 0xb1), ember2: new Simplex(seed ^ 0xb2), hollow: new Simplex(seed ^ 0xc1),
  };
  return ctx;
}

export function generateChunk(seed: number, dim: Dim, cx: number, cz: number): GenResult {
  const c = getCtx(seed);
  const w = new Writer(cx, cz);
  const biomes = new Uint8Array(CHUNK_AREA);
  if (dim === Dim.Overworld) overworld(c, w, biomes);
  else if (dim === Dim.Ember) ember(c, w, biomes);
  else hollow(c, w, biomes);
  return { blocks: w.blocks, meta: w.meta, features: w.features, biomes };
}

/* =========================================================== Overworld */
/** lake in chunk (cx,cz): [centreX, centreZ, radius, lava] or null; independent of every other generation step */
function lakeAt(seed: number, cx: number, cz: number): [number, number, number, boolean] | null {
  const r = mulberry(hash32(seed, cx, cz, 0x1a4e));
  if (r() >= 0.06) return null;
  return [cx * CHUNK + 4 + Math.floor(r() * 8), cz * CHUNK + 4 + Math.floor(r() * 8), 3 + Math.floor(r() * 2), r() < 0.15];
}
/** true when a cave tunnel breaks through the ground surface at this column (same rule as the carver) */
function surfaceCave(c: Ctx, wx: number, h: number, wz: number): boolean {
  if (c.misc.n2(wx / 90, wz / 90) <= 0.25) return false;
  for (const y of [h, h - 1]) {
    const a = c.cave1.n3(wx / 42, y / 26, wz / 42), b = c.cave2.n3(wx / 42 + 50, y / 26, wz / 42 - 50);
    if (Math.abs(a) < 0.075 && Math.abs(b) < 0.075) return true;
  }
  return false;
}
function vein(w: Writer, rng: Rng, ore: number, size: number, x: number, y: number, z: number, hosts: number[]) {
  let px = x, py = y, pz = z;
  for (let i = 0; i < size; i++) {
    const cur = w.get(px, py, pz);
    if (hosts.includes(cur)) w.set(px, py, pz, ore);
    px += Math.floor(rng() * 3) - 1; py += Math.floor(rng() * 3) - 1; pz += Math.floor(rng() * 3) - 1;
  }
}

function overworld(c: Ctx, w: Writer, biomes: Uint8Array) {
  const { T, seed } = c;
  const x0 = w.x0, z0 = w.z0;
  const cols: Column[] = [];
  for (let z = 0; z < CHUNK; z++) for (let x = 0; x < CHUNK; x++) {
    const col = T.sample(x0 + x, z0 + z);
    cols.push(col);
    biomes[x + z * CHUNK] = col.biome;
  }
  const rng = mulberry(hash32(seed, w.cx, w.cz, 1));
  // --- base terrain + surface
  for (let z = 0; z < CHUNK; z++) for (let x = 0; x < CHUNK; x++) {
    const col = cols[x + z * CHUNK];
    const wx = x0 + x, wz = z0 + z;
    const { h, biome } = col;
    const bedrockTop = 1 + Math.floor(hashf(wx, wz, seed) * 3);
    const dirtDepth = 3 + Math.floor(hashf(wx, wz, seed + 1) * 2);
    for (let y = 0; y <= Math.max(h, SEA_LEVEL); y++) {
      let id: number;
      if (y <= bedrockTop) id = y === 0 || hashf(wx, y, wz) < 0.5 ? B.bedrock : B.darkstone;
      else if (y < 22 + Math.floor(hashf(wx, wz, 7) * 4)) id = B.darkstone;
      else if (y < h - dirtDepth) id = B.stone;
      else if (y <= h) {
        const top = y === h;
        if (h < SEA_LEVEL - 1) id = biome === Bi.DeepOcean ? B.gravel : (biome === Bi.River && hashf(wx, wz, 3) < 0.15) ? B.clay : B.sand;
        else switch (biome) {
          case Bi.Beach: id = y > h - 4 ? B.sand : B.sandstone; break;
          case Bi.Desert: id = y > h - 4 ? B.sand : B.sandstone; break;
          case Bi.Badlands: {
            if (top) id = B.red_sand;
            else { const band = (y + Math.floor(c.misc.n2(wx / 40, wz / 40) * 3)) % 7; id = [B.terracotta, B.terracotta_orange, B.terracotta, B.terracotta_red, B.terracotta_yellow, B.terracotta_white, B.terracotta_orange][band]; }
            break;
          }
          case Bi.Mountains: id = h > 102 ? (top ? B.snow_block : B.stone) : h > 92 ? B.stone : top ? B.grass : B.dirt; break;
          case Bi.Mushroom: id = top ? B.sporeturf : B.dirt; break;
          case Bi.River: id = B.sand; break;
          case Bi.Swamp: id = top ? (hashf(wx, wz, 9) < 0.2 ? B.mud : B.grass) : B.dirt; break;
          default: id = top ? B.grass : B.dirt;
        }
      } else id = y <= SEA_LEVEL ? B.water : 0; // water fill
      w.blocks[x + z * CHUNK + y * CHUNK_AREA] = id;
    }
    // badlands extra mesas
    if (biome === Bi.Badlands) {
      const mesa = c.misc.n2(wx / 50, wz / 50);
      if (mesa > 0.35) {
        const top = h + Math.floor((mesa - 0.35) * 40);
        for (let y = h + 1; y <= Math.min(top, HEIGHT - 4); y++) w.blocks[x + z * CHUNK + y * CHUNK_AREA] = [B.terracotta, B.terracotta_orange, B.terracotta_red, B.terracotta_white, B.terracotta_yellow][(y >> 1) % 5];
        w.blocks[x + z * CHUNK + h * CHUNK_AREA] = B.terracotta_orange;
      }
    }
    // frozen surfaces
    if (BIOMES[biome].snow) {
      if (h < SEA_LEVEL) w.blocks[x + z * CHUNK + SEA_LEVEL * CHUNK_AREA] = hashf(wx, wz, 11) < 0.85 ? B.ice : B.packed_ice;
      else w.blocks[x + z * CHUNK + (h + 1) * CHUNK_AREA] = B.snow_layer;
    }
    // sky islands: rare, large, lens-shaped (a dome on top, a long tapering underside)
    if (biome === Bi.Mountains || biome === Bi.Meadow || biome === Bi.Plains || biome === Bi.Forest) {
      const region = c.misc.n2(wx / 900 + 90, wz / 900 - 40);
      if (region > 0.52) {
        const f = c.misc.n2(wx / 85 + 500, wz / 85) + c.misc.n2(wx / 23 - 70, wz / 23) * 0.18 - (1 - region) * 0.25;
        if (f > 0.3) {
          const t = f - 0.3;
          const base = 100 + Math.floor(c.misc.n2(wx / 300, wz / 300 + 20) * 8);
          const top = Math.min(HEIGHT - 6, base + Math.floor(Math.sqrt(t) * 7));
          const bottom = top - Math.floor(t * 70 + 2);
          if (top > h + 12) for (let y = bottom; y <= top; y++) w.blocks[x + z * CHUNK + y * CHUNK_AREA] = y === top ? B.grass : y > top - 3 ? B.dirt : B.stone;
        }
      }
    }
  }
  // --- swamp puddles
  // --- caves (spaghetti tunnels + cheese caverns), aquifers
  for (let z = 0; z < CHUNK; z++) for (let x = 0; x < CHUNK; x++) {
    const col = cols[x + z * CHUNK];
    const wx = x0 + x, wz = z0 + z;
    const wet = col.h < SEA_LEVEL + 2;
    const maxY = wet ? col.h - 6 : col.h + 1;
    for (let y = 5; y <= maxY; y++) {
      const i = x + z * CHUNK + y * CHUNK_AREA;
      const id = w.blocks[i];
      if (id === 0 || id === B.water || id === B.bedrock) continue;
      const nearSurface = y > col.h - 5;
      const a = c.cave1.n3(wx / 42, y / 26, wz / 42), b = c.cave2.n3(wx / 42 + 50, y / 26, wz / 42 - 50);
      let air = Math.abs(a) < 0.075 && Math.abs(b) < 0.075;
      if (nearSurface && air) air = c.misc.n2(wx / 90, wz / 90) > 0.25; // only some tunnels breach the surface
      if (!air && y < 56 && !nearSurface) {
        const cav = c.cave3.n3(wx / 80, y / 34, wz / 80) - (y < 20 ? 0 : (y - 20) / 120);
        air = cav > 0.52;
      }
      if (!air) continue;
      if (y <= 10) w.blocks[i] = B.lava;
      else if (y < 30 && c.lakeN.n3(wx / 60, y / 30, wz / 60) > 0.45) w.blocks[i] = B.water;
      else w.blocks[i] = 0;
      // grass above an opened cave becomes dirt so it doesn't float oddly
      if (y === col.h && id === B.grass) w.blocks[i] = 0;
    }
  }
  // --- ores
  const S = B.stone, D = B.darkstone;
  const ores: [number, number, number, number, number, number[]][] = [
    // ore, perChunk, size, minY, maxY, hosts
    [B.coal_ore, 18, 10, 8, 120, [S]],
    [B.copper_ore, 9, 7, 20, 90, [S]],
    [B.iron_ore, 12, 6, 5, 72, [S, D]],
    [B.gold_ore, 2.5, 5, 5, 34, [S, D]],
    [B.pulsite_ore, 5, 6, 5, 18, [S, D]],
    [B.azurite_ore, 2, 5, 6, 36, [S, D]],
    [B.diamond_ore, 1.2, 4, 5, 16, [S, D]],
    [B.starmetal_ore, 0.12, 2, 3, 10, [D]],
    [B.gravel, 6, 18, 5, 100, [S]],
    [B.clay, 1, 8, 40, 64, [B.dirt, B.sand]],
  ];
  for (const [ore, per, size, y0, y1, hosts] of ores) {
    let n = Math.floor(per) + (rng() < per % 1 ? 1 : 0);
    while (n--) vein(w, rng, ore, size, x0 + Math.floor(rng() * 16), y0 + Math.floor(rng() * (y1 - y0)), z0 + Math.floor(rng() * 16), hosts);
  }
  const midBiome = cols[8 + 8 * CHUNK].biome;
  if (midBiome === Bi.Mountains) for (let i = 0; i < 4; i++) { const x = x0 + Math.floor(rng() * 16), z = z0 + Math.floor(rng() * 16), y = 30 + Math.floor(rng() * 60); if (w.get(x, y, z) === S) w.set(x, y, z, B.verdite_ore); }
  if (midBiome === Bi.Badlands) for (let i = 0; i < 6; i++) vein(w, rng, B.gold_ore, 5, x0 + Math.floor(rng() * 16), 32 + Math.floor(rng() * 40), z0 + Math.floor(rng() * 16), [S, B.terracotta, B.terracotta_orange]);
  // --- lakes (contained within chunk)
  const lake = lakeAt(seed, w.cx, w.cz);
  if (lake) {
    const [lx, lz, r] = lake;
    const col = cols[(lx - x0) + (lz - z0) * CHUNK];
    const lava = lake[3] && col.biome !== Bi.Swamp;
    if (col.h > SEA_LEVEL + 1 && col.biome !== Bi.Desert || lava) {
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        const d = dx * dx + dz * dz;
        if (d > r * r) continue;
        const ch = cols[(lx + dx - x0) + (lz + dz - z0) * CHUNK]?.h;
        if (ch === undefined || Math.abs(ch - col.h) > 2) continue;
        const depth = d < (r - 1) * (r - 1) ? 2 : 1;
        for (let y = col.h; y > col.h - depth; y--) w.set(lx + dx, y, lz + dz, lava ? B.lava : B.water);
        for (let y = col.h + 1; y < col.h + 4; y++) w.set(lx + dx, y, lz + dz, 0);
        if (lava) w.set(lx + dx, col.h - depth, lz + dz, rng() < 0.5 ? B.obsidian : B.stone);
      }
    }
  }
  // underground lava pools
  if (rng() < 0.2) {
    const lx = x0 + 4 + Math.floor(rng() * 8), lz = z0 + 4 + Math.floor(rng() * 8), ly = 12 + Math.floor(rng() * 25);
    for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) if (dx * dx + dz * dz <= 9) {
      w.set(lx + dx, ly, lz + dz, B.lava); w.set(lx + dx, ly + 1, lz + dz, 0); w.set(lx + dx, ly + 2, lz + dz, 0);
    }
  }
  // --- structures (before vegetation so trees don't grow inside houses)
  const footprints = placeStructures(w, T, OVERWORLD_STRUCTS, seed);
  // --- trees. Every chunk that a canopy touches must make the same decision, so the choice uses only
  // deterministic inputs (terrain, cave noise, lakes, structure footprints), never this chunk's blocks.
  const TM = 6;
  for (let z = -TM; z < CHUNK + TM; z++) for (let x = -TM; x < CHUNK + TM; x++) {
    const wx = x0 + x, wz = z0 + z;
    const inChunk = x >= 0 && x < CHUNK && z >= 0 && z < CHUNK;
    const col = inChunk ? cols[x + z * CHUNK] : T.sample(wx, wz);
    const bd = BIOMES[col.biome];
    const r = hashf(wx, wz, seed + 77);
    if (col.h < SEA_LEVEL || col.river) continue;
    const isMush = col.biome === Bi.Mushroom && r < 0.004;
    if (!isMush && r >= bd.treeChance) continue;
    if (col.biome === Bi.Mountains && col.h > 96) continue; // bare rock and snow
    if (footprints.some(([sx, sz, sr]) => Math.abs(wx - sx) <= sr + 3 && Math.abs(wz - sz) <= sr + 3)) continue;
    if (surfaceCave(c, wx, col.h, wz)) continue;
    const lk = lakeAt(seed, Math.floor(wx / CHUNK), Math.floor(wz / CHUNK));
    if (lk && (wx - lk[0]) ** 2 + (wz - lk[1]) ** 2 <= (lk[2] + 2) ** 2) continue;
    if (isMush) { giantMushroom(w, wx, col.h + 1, wz, mulberry(hash32(wx, wz, seed, 5))); continue; }
    let tw = bd.trees.reduce((a, t) => a + t[1], 0) * hashf(wx, wz, seed + 78), sp = bd.trees[0][0];
    for (const [k, wt] of bd.trees) { if ((tw -= wt) < 0) { sp = k; break; } }
    growTree(w, sp, wx, col.h + 1, wz, mulberry(hash32(wx, wz, seed, 9)));
    if (inChunk) w.set(wx, col.h, wz, B.dirt);
  }
  // --- ground cover
  for (let z = 0; z < CHUNK; z++) for (let x = 0; x < CHUNK; x++) {
    const col = cols[x + z * CHUNK];
    const wx = x0 + x, wz = z0 + z, y = col.h;
    const top = w.get(wx, y, wz), above = w.get(wx, y + 1, wz);
    if (above !== 0) {
      if (above === B.water && top === B.sand && col.biome === Bi.Swamp && hashf(wx, wz, 21) < 0.08 && w.get(wx, y + 2, wz) === 0) w.set(wx, y + 2, wz, B.lily_pad);
      if (above === B.water && y === SEA_LEVEL - 1 && col.biome === Bi.Swamp && hashf(wx, wz, 22) < 0.1) w.set(wx, SEA_LEVEL + 1, wz, B.lily_pad);
      continue;
    }
    const bd = BIOMES[col.biome];
    const r = hashf(wx, wz, seed + 31);
    if (top === B.grass) {
      if (r < bd.flowerChance && bd.flowers.length) w.set(wx, y + 1, wz, B[bd.flowers[Math.floor(hashf(wx, wz, 5) * bd.flowers.length)]]);
      else if (r < bd.flowerChance + bd.grass) w.set(wx, y + 1, wz, col.biome === Bi.Jungle || col.biome === Bi.SnowyForest ? (hashf(wx, wz, 6) < 0.4 ? B.fern : B.tall_grass) : B.tall_grass);
      else if (r < bd.flowerChance + bd.grass + 0.002 && (col.biome === Bi.Plains || col.biome === Bi.Savanna)) w.set(wx, y + 1, wz, hashf(wx, wz, 8) < 0.7 ? B.pumpkin : B.melon);
      else if (r < bd.flowerChance + bd.grass + 0.004 && (col.biome === Bi.Forest || col.biome === Bi.SnowyForest)) w.set(wx, y + 1, wz, B.berry_bush, 3);
      // reeds by water
      if (y === SEA_LEVEL && hashf(wx, wz, 13) < 0.12) {
        const nearWater = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => w.get(wx + dx, y, wz + dz) === B.water);
        if (nearWater) { const hh = 1 + Math.floor(hashf(wx, wz, 14) * 3); for (let i = 1; i <= hh; i++) w.set(wx, y + i, wz, B.reeds); }
      }
    } else if (top === B.sand || top === B.red_sand) {
      if ((col.biome === Bi.Desert || col.biome === Bi.Badlands) && r < 0.006) {
        const hh = 1 + Math.floor(hashf(wx, wz, 15) * 3);
        const free = [[1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dz]) => { const v = w.get(wx + dx, y + 1, wz + dz); return v === 0 || v === -1; });
        if (free) for (let i = 1; i <= hh; i++) w.set(wx, y + i, wz, B.cactus);
      } else if ((col.biome === Bi.Desert || col.biome === Bi.Badlands) && r < 0.016) w.set(wx, y + 1, wz, B.dead_bush);
      else if (y === SEA_LEVEL && col.biome === Bi.Beach && hashf(wx, wz, 13) < 0.05) w.set(wx, y + 1, wz, B.reeds);
    } else if (top === B.sporeturf && r < 0.04) w.set(wx, y + 1, wz, r < 0.02 ? B.mushroom_red : B.mushroom_brown);
  }
  // mushrooms + cobwebs in caves (sparse)
  for (let i = 0; i < 6; i++) {
    const x = x0 + Math.floor(rng() * 16), z = z0 + Math.floor(rng() * 16), y = 12 + Math.floor(rng() * 40);
    if (w.get(x, y, z) === 0 && (w.get(x, y - 1, z) === B.stone || w.get(x, y - 1, z) === B.darkstone)) w.set(x, y, z, rng() < 0.5 ? B.mushroom_brown : B.mushroom_red);
  }
}

/* =========================================================== Emberdeep */
const LAVA_SEA = 32;
function ember(c: Ctx, w: Writer, biomes: Uint8Array) {
  const x0 = w.x0, z0 = w.z0;
  const rng = mulberry(hash32(c.seed, w.cx, w.cz, 2));
  biomes.fill(255);
  for (let z = 0; z < CHUNK; z++) for (let x = 0; x < CHUNK; x++) {
    const wx = x0 + x, wz = z0 + z;
    const region = c.ember2.n2(wx / 140, wz / 140); // >0.3 basalt deltas, <-0.3 ash wastes
    for (let y = 0; y < HEIGHT; y++) {
      let id = 0;
      if (y === 0 || y === HEIGHT - 1) id = B.bedrock;
      else if (y < 4 || y > HEIGHT - 5) id = hashf(wx, y, wz) < 0.5 ? B.bedrock : B.emberstone;
      else {
        const n = c.ember.n3(wx / 64, y / 38, wz / 64) + c.ember.n3(wx / 22, y / 16, wz / 22) * 0.35;
        const grad = (y < 50 ? (50 - y) / 30 : 0) + (y > 96 ? (y - 96) / 22 : 0);
        const dens = n + grad - 0.18;
        if (dens > 0) id = region > 0.3 ? (dens < 0.12 ? B.basalt : B.emberstone) : B.emberstone;
        else if (y <= LAVA_SEA) id = B.lava;
      }
      w.blocks[x + z * CHUNK + y * CHUNK_AREA] = id;
    }
    // surface dressing
    for (let y = HEIGHT - 6; y > 4; y--) {
      const i = x + z * CHUNK + y * CHUNK_AREA;
      const id = w.blocks[i], above = w.blocks[i + CHUNK_AREA];
      if (id === B.emberstone && above === 0) {
        if (region < -0.3) w.blocks[i] = B.ashsand;
        else if (y <= LAVA_SEA + 2 && hashf(wx, y, wz) < 0.3) w.blocks[i] = B.magma_block;
        const r = hashf(wx, y, wz, 4);
        if (r < 0.03) w.blocks[i + CHUNK_AREA] = w.blocks[i] === B.ashsand ? B.ashroot : B.ember_fungus;
      }
      const below = w.blocks[i - CHUNK_AREA];
      if (id === 0 && (above === B.emberstone || above === B.basalt) && hashf(wx, y, wz, 6) < 0.01 && y > 70) {
        for (let k = 0; k < 1 + Math.floor(hashf(wx, wz, 7) * 4); k++) w.blocks[i - k * CHUNK_AREA] === 0 && (w.blocks[i - k * CHUNK_AREA] = B.lumen_block);
      }
      void below;
    }
  }
  const S = [B.emberstone, B.basalt];
  for (let i = 0; i < 14; i++) vein(w, rng, B.flarequartz_ore, 8, x0 + Math.floor(rng() * 16), 10 + Math.floor(rng() * 110), z0 + Math.floor(rng() * 16), S);
  for (let i = 0; i < 3; i++) vein(w, rng, B.gold_ore, 6, x0 + Math.floor(rng() * 16), 10 + Math.floor(rng() * 110), z0 + Math.floor(rng() * 16), S);
  if (rng() < 0.5) vein(w, rng, B.cinderite_ore, 2, x0 + Math.floor(rng() * 16), 8 + Math.floor(rng() * 16), z0 + Math.floor(rng() * 16), S);
  // bastions
  const spacing = 176, radius = 46;
  const c0x = Math.floor((x0 - radius) / spacing), c1x = Math.floor((x0 + 15 + radius) / spacing);
  const c0z = Math.floor((z0 - radius) / spacing), c1z = Math.floor((z0 + 15 + radius) / spacing);
  for (let gx = c0x; gx <= c1x; gx++) for (let gz = c0z; gz <= c1z; gz++) {
    const h = hash32(c.seed, gx, gz, 999);
    if ((h & 0xffff) / 65536 > 0.8) continue;
    const px = gx * spacing + 50 + ((h >>> 16) % (spacing - 100)), pz = gz * spacing + 50 + (hash32(h, 1) % (spacing - 100));
    if (Math.abs(px - x0 - 8) > radius + 8 || Math.abs(pz - z0 - 8) > radius + 8) continue;
    buildBastion(w, px, pz, mulberry(h));
  }
}
export function emberBastionNear(seed: number, x: number, z: number): [number, number] | null {
  const spacing = 176;
  let best: [number, number] | null = null, bd = Infinity;
  const gx0 = Math.floor(x / spacing), gz0 = Math.floor(z / spacing);
  for (let gx = gx0 - 4; gx <= gx0 + 4; gx++) for (let gz = gz0 - 4; gz <= gz0 + 4; gz++) {
    const h = hash32(seed, gx, gz, 999);
    if ((h & 0xffff) / 65536 > 0.8) continue;
    const px = gx * spacing + 50 + ((h >>> 16) % (spacing - 100)), pz = gz * spacing + 50 + (hash32(h, 1) % (spacing - 100));
    const d = (px - x) ** 2 + (pz - z) ** 2;
    if (d < bd) { bd = d; best = [px, pz]; }
  }
  return best;
}

/* =========================================================== The Hollow */
export const HOLLOW_ARENA_Y = 64;
function hollow(c: Ctx, w: Writer, biomes: Uint8Array) {
  const x0 = w.x0, z0 = w.z0;
  biomes.fill(254);
  const rng = mulberry(hash32(c.seed, w.cx, w.cz, 3));
  for (let z = 0; z < CHUNK; z++) for (let x = 0; x < CHUNK; x++) {
    const wx = x0 + x, wz = z0 + z;
    const d = Math.sqrt(wx * wx + wz * wz);
    // main island
    if (d < 64) {
      const edge = smoothstep(64, 40, d);
      const depth = Math.floor(4 + edge * 26 + c.hollow.n2(wx / 20, wz / 20) * 4);
      const top = HOLLOW_ARENA_Y + Math.floor(c.hollow.n2(wx / 40, wz / 40) * 2 * edge);
      for (let y = top - depth; y <= top; y++) if (y > 0) w.blocks[x + z * CHUNK + y * CHUNK_AREA] = B.pale_stone;
      if (d > 20 && hashf(wx, wz, 3) < 0.02) w.blocks[x + z * CHUNK + (top + 1) * CHUNK_AREA] = B.void_bloom;
      continue;
    }
    // outer islands
    if (d > 110) {
      const n = c.hollow.n2(wx / 70, wz / 70) + c.hollow.n2(wx / 18, wz / 18) * 0.3;
      if (n > 0.35) {
        const t = (n - 0.35) * 2;
        const top = 58 + Math.floor(c.hollow.n2(wx / 50 + 9, wz / 50) * 14);
        const depth = Math.floor(3 + t * 30);
        for (let y = top - depth; y <= top; y++) if (y > 0) w.blocks[x + z * CHUNK + y * CHUNK_AREA] = B.pale_stone;
        if (hashf(wx, wz, 4) < 0.025) w.blocks[x + z * CHUNK + (top + 1) * CHUNK_AREA] = B.void_bloom;
        if (hashf(wx, wz, 8) < 0.002) for (let y = top - depth + 1; y < top - 2; y++) if (hashf(wx, y, wz) < 0.15) w.blocks[x + z * CHUNK + y * CHUNK_AREA] = B.starmetal_ore;
      }
    }
  }
  // ward pylons around the arena
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    const px = Math.round(Math.cos(a) * 30), pz = Math.round(Math.sin(a) * 30);
    for (let y = HOLLOW_ARENA_Y + 1; y < HOLLOW_ARENA_Y + 22; y++) w.box(px - 1, y, pz - 1, px + 1, y, pz + 1, B.pale_bricks);
    w.set(px, HOLLOW_ARENA_Y + 22, pz, B.ward_pylon);
    for (let y = HOLLOW_ARENA_Y + 1; y < HOLLOW_ARENA_Y + 22; y++) if (w.inside(px + 2, y, pz)) w.set(px + 2, y, pz, B.ladder, 3);
  }
  // arrival platform
  w.box(-3, HOLLOW_ARENA_Y, 44, 3, HOLLOW_ARENA_Y, 50, B.pale_bricks);
  w.feature('boss', 0, HOLLOW_ARENA_Y + 12, 0, 'sovereign');
  // hollow spires on outer islands
  const sp = 112;
  for (let gx = Math.floor((x0 - 8) / sp); gx <= Math.floor((x0 + 24) / sp); gx++) for (let gz = Math.floor((z0 - 8) / sp); gz <= Math.floor((z0 + 24) / sp); gz++) {
    const h = hash32(c.seed, gx, gz, 4242);
    if ((h & 0xffff) / 65536 > 0.55) continue;
    const px = gx * sp + 20 + ((h >>> 16) % (sp - 40)), pz = gz * sp + 20 + (hash32(h, 2) % (sp - 40));
    if (Math.sqrt(px * px + pz * pz) < 140) continue;
    if (Math.abs(px - x0 - 8) > 14 || Math.abs(pz - z0 - 8) > 14) continue;
    const n = c.hollow.n2(px / 70, pz / 70) + c.hollow.n2(px / 18, pz / 18) * 0.3;
    if (n <= 0.4) continue;
    const top = 58 + Math.floor(c.hollow.n2(px / 50 + 9, pz / 50) * 14);
    const r2 = mulberry(h);
    const height = 18 + Math.floor(r2() * 12);
    for (let y = top + 1; y < top + height; y++) w.hollow(px - 2, y, pz - 2, px + 2, y, pz + 2, B.pale_bricks, 0);
    for (let y = top + 1; y <= top + height; y++) w.set(px, y, pz - 1, B.ladder, 0);
    w.set(px, top + 1, pz - 2, 0); w.set(px, top + 2, pz - 2, 0);
    w.box(px - 3, top + height, pz - 3, px + 3, top + height, pz + 3, B.pale_bricks);
    w.chest(px + 1, top + height + 1, pz + 1, 'spire');
    w.set(px - 1, top + height + 1, pz - 1, B.lantern);
    w.feature('cage', px, top + Math.floor(height / 2), pz + 1, 'voidstalker');
    w.set(px, top + Math.floor(height / 2), pz + 1, B.mob_cage);
    void rng;
  }
}
