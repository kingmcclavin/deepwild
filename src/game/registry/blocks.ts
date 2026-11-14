// Data-driven block registry. Pure data + pure functions so it can be imported by workers.
import { FACING_VEC } from '../constants';

export type ToolKind = 'pickaxe' | 'axe' | 'shovel' | 'hoe' | 'sword' | 'shears';
export type Sound = 'stone' | 'wood' | 'grass' | 'sand' | 'gravel' | 'glass' | 'wool' | 'metal' | 'snow' | 'liquid';
export type Shape = 'cube' | 'cross' | 'liquid' | 'model' | 'none';
export type Layer = 0 | 1 | 2; // 0 opaque, 1 alpha-cutout, 2 translucent
/** box: x0,y0,z0,x1,y1,z1 in 1/16 units, optional tile override for all faces */
export type Box = [number, number, number, number, number, number, string?];
export type NeighborFn = (dx: number, dy: number, dz: number) => number; // returns block id

export interface Drop { item: string; min?: number; max?: number; chance?: number; fortune?: boolean }

export interface BlockDef {
  id: number;
  key: string;
  name: string;
  /** tile names: [top, bottom, side, front?] */
  tiles: [string, string, string, string?];
  hardness: number; // -1 = unbreakable
  tool?: ToolKind;
  tier: number; // min tool tier for drops (-1 = hand ok)
  drops?: Drop[] | 'self' | 'none';
  shape: Shape;
  layer: Layer;
  opaque: boolean; // blocks light and culls neighbours
  solid: boolean; // has collision
  light: number;
  filter: number; // extra light attenuation
  replaceable: boolean;
  sound: Sound;
  gravity: boolean;
  climbable: boolean;
  flammable: boolean;
  model?: (meta: number, n: NeighborFn) => Box[];
  collide?: (meta: number, n: NeighborFn) => Box[];
  orient?: 'facing' | 'axis' | 'wall' | 'slab' | 'door' | 'stairs';
  container?: 'chest' | 'furnace' | 'smoker' | 'blast' | 'dispenser' | 'hopper' | 'brewing';
  ui?: 'crafting' | 'enchant' | 'anvil';
  needs?: 'soil' | 'farmland' | 'sand' | 'solid' | 'water' | 'wall' | 'ember' | 'mycel';
  pulse?: 'wire' | 'lever' | 'button' | 'plate' | 'torch' | 'repeater' | 'comparator' | 'block' | 'consumer';
  emitsWhenMeta?: number; // light when (meta & 8)
  plant?: boolean;
  slow?: number; // movement multiplier
  damage?: number; // contact damage per second
  item: boolean;
  xp?: [number, number];
  color?: string; // used for particles/map
}

const defs: BlockDef[] = [];
const byKey = new Map<string, BlockDef>();

type Opt = Partial<Omit<BlockDef, 'id' | 'key' | 'name' | 'tiles'>> & { tiles?: BlockDef['tiles'] | string };
function add(key: string, name: string, tiles: string | BlockDef['tiles'], o: Opt = {}): BlockDef {
  const t: BlockDef['tiles'] = typeof tiles === 'string' ? [tiles, tiles, tiles] : tiles;
  const shape = o.shape ?? 'cube';
  const d: BlockDef = {
    id: defs.length, key, name, tiles: t,
    hardness: 1, tier: -1, shape, layer: 0,
    opaque: shape === 'cube', solid: shape === 'cube' || shape === 'model',
    light: 0, filter: 0, replaceable: false, sound: 'stone', gravity: false, climbable: false, flammable: false,
    item: true,
    ...o,
  } as BlockDef;
  if (d.layer !== 0 && o.opaque === undefined) d.opaque = false;
  defs.push(d);
  byKey.set(key, d);
  return d;
}

/* ---------------- shape helpers ---------------- */
const full: Box = [0, 0, 0, 16, 16, 16];
const slabBox = (meta: number): Box[] => (meta & 1 ? [[0, 8, 0, 16, 16, 16]] : [[0, 0, 0, 16, 8, 16]]);
function stairBoxes(meta: number): Box[] {
  const f = meta & 3, top = (meta & 4) !== 0;
  const base: Box = top ? [0, 8, 0, 16, 16, 16] : [0, 0, 0, 16, 8, 16];
  const y0 = top ? 0 : 8, y1 = top ? 8 : 16;
  const step: Box[] = [
    [[0, y0, 0, 16, y1, 8]], [[8, y0, 0, 16, y1, 16]], [[0, y0, 8, 16, y1, 16]], [[0, y0, 0, 8, y1, 16]],
  ][f] as Box[];
  return [base, ...step];
}
const isFenceLike = (id: number) => { const d = defs[id]; return !!d && (d.opaque || d.key.includes('fence') || d.key.endsWith('_gate')); };
const isPaneLike = (id: number) => { const d = defs[id]; return !!d && (d.opaque || d.key === 'glass_pane' || d.key === 'iron_bars'); };
function fenceBoxes(_m: number, n: NeighborFn, tall: boolean): Box[] {
  const h = tall ? 24 : 16;
  const b: Box[] = [[6, 0, 6, 10, h > 16 ? 16 : 16, 10]];
  if (isFenceLike(n(0, 0, -1))) b.push([7, 6, 0, 9, 15, 6]);
  if (isFenceLike(n(0, 0, 1))) b.push([7, 6, 10, 9, 15, 16]);
  if (isFenceLike(n(-1, 0, 0))) b.push([0, 6, 7, 6, 15, 9]);
  if (isFenceLike(n(1, 0, 0))) b.push([10, 6, 7, 16, 15, 9]);
  return b;
}
function fenceCollide(_m: number, n: NeighborFn): Box[] {
  const b: Box[] = [[6, 0, 6, 10, 24, 10]];
  if (isFenceLike(n(0, 0, -1))) b.push([6, 0, 0, 10, 24, 6]);
  if (isFenceLike(n(0, 0, 1))) b.push([6, 0, 10, 10, 24, 16]);
  if (isFenceLike(n(-1, 0, 0))) b.push([0, 0, 6, 6, 24, 10]);
  if (isFenceLike(n(1, 0, 0))) b.push([10, 0, 6, 16, 24, 10]);
  return b;
}
function paneBoxes(_m: number, n: NeighborFn): Box[] {
  const b: Box[] = [[7, 0, 7, 9, 16, 9]];
  const nz = isPaneLike(n(0, 0, -1)), pz = isPaneLike(n(0, 0, 1)), nx = isPaneLike(n(-1, 0, 0)), px = isPaneLike(n(1, 0, 0));
  if (nz) b.push([7, 0, 0, 9, 16, 7]);
  if (pz) b.push([7, 0, 9, 9, 16, 16]);
  if (nx) b.push([0, 0, 7, 7, 16, 9]);
  if (px) b.push([9, 0, 7, 16, 16, 9]);
  if (!nz && !pz && !nx && !px) b.push([0, 0, 7, 16, 16, 9]);
  return b;
}
// door meta: bits0-1 facing, bit2 open, bit3 upper half, bit4 hinge? (unused)
function doorBoxes(meta: number): Box[] {
  let f = meta & 3;
  if (meta & 4) f = (f + 1) & 3;
  return [[[0, 0, 13, 16, 16, 16], [0, 0, 0, 3, 16, 16], [0, 0, 0, 16, 16, 3], [13, 0, 0, 16, 16, 16]][f] as Box];
}
function trapdoorBoxes(meta: number): Box[] {
  if (meta & 4) return [[[0, 0, 13, 16, 16, 16], [0, 0, 0, 3, 16, 16], [0, 0, 0, 16, 16, 3], [13, 0, 0, 16, 16, 16]][meta & 3] as Box];
  return meta & 8 ? [[0, 13, 0, 16, 16, 16]] : [[0, 0, 0, 16, 3, 16]];
}
function gateBoxes(meta: number): Box[] {
  const ns = (meta & 1) === 0; // facing north/south -> gate spans X
  if (meta & 4) return ns ? [[0, 5, 7, 2, 16, 9], [14, 5, 7, 16, 16, 9]] : [[7, 5, 0, 9, 16, 2], [7, 5, 14, 9, 16, 16]];
  return ns ? [[0, 5, 7, 16, 15, 9]] : [[7, 5, 0, 9, 15, 16]];
}
// wall-attached thin things. meta&7: 0 floor,1..4 facing walls (n,e,s,w), 5 ceiling
// wall-attached: meta&3 = facing direction pointing TOWARD the supporting wall (0 north -Z, 1 east +X, 2 south +Z, 3 west -X)
function wallFlat(meta: number, depth: number): Box[] {
  const f = meta & 3;
  return [[[0, 0, 0, 16, 16, depth], [16 - depth, 0, 0, 16, 16, 16], [0, 0, 16 - depth, 16, 16, 16], [0, 0, 0, depth, 16, 16]][f] as Box];
}
function torchBoxes(meta: number): Box[] {
  const m = meta & 7;
  if (m === 0) return [[7, 0, 7, 9, 10, 9]];
  const [fx, fz] = FACING_VEC[(m - 1) & 3];
  const cx = 8 + fx * 5.5, cz = 8 + fz * 5.5;
  return [[cx - 1, 3, cz - 1, cx + 1, 13, cz + 1]];
}
function leverBoxes(meta: number): Box[] {
  const on = (meta & 8) !== 0;
  const base: Box = [5, 0, 4, 11, 3, 12, 'cobblestone'];
  const lever: Box = on ? [7, 2, 4, 9, 10, 7] : [7, 2, 9, 9, 10, 12];
  return [base, lever];
}
function buttonBoxes(meta: number): Box[] {
  const d = meta & 8 ? 1 : 2;
  const m = meta & 7;
  if (m === 0) return [[5, 0, 6, 11, d, 10]];
  return [[[5, 6, 0, 11, 10, d], [16 - d, 6, 5, 16, 10, 11], [5, 6, 16 - d, 11, 10, 16], [0, 6, 5, d, 10, 11]][(m - 1) & 3] as Box];
}
function wireBoxes(): Box[] { return [[0, 0, 0, 16, 1, 16]]; }
function repeaterBoxes(meta: number): Box[] {
  const f = meta & 3;
  const [fx, fz] = FACING_VEC[f];
  const lit = meta & 8 ? 'pulse_torch_on' : 'pulse_torch_off';
  return [[0, 0, 0, 16, 2, 16], [7 + fx * 4, 2, 7 + fz * 4, 9 + fx * 4, 7, 9 + fz * 4, lit], [7 - fx * 4, 2, 7 - fz * 4, 9 - fx * 4, 6, 9 - fz * 4, lit]];
}
function pistonHeadBoxes(meta: number): Box[] {
  const d = meta & 7;
  const plate: Box[] = [
    [[0, 0, 0, 4, 16, 16]], [[12, 0, 0, 16, 16, 16]], [[0, 0, 0, 16, 4, 16]], [[0, 12, 0, 16, 16, 16]], [[0, 0, 0, 16, 16, 4]], [[0, 0, 12, 16, 16, 16]],
  ][d] as Box[];
  const rod: Box = [
    [4, 6, 6, 16, 10, 10], [0, 6, 6, 12, 10, 10], [6, 4, 6, 10, 16, 10], [6, 0, 6, 10, 12, 10], [6, 6, 4, 10, 10, 16], [6, 6, 0, 10, 10, 12],
  ][d] as Box;
  return [...plate, [rod[0], rod[1], rod[2], rod[3], rod[4], rod[5], 'piston_side']];
}
function pistonBaseBoxes(meta: number): Box[] {
  if (!(meta & 8)) return [full];
  const d = meta & 7;
  return [[[4, 0, 0, 16, 16, 16], [0, 0, 0, 12, 16, 16], [0, 4, 0, 16, 16, 16], [0, 0, 0, 16, 12, 16], [0, 0, 4, 16, 16, 16], [0, 0, 0, 16, 16, 12]][d] as Box];
}

/* ---------------- registry ---------------- */
const NONE = { drops: 'none' as const };
const pick = (h: number, tier = 0, o: Opt = {}): Opt => ({ hardness: h, tool: 'pickaxe', tier, ...o });
const axe = (h: number, o: Opt = {}): Opt => ({ hardness: h, tool: 'axe', sound: 'wood', flammable: true, ...o });
const shovel = (h: number, o: Opt = {}): Opt => ({ hardness: h, tool: 'shovel', ...o });
const plant = (o: Opt = {}): Opt => ({ shape: 'cross', layer: 1, solid: false, hardness: 0, sound: 'grass', replaceable: false, plant: true, needs: 'soil', flammable: true, ...o });

export const AIR = add('air', 'Air', 'none', { shape: 'none', solid: false, opaque: false, replaceable: true, hardness: 0, item: false, ...NONE }).id;

// --- natural
add('grass', 'Turf', ['grass_top', 'dirt', 'grass_side'], shovel(0.6, { sound: 'grass', drops: [{ item: 'dirt' }], color: '#5f9a4a' }));
add('dirt', 'Dirt', 'dirt', shovel(0.5, { sound: 'gravel', color: '#7a573d' }));
add('stone', 'Stone', 'stone', pick(1.5, 0, { drops: [{ item: 'cobblestone' }], color: '#7d7f86' }));
add('cobblestone', 'Cobblestone', 'cobblestone', pick(2, 0));
add('bedrock', 'Bedrock', 'bedrock', { hardness: -1, ...NONE });
add('sand', 'Sand', 'sand', shovel(0.5, { sound: 'sand', gravity: true, color: '#dccb95' }));
add('red_sand', 'Rust Sand', 'red_sand', shovel(0.5, { sound: 'sand', gravity: true, color: '#b8642f' }));
add('sandstone', 'Sandstone', ['sandstone_top', 'sandstone_top', 'sandstone'], pick(0.8));
add('gravel', 'Gravel', 'gravel', shovel(0.6, { sound: 'gravel', gravity: true, drops: [{ item: 'flint', chance: 0.12 }, { item: 'gravel', chance: 0.88 }] }));
add('clay', 'Clay', 'clay', shovel(0.6, { sound: 'gravel', drops: [{ item: 'clay_ball', min: 4, max: 4 }] }));
add('mud', 'Mud', 'mud', shovel(0.5, { sound: 'gravel', slow: 0.7 }));
add('snow_block', 'Snow Block', 'snow', shovel(0.2, { sound: 'snow', drops: [{ item: 'snowball', min: 4, max: 4 }] }));
add('snow_layer', 'Snow Cover', 'snow', shovel(0.1, { shape: 'model', layer: 0, opaque: false, solid: false, sound: 'snow', replaceable: true, model: () => [[0, 0, 0, 16, 2, 16]], drops: [{ item: 'snowball' }], needs: 'solid' }));
add('ice', 'Ice', 'ice', pick(0.5, -1, { layer: 2, opaque: false, sound: 'glass', drops: 'none', filter: 1, slow: 1.0 }));
add('packed_ice', 'Packed Ice', 'packed_ice', pick(0.5, -1, { sound: 'glass' }));
export const WATER = add('water', 'Water', 'water', { shape: 'liquid', layer: 2, solid: false, opaque: false, replaceable: true, hardness: -1, filter: 2, sound: 'liquid', item: false, ...NONE }).id;
export const LAVA = add('lava', 'Lava', 'lava', { shape: 'liquid', layer: 0, solid: false, opaque: false, replaceable: true, hardness: -1, light: 15, sound: 'liquid', item: false, damage: 4, ...NONE }).id;
add('obsidian', 'Obsidian', 'obsidian', pick(25, 4));
add('mossy_cobblestone', 'Mossy Cobblestone', 'mossy_cobblestone', pick(2));
add('darkstone', 'Darkstone', 'darkstone', pick(3, 0, { drops: [{ item: 'cobbled_darkstone' }] }));
add('cobbled_darkstone', 'Cobbled Darkstone', 'cobbled_darkstone', pick(3.5));
add('terracotta', 'Terracotta', 'terracotta', pick(1.25));
add('terracotta_orange', 'Orange Terracotta', 'terracotta_orange', pick(1.25));
add('terracotta_red', 'Red Terracotta', 'terracotta_red', pick(1.25));
add('terracotta_yellow', 'Yellow Terracotta', 'terracotta_yellow', pick(1.25));
add('terracotta_white', 'White Terracotta', 'terracotta_white', pick(1.25));
add('sporeturf', 'Sporeturf', ['sporeturf_top', 'dirt', 'sporeturf_side'], shovel(0.6, { sound: 'grass', drops: [{ item: 'dirt' }] }));
add('farmland', 'Farmland', ['farmland', 'dirt', 'dirt'], shovel(0.6, { shape: 'model', opaque: false, layer: 0, sound: 'gravel', model: () => [[0, 0, 0, 16, 15, 16]], drops: [{ item: 'dirt' }] }));
add('path', 'Trodden Path', ['path_top', 'dirt', 'path_side'], shovel(0.6, { shape: 'model', opaque: false, layer: 0, sound: 'gravel', model: () => [[0, 0, 0, 16, 15, 16]], drops: [{ item: 'dirt' }] }));

// --- wood (6 species)
export const WOODS = ['oak', 'pine', 'birch', 'teak', 'thorn', 'willow'] as const;
export type Wood = typeof WOODS[number];
const WOOD_NAMES: Record<Wood, string> = { oak: 'Oak', pine: 'Pine', birch: 'Birch', teak: 'Teak', thorn: 'Thornwood', willow: 'Willow' };
for (const w of WOODS) {
  const N = WOOD_NAMES[w];
  add(`${w}_log`, `${N} Log`, [`log_top_${w}`, `log_top_${w}`, `log_${w}`], axe(2, { orient: 'axis' }));
  add(`${w}_stripped`, `Stripped ${N} Log`, [`stripped_top_${w}`, `stripped_top_${w}`, `stripped_${w}`], axe(2, { orient: 'axis' }));
  add(`${w}_planks`, `${N} Planks`, `planks_${w}`, axe(2));
  add(`${w}_leaves`, `${N} Leaves`, `leaves_${w}`, {
    hardness: 0.2, tool: 'shears', layer: 1, opaque: false, sound: 'grass', filter: 1, flammable: true,
    drops: [{ item: `${w}_sapling`, chance: 0.06 }, { item: 'stick', chance: 0.03 }, ...(w === 'oak' ? [{ item: 'apple', chance: 0.02 }] : [])],
  });
  add(`${w}_sapling`, `${N} Sapling`, `sapling_${w}`, plant());
}
// shared wooden building pieces (plank-coloured oak style + generic)
add('wood_stairs', 'Wooden Stairs', 'planks_oak', axe(2, { shape: 'model', opaque: false, orient: 'stairs', model: stairBoxes }));
add('wood_slab', 'Wooden Slab', 'planks_oak', axe(2, { shape: 'model', opaque: false, orient: 'slab', model: slabBox }));
add('wood_fence', 'Wooden Fence', 'planks_oak', axe(2, { shape: 'model', opaque: false, model: (m, n) => fenceBoxes(m, n, false), collide: fenceCollide }));
add('wood_fence_gate', 'Fence Gate', 'planks_oak', axe(2, { shape: 'model', opaque: false, orient: 'facing', model: gateBoxes, collide: (m) => (m & 4 ? [] : gateBoxes(m).map((b) => [b[0], 0, b[2], b[3], 24, b[5]] as Box)) }));
add('wood_door', 'Wooden Door', ['door_wood', 'door_wood', 'door_wood'], axe(3, { shape: 'model', layer: 1, opaque: false, orient: 'door', model: doorBoxes, pulse: 'consumer', drops: [{ item: 'wood_door' }] }));
add('wood_trapdoor', 'Wooden Trapdoor', 'trapdoor_wood', axe(3, { shape: 'model', layer: 1, opaque: false, orient: 'facing', model: trapdoorBoxes, pulse: 'consumer', climbable: false }));
add('wood_sign', 'Sign', 'planks_oak', axe(1, { shape: 'model', opaque: false, solid: false, orient: 'facing', model: (m) => [[[2, 4, 0, 14, 12, 2], [14, 4, 2, 16, 12, 14], [2, 4, 14, 14, 12, 16], [0, 4, 2, 2, 12, 14]][m & 3] as Box] }));
add('ladder', 'Ladder', 'ladder', axe(0.4, { shape: 'model', layer: 1, opaque: false, orient: 'wall', climbable: true, model: (m) => wallFlat(m, 1), collide: (m) => wallFlat(m, 2), needs: 'wall' }));

// --- stone building
add('stone_bricks', 'Stone Bricks', 'stone_bricks', pick(1.5));
add('mossy_stone_bricks', 'Mossy Stone Bricks', 'mossy_stone_bricks', pick(1.5));
add('cracked_stone_bricks', 'Cracked Stone Bricks', 'cracked_stone_bricks', pick(1.5));
add('smooth_stone', 'Smooth Stone', 'smooth_stone', pick(2));
add('bricks', 'Bricks', 'bricks', pick(2));
add('stone_stairs', 'Cobblestone Stairs', 'cobblestone', pick(2, 0, { shape: 'model', opaque: false, orient: 'stairs', model: stairBoxes }));
add('stone_slab', 'Stone Slab', 'smooth_stone', pick(2, 0, { shape: 'model', opaque: false, orient: 'slab', model: slabBox }));
add('brick_stairs', 'Brick Stairs', 'bricks', pick(2, 0, { shape: 'model', opaque: false, orient: 'stairs', model: stairBoxes }));
add('brick_slab', 'Brick Slab', 'bricks', pick(2, 0, { shape: 'model', opaque: false, orient: 'slab', model: slabBox }));
add('stone_brick_stairs', 'Stone Brick Stairs', 'stone_bricks', pick(1.5, 0, { shape: 'model', opaque: false, orient: 'stairs', model: stairBoxes }));
add('cobble_wall', 'Cobblestone Wall', 'cobblestone', pick(2, 0, { shape: 'model', opaque: false, model: (m, n) => fenceBoxes(m, n, true).map((b, i) => (i === 0 ? [4, 0, 4, 12, 16, 12] : [b[0] === 7 ? 5 : b[0], 0, b[2] === 7 ? 5 : b[2], b[3] === 9 ? 11 : b[3], 13, b[5] === 9 ? 11 : b[5]]) as Box), collide: fenceCollide }));
add('glass', 'Glass', 'glass', { hardness: 0.3, layer: 1, opaque: false, sound: 'glass', drops: 'none' });
add('glass_pane', 'Glass Pane', 'glass', { hardness: 0.3, shape: 'model', layer: 1, opaque: false, sound: 'glass', drops: 'none', model: paneBoxes });
add('iron_bars', 'Iron Bars', 'iron_bars', pick(5, 0, { shape: 'model', layer: 1, opaque: false, sound: 'metal', model: paneBoxes }));
export const DYE_COLORS = ['white', 'black', 'red', 'orange', 'yellow', 'green', 'blue', 'purple'] as const;
for (const c of DYE_COLORS) add(`wool_${c}`, `${c[0].toUpperCase() + c.slice(1)} Fleece`, `wool_${c}`, { hardness: 0.8, tool: 'shears', sound: 'wool', flammable: true });
for (const c of DYE_COLORS) add(`concrete_${c}`, `${c[0].toUpperCase() + c.slice(1)} Concrete`, `concrete_${c}`, pick(1.8));
add('bookshelf', 'Bookshelf', ['planks_oak', 'planks_oak', 'bookshelf'], axe(1.5, { drops: [{ item: 'book', min: 3, max: 3 }] }));
add('hay_bale', 'Hay Bale', ['hay_top', 'hay_top', 'hay_side'], { hardness: 0.5, tool: 'hoe', sound: 'grass', flammable: true, orient: 'axis' });
add('torch', 'Torch', 'torch', { hardness: 0, shape: 'model', layer: 1, opaque: false, solid: false, light: 14, sound: 'wood', orient: 'wall', model: torchBoxes, needs: 'wall' });
add('lantern', 'Lantern', 'lantern', pick(3.5, -1, { shape: 'model', layer: 1, opaque: false, light: 15, sound: 'metal', model: () => [[5, 0, 5, 11, 7, 11], [6, 7, 6, 10, 9, 10]] }));
add('lumen_block', 'Lumen Block', 'lumen', { hardness: 0.3, light: 15, sound: 'glass', drops: [{ item: 'lumen_dust', min: 2, max: 4, fortune: true }] });
add('bed', 'Bed', ['bed_top', 'planks_oak', 'bed_side'], { hardness: 0.2, shape: 'model', opaque: false, sound: 'wool', orient: 'facing', model: () => [[0, 3, 0, 16, 9, 16], [0, 0, 0, 3, 3, 3, 'planks_oak'], [13, 0, 13, 16, 3, 16, 'planks_oak']] });

// --- ores & minerals
add('coal_ore', 'Coal Ore', 'coal_ore', pick(3, 0, { drops: [{ item: 'coal', fortune: true }], xp: [0, 2] }));
add('copper_ore', 'Copper Ore', 'copper_ore', pick(3, 1, { drops: [{ item: 'raw_copper', min: 2, max: 4, fortune: true }] }));
add('iron_ore', 'Iron Ore', 'iron_ore', pick(3, 1, { drops: [{ item: 'raw_iron', fortune: true }] }));
add('gold_ore', 'Gold Ore', 'gold_ore', pick(3, 3, { drops: [{ item: 'raw_gold', fortune: true }] }));
add('pulsite_ore', 'Pulsite Ore', 'pulsite_ore', pick(3, 3, { drops: [{ item: 'pulsite', min: 4, max: 5, fortune: true }], xp: [1, 5], light: 3 }));
add('azurite_ore', 'Azurite Ore', 'azurite_ore', pick(3, 1, { drops: [{ item: 'azurite', min: 4, max: 8, fortune: true }], xp: [2, 5] }));
add('diamond_ore', 'Diamond Ore', 'diamond_ore', pick(3, 3, { drops: [{ item: 'diamond', fortune: true }], xp: [3, 7] }));
add('verdite_ore', 'Verdite Ore', 'verdite_ore', pick(3, 3, { drops: [{ item: 'verdite', fortune: true }], xp: [3, 7] }));
add('starmetal_ore', 'Starmetal Ore', 'starmetal_ore', pick(10, 4, { drops: [{ item: 'starmetal_shard' }], xp: [6, 10] }));
add('coal_block', 'Block of Coal', 'coal_block', pick(5, 0, { flammable: true }));
add('copper_block', 'Block of Copper', 'copper_block', pick(5, 1, { sound: 'metal' }));
add('iron_block', 'Block of Iron', 'iron_block', pick(5, 1, { sound: 'metal' }));
add('gold_block', 'Block of Gold', 'gold_block', pick(3, 3, { sound: 'metal' }));
add('diamond_block', 'Block of Diamond', 'diamond_block', pick(5, 3, { sound: 'metal' }));
add('azurite_block', 'Block of Azurite', 'azurite_block', pick(3, 1));
add('verdite_block', 'Block of Verdite', 'verdite_block', pick(5, 3, { sound: 'metal' }));
add('pulsite_block', 'Block of Pulsite', 'pulsite_block', pick(5, 0, { pulse: 'block', sound: 'metal' }));

// --- functional
add('crafting_table', 'Workbench', ['workbench_top', 'planks_oak', 'workbench_side', 'workbench_front'], axe(2.5, { ui: 'crafting' }));
add('furnace', 'Furnace', ['furnace_top', 'furnace_top', 'furnace_side', 'furnace_front'], pick(3.5, 0, { orient: 'facing', container: 'furnace', emitsWhenMeta: 13 }));
add('smoker', 'Smokehouse', ['smoker_top', 'furnace_top', 'smoker_side', 'smoker_front'], pick(3.5, 0, { orient: 'facing', container: 'smoker', emitsWhenMeta: 13 }));
add('blast_furnace', 'Blast Furnace', ['blast_top', 'blast_top', 'blast_side', 'blast_front'], pick(3.5, 0, { orient: 'facing', container: 'blast', emitsWhenMeta: 13 }));
add('chest', 'Chest', ['chest_top', 'chest_top', 'chest_side', 'chest_front'], axe(2.5, { shape: 'model', opaque: false, orient: 'facing', container: 'chest', model: () => [[1, 0, 1, 15, 14, 15]] }));
add('anvil', 'Anvil', 'anvil', pick(5, 0, { shape: 'model', opaque: false, orient: 'facing', ui: 'anvil', sound: 'metal', model: (m) => (m & 1 ? [[2, 0, 2, 14, 4, 14], [4, 4, 6, 12, 10, 10], [0, 10, 3, 16, 16, 13]] : [[2, 0, 2, 14, 4, 14], [6, 4, 4, 10, 10, 12], [3, 10, 0, 13, 16, 16]]) }));
add('enchanting_table', 'Runic Altar', ['altar_top', 'obsidian', 'altar_side'], pick(5, 0, { shape: 'model', opaque: false, ui: 'enchant', light: 7, model: () => [[0, 0, 0, 16, 12, 16]] }));
add('brewing_stand', 'Brewing Stand', ['brew_top', 'cobblestone', 'brew_side'], pick(0.5, 0, { shape: 'model', layer: 1, opaque: false, container: 'brewing', light: 1, model: () => [[7, 0, 7, 9, 14, 9], [1, 0, 1, 15, 2, 15, 'cobblestone']] }));
add('dispenser', 'Dispenser', ['furnace_top', 'furnace_top', 'furnace_side', 'dispenser_front'], pick(3.5, 0, { orient: 'facing', container: 'dispenser', pulse: 'consumer' }));
add('hopper', 'Hopper', ['hopper_top', 'hopper_side', 'hopper_side'], pick(3, 0, { shape: 'model', opaque: false, sound: 'metal', container: 'hopper', pulse: 'consumer', model: () => [[0, 10, 0, 16, 16, 16], [4, 4, 4, 12, 10, 12], [6, 0, 6, 10, 4, 10]] }));
add('lever', 'Lever', 'cobblestone', { hardness: 0.5, shape: 'model', layer: 1, opaque: false, solid: false, pulse: 'lever', model: leverBoxes, needs: 'solid' });
add('stone_button', 'Stone Button', 'stone', pick(0.5, -1, { shape: 'model', opaque: false, solid: false, pulse: 'button', orient: 'wall', model: buttonBoxes, needs: 'wall' }));
add('wood_button', 'Wooden Button', 'planks_oak', axe(0.5, { shape: 'model', opaque: false, solid: false, pulse: 'button', orient: 'wall', model: buttonBoxes, needs: 'wall' }));
add('pressure_plate', 'Pressure Plate', 'smooth_stone', pick(0.5, -1, { shape: 'model', opaque: false, solid: false, pulse: 'plate', model: (m) => [[1, 0, 1, 15, m & 8 ? 0.5 : 1, 15]], needs: 'solid' }));
add('pulse_wire', 'Pulse Wire', 'pulse_wire', { hardness: 0, shape: 'model', layer: 1, opaque: false, solid: false, pulse: 'wire', model: wireBoxes, drops: [{ item: 'pulsite' }], needs: 'solid', item: false });
add('pulse_torch', 'Pulse Torch', ['pulse_torch_on', 'pulse_torch_on', 'pulse_torch_on'], { hardness: 0, shape: 'model', layer: 1, opaque: false, solid: false, pulse: 'torch', light: 7, orient: 'wall', model: torchBoxes, needs: 'wall' });
add('repeater', 'Pulse Repeater', ['repeater_top', 'smooth_stone', 'smooth_stone'], { hardness: 0, shape: 'model', opaque: false, solid: true, pulse: 'repeater', orient: 'facing', model: repeaterBoxes, needs: 'solid' });
add('comparator', 'Pulse Comparator', ['comparator_top', 'smooth_stone', 'smooth_stone'], { hardness: 0, shape: 'model', opaque: false, solid: true, pulse: 'comparator', orient: 'facing', model: repeaterBoxes, needs: 'solid' });
add('pulse_lamp', 'Pulse Lamp', 'lamp_off', { hardness: 0.3, sound: 'glass', pulse: 'consumer', emitsWhenMeta: 15 });
add('piston', 'Piston', ['piston_top', 'piston_bottom', 'piston_side'], pick(1.5, -1, { shape: 'model', opaque: false, orient: 'facing', pulse: 'consumer', model: pistonBaseBoxes }));
add('sticky_piston', 'Sticky Piston', ['piston_top_sticky', 'piston_bottom', 'piston_side'], pick(1.5, -1, { shape: 'model', opaque: false, orient: 'facing', pulse: 'consumer', model: pistonBaseBoxes }));
add('piston_head', 'Piston Head', 'piston_top', pick(1.5, -1, { shape: 'model', opaque: false, model: pistonHeadBoxes, drops: 'none', item: false }));
add('powder_keg', 'Powder Keg', ['keg_top', 'keg_top', 'keg_side'], { hardness: 0, sound: 'grass', pulse: 'consumer', flammable: true });
add('iron_door', 'Iron Door', 'door_iron', pick(5, 0, { shape: 'model', layer: 1, opaque: false, orient: 'door', model: doorBoxes, pulse: 'consumer', sound: 'metal', drops: [{ item: 'iron_door' }] }));
add('fire', 'Fire', 'fire', { hardness: 0, shape: 'cross', layer: 1, solid: false, light: 15, damage: 1, replaceable: true, item: false, drops: 'none' });
add('mob_cage', 'Creature Cage', 'mob_cage', pick(5, 0, { layer: 1, opaque: false, drops: 'none', xp: [15, 40], sound: 'metal' }));
add('rail', 'Rail', 'rail', pick(0.7, -1, { shape: 'model', layer: 1, opaque: false, solid: false, model: () => [[0, 0, 0, 16, 1, 16]], needs: 'solid', sound: 'metal' }));

// --- plants & crops
add('tall_grass', 'Tall Grass', 'tall_grass', plant({ replaceable: true, drops: [{ item: 'wheat_seeds', chance: 0.125 }] }));
add('fern', 'Fern', 'fern', plant({ replaceable: true, drops: [{ item: 'wheat_seeds', chance: 0.08 }] }));
add('dead_bush', 'Dry Shrub', 'dead_bush', plant({ replaceable: true, needs: 'sand', drops: [{ item: 'stick', min: 0, max: 2 }] }));
export const FLOWERS = [['flower_red', 'Ember Poppy'], ['flower_yellow', 'Sunbell'], ['flower_blue', 'Skyblossom'], ['flower_purple', 'Duskthistle'], ['flower_orange', 'Fox Lily'], ['flower_white', 'Snowcap Daisy']] as const;
for (const [k, n] of FLOWERS) add(k, n, k, plant());
add('mushroom_red', 'Red Toadstool', 'mushroom_red', plant({ needs: 'solid', light: 0 }));
add('mushroom_brown', 'Brown Mushroom', 'mushroom_brown', plant({ needs: 'solid', light: 1 }));
add('mushroom_cap_red', 'Red Cap Block', 'mushroom_cap_red', axe(0.2, { drops: [{ item: 'mushroom_red', min: 0, max: 2 }] }));
add('mushroom_cap_brown', 'Brown Cap Block', 'mushroom_cap_brown', axe(0.2, { drops: [{ item: 'mushroom_brown', min: 0, max: 2 }] }));
add('mushroom_stem', 'Mushroom Stem', 'mushroom_stem', axe(0.2, { drops: 'none' }));
add('cactus', 'Cactus', ['cactus_top', 'cactus_top', 'cactus_side'], { hardness: 0.4, shape: 'model', layer: 1, opaque: false, sound: 'wool', damage: 1, needs: 'sand', model: () => [[1, 0, 1, 15, 16, 15]], collide: () => [[1, 0, 1, 15, 15, 15]] });
add('reeds', 'Riverreed', 'reeds', plant({ needs: 'water', drops: [{ item: 'reeds' }] }));
add('vine', 'Vines', 'vine', { hardness: 0.2, tool: 'shears', shape: 'model', layer: 1, opaque: false, solid: false, climbable: true, sound: 'grass', orient: 'wall', model: (m) => wallFlat(m, 0.5), replaceable: true, flammable: true, drops: 'none' });
add('lily_pad', 'Lily Pad', 'lily_pad', { hardness: 0, shape: 'model', layer: 1, opaque: false, solid: true, sound: 'grass', model: () => [[0, 0, 0, 16, 0.25, 16]], needs: 'water' });
add('cobweb', 'Cobweb', 'cobweb', { hardness: 4, tool: 'sword', shape: 'cross', layer: 1, solid: false, slow: 0.25, drops: [{ item: 'string' }] });
add('pumpkin', 'Pumpkin', ['pumpkin_top', 'pumpkin_top', 'pumpkin_side'], axe(1, { sound: 'wood' }));
add('melon', 'Melon', ['melon_top', 'melon_top', 'melon_side'], axe(1, { sound: 'wood', drops: [{ item: 'melon_slice', min: 3, max: 7, fortune: true }] }));
const crop = (key: string, name: string, item: string, seed: string, stages: number) =>
  add(key, name, `${key}_0`, plant({ needs: 'farmland', item: false, model: undefined, drops: [{ item: seed }] , tiles: [`${key}_${stages - 1}`, `${key}_${stages - 1}`, `${key}_${stages - 1}`], xp: undefined, color: item }));
crop('wheat_crop', 'Wheat', 'wheat', 'wheat_seeds', 8);
crop('carrot_crop', 'Carrots', 'carrot', 'carrot', 4);
crop('potato_crop', 'Potatoes', 'potato', 'potato', 4);
crop('beet_crop', 'Beetroots', 'beetroot', 'beetroot_seeds', 4);
add('berry_bush', 'Sunberry Bush', 'berry_bush_1', plant({ drops: [{ item: 'sunberries', min: 1, max: 2 }] }));

// --- Emberdeep (volcanic realm)
add('emberstone', 'Emberstone', 'emberstone', pick(0.4, 0, { color: '#6d2a26' }));
add('ashsand', 'Ash Sand', 'ashsand', shovel(0.5, { sound: 'sand', slow: 0.55 }));
add('basalt', 'Basalt', ['basalt_top', 'basalt_top', 'basalt_side'], pick(1.25, 0, { orient: 'axis' }));
add('magma_block', 'Magma Rock', 'magma', pick(0.5, 0, { light: 3, damage: 1 }));
add('cinderite_ore', 'Cinderite Ore', 'cinderite_ore', pick(30, 4, { drops: 'self', light: 4 }));
add('flarequartz_ore', 'Flarequartz Ore', 'flarequartz_ore', pick(3, 0, { drops: [{ item: 'flarequartz', fortune: true }], xp: [2, 5] }));
add('ember_bricks', 'Ember Bricks', 'ember_bricks', pick(2));
add('ashroot', 'Ashroot', 'ashroot', plant({ needs: 'ember', drops: [{ item: 'ashroot', min: 1, max: 3 }] }));
add('ember_fungus', 'Ember Fungus', 'ember_fungus', plant({ needs: 'ember', light: 6 }));

// --- The Hollow (endgame)
add('pale_stone', 'Pale Stone', 'pale_stone', pick(3, 0, { color: '#d9d5b7' }));
add('pale_bricks', 'Pale Bricks', 'pale_bricks', pick(3));
add('ward_pylon', 'Ward Pylon', ['pylon_top', 'pylon_top', 'pylon_side'], pick(4, 0, { light: 12, drops: 'none' }));
add('void_bloom', 'Void Bloom', 'void_bloom', plant({ needs: 'solid', light: 9, drops: [{ item: 'void_bloom' }] }));

// --- portals
add('rift_core', 'Ember Rift Core', ['riftcore_top', 'obsidian', 'riftcore_side'], pick(8, 0, { light: 10 }));
add('void_core', 'Hollow Rift Core', ['voidcore_top', 'obsidian', 'voidcore_side'], pick(8, 0, { light: 10 }));
add('rift_pad', 'Rift Surface', 'rift_pad', { hardness: -1, shape: 'model', layer: 2, opaque: false, solid: false, light: 11, model: () => [[0, 0, 0, 16, 2, 16]], drops: 'none', item: false });
add('return_gate', 'Homeward Gate', 'rift_pad_home', { hardness: -1, shape: 'model', layer: 2, opaque: false, solid: false, light: 13, model: () => [[0, 0, 0, 16, 2, 16]], drops: 'none', item: false });

export const BLOCKS = defs;
export const BLOCK_COUNT = defs.length;
export function blockByKey(k: string): BlockDef {
  const d = byKey.get(k);
  if (!d) throw new Error('Unknown block ' + k);
  return d;
}
export const B = new Proxy({} as Record<string, number>, { get: (_t, k: string) => blockByKey(k).id });

// Fast lookup tables for the hot paths (mesher, lighting, physics)
export const OPAQUE = new Uint8Array(256);
export const SOLID = new Uint8Array(256);
export const LIGHT_EMIT = new Uint8Array(256);
export const LIGHT_FILTER = new Uint8Array(256);
export const SHAPE = new Uint8Array(256); // 0 none 1 cube 2 cross 3 liquid 4 model
export const LAYER = new Uint8Array(256);
for (const d of defs) {
  OPAQUE[d.id] = d.opaque ? 1 : 0;
  SOLID[d.id] = d.solid ? 1 : 0;
  LIGHT_EMIT[d.id] = d.light;
  LIGHT_FILTER[d.id] = d.opaque ? 15 : d.filter;
  SHAPE[d.id] = ({ none: 0, cube: 1, cross: 2, liquid: 3, model: 4 } as const)[d.shape];
  LAYER[d.id] = d.layer;
}
if (defs.length > 255) throw new Error('Too many blocks for Uint8 storage');

/** light emitted taking meta into account (lit furnaces, powered lamps) */
export function emission(id: number, meta: number): number {
  const d = defs[id];
  if (d.emitsWhenMeta) return meta & 8 ? d.emitsWhenMeta : 0;
  if (d.key === 'pulse_torch') return meta & 8 ? 0 : 7; // bit 8 = unlit
  return d.light;
}

export function cropStages(key: string): number {
  return key === 'wheat_crop' ? 8 : 4;
}

/** returns tile name for crops by meta (growth) */
export function plantTile(d: BlockDef, meta: number): string {
  if (d.key.endsWith('_crop')) return `${d.key}_${Math.min(meta & 7, cropStages(d.key) - 1)}`;
  if (d.key === 'berry_bush') return meta >= 3 ? 'berry_bush_3' : 'berry_bush_1';
  if (d.key === 'pulse_torch') return meta & 8 ? 'pulse_torch_off' : 'pulse_torch_on';
  return d.tiles[2];
}

/** Every tile name referenced anywhere – order defines texture array layers */
export function allTileNames(): string[] {
  const s = new Set<string>();
  for (const d of defs) {
    if (d.shape === 'none') continue;
    d.tiles.forEach((t) => t && s.add(t));
    if (d.key.endsWith('_crop')) for (let i = 0; i < cropStages(d.key); i++) s.add(`${d.key}_${i}`);
  }
  ['berry_bush_3', 'pulse_torch_off', 'pulse_torch_on', 'lamp_on', 'furnace_front_lit', 'smoker_front_lit', 'blast_front_lit', 'pulse_wire_on', 'water_flow', 'lava_flow',
    'destroy_0', 'destroy_1', 'destroy_2', 'destroy_3', 'destroy_4', 'destroy_5', 'destroy_6', 'destroy_7', 'piston_side', 'cobblestone', 'planks_oak'].forEach((t) => s.add(t));
  return [...s];
}
export const TILE_NAMES = allTileNames();
export const TILE_INDEX = new Map(TILE_NAMES.map((n, i) => [n, i]));
export const tileId = (n: string) => TILE_INDEX.get(n) ?? 0;

/** Tile used for face `dir` (0..5 as in DIRS) */
export function faceTile(id: number, meta: number, dir: number): number {
  const d = defs[id];
  const [top, bottom, side, front] = d.tiles;
  if (d.shape === 'cross') return tileId(plantTile(d, meta));
  if (d.key === 'pulse_lamp') return tileId(meta & 8 ? 'lamp_on' : 'lamp_off');
  if (d.key === 'pulse_wire') return tileId(meta & 15 ? 'pulse_wire_on' : 'pulse_wire');
  if (d.orient === 'axis') {
    const axis = meta & 3; // 0 y, 1 x, 2 z
    const end = axis === 0 ? dir === 2 || dir === 3 : axis === 1 ? dir === 0 || dir === 1 : dir === 4 || dir === 5;
    return tileId(end ? top : side);
  }
  if (dir === 3) return tileId(top);
  if (dir === 2) return tileId(bottom);
  if (front && d.orient === 'facing') {
    const f = meta & 3;
    const fd = [4, 1, 5, 0][f];
    if (dir === fd) {
      if (d.emitsWhenMeta && meta & 8) return tileId(front + '_lit');
      return tileId(front);
    }
  }
  if (front && !d.orient && dir === 5) return tileId(front);
  return tileId(side);
}

export function modelBoxes(id: number, meta: number, n: NeighborFn): Box[] {
  const d = defs[id];
  if (d.model) return d.model(meta, n);
  return [full];
}
export function collisionBoxes(id: number, meta: number, n: NeighborFn): Box[] {
  const d = defs[id];
  if (!d.solid) return [];
  if (d.collide) return d.collide(meta, n);
  if (d.shape === 'model' && d.model) return d.model(meta, n);
  return [full];
}
