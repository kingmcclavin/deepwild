import { ITEMS, itemByKey, hasItem, type ItemStack, TIERS } from './items';
import { WOODS, DYE_COLORS } from './blocks';

export type Category = 'building' | 'tools' | 'combat' | 'food' | 'pulse' | 'transport' | 'decor' | 'misc';
export interface Recipe {
  id: number;
  out: number;
  n: number;
  cat: Category;
  // shaped: rows of chars; shapeless: list of ingredients
  pattern?: string[];
  keys?: Record<string, string>;
  ing?: string[];
  w: number;
  h: number;
}

export const RECIPES: Recipe[] = [];
function shaped(out: string, n: number, cat: Category, pattern: string[], keys: Record<string, string>) {
  if (!hasItem(out)) throw new Error('recipe out ' + out);
  // crop to the bounding box of non-empty cells so trailing spaces never change the shape
  const W = Math.max(...pattern.map((r) => r.length));
  const rows = pattern.map((r) => r.padEnd(W, ' '));
  let x0 = W, x1 = -1;
  for (const r of rows) for (let x = 0; x < W; x++) if (r[x] !== ' ') { x0 = Math.min(x0, x); x1 = Math.max(x1, x); }
  const cropped = rows.map((r) => r.slice(x0, x1 + 1)).filter((r, i, a) => r.trim() || (a.slice(0, i).some((q) => q.trim()) && a.slice(i + 1).some((q) => q.trim())));
  RECIPES.push({ id: RECIPES.length, out: itemByKey(out).id, n, cat, pattern: cropped, keys, w: x1 - x0 + 1, h: cropped.length });
}
function shapeless(out: string, n: number, cat: Category, ing: string[]) {
  RECIPES.push({ id: RECIPES.length, out: itemByKey(out).id, n, cat, ing, w: ing.length > 4 ? 3 : 2, h: ing.length > 4 ? 3 : 2 });
}

/** an ingredient spec is an item key or #tag */
export function matches(spec: string, s: ItemStack | null | undefined): boolean {
  if (!s) return false;
  const d = ITEMS[s.id];
  if (spec.startsWith('#')) return d.tags.includes(spec.slice(1));
  return d.key === spec;
}
export function specExample(spec: string): number {
  if (!spec.startsWith('#')) return itemByKey(spec).id;
  const t = spec.slice(1);
  return ITEMS.find((d) => d && d.tags.includes(t))!.id;
}

/* ---------------- basics ---------------- */
for (const w of WOODS) {
  shapeless(`${w}_planks`, 4, 'building', [`${w}_log`]);
  shapeless(`${w}_planks`, 4, 'building', [`${w}_stripped`]);
}
shaped('stick', 4, 'misc', ['P', 'P'], { P: '#planks' });
shaped('crafting_table', 1, 'misc', ['PP', 'LL'], { P: '#planks', L: '#logs' });
shapeless('torch', 4, 'decor', ['#coal', 'stick']);
shaped('chest', 1, 'misc', ['PSP', 'P P', 'PPP'], { P: '#planks', S: 'stick' });
shaped('furnace', 1, 'misc', ['C C', 'CCC', 'CCC'], { C: '#stone_crafting' });
shaped('smoker', 1, 'misc', [' L ', 'LFL', ' L '], { L: '#logs', F: 'furnace' });
shaped('blast_furnace', 1, 'misc', ['III', 'IFI', 'SSS'], { I: 'iron_ingot', F: 'furnace', S: 'smooth_stone' });
shaped('ladder', 4, 'building', ['S S', 'SSS', 'S S'], { S: 'stick' });
shaped('bed', 1, 'decor', ['WWW', 'PPP'], { W: '#wool', P: '#planks' });
shaped('bookshelf', 1, 'decor', ['PPP', 'BBB', 'PPP'], { P: '#planks', B: 'book' });
shapeless('paper', 3, 'misc', ['reeds', 'reeds', 'reeds']);
shapeless('book', 1, 'misc', ['paper', 'paper', 'paper', 'hide']);
shaped('enchanting_table', 1, 'misc', [' B ', 'DOD', 'OOO'], { B: 'book', D: 'diamond', O: 'obsidian' });
shaped('anvil', 1, 'misc', ['BBB', ' I ', 'III'], { B: 'iron_block', I: 'iron_ingot' });
shaped('brewing_stand', 1, 'misc', [' F ', 'CCC'], { F: 'flarequartz', C: '#stone_crafting' });
shaped('glass_bottle', 3, 'misc', ['G G', ' G '], { G: 'glass' });
shaped('bucket', 1, 'tools', ['I I', ' I '], { I: 'iron_ingot' });
shaped('lantern', 1, 'decor', [' I ', 'ITI', ' I '], { I: 'iron_ingot', T: 'torch' });
shaped('bowl', 4, 'misc', ['P P', ' P '], { P: '#planks' });

/* ---------------- tools & combat ---------------- */
for (const t of TIERS) {
  const M = t.mat.startsWith('planks') || t.mat === 'stone_crafting' ? `#${t.mat}` : t.mat;
  shaped(`${t.key}_pickaxe`, 1, 'tools', [' M ', 'MSM', ' S '], { M, S: 'stick' });
  shaped(`${t.key}_axe`, 1, 'tools', ['MM ', 'SM ', 'S  '], { M, S: 'stick' });
  shaped(`${t.key}_shovel`, 1, 'tools', ['M ', ' S'], { M, S: 'stick' });
  shaped(`${t.key}_hoe`, 1, 'tools', ['MM', ' S'], { M, S: 'stick' });
  shaped(`${t.key}_sword`, 1, 'combat', ['  M', ' M ', 'S  '], { M, S: 'stick' });
}
for (const m of ['leather', 'copper', 'iron', 'gold', 'diamond', 'cinderite']) {
  const M = { leather: 'hide', copper: 'copper_ingot', iron: 'iron_ingot', gold: 'gold_ingot', diamond: 'diamond', cinderite: 'cinderite_ingot' }[m]!;
  shaped(`${m}_helmet`, 1, 'combat', ['MTM', 'M M'], { M, T: 'string' });
  shaped(`${m}_chest`, 1, 'combat', ['M M', 'MTM', 'MMM'], { M, T: 'string' });
  shaped(`${m}_legs`, 1, 'combat', ['MTM', 'M M', 'M M'], { M, T: 'string' });
  shaped(`${m}_boots`, 1, 'combat', ['M M', 'MTM'], { M, T: 'string' });
}
shapeless('cinderite_ingot', 1, 'misc', ['cinderite_scrap', 'cinderite_scrap', 'cinderite_scrap', 'gold_ingot', 'gold_ingot']);
shaped('bow', 1, 'combat', [' ST', 'S T', ' ST'], { S: 'stick', T: 'string' });
shaped('arrow', 4, 'combat', ['F', 'S', 'E'], { F: 'flint', S: 'stick', E: 'feather' });
shaped('shield', 1, 'combat', ['PIP', 'PPP', ' P '], { P: '#planks', I: 'iron_ingot' });
shaped('shears', 1, 'tools', [' I', 'I '], { I: 'iron_ingot' });
shaped('fishing_rod', 1, 'tools', ['  S', ' ST', 'S T'], { S: 'stick', T: 'string' });
shapeless('igniter', 1, 'tools', ['iron_ingot', 'flint']);
shaped('lead', 2, 'tools', ['TT ', 'TG ', '  T'], { T: 'string', G: 'gum' });
shaped('saddle', 1, 'transport', ['HHH', 'H H', 'I I'], { H: 'hide', I: 'iron_ingot' });

/* ---------------- transport ---------------- */
shaped('boat', 1, 'transport', ['P P', 'PPP'], { P: '#planks' });
shaped('rail', 16, 'transport', ['I I', 'ISI', 'I I'], { I: 'iron_ingot', S: 'stick' });
shaped('minecart', 1, 'transport', ['I I', 'III'], { I: 'iron_ingot' });

/* ---------------- building ---------------- */
shaped('wood_stairs', 4, 'building', ['P  ', 'PP ', 'PPP'], { P: '#planks' });
shaped('wood_slab', 6, 'building', ['PPP'], { P: '#planks' });
shaped('wood_fence', 3, 'building', ['PSP', 'PSP'], { P: '#planks', S: 'stick' });
shaped('wood_fence_gate', 1, 'building', ['SPS', 'SPS'], { P: '#planks', S: 'stick' });
shaped('wood_door', 3, 'building', ['PP', 'PP', 'PP'], { P: '#planks' });
shaped('iron_door', 3, 'building', ['II', 'II', 'II'], { I: 'iron_ingot' });
shaped('wood_trapdoor', 2, 'building', ['PPP', 'PPP'], { P: '#planks' });
shaped('wood_sign', 3, 'decor', ['PPP', 'PPP', ' S '], { P: '#planks', S: 'stick' });
shaped('stone_stairs', 4, 'building', ['C  ', 'CC ', 'CCC'], { C: 'cobblestone' });
shaped('stone_slab', 6, 'building', ['SSS'], { S: 'smooth_stone' });
shaped('brick_stairs', 4, 'building', ['B  ', 'BB ', 'BBB'], { B: 'bricks' });
shaped('brick_slab', 6, 'building', ['BBB'], { B: 'bricks' });
shaped('stone_brick_stairs', 4, 'building', ['B  ', 'BB ', 'BBB'], { B: 'stone_bricks' });
shaped('cobble_wall', 6, 'building', ['CCC', 'CCC'], { C: 'cobblestone' });
shaped('stone_bricks', 4, 'building', ['SS', 'SS'], { S: 'stone' });
shapeless('mossy_stone_bricks', 1, 'building', ['stone_bricks', 'vine']);
shapeless('mossy_cobblestone', 1, 'building', ['cobblestone', 'vine']);
shaped('bricks', 1, 'building', ['BB', 'BB'], { B: 'brick' });
shaped('sandstone', 1, 'building', ['SS', 'SS'], { S: 'sand' });
shaped('glass_pane', 16, 'building', ['GGG', 'GGG'], { G: 'glass' });
shaped('iron_bars', 16, 'building', ['III', 'III'], { I: 'iron_ingot' });
shaped('hay_bale', 1, 'building', ['WWW', 'WWW', 'WWW'], { W: 'wheat' });
shaped('ember_bricks', 1, 'building', ['FF', 'FF'], { F: 'flarequartz' });
shaped('pale_bricks', 4, 'building', ['PP', 'PP'], { P: 'pale_stone' });
shaped('lumen_block', 1, 'decor', ['LL', 'LL'], { L: 'lumen_dust' });
shaped('snow_block', 1, 'building', ['SS', 'SS'], { S: 'snowball' });
shapeless('wool_white', 1, 'building', ['string', 'string', 'string', 'string']);
for (const c of DYE_COLORS) {
  if (c !== 'white') shapeless(`wool_${c}`, 1, 'decor', [`dye_${c}`, 'wool_white']);
  shaped(`concrete_${c}`, 8, 'building', ['SGS', 'GDG', 'SGS'], { S: 'sand', G: 'gravel', D: `dye_${c}` });
}
shapeless('dye_red', 2, 'misc', ['flower_red']);
shapeless('dye_yellow', 2, 'misc', ['flower_yellow']);
shapeless('dye_blue', 2, 'misc', ['flower_blue']);
shapeless('dye_purple', 2, 'misc', ['flower_purple']);
shapeless('dye_orange', 2, 'misc', ['flower_orange']);
shapeless('dye_white', 2, 'misc', ['flower_white']);
shapeless('dye_white', 3, 'misc', ['bone_meal']);
shapeless('dye_black', 1, 'misc', ['#coal']);
shapeless('dye_blue', 1, 'misc', ['azurite']);
shapeless('bone_meal', 3, 'misc', ['bone']);

/* ---------------- mineral blocks ---------------- */
for (const [blk, it] of [['coal_block', 'coal'], ['copper_block', 'copper_ingot'], ['iron_block', 'iron_ingot'], ['gold_block', 'gold_ingot'], ['diamond_block', 'diamond'], ['azurite_block', 'azurite'], ['verdite_block', 'verdite'], ['pulsite_block', 'pulsite']] as const) {
  shaped(blk, 1, 'building', ['XXX', 'XXX', 'XXX'], { X: it });
  shapeless(it, 9, 'misc', [blk]);
}

/* ---------------- pulse (automation) ---------------- */
shaped('lever', 1, 'pulse', ['S', 'C'], { S: 'stick', C: 'cobblestone' });
shapeless('stone_button', 1, 'pulse', ['stone']);
shapeless('wood_button', 1, 'pulse', ['#planks']);
shaped('pressure_plate', 1, 'pulse', ['SS'], { S: 'smooth_stone' });
shaped('pulse_torch', 1, 'pulse', ['P', 'S'], { P: 'pulsite', S: 'stick' });
shaped('repeater', 1, 'pulse', ['TPT', 'SSS'], { T: 'pulse_torch', P: 'pulsite', S: 'stone' });
shaped('comparator', 1, 'pulse', [' T ', 'TFT', 'SSS'], { T: 'pulse_torch', F: 'flarequartz', S: 'stone' });
shaped('pulse_lamp', 1, 'pulse', [' P ', 'PLP', ' P '], { P: 'pulsite', L: 'lumen_block' });
shaped('piston', 1, 'pulse', ['PPP', 'CIC', 'CPC'], { P: '#planks', C: 'cobblestone', I: 'iron_ingot' });
shapeless('sticky_piston', 1, 'pulse', ['piston', 'gum']);
shaped('dispenser', 1, 'pulse', ['CCC', 'CBC', 'CPC'], { C: 'cobblestone', B: 'bow', P: 'pulsite' });
shaped('hopper', 1, 'pulse', ['I I', 'ICI', ' I '], { I: 'iron_ingot', C: 'chest' });
shaped('powder_keg', 1, 'pulse', ['PSP', 'SPS', 'PSP'], { P: 'blast_powder', S: 'sand' });

/* ---------------- food ---------------- */
shaped('bread', 1, 'food', ['WWW'], { W: 'wheat' });
shapeless('mushroom_stew', 1, 'food', ['mushroom_red', 'mushroom_brown', 'bowl']);
shapeless('pumpkin_pie', 1, 'food', ['pumpkin', 'sugar', 'egg']);
shaped('cookie', 8, 'food', ['WCW'], { W: 'wheat', C: 'dye_orange' });
shapeless('sugar', 1, 'food', ['reeds']);
shaped('gilded_apple', 1, 'food', ['GGG', 'GAG', 'GGG'], { G: 'gold_ingot', A: 'apple' });
shaped('golden_carrot', 1, 'food', ['GGG', 'GCG', 'GGG'], { G: 'gold_ingot', C: 'carrot' });
shaped('glow_melon', 1, 'misc', ['GGG', 'GMG', 'GGG'], { G: 'gold_ingot', M: 'melon_slice' });
shapeless('ember_cream', 1, 'misc', ['ember_dust', 'gum']);
shapeless('fermented_eye', 1, 'misc', ['spider_eye', 'sugar', 'mushroom_brown']);
shapeless('ember_dust', 2, 'misc', ['flarequartz', 'pulsite']);

/* ---------------- progression ---------------- */
shaped('rift_core', 1, 'misc', ['OGO', 'GDG', 'OGO'], { O: 'obsidian', G: 'gold_block', D: 'diamond' });
shaped('starforged_blade', 1, 'combat', [' S ', 'SHS', ' B '], { S: 'starmetal_shard', H: 'sovereign_heart', B: 'cinderite_sword' });
shaped('sovereign_halo', 1, 'combat', ['GVG', 'V V'], { G: 'gold_block', V: 'void_shard' });
shaped('void_core', 1, 'misc', ['SES', 'ECE', 'SES'], { S: 'starmetal_shard', E: 'ember_core', C: 'rift_core' });

export function recipeNeedsTable(r: Recipe) { return r.w > 2 || r.h > 2; }

/** Match a crafting grid (size x size, row-major) against all recipes */
export function matchGrid(grid: (ItemStack | null)[], size: number): Recipe | null {
  // bounding box
  let minX = size, minY = size, maxX = -1, maxY = -1, count = 0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (grid[y * size + x]) { count++; minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  }
  if (!count) return null;
  const w = maxX - minX + 1, h = maxY - minY + 1;
  for (const r of RECIPES) {
    if (r.pattern) {
      if (r.w !== w || r.h !== h) continue;
      const tryMatch = (mirror: boolean) => {
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const ch = r.pattern![y][mirror ? w - 1 - x : x];
          const s = grid[(y + minY) * size + x + minX];
          if (ch === ' ') { if (s) return false; } else if (!matches(r.keys![ch], s)) return false;
        }
        return true;
      };
      if (tryMatch(false) || tryMatch(true)) return r;
    } else if (r.ing && r.ing.length === count) {
      const left = grid.filter(Boolean) as ItemStack[];
      const used = new Array(left.length).fill(false);
      let ok = true;
      for (const spec of r.ing) {
        const i = left.findIndex((s, j) => !used[j] && matches(spec, s));
        if (i < 0) { ok = false; break; }
        used[i] = true;
      }
      if (ok) return r;
    }
  }
  return null;
}

/* ---------------- smelting ---------------- */
export interface Smelt { in: string; out: string; xp: number; kind: 'food' | 'ore' | 'other' }
export const SMELTING: Smelt[] = ([
  { in: 'raw_iron', out: 'iron_ingot', xp: 0.7, kind: 'ore' }, { in: 'iron_ore', out: 'iron_ingot', xp: 0.7, kind: 'ore' },
  { in: 'raw_gold', out: 'gold_ingot', xp: 1, kind: 'ore' }, { in: 'gold_ore', out: 'gold_ingot', xp: 1, kind: 'ore' },
  { in: 'raw_copper', out: 'copper_ingot', xp: 0.7, kind: 'ore' }, { in: 'copper_ore', out: 'copper_ingot', xp: 0.7, kind: 'ore' },
  { in: 'cinderite_ore', out: 'cinderite_scrap', xp: 2, kind: 'ore' },
  { in: 'diamond_ore', out: 'diamond', xp: 1, kind: 'ore' },
  { in: 'sand', out: 'glass', xp: 0.1, kind: 'other' }, { in: 'red_sand', out: 'glass', xp: 0.1, kind: 'other' },
  { in: 'cobblestone', out: 'stone', xp: 0.1, kind: 'other' }, { in: 'stone', out: 'smooth_stone', xp: 0.1, kind: 'other' },
  { in: 'cobbled_darkstone', out: 'darkstone', xp: 0.1, kind: 'other' },
  { in: 'stone_bricks', out: 'cracked_stone_bricks', xp: 0.1, kind: 'other' },
  { in: 'clay_ball', out: 'brick', xp: 0.3, kind: 'other' }, { in: 'clay', out: 'terracotta', xp: 0.35, kind: 'other' },
  { in: 'cactus', out: 'dye_green', xp: 1, kind: 'other' },
  ...WOODS.map((w) => ({ in: `${w}_log`, out: 'charcoal', xp: 0.15, kind: 'other' as const })),
  { in: 'raw_grazer', out: 'cooked_grazer', xp: 0.35, kind: 'food' }, { in: 'raw_mutton', out: 'cooked_mutton', xp: 0.35, kind: 'food' },
  { in: 'raw_pork', out: 'cooked_pork', xp: 0.35, kind: 'food' }, { in: 'raw_chicken', out: 'cooked_chicken', xp: 0.35, kind: 'food' },
  { in: 'raw_rabbit', out: 'cooked_rabbit', xp: 0.35, kind: 'food' }, { in: 'raw_fish', out: 'cooked_fish', xp: 0.35, kind: 'food' },
  { in: 'potato', out: 'baked_potato', xp: 0.35, kind: 'food' },
] as Smelt[]).filter((s) => hasItem(s.in) && hasItem(s.out));
export function smeltResult(id: number, furnace: 'furnace' | 'smoker' | 'blast'): Smelt | null {
  const k = ITEMS[id].key;
  const s = SMELTING.find((x) => x.in === k);
  if (!s) return null;
  if (furnace === 'smoker' && s.kind !== 'food') return null;
  if (furnace === 'blast' && s.kind !== 'ore') return null;
  return s;
}
export function fuelValue(id: number): number {
  const d = ITEMS[id];
  if (d.fuel) return d.fuel;
  if (d.tags.includes('planks') || d.tags.includes('logs')) return 300;
  if (d.key === 'coal_block') return 16000;
  if (d.tags.includes('saplings')) return 100;
  if (d.tool && d.tool.tier === 0) return 200;
  if (d.key.endsWith('_slab') && d.key.startsWith('wood')) return 150;
  if (['wood_stairs', 'wood_fence', 'crafting_table', 'chest', 'bookshelf', 'ladder', 'bowl', 'wood_trapdoor', 'wood_fence_gate'].includes(d.key)) return 300;
  return 0;
}

/* ---------------- brewing ---------------- */
// base -> ingredient -> result
export const BREWING: [string, string, string][] = [
  ['water', 'ashroot', 'murky'],
  ['murky', 'glow_melon', 'healing'],
  ['murky', 'gilded_apple', 'regeneration'],
  ['murky', 'sugar', 'swiftness'],
  ['murky', 'ember_dust', 'strength'],
  ['murky', 'ember_cream', 'fire_resistance'],
  ['murky', 'golden_carrot', 'night_vision'],
  ['murky', 'raw_fish', 'water_breathing'],
  ['murky', 'rabbit_foot', 'leaping'],
  ['murky', 'spider_eye', 'poison'],
  ['healing', 'fermented_eye', 'harming'],
  ['poison', 'fermented_eye', 'harming'],
];
export function brewResult(base: string, ingredientId: number): string | null {
  const k = ITEMS[ingredientId].key;
  const r = BREWING.find((b) => b[0] === base && b[1] === k);
  return r ? r[2] : null;
}
export const isBrewIngredient = (id: number) => BREWING.some((b) => b[1] === ITEMS[id].key);
