import { itemByKey, ITEMS, type ItemStack } from './registry/items';
import { enchantOffers } from './registry/enchant';

type Entry = [key: string, min: number, max: number, weight: number, enchanted?: boolean];
const T: Record<string, { rolls: [number, number]; e: Entry[] }> = {
  village_house: { rolls: [3, 7], e: [['bread', 1, 4, 10], ['apple', 1, 3, 8], ['wheat_seeds', 2, 6, 8], ['carrot', 1, 4, 6], ['potato', 1, 4, 6], ['coal', 1, 4, 6], ['string', 1, 3, 4], ['iron_ingot', 1, 2, 3], ['verdite', 1, 2, 2], ['torch', 2, 6, 5]] },
  smithy: { rolls: [3, 7], e: [['iron_ingot', 1, 5, 10], ['bread', 1, 3, 6], ['apple', 1, 3, 6], ['iron_pickaxe', 1, 1, 4], ['iron_sword', 1, 1, 4], ['iron_helmet', 1, 1, 3], ['iron_chest', 1, 1, 3], ['obsidian', 2, 6, 5], ['gold_ingot', 1, 3, 4], ['diamond', 1, 2, 2], ['saddle', 1, 1, 2], ['copper_ingot', 2, 6, 6]] },
  library: { rolls: [2, 5], e: [['book', 1, 4, 10], ['paper', 2, 8, 8], ['azurite', 3, 9, 6], ['verdite', 1, 3, 3], ['lantern', 1, 1, 2]] },
  ruin: { rolls: [2, 6], e: [['coal', 1, 6, 10], ['iron_ingot', 1, 3, 6], ['gold_ingot', 1, 2, 3], ['rotten_flesh', 1, 4, 8], ['bone', 1, 4, 6], ['wheat', 1, 6, 6], ['verdite', 1, 2, 3], ['gilded_apple', 1, 1, 1], ['stone_sword', 1, 1, 3, true]] },
  tower: { rolls: [3, 7], e: [['arrow', 4, 16, 10], ['bow', 1, 1, 4, true], ['iron_sword', 1, 1, 3, true], ['bread', 1, 4, 8], ['saddle', 1, 1, 3], ['verdite', 1, 3, 4], ['diamond', 1, 2, 2], ['iron_ingot', 1, 4, 6], ['lead', 1, 2, 3]] },
  ship: { rolls: [3, 7], e: [['paper', 1, 6, 8], ['coal', 2, 8, 8], ['iron_ingot', 1, 5, 8], ['gold_ingot', 1, 4, 5], ['verdite', 1, 4, 5], ['diamond', 1, 2, 2], ['starmetal_shard', 1, 1, 1], ['leather_chest', 1, 1, 3, true]] },
  ship_supply: { rolls: [3, 8], e: [['bread', 2, 6, 10], ['cooked_fish', 2, 6, 8], ['carrot', 2, 6, 8], ['potato', 2, 6, 8], ['wheat', 4, 12, 6], ['pumpkin', 1, 3, 4], ['torch', 4, 12, 5]] },
  treasure: { rolls: [4, 8], e: [['gold_ingot', 2, 8, 10], ['iron_ingot', 3, 8, 10], ['diamond', 1, 3, 6], ['verdite', 2, 6, 8], ['gilded_apple', 1, 2, 3], ['starmetal_shard', 1, 2, 2], ['cooked_fish', 2, 5, 6]] },
  temple: { rolls: [2, 6], e: [['bone', 2, 6, 10], ['rotten_flesh', 2, 6, 10], ['gold_ingot', 2, 6, 8], ['iron_ingot', 1, 5, 8], ['verdite', 1, 3, 6], ['diamond', 1, 3, 4], ['saddle', 1, 1, 4], ['gilded_apple', 1, 1, 2], ['gold_sword', 1, 1, 3, true], ['blast_powder', 2, 6, 5]] },
  shrine: { rolls: [2, 6], e: [['arrow', 3, 12, 10], ['bone', 2, 6, 8], ['gold_ingot', 2, 6, 8], ['iron_ingot', 1, 5, 8], ['diamond', 1, 3, 4], ['verdite', 1, 3, 6], ['saddle', 1, 1, 3], ['iron_boots', 1, 1, 2, true]] },
  dungeon: { rolls: [2, 6], e: [['bread', 1, 3, 10], ['wheat', 1, 4, 8], ['saddle', 1, 1, 6], ['iron_ingot', 1, 4, 8], ['gold_ingot', 1, 4, 5], ['pulsite', 1, 4, 6], ['bone', 1, 6, 8], ['string', 1, 4, 8], ['rotten_flesh', 1, 6, 8], ['blast_powder', 1, 4, 6], ['gilded_apple', 1, 1, 2], ['iron_chest', 1, 1, 2, true]] },
  mineshaft: { rolls: [3, 7], e: [['rail', 4, 8, 10], ['torch', 2, 10, 10], ['coal', 3, 8, 10], ['iron_ingot', 1, 5, 8], ['gold_ingot', 1, 3, 5], ['azurite', 4, 9, 5], ['pulsite', 4, 9, 5], ['diamond', 1, 2, 3], ['bread', 1, 3, 8], ['iron_pickaxe', 1, 1, 2, true]] },
  starfall: { rolls: [3, 6], e: [['starmetal_shard', 1, 3, 10], ['diamond', 1, 3, 8], ['obsidian', 2, 6, 6], ['gilded_apple', 1, 1, 4], ['diamond_pickaxe', 1, 1, 2, true], ['void_bloom', 1, 2, 4]] },
  bastion: { rolls: [4, 8], e: [['gold_ingot', 3, 9, 10], ['cinderite_scrap', 1, 2, 3], ['flarequartz', 4, 12, 8], ['ember_dust', 2, 6, 8], ['obsidian', 2, 6, 6], ['diamond', 1, 3, 4], ['saddle', 1, 1, 4], ['gilded_apple', 1, 1, 3], ['diamond_sword', 1, 1, 2, true], ['gold_chest', 1, 1, 3, true], ['ashroot', 2, 5, 6]] },
  spire: { rolls: [4, 8], e: [['diamond', 2, 6, 10], ['cinderite_ingot', 1, 2, 4], ['starmetal_shard', 1, 4, 8], ['gilded_apple', 1, 2, 5], ['verdite', 3, 10, 8], ['diamond_chest', 1, 1, 3, true], ['diamond_legs', 1, 1, 3, true], ['diamond_sword', 1, 1, 3, true], ['void_shard', 2, 5, 8]] },
  bonus: { rolls: [6, 8], e: [['oak_log', 4, 8, 10], ['oak_planks', 8, 16, 10], ['apple', 2, 5, 8], ['bread', 2, 4, 8], ['stick', 4, 8, 6], ['stone_pickaxe', 1, 1, 4], ['stone_axe', 1, 1, 4], ['torch', 4, 8, 6]] },
};

export function rollLoot(table: string, rng: () => number = Math.random): (ItemStack | null)[] {
  const t = T[table] ?? T.ruin;
  const slots: (ItemStack | null)[] = new Array(27).fill(null);
  const n = t.rolls[0] + Math.floor(rng() * (t.rolls[1] - t.rolls[0] + 1));
  const tot = t.e.reduce((a, e) => a + e[3], 0);
  for (let i = 0; i < n; i++) {
    let x = rng() * tot;
    const e = t.e.find((q) => (x -= q[3]) < 0) ?? t.e[0];
    const id = itemByKey(e[0]).id;
    const st: ItemStack = { id, count: Math.min(ITEMS[id].stack, e[1] + Math.floor(rng() * (e[2] - e[1] + 1))) };
    if (e[4]) { const offers = enchantOffers(st, 15, Math.floor(rng() * 1e9)); const o = offers[1 + Math.floor(rng() * 2)] ?? offers[0]; if (o && Object.keys(o.ench).length) st.ench = o.ench; }
    let slot = Math.floor(rng() * 27);
    for (let k = 0; k < 27 && slots[slot]; k++) slot = (slot + 7) % 27;
    slots[slot] = st;
  }
  return slots;
}
export const FISHING = {
  fish: [['raw_fish', 1]] as [string, number][],
  junk: [['stick', 1], ['bone', 1], ['string', 1], ['hide', 1], ['rotten_flesh', 1], ['bowl', 1], ['lily_pad', 1]] as [string, number][],
  treasure: [['saddle', 1], ['verdite', 1], ['bow', 1], ['fishing_rod', 1], ['gilded_apple', 1], ['diamond', 1]] as [string, number][],
};
