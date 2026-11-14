// Creature definitions (all original designs)
export type AI = 'passive' | 'melee' | 'ranged' | 'exploder' | 'flyer' | 'swim' | 'caster' | 'imp' | 'blob' | 'stalker' | 'guardian' | 'villager' | 'colossus' | 'sovereign';
export interface MobDrop { item: string; min: number; max: number; chance?: number; looting?: boolean }
export interface MobDef {
  key: string; name: string; model: string;
  hp: number; speed: number; dmg: number; w: number; h: number;
  hostile: boolean; ai: AI; voice: string; xp: number;
  drops: MobDrop[];
  burns?: boolean; breed?: string[]; ride?: boolean; shear?: boolean; milk?: boolean;
  fireImmune?: boolean; climbs?: boolean; knockResist?: number; detect?: number; attackCd?: number;
  flying?: boolean; aquatic?: boolean; boss?: boolean; neutralDay?: boolean; glow?: boolean;
}
const d = (o: MobDef) => o;
export const MOBS: Record<string, MobDef> = {
  grazer: d({ key: 'grazer', name: 'Grazer', model: 'grazer', hp: 10, speed: 1.9, dmg: 0, w: 0.45, h: 1.4, hostile: false, ai: 'passive', voice: 'low', xp: 2, drops: [{ item: 'raw_grazer', min: 1, max: 3, looting: true }, { item: 'hide', min: 0, max: 2 }], breed: ['wheat'], milk: true }),
  fluffer: d({ key: 'fluffer', name: 'Fluffer', model: 'fluffer', hp: 8, speed: 1.9, dmg: 0, w: 0.45, h: 1.3, hostile: false, ai: 'passive', voice: 'bleat', xp: 2, drops: [{ item: 'raw_mutton', min: 1, max: 2, looting: true }], breed: ['wheat'], shear: true }),
  snoutling: d({ key: 'snoutling', name: 'Snoutling', model: 'snoutling', hp: 10, speed: 2.1, dmg: 0, w: 0.45, h: 0.9, hostile: false, ai: 'passive', voice: 'grunt', xp: 2, drops: [{ item: 'raw_pork', min: 1, max: 3, looting: true }], breed: ['carrot', 'potato', 'beetroot'] }),
  cluckit: d({ key: 'cluckit', name: 'Cluckit', model: 'cluckit', hp: 4, speed: 1.9, dmg: 0, w: 0.22, h: 0.7, hostile: false, ai: 'passive', voice: 'chirp', xp: 1, drops: [{ item: 'raw_chicken', min: 1, max: 1 }, { item: 'feather', min: 0, max: 2, looting: true }], breed: ['wheat_seeds', 'beetroot_seeds'] }),
  steed: d({ key: 'steed', name: 'Steed', model: 'steed', hp: 24, speed: 3.6, dmg: 0, w: 0.65, h: 1.6, hostile: false, ai: 'passive', voice: 'neigh', xp: 3, drops: [{ item: 'hide', min: 0, max: 2 }], breed: ['gilded_apple', 'golden_carrot'], ride: true }),
  burrowkin: d({ key: 'burrowkin', name: 'Burrowkin', model: 'burrowkin', hp: 3, speed: 2.8, dmg: 0, w: 0.22, h: 0.5, hostile: false, ai: 'passive', voice: 'squeak', xp: 1, drops: [{ item: 'raw_rabbit', min: 0, max: 1 }, { item: 'hide', min: 0, max: 1 }, { item: 'rabbit_foot', min: 1, max: 1, chance: 0.1 }], breed: ['carrot'] }),
  finling: d({ key: 'finling', name: 'Finling', model: 'finling', hp: 3, speed: 2.2, dmg: 0, w: 0.25, h: 0.4, hostile: false, ai: 'swim', voice: 'squeak', xp: 1, drops: [{ item: 'raw_fish', min: 1, max: 1 }], aquatic: true }),
  frostfox: d({ key: 'frostfox', name: 'Frostfox', model: 'frostfox', hp: 10, speed: 3.0, dmg: 0, w: 0.3, h: 0.7, hostile: false, ai: 'passive', voice: 'squeak', xp: 2, drops: [{ item: 'hide', min: 0, max: 1 }], breed: ['sunberries'] }),
  miretoad: d({ key: 'miretoad', name: 'Miretoad', model: 'miretoad', hp: 6, speed: 1.6, dmg: 0, w: 0.3, h: 0.5, hostile: false, ai: 'passive', voice: 'low', xp: 1, drops: [{ item: 'gum', min: 0, max: 2, looting: true }], breed: ['raw_fish'] }),
  sporeback: d({ key: 'sporeback', name: 'Sporeback', model: 'sporeback', hp: 12, speed: 1.5, dmg: 0, w: 0.45, h: 0.8, hostile: false, ai: 'passive', voice: 'chitter', xp: 2, drops: [{ item: 'mushroom_red', min: 0, max: 2 }, { item: 'mushroom_brown', min: 0, max: 2 }], breed: ['wheat'], shear: true }),

  shambler: d({ key: 'shambler', name: 'Shambler', model: 'shambler', hp: 20, speed: 2.1, dmg: 3, w: 0.3, h: 1.85, hostile: true, ai: 'melee', voice: 'groan', xp: 5, drops: [{ item: 'rotten_flesh', min: 0, max: 2, looting: true }, { item: 'iron_ingot', min: 1, max: 1, chance: 0.025 }, { item: 'carrot', min: 1, max: 1, chance: 0.025 }, { item: 'potato', min: 1, max: 1, chance: 0.025 }], burns: true }),
  fusebloom: d({ key: 'fusebloom', name: 'Fusebloom', model: 'fusebloom', hp: 20, speed: 2.0, dmg: 0, w: 0.35, h: 1.5, hostile: true, ai: 'exploder', voice: 'hiss', xp: 5, drops: [{ item: 'blast_powder', min: 0, max: 2, looting: true }, { item: 'flower_red', min: 0, max: 1 }] }),
  rattler: d({ key: 'rattler', name: 'Rattler', model: 'rattler', hp: 20, speed: 2.1, dmg: 3, w: 0.3, h: 1.95, hostile: true, ai: 'ranged', voice: 'rattle', xp: 5, drops: [{ item: 'bone', min: 0, max: 2, looting: true }, { item: 'arrow', min: 0, max: 2, looting: true }, { item: 'bow', min: 1, max: 1, chance: 0.05 }], burns: true }),
  skitterfang: d({ key: 'skitterfang', name: 'Skitterfang', model: 'skitterfang', hp: 16, speed: 3.0, dmg: 2, w: 0.65, h: 0.8, hostile: true, ai: 'melee', voice: 'chitter', xp: 5, drops: [{ item: 'string', min: 0, max: 2, looting: true }, { item: 'spider_eye', min: 1, max: 1, chance: 0.33 }], climbs: true, neutralDay: true }),
  brute: d({ key: 'brute', name: 'Gravemaw Brute', model: 'brute', hp: 60, speed: 1.7, dmg: 9, w: 0.7, h: 2.7, hostile: true, ai: 'melee', voice: 'brute', xp: 20, drops: [{ item: 'iron_ingot', min: 1, max: 3 }, { item: 'cobblestone', min: 2, max: 6 }, { item: 'diamond', min: 1, max: 1, chance: 0.1 }], knockResist: 0.8, attackCd: 1.6 }),
  wisp: d({ key: 'wisp', name: 'Cave Wisp', model: 'wisp', hp: 8, speed: 3.0, dmg: 2, w: 0.25, h: 0.5, hostile: true, ai: 'flyer', voice: 'wisp', xp: 3, drops: [{ item: 'lumen_dust', min: 0, max: 1 }], flying: true, glow: true }),
  hexwarden: d({ key: 'hexwarden', name: 'Hexwarden', model: 'hexwarden', hp: 40, speed: 2.0, dmg: 6, w: 0.35, h: 2.0, hostile: true, ai: 'caster', voice: 'crystal', xp: 30, drops: [{ item: 'verdite', min: 1, max: 3 }, { item: 'azurite', min: 2, max: 6 }, { item: 'gilded_apple', min: 1, max: 1, chance: 0.1 }], detect: 24 }),
  cinder_imp: d({ key: 'cinder_imp', name: 'Cinder Imp', model: 'cinder_imp', hp: 14, speed: 3.2, dmg: 4, w: 0.3, h: 1.1, hostile: true, ai: 'imp', voice: 'imp', xp: 10, drops: [{ item: 'ember_dust', min: 0, max: 2, looting: true }], fireImmune: true, flying: true, detect: 28 }),
  ashen_knight: d({ key: 'ashen_knight', name: 'Ashen Knight', model: 'ashen_knight', hp: 30, speed: 2.4, dmg: 7, w: 0.35, h: 2.0, hostile: true, ai: 'melee', voice: 'groan', xp: 10, drops: [{ item: 'gold_ingot', min: 0, max: 1 }, { item: 'cinderite_scrap', min: 1, max: 1, chance: 0.12 }, { item: 'bone', min: 0, max: 2 }], fireImmune: true }),
  emberling: d({ key: 'emberling', name: 'Emberling', model: 'emberling', hp: 6, speed: 2.4, dmg: 3, w: 0.3, h: 0.5, hostile: true, ai: 'blob', voice: 'hiss', xp: 3, drops: [{ item: 'ember_dust', min: 0, max: 1 }], fireImmune: true }),
  voidstalker: d({ key: 'voidstalker', name: 'Voidstalker', model: 'voidstalker', hp: 40, speed: 2.6, dmg: 7, w: 0.4, h: 2.2, hostile: true, ai: 'stalker', voice: 'crystal', xp: 10, drops: [{ item: 'void_shard', min: 0, max: 1, looting: true }, { item: 'starmetal_shard', min: 1, max: 1, chance: 0.06 }], flying: true, detect: 24 }),
  stoneward: d({ key: 'stoneward', name: 'Stoneward', model: 'stoneward', hp: 100, speed: 1.6, dmg: 12, w: 0.7, h: 2.6, hostile: false, ai: 'guardian', voice: 'brute', xp: 0, drops: [{ item: 'iron_ingot', min: 2, max: 4 }, { item: 'lantern', min: 0, max: 1 }], knockResist: 1, attackCd: 1.2 }),
  wayfolk: d({ key: 'wayfolk', name: 'Wayfolk', model: 'wayfolk', hp: 20, speed: 1.8, dmg: 0, w: 0.3, h: 1.6, hostile: false, ai: 'villager', voice: 'folk', xp: 0, drops: [] }),
  colossus: d({ key: 'colossus', name: 'Magma Colossus', model: 'colossus', hp: 360, speed: 1.6, dmg: 12, w: 1.3, h: 4.6, hostile: true, ai: 'colossus', voice: 'boss', xp: 150, drops: [{ item: 'ember_core', min: 1, max: 1 }, { item: 'cinderite_scrap', min: 2, max: 4 }, { item: 'diamond', min: 2, max: 5 }], fireImmune: true, boss: true, knockResist: 1, detect: 40 }),
  sovereign: d({ key: 'sovereign', name: 'Shard Sovereign', model: 'sovereign', hp: 600, speed: 4, dmg: 10, w: 1.4, h: 3.2, hostile: true, ai: 'sovereign', voice: 'boss', xp: 500, drops: [{ item: 'sovereign_heart', min: 1, max: 1 }, { item: 'void_shard', min: 4, max: 8 }], fireImmune: true, flying: true, boss: true, knockResist: 1, detect: 120 }),
};

/** Wayfolk professions and their trades: [give item, give count, receive item, receive count] */
export const PROFESSIONS: Record<string, { name: string; robe: string; trades: [string, number, string, number][] }> = {
  farmer: { name: 'Farmer', robe: '#8a6a3a', trades: [['wheat', 20, 'verdite', 1], ['potato', 22, 'verdite', 1], ['verdite', 1, 'bread', 6], ['verdite', 1, 'apple', 4], ['pumpkin', 6, 'verdite', 1], ['verdite', 3, 'golden_carrot', 3]] },
  shepherd: { name: 'Shepherd', robe: '#e8e4d8', trades: [['wool_white', 16, 'verdite', 1], ['verdite', 1, 'shears', 1], ['verdite', 1, 'wool_blue', 1], ['verdite', 1, 'wool_red', 1], ['verdite', 3, 'bed', 1]] },
  butcher: { name: 'Butcher', robe: '#a83a2a', trades: [['raw_chicken', 14, 'verdite', 1], ['raw_pork', 7, 'verdite', 1], ['verdite', 1, 'cooked_grazer', 4], ['coal', 15, 'verdite', 1], ['verdite', 1, 'cooked_pork', 5]] },
  smith: { name: 'Smith', robe: '#3a3a40', trades: [['coal', 15, 'verdite', 1], ['iron_ingot', 4, 'verdite', 1], ['verdite', 5, 'iron_pickaxe', 1], ['verdite', 7, 'iron_chest', 1], ['verdite', 9, 'iron_sword', 1], ['diamond', 1, 'verdite', 2], ['verdite', 18, 'diamond_pickaxe', 1], ['verdite', 4, 'shield', 1]] },
  librarian: { name: 'Lorekeeper', robe: '#3a4a8a', trades: [['paper', 24, 'verdite', 1], ['book', 4, 'verdite', 1], ['verdite', 9, 'bookshelf', 1], ['verdite', 1, 'lantern', 1], ['verdite', 5, 'azurite', 12], ['verdite', 15, 'enchanting_table', 1]] },
  cartographer: { name: 'Pathfinder', robe: '#2a6a5a', trades: [['paper', 24, 'verdite', 1], ['verdite', 1, 'boat', 1], ['verdite', 3, 'saddle', 1], ['verdite', 2, 'lead', 2], ['verdite', 6, 'starmetal_shard', 1], ['verdite', 8, 'gilded_apple', 1]] },
  herder: { name: 'Herder', robe: '#5a7a3a', trades: [['hide', 6, 'verdite', 1], ['verdite', 2, 'saddle', 1], ['verdite', 1, 'lead', 1], ['verdite', 1, 'wheat', 12], ['verdite', 4, 'leather_chest', 1]] },
};
