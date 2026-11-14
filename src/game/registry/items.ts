import { BLOCKS, WOODS, DYE_COLORS, type ToolKind } from './blocks';

export type ArmorSlot = 0 | 1 | 2 | 3; // head, chest, legs, feet
export interface ToolInfo { kind: ToolKind; tier: number; speed: number; durability: number; damage: number; cooldown: number }
export interface ArmorInfo { slot: ArmorSlot; points: number; toughness: number; durability: number; material: string }
export interface FoodInfo { hunger: number; sat: number; effects?: [string, number, number, number?][]; always?: boolean; returns?: string }

export interface ItemDef {
  id: number;
  key: string;
  name: string;
  stack: number;
  block?: number; // places this block
  icon: { tpl: string; c: string[] } | { block: number };
  tool?: ToolInfo;
  armor?: ArmorInfo;
  food?: FoodInfo;
  fuel?: number; // burn ticks (200 = one smelt)
  durability?: number;
  use?: string; // special right-click behaviour
  tags: string[];
  desc?: string;
  rarity?: 0 | 1 | 2 | 3;
}

export interface ItemStack { id: number; count: number; dmg?: number; ench?: Record<string, number>; data?: string; name?: string }

const items: ItemDef[] = [];
const byKey = new Map<string, ItemDef>();

// block items share ids with their blocks
for (const b of BLOCKS) {
  const d: ItemDef = { id: b.id, key: b.key, name: b.name, stack: 64, block: b.id, icon: { block: b.id }, tags: [] };
  items[b.id] = d;
  if (b.item) byKey.set(b.key, d);
}
let next = 256;
function add(key: string, name: string, tpl: string, c: string[], o: Partial<ItemDef> = {}): ItemDef {
  const d: ItemDef = { id: next++, key, name, stack: 64, icon: { tpl, c }, tags: [], ...o };
  items[d.id] = d;
  byKey.set(key, d);
  return d;
}
function tag(keys: string[], t: string) { for (const k of keys) byKey.get(k)?.tags.push(t); }

tag(WOODS.map((w) => `${w}_planks`), 'planks');
tag(WOODS.map((w) => `${w}_log`), 'logs');
tag(WOODS.map((w) => `${w}_stripped`), 'logs');
tag(WOODS.map((w) => `${w}_sapling`), 'saplings');
tag(DYE_COLORS.map((c) => `wool_${c}`), 'wool');
tag(['cobblestone', 'cobbled_darkstone'], 'stone_crafting');
tag(['coal', 'charcoal'], 'coal');
tag(['flower_red', 'flower_yellow', 'flower_blue', 'flower_purple', 'flower_orange', 'flower_white'], 'flowers');

/* ------------ materials ------------ */
add('stick', 'Stick', 'stick', ['#8b6236', '#5c3d1d'], { fuel: 100 });
add('coal', 'Coal', 'lump', ['#2b2b2f', '#47474f'], { fuel: 1600 });
add('charcoal', 'Charcoal', 'lump', ['#3a2e26', '#5a4a3c'], { fuel: 1600 });
add('raw_copper', 'Raw Copper', 'lump', ['#c26b42', '#e39a6c'], {});
add('raw_iron', 'Raw Iron', 'lump', ['#b59a84', '#dcc6b2'], {});
add('raw_gold', 'Raw Gold', 'lump', ['#d9a72b', '#f6dc6b'], {});
add('copper_ingot', 'Copper Ingot', 'ingot', ['#c4683c', '#eea078']);
add('iron_ingot', 'Iron Ingot', 'ingot', ['#bfc3c7', '#eef0f2']);
add('gold_ingot', 'Gold Ingot', 'ingot', ['#e0ac1e', '#fde480']);
add('diamond', 'Diamond', 'gem', ['#3fd4cf', '#b8fff8']);
add('verdite', 'Verdite', 'gem', ['#2bb05d', '#a5f3b8'], { desc: 'Traded as currency by the Wayfolk.' });
add('azurite', 'Azurite', 'dust', ['#2f4fbf', '#6f8ff0'], { desc: 'Fuel for runic enchanting.' });
add('pulsite', 'Pulsite Dust', 'dust', ['#c52a2a', '#ff6a5a'], { block: undefined, use: 'place:pulse_wire', desc: 'Lay it down to carry a pulse signal.' });
add('starmetal_shard', 'Starmetal Shard', 'gem', ['#6c5a9c', '#c7b6ff'], { rarity: 1 });
add('flarequartz', 'Flarequartz', 'gem', ['#e8e0d0', '#ffffff']);
add('cinderite_scrap', 'Cinderite Scrap', 'lump', ['#5c3b2f', '#9a6a52'], { rarity: 1 });
add('cinderite_ingot', 'Cinderite Ingot', 'ingot', ['#4a3434', '#a05a4a'], { rarity: 1 });
add('lumen_dust', 'Lumen Dust', 'dust', ['#e2c055', '#fff3a8']);
add('ember_dust', 'Ember Dust', 'dust', ['#ff8a1f', '#ffd27a'], { fuel: 0, desc: 'Fuels brewing stands.' });
add('ember_core', 'Ember Core', 'orb', ['#ff5a1f', '#ffe08a'], { rarity: 2, stack: 16, desc: 'Torn from the Magma Colossus. Hums with heat.' });
add('void_shard', 'Hollow Shard', 'gem', ['#5a2f8a', '#d0a8ff'], { rarity: 1 });
add('sovereign_heart', 'Sovereign Heart', 'orb', ['#b08aff', '#ffffff'], { rarity: 3, stack: 1, desc: 'The still heart of the Shard Sovereign.' });
add('clay_ball', 'Clay Ball', 'lump', ['#9aa3b5', '#c9d0dd']);
add('brick', 'Brick', 'ingot', ['#a24a33', '#d77a5c']);
add('flint', 'Flint', 'lump', ['#3a3a3e', '#6c6c72']);
add('snowball', 'Snowball', 'ball', ['#e8f0f6', '#ffffff'], { stack: 16, use: 'throw:snowball' });
add('bone', 'Bone', 'bone', ['#e2dccb', '#fffaf0']);
add('bone_meal', 'Bone Meal', 'dust', ['#e8e4da', '#ffffff'], { use: 'bonemeal' });
add('string', 'String', 'string', ['#e8e8e8', '#b0b0b0']);
add('feather', 'Feather', 'feather', ['#f0f0f0', '#c8c8c8']);
add('blast_powder', 'Blast Powder', 'dust', ['#55575c', '#8a8d93']);
add('hide', 'Hide', 'hide', ['#8a5530', '#b07448']);
add('gum', 'Swamp Gum', 'ball', ['#6fbf4f', '#b6f08c'], { desc: 'Sticky. Used for sticky pistons and leads.' });
add('paper', 'Paper', 'paper', ['#f2efe2', '#d8d3c0']);
add('book', 'Book', 'book', ['#7a3d22', '#f2efe2']);
add('sugar', 'Sugar', 'dust', ['#f6f6f6', '#ffffff']);
add('wheat', 'Wheat', 'wheat', ['#d8b44a', '#a78727']);
add('reeds', 'Riverreed', 'reed', ['#86b85a', '#5e8a3a'], { use: 'place:reeds' });
add('wheat_seeds', 'Wheat Seeds', 'seeds', ['#6f9a3a', '#a8c86a'], { use: 'plant:wheat_crop' });
add('beetroot_seeds', 'Beet Seeds', 'seeds', ['#8a5a3a', '#c8906a'], { use: 'plant:beet_crop' });
add('glass_bottle', 'Glass Flask', 'bottle', ['#cfe8f0', '#ffffff'], { use: 'fill_bottle' });
add('potion', 'Brew', 'potion', ['#3f76e4', '#cfe8f0'], { stack: 1, use: 'drink' });
add('ashroot', 'Ashroot', 'seeds', ['#9a2a2a', '#d8584a'], { use: 'plant:ashroot' });
add('void_bloom', 'Void Bloom Petal', 'feather', ['#a070e0', '#e0c8ff']);
add('glow_melon', 'Glinting Melon', 'melon', ['#e0b030', '#ff8a8a']);
add('ember_cream', 'Ember Cream', 'ball', ['#ff7a2a', '#ffd06a']);
add('spider_eye', 'Skitter Eye', 'ball', ['#8a1a2a', '#e04a5a'], { food: { hunger: 2, sat: 3.2, effects: [['poison', 5, 0, 1]] } });
add('fermented_eye', 'Soured Eye', 'ball', ['#6a3a1a', '#c86a4a']);
add('rabbit_foot', 'Burrowkin Foot', 'bone', ['#c8a080', '#f0d8c0']);

/* ------------ dyes ------------ */
const DYE_HEX: Record<string, string> = { white: '#f2f2f2', black: '#25252a', red: '#c0392b', orange: '#e67e22', yellow: '#f1c40f', green: '#3c8d2f', blue: '#2e5fbf', purple: '#8e44ad' };
for (const c of DYE_COLORS) add(`dye_${c}`, `${c[0].toUpperCase() + c.slice(1)} Dye`, 'dye', [DYE_HEX[c], '#ffffff']);
tag(DYE_COLORS.map((c) => `dye_${c}`), 'dye');

/* ------------ tools ------------ */
export const TIERS = [
  { key: 'wood', name: 'Wooden', tier: 0, speed: 2, dur: 60, dmg: 0, mat: 'planks', c: ['#9c7546', '#6b4a28'] },
  { key: 'stone', name: 'Stone', tier: 1, speed: 4, dur: 132, dmg: 1, mat: 'stone_crafting', c: ['#8d8f95', '#5e6066'] },
  { key: 'copper', name: 'Copper', tier: 2, speed: 5, dur: 190, dmg: 1.5, mat: 'copper_ingot', c: ['#d27a4a', '#8f4a28'] },
  { key: 'iron', name: 'Iron', tier: 3, speed: 6, dur: 250, dmg: 2, mat: 'iron_ingot', c: ['#d8dbde', '#8f9399'] },
  { key: 'gold', name: 'Golden', tier: 2, speed: 12, dur: 33, dmg: 0, mat: 'gold_ingot', c: ['#f6d23a', '#b8891a'] },
  { key: 'diamond', name: 'Diamond', tier: 4, speed: 8, dur: 1561, dmg: 3, mat: 'diamond', c: ['#5ee8e0', '#239e98'] },
  { key: 'cinderite', name: 'Cinderite', tier: 5, speed: 9, dur: 2031, dmg: 4, mat: 'cinderite_ingot', c: ['#6a4646', '#2e1e1e'] },
] as const;
const TOOL_KINDS: { kind: ToolKind; name: string; base: number; cd: number }[] = [
  { kind: 'pickaxe', name: 'Pickaxe', base: 2, cd: 0.85 },
  { kind: 'axe', name: 'Axe', base: 6, cd: 1.1 },
  { kind: 'shovel', name: 'Shovel', base: 2.5, cd: 1.0 },
  { kind: 'hoe', name: 'Hoe', base: 1, cd: 0.5 },
  { kind: 'sword', name: 'Sword', base: 4, cd: 0.62 },
];
for (const t of TIERS) {
  for (const k of TOOL_KINDS) {
    add(`${t.key}_${k.kind}`, `${t.name} ${k.name}`, k.kind, [...t.c, '#6b4a28'], {
      stack: 1,
      tool: { kind: k.kind, tier: t.tier, speed: t.speed, durability: t.dur, damage: k.base + t.dmg, cooldown: k.cd },
      durability: t.dur,
      tags: ['tool', k.kind],
      rarity: t.key === 'cinderite' ? 1 : 0,
    });
  }
}
add('shears', 'Shears', 'shears', ['#d8dbde', '#8f9399'], { stack: 1, tool: { kind: 'shears', tier: 0, speed: 5, durability: 238, damage: 1, cooldown: 0.5 }, durability: 238, tags: ['tool'] });
add('bow', 'Bow', 'bow', ['#8b6236', '#e8e8e8'], { stack: 1, durability: 384, use: 'bow', tags: ['bow'] });
add('arrow', 'Arrow', 'arrow', ['#8b6236', '#d8dbde', '#f0f0f0']);
add('shield', 'Shield', 'shield', ['#8b6236', '#bfc3c7'], { stack: 1, durability: 336, use: 'shield' });
add('fishing_rod', 'Fishing Rod', 'rod', ['#8b6236', '#e8e8e8'], { stack: 1, durability: 64, use: 'fish' });
add('igniter', 'Flint Striker', 'striker', ['#3a3a3e', '#bfc3c7'], { stack: 1, durability: 64, use: 'ignite' });
add('bucket', 'Bucket', 'bucket', ['#bfc3c7', '#6c7076'], { stack: 16, use: 'bucket' });
add('water_bucket', 'Water Bucket', 'bucket', ['#bfc3c7', '#3f76e4'], { stack: 1, use: 'pour:water' });
add('lava_bucket', 'Lava Bucket', 'bucket', ['#bfc3c7', '#ff7a1a'], { stack: 1, use: 'pour:lava', fuel: 20000 });
add('milk_bucket', 'Milk Bucket', 'bucket', ['#bfc3c7', '#f8f8f8'], { stack: 1, use: 'drink_milk' });
add('saddle', 'Saddle', 'saddle', ['#7a4424', '#c8a070'], { stack: 1 });
add('lead', 'Lead', 'lead', ['#b08a5a', '#6fbf4f'], { stack: 16, use: 'lead' });
add('boat', 'Boat', 'boat', ['#9c7546', '#6b4a28'], { stack: 1, use: 'boat' });
add('minecart', 'Rail Cart', 'cart', ['#8f9399', '#5e6066'], { stack: 1, use: 'cart' });
add('builder_wand', "Builder's Wand", 'wand', ['#e0b030', '#8a5aff'], { stack: 1, use: 'wand', desc: 'Creative only. Left click and right click mark corners, then press G to fill with the held block in your offhand, or H to clear.' });
add('wood_door', 'Wooden Door', 'door', ['#9c7546', '#6b4a28'], { use: 'door:wood_door', stack: 64 });
add('iron_door', 'Iron Door', 'door', ['#d8dbde', '#8f9399'], { use: 'door:iron_door', stack: 64 });

/* ------------ armour ------------ */
const ARMOR_MATS = [
  { key: 'leather', name: 'Hide', pts: [1, 3, 2, 1], tough: 0, dur: 5, mat: 'hide', c: ['#9a6238', '#6b4022'] },
  { key: 'copper', name: 'Copper', pts: [2, 4, 3, 1], tough: 0, dur: 11, mat: 'copper_ingot', c: ['#d27a4a', '#8f4a28'] },
  { key: 'iron', name: 'Iron', pts: [2, 6, 5, 2], tough: 0, dur: 15, mat: 'iron_ingot', c: ['#d8dbde', '#8f9399'] },
  { key: 'gold', name: 'Golden', pts: [2, 5, 3, 1], tough: 0, dur: 7, mat: 'gold_ingot', c: ['#f6d23a', '#b8891a'] },
  { key: 'diamond', name: 'Diamond', pts: [3, 8, 6, 3], tough: 2, dur: 33, mat: 'diamond', c: ['#5ee8e0', '#239e98'] },
  { key: 'cinderite', name: 'Cinderite', pts: [3, 8, 6, 3], tough: 3, dur: 37, mat: 'cinderite_ingot', c: ['#6a4646', '#2e1e1e'] },
];
export const ARMOR_MATERIALS = ARMOR_MATS;
const PIECES = [['helmet', 'Cap', 11], ['chest', 'Tunic', 16], ['legs', 'Greaves', 15], ['boots', 'Boots', 13]] as const;
for (const m of ARMOR_MATS) {
  PIECES.forEach(([p, n, d], slot) => {
    const nm = m.key === 'leather' ? `${m.name} ${n}` : `${m.name} ${['Helm', 'Chestplate', 'Leggings', 'Boots'][slot]}`;
    add(`${m.key}_${p}`, nm, `armor_${p}`, m.c, {
      stack: 1,
      armor: { slot: slot as ArmorSlot, points: m.pts[slot], toughness: m.tough, durability: m.dur * d, material: m.mat },
      durability: m.dur * d,
      tags: ['armor'],
    });
  });
}

/* ------------ endgame ------------ */
add('starforged_blade', 'Starforged Blade', 'sword', ['#e0c8ff', '#7a4ac0', '#f0d060'], { stack: 1, tool: { kind: 'sword', tier: 6, speed: 10, durability: 4000, damage: 12, cooldown: 0.55 }, durability: 4000, tags: ['tool', 'sword'], rarity: 3, desc: 'Forged around the Sovereign Heart.' });
add('sovereign_halo', 'Sovereign Halo', 'armor_helmet', ['#f0d060', '#b08aff'], { stack: 1, armor: { slot: 0, points: 5, toughness: 4, durability: 1600, material: 'void_shard' }, durability: 1600, tags: ['armor'], rarity: 3, desc: 'Grants Owlsight and slow Renewal while worn.' });

/* ------------ food ------------ */
const food = (key: string, name: string, tpl: string, c: string[], hunger: number, sat: number, o: Partial<FoodInfo> = {}, extra: Partial<ItemDef> = {}) =>
  add(key, name, tpl, c, { food: { hunger, sat, ...o }, ...extra });
food('apple', 'Apple', 'apple', ['#d8342a', '#6b9a2a'], 4, 2.4);
food('gilded_apple', 'Gilded Apple', 'apple', ['#f6d23a', '#6b9a2a'], 4, 9.6, { effects: [['regeneration', 5, 1], ['absorption', 120, 0]], always: true }, { rarity: 1 });
food('bread', 'Bread', 'bread', ['#c8913a', '#8a5a1a'], 5, 6);
food('carrot', 'Carrot', 'carrot', ['#ef8a1f', '#5a9a2a'], 3, 3.6, {}, { use: 'plant:carrot_crop' });
food('golden_carrot', 'Golden Carrot', 'carrot', ['#f6d23a', '#d8b02a'], 6, 14.4);
food('potato', 'Potato', 'potato', ['#c8a060', '#8a6a3a'], 1, 0.6, {}, { use: 'plant:potato_crop' });
food('baked_potato', 'Baked Potato', 'potato', ['#d8a850', '#a0702a'], 5, 6);
food('beetroot', 'Beetroot', 'potato', ['#9a1a3a', '#5a9a2a'], 1, 1.2);
food('sunberries', 'Sunberries', 'berries', ['#f0a020', '#c86010'], 2, 0.4, {}, { use: 'plant:berry_bush' });
food('melon_slice', 'Melon Slice', 'melon', ['#e04a4a', '#5a9a2a'], 2, 1.2);
food('pumpkin_pie', 'Pumpkin Tart', 'bread', ['#e08a2a', '#a0602a'], 8, 4.8);
food('cookie', 'Biscuit', 'cookie', ['#b8783a', '#5a3a1a'], 2, 0.4);
food('mushroom_stew', 'Mushroom Stew', 'bowl', ['#a87a5a', '#6b4a28'], 6, 7.2, { returns: 'bowl' }, { stack: 1 });
add('bowl', 'Bowl', 'bowl', ['#9c7546', '#6b4a28']);
food('raw_grazer', 'Raw Grazer Steak', 'meat', ['#c8484a', '#f0a0a0'], 3, 1.8);
food('cooked_grazer', 'Grazer Steak', 'meat', ['#8a4a2a', '#c8784a'], 8, 12.8);
food('raw_mutton', 'Raw Fluffer Chop', 'meat', ['#d0585a', '#f4c0c0'], 2, 1.2);
food('cooked_mutton', 'Fluffer Chop', 'meat', ['#9a5a3a', '#d0905a'], 6, 9.6);
food('raw_pork', 'Raw Snoutling Ham', 'meat', ['#e88a8a', '#f8d0d0'], 3, 1.8);
food('cooked_pork', 'Snoutling Ham', 'meat', ['#b8784a', '#e8b080'], 8, 12.8);
food('raw_chicken', 'Raw Cluckit', 'drumstick', ['#f0c0a0', '#ffffff'], 2, 1.2, { effects: [['hunger_fx', 30, 0, 0.3]] });
food('cooked_chicken', 'Roast Cluckit', 'drumstick', ['#c8884a', '#ffffff'], 6, 7.2);
food('raw_rabbit', 'Raw Burrowkin', 'meat', ['#e0a090', '#f8d8d0'], 3, 1.8);
food('cooked_rabbit', 'Roast Burrowkin', 'meat', ['#a86a3a', '#d8a070'], 5, 6);
food('raw_fish', 'Raw Finling', 'fish', ['#7aa8c8', '#c8e0f0'], 2, 0.4);
food('cooked_fish', 'Cooked Finling', 'fish', ['#c8905a', '#e8c090'], 5, 6);
food('rotten_flesh', 'Rotten Flesh', 'meat', ['#7a8a3a', '#a85a3a'], 4, 0.8, { effects: [['hunger_fx', 30, 0, 0.8]] });
add('egg', 'Egg', 'egg', ['#e8d8b8', '#ffffff'], { stack: 16, use: 'throw:egg' });

export const ITEMS = items;
export function itemByKey(k: string): ItemDef {
  const d = byKey.get(k);
  if (!d) throw new Error('Unknown item ' + k);
  return d;
}
export const hasItem = (k: string) => byKey.has(k);
export const I = new Proxy({} as Record<string, number>, { get: (_t, k: string) => itemByKey(k).id });
export function allItems(): ItemDef[] { return items.filter((d) => d && (d.id >= 256 || BLOCKS[d.id].item)); }
export function maxDurability(s: ItemStack): number { return ITEMS[s.id]?.durability ?? 0; }
export function stackLimit(id: number): number { return ITEMS[id]?.stack ?? 64; }
export function sameItem(a: ItemStack, b: ItemStack) {
  return a.id === b.id && (a.data ?? '') === (b.data ?? '') && !a.ench && !b.ench && !a.dmg && !b.dmg && (a.name ?? '') === (b.name ?? '');
}
export function itemName(s: ItemStack): string {
  if (s.name) return s.name;
  const d = ITEMS[s.id];
  if (d.key === 'potion') return potionName(s.data);
  return d.name;
}
export function potionName(data?: string) {
  const p = POTIONS[data ?? 'water'];
  return p ? p.name : 'Brew';
}
export const POTIONS: Record<string, { name: string; color: string; effect?: [string, number, number] }> = {
  water: { name: 'Flask of Water', color: '#3f76e4' },
  murky: { name: 'Murky Brew', color: '#5a5a8a' },
  healing: { name: 'Brew of Mending', color: '#f04a6a', effect: ['instant_health', 0, 1] },
  regeneration: { name: 'Brew of Renewal', color: '#e07ab0', effect: ['regeneration', 45, 0] },
  swiftness: { name: 'Brew of Swiftness', color: '#7ad0f0', effect: ['speed', 180, 0] },
  strength: { name: 'Brew of Might', color: '#a03a2a', effect: ['strength', 180, 0] },
  fire_resistance: { name: 'Brew of Emberward', color: '#ff9a2a', effect: ['fire_resistance', 180, 0] },
  night_vision: { name: 'Brew of Owlsight', color: '#2a3ac0', effect: ['night_vision', 180, 0] },
  water_breathing: { name: 'Brew of Gills', color: '#2a7aa0', effect: ['water_breathing', 180, 0] },
  leaping: { name: 'Brew of Bounding', color: '#4af04a', effect: ['jump', 180, 0] },
  poison: { name: 'Brew of Blight', color: '#4a8a2a', effect: ['poison', 45, 0] },
  harming: { name: 'Brew of Ruin', color: '#4a0a1a', effect: ['instant_damage', 0, 0] },
};
