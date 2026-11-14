import { ITEMS, type ItemStack } from './items';

export interface EnchantDef { key: string; name: string; max: number; applies: (s: ItemStack) => boolean; weight: number }
const isTool = (s: ItemStack) => !!ITEMS[s.id].tool && ITEMS[s.id].tool!.kind !== 'sword';
const isSword = (s: ItemStack) => ITEMS[s.id].tool?.kind === 'sword' || ITEMS[s.id].tool?.kind === 'axe';
const isArmor = (s: ItemStack) => !!ITEMS[s.id].armor;
const isBoots = (s: ItemStack) => ITEMS[s.id].armor?.slot === 3;
const isHelm = (s: ItemStack) => ITEMS[s.id].armor?.slot === 0;
const isBow = (s: ItemStack) => ITEMS[s.id].key === 'bow';
const durable = (s: ItemStack) => !!ITEMS[s.id].durability;

export const ENCHANTS: EnchantDef[] = [
  { key: 'haste', name: 'Haste', max: 5, applies: isTool, weight: 10 },
  { key: 'bounty', name: 'Bounty', max: 3, applies: (s) => isTool(s), weight: 2 },
  { key: 'keen', name: 'Keenness', max: 5, applies: isSword, weight: 10 },
  { key: 'blaze', name: 'Blazing Edge', max: 2, applies: isSword, weight: 2 },
  { key: 'shove', name: 'Shove', max: 2, applies: isSword, weight: 5 },
  { key: 'plunder', name: 'Plunder', max: 3, applies: isSword, weight: 2 },
  { key: 'ward', name: 'Warding', max: 4, applies: isArmor, weight: 10 },
  { key: 'featherfall', name: 'Featherfall', max: 4, applies: isBoots, weight: 5 },
  { key: 'gills', name: 'Gills', max: 3, applies: isHelm, weight: 2 },
  { key: 'force', name: 'Force', max: 5, applies: isBow, weight: 10 },
  { key: 'flame', name: 'Flame Arrow', max: 1, applies: isBow, weight: 2 },
  { key: 'endless', name: 'Endless Quiver', max: 1, applies: isBow, weight: 1 },
  { key: 'endurance', name: 'Endurance', max: 3, applies: durable, weight: 5 },
  { key: 'mending', name: 'Mending', max: 1, applies: durable, weight: 1 },
];
export const ENCHANT_BY_KEY = Object.fromEntries(ENCHANTS.map((e) => [e.key, e]));
export const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];
export const enchLevel = (s: ItemStack | null | undefined, k: string) => (s?.ench?.[k] ?? 0);

/** deterministic offers for altar UI */
export function enchantOffers(s: ItemStack, shelves: number, seed: number): { cost: number; ench: Record<string, number> }[] {
  const pool = ENCHANTS.filter((e) => e.applies(s));
  if (!pool.length || s.ench) return [];
  let r = seed >>> 0;
  const rnd = () => { r = (Math.imul(r ^ (r >>> 15), 2246822507) + 0x9e3779b9) >>> 0; return r / 4294967296; };
  const base = 1 + Math.floor(rnd() * 8) + Math.floor(Math.min(15, shelves) / 2) + Math.floor(rnd() * (Math.min(15, shelves) + 1));
  const costs = [Math.max(1, Math.floor(base / 3)), Math.floor((base * 2) / 3) + 1, Math.max(base, Math.min(15, shelves) * 2)];
  return costs.map((cost) => {
    const ench: Record<string, number> = {};
    const picks = 1 + (cost > 15 && rnd() < 0.6 ? 1 : 0) + (cost > 25 && rnd() < 0.4 ? 1 : 0);
    for (let i = 0; i < picks; i++) {
      const tot = pool.reduce((a, e) => a + e.weight, 0);
      let x = rnd() * tot;
      const e = pool.find((p) => (x -= p.weight) < 0) ?? pool[0];
      if (ench[e.key]) continue;
      ench[e.key] = Math.max(1, Math.min(e.max, Math.round((cost / 30) * e.max + rnd() * 0.8)));
    }
    return { cost, ench };
  });
}

export interface EffectDef { key: string; name: string; good: boolean; color: string }
export const EFFECTS: Record<string, EffectDef> = {
  speed: { key: 'speed', name: 'Swiftness', good: true, color: '#7ad0f0' },
  strength: { key: 'strength', name: 'Might', good: true, color: '#c04a2a' },
  regeneration: { key: 'regeneration', name: 'Renewal', good: true, color: '#e07ab0' },
  fire_resistance: { key: 'fire_resistance', name: 'Emberward', good: true, color: '#ff9a2a' },
  night_vision: { key: 'night_vision', name: 'Owlsight', good: true, color: '#3a4ad0' },
  water_breathing: { key: 'water_breathing', name: 'Gills', good: true, color: '#2a7aa0' },
  jump: { key: 'jump', name: 'Bounding', good: true, color: '#4af04a' },
  absorption: { key: 'absorption', name: 'Bulwark', good: true, color: '#f0c02a' },
  poison: { key: 'poison', name: 'Blight', good: false, color: '#4a8a2a' },
  hunger_fx: { key: 'hunger_fx', name: 'Queasy', good: false, color: '#6a7a3a' },
  slowness: { key: 'slowness', name: 'Sluggish', good: false, color: '#5a6a8a' },
  wither: { key: 'wither', name: 'Withering', good: false, color: '#2a2a2a' },
};
