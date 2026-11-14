import { Simplex, smoothstep, lerp } from '../noise';
import { SEA_LEVEL } from '../../constants';

export const enum Bi {
  Ocean, DeepOcean, FrozenOcean, Beach, River, Plains, Forest, BirchForest, SnowyForest, Tundra,
  Desert, Savanna, Jungle, Swamp, Mountains, Badlands, Mushroom, Meadow,
}

export interface BiomeDef {
  key: string;
  name: string;
  trees: [string, number][]; // species weights
  treeChance: number; // per column
  grass: number;
  flowers: string[];
  flowerChance: number;
  snow: boolean;
  animals: string[];
  sky: [number, number, number];
  fog: [number, number, number];
  water?: [number, number, number];
}

export const BIOMES: BiomeDef[] = [];
const b = (key: string, name: string, o: Partial<BiomeDef>) => BIOMES.push({
  key, name, trees: [], treeChance: 0, grass: 0, flowers: [], flowerChance: 0, snow: false, animals: [],
  sky: [0.55, 0.74, 0.95], fog: [0.75, 0.84, 0.95], ...o,
});
b('ocean', 'Ocean', { animals: ['finling'] });
b('deep_ocean', 'Deep Ocean', { animals: ['finling'], fog: [0.6, 0.72, 0.88] });
b('frozen_ocean', 'Frozen Ocean', { snow: true, animals: ['finling'], sky: [0.66, 0.76, 0.92] });
b('beach', 'Shoreline', { grass: 0, animals: [] });
b('river', 'River', { animals: ['finling'], grass: 0.05 });
b('plains', 'Grassland', { trees: [['oak', 1]], treeChance: 0.0015, grass: 0.35, flowers: ['flower_yellow', 'flower_red', 'flower_white', 'flower_orange'], flowerChance: 0.02, animals: ['grazer', 'fluffer', 'snoutling', 'cluckit', 'steed'] });
b('forest', 'Oakwood', { trees: [['oak', 4], ['birch', 1]], treeChance: 0.035, grass: 0.15, flowers: ['flower_red', 'flower_yellow'], flowerChance: 0.008, animals: ['snoutling', 'cluckit', 'fluffer', 'burrowkin'] });
b('birch_forest', 'Silverbirch Grove', { trees: [['birch', 1]], treeChance: 0.03, grass: 0.2, flowers: ['flower_white', 'flower_purple'], flowerChance: 0.01, animals: ['burrowkin', 'cluckit'] });
b('snowy_forest', 'Pinefrost Woods', { trees: [['pine', 1]], treeChance: 0.03, grass: 0.06, snow: true, animals: ['frostfox', 'burrowkin', 'fluffer'], sky: [0.66, 0.76, 0.92] });
b('tundra', 'Tundra', { trees: [['pine', 1]], treeChance: 0.0015, grass: 0.03, snow: true, animals: ['frostfox', 'burrowkin'], sky: [0.7, 0.78, 0.92] });
b('desert', 'Dunes', { grass: 0, animals: ['burrowkin'], sky: [0.66, 0.78, 0.95], fog: [0.9, 0.86, 0.76] });
b('savanna', 'Savanna', { trees: [['thorn', 1]], treeChance: 0.0035, grass: 0.4, flowers: ['flower_orange'], flowerChance: 0.004, animals: ['grazer', 'steed', 'snoutling'], fog: [0.88, 0.85, 0.72] });
b('jungle', 'Teak Jungle', { trees: [['teak', 3], ['oak', 1]], treeChance: 0.06, grass: 0.45, flowers: ['flower_red', 'flower_orange'], flowerChance: 0.01, animals: ['cluckit', 'snoutling'], fog: [0.7, 0.85, 0.75] });
b('swamp', 'Mirefen', { trees: [['willow', 1]], treeChance: 0.006, grass: 0.25, flowers: ['flower_purple', 'flower_blue'], flowerChance: 0.006, animals: ['miretoad', 'cluckit'], fog: [0.55, 0.62, 0.5], water: [0.3, 0.38, 0.3] });
b('mountains', 'Highcrags', { trees: [['pine', 1]], treeChance: 0.004, grass: 0.06, animals: ['fluffer', 'steed'], sky: [0.6, 0.76, 0.98] });
b('badlands', 'Rustlands', { grass: 0, animals: [], sky: [0.7, 0.75, 0.9], fog: [0.88, 0.7, 0.55] });
b('mushroom', 'Sporefields', { grass: 0, animals: ['sporeback'], sky: [0.7, 0.66, 0.85], fog: [0.75, 0.7, 0.82] });
b('meadow', 'Bloommeadow', { trees: [['birch', 1], ['oak', 1]], treeChance: 0.0008, grass: 0.5, flowers: ['flower_blue', 'flower_purple', 'flower_white', 'flower_yellow', 'flower_red'], flowerChance: 0.08, animals: ['fluffer', 'burrowkin', 'steed'] });

export interface Column { h: number; biome: Bi; river: boolean; temp: number; hum: number }

export class Terrain {
  private c: Simplex; private e: Simplex; private r: Simplex; private d: Simplex; private t: Simplex; private m: Simplex; private w: Simplex; private rv: Simplex;
  constructor(public seed: number) {
    this.c = new Simplex(seed ^ 0x1111);
    this.e = new Simplex(seed ^ 0x2222);
    this.r = new Simplex(seed ^ 0x3333);
    this.d = new Simplex(seed ^ 0x4444);
    this.t = new Simplex(seed ^ 0x5555);
    this.m = new Simplex(seed ^ 0x6666);
    this.w = new Simplex(seed ^ 0x7777);
    this.rv = new Simplex(seed ^ 0x8888);
  }
  sample(x: number, z: number): Column {
    const cont = this.c.fbm2(x / 760, z / 760, 4) * 1.3 + 0.12;
    const ero = this.e.fbm2(x / 380, z / 380, 3);
    const ridgeN = this.r.fbm2(x / 280, z / 280, 4);
    const ridge = 1 - Math.abs(ridgeN) * 1.8;
    const det = this.d.fbm2(x / 70, z / 70, 3);
    const land = smoothstep(-0.36, -0.22, cont);
    let h: number;
    if (cont < -0.3) h = SEA_LEVEL + (cont + 0.3) * 70; // ocean floor
    else h = SEA_LEVEL + 1 + smoothstep(-0.3, -0.18, cont) * 2 + Math.max(0, cont) * 16;
    h += det * (4 + 9 * smoothstep(0.5, -0.4, ero)) * land;
    const mount = smoothstep(0.35, 0.9, ridge) * smoothstep(-0.05, 0.35, cont) * smoothstep(0.35, -0.25, ero);
    h += mount * 52;
    // rivers
    const rvn = Math.abs(this.rv.fbm2(x / 520, z / 520, 2));
    let river = false;
    if (land > 0.5 && rvn < 0.04 && h < 92) {
      const k = smoothstep(0.04, 0.0, rvn);
      h = lerp(h, SEA_LEVEL - 3, k);
      river = k > 0.45;
    }
    h = Math.max(6, Math.min(122, Math.round(h)));
    const temp = this.t.fbm2(x / 1000, z / 1000, 3) * 1.7 - Math.max(0, h - 92) / 40;
    const hum = this.m.fbm2(x / 900, z / 900, 3) * 1.7;
    const weird = this.w.fbm2(x / 600, z / 600, 3);
    let biome: Bi;
    if (h < SEA_LEVEL - 1 && !river) biome = temp < -0.55 ? Bi.FrozenOcean : h < 44 ? Bi.DeepOcean : Bi.Ocean;
    else if (river) biome = Bi.River;
    else if (h <= SEA_LEVEL + 2 && cont < -0.16) biome = temp < -0.55 ? Bi.Tundra : Bi.Beach;
    else if (weird > 0.62 && cont < 0.1) biome = Bi.Mushroom;
    else if (h > 96 || mount > 0.55) biome = Bi.Mountains;
    else if (temp > 0.42 && hum < -0.25 && weird > 0.15) biome = Bi.Badlands;
    else if (temp > 0.4 && hum < -0.05) biome = Bi.Desert;
    else if (temp > 0.3 && hum > 0.38) biome = Bi.Jungle;
    else if (temp > 0.28) biome = Bi.Savanna;
    else if (temp > -0.1 && hum > 0.35 && h < SEA_LEVEL + 6) biome = Bi.Swamp;
    else if (temp < -0.4) biome = hum > 0 ? Bi.SnowyForest : Bi.Tundra;
    else if (hum > 0.1) biome = weird < -0.35 ? Bi.BirchForest : Bi.Forest;
    else if (weird < -0.45) biome = Bi.Meadow;
    else biome = Bi.Plains;
    return { h, biome, river, temp, hum };
  }
}
