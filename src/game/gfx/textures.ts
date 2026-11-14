// Procedural pixel-art for every tile and item icon. All artwork is generated here.
import { TILE_NAMES, BLOCKS, faceTile, SHAPE, WOODS } from '../registry/blocks';
import { ITEMS, POTIONS, type ItemStack } from '../registry/items';
import { mulberry, hash32 } from '../world/noise';

export const TS = 16;
type RGB = [number, number, number];
type Px = (x: number, y: number) => [number, number, number, number] | RGB | null;

const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mul = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

class Tile {
  d = new Uint8ClampedArray(TS * TS * 4);
  r: () => number;
  constructor(seed: number) { this.r = mulberry(seed); }
  px(x: number, y: number, c: RGB, a = 255) {
    if (x < 0 || y < 0 || x >= TS || y >= TS) return;
    const i = (y * TS + x) * 4;
    this.d[i] = c[0]; this.d[i + 1] = c[1]; this.d[i + 2] = c[2]; this.d[i + 3] = a;
  }
  get(x: number, y: number): RGB { const i = (y * TS + x) * 4; return [this.d[i], this.d[i + 1], this.d[i + 2]]; }
  alpha(x: number, y: number) { return this.d[(y * TS + x) * 4 + 3]; }
  fill(fn: Px) {
    for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) {
      const c = fn(x, y);
      if (c) this.px(x, y, [c[0], c[1], c[2]], c.length === 4 ? (c as number[])[3] : 255);
    }
    return this;
  }
  noise(base: RGB, amt = 0.12, chunky = 1) {
    const cache = new Map<number, number>();
    return this.fill((x, y) => {
      const k = Math.floor(x / chunky) * 100 + Math.floor(y / chunky);
      if (!cache.has(k)) cache.set(k, 1 - amt + this.r() * amt * 2);
      return mul(base, cache.get(k)!);
    });
  }
  speckle(c: RGB, chance: number, size = 1) {
    for (let y = 0; y < TS; y += size) for (let x = 0; x < TS; x += size) if (this.r() < chance)
      for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) this.px(x + dx, y + dy, mul(c, 0.9 + this.r() * 0.2));
    return this;
  }
  blobs(c: RGB, n: number, rmin = 1, rmax = 2) {
    for (let i = 0; i < n; i++) {
      const cx = this.r() * TS, cy = this.r() * TS, r = rmin + this.r() * (rmax - rmin);
      for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++)
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) this.px(((x % TS) + TS) % TS, ((y % TS) + TS) % TS, mul(c, 0.85 + this.r() * 0.3));
    }
    return this;
  }
  border(c: RGB, w = 1) { for (let i = 0; i < TS; i++) for (let k = 0; k < w; k++) { this.px(i, k, c); this.px(i, TS - 1 - k, c); this.px(k, i, c); this.px(TS - 1 - k, i, c); } return this; }
  clear() { this.d.fill(0); return this; }
  line(x0: number, y0: number, x1: number, y1: number, c: RGB, a = 255) {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) + 1;
    for (let i = 0; i < n; i++) { const t = n === 1 ? 0 : i / (n - 1); this.px(Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t), c, a); }
    return this;
  }
  rect(x0: number, y0: number, x1: number, y1: number, c: RGB | ((x: number, y: number) => RGB)) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.px(x, y, typeof c === 'function' ? c(x, y) : c);
    return this;
  }
}

const WOOD_COL: Record<string, { bark: RGB; plank: RGB; leaf: RGB; core: RGB }> = {
  oak: { bark: hex('#5e4426'), plank: hex('#a57a4a'), leaf: hex('#4c8a3a'), core: hex('#b88a55') },
  pine: { bark: hex('#3c2a1a'), plank: hex('#6e4c2c'), leaf: hex('#2f5e3c'), core: hex('#8a6440') },
  birch: { bark: hex('#dcd8cc'), plank: hex('#cdb98a'), leaf: hex('#78a85a'), core: hex('#d8c89c') },
  teak: { bark: hex('#5a4a2a'), plank: hex('#a86a44'), leaf: hex('#3a9a2e'), core: hex('#b87a52') },
  thorn: { bark: hex('#6a6058'), plank: hex('#b8603a'), leaf: hex('#7a9a3a'), core: hex('#c8704a') },
  willow: { bark: hex('#4a4a3a'), plank: hex('#8a8a5a'), leaf: hex('#6a9a5a'), core: hex('#a0a070') },
};
const DYE: Record<string, RGB> = { white: hex('#e8e8e8'), black: hex('#2a2a30'), red: hex('#b03a30'), orange: hex('#e07a24'), yellow: hex('#e8c02a'), green: hex('#4a8a2c'), blue: hex('#3058b8'), purple: hex('#7a3aa8') };

const STONE = hex('#7d7f86'), DIRT = hex('#7a573d'), GRASS = hex('#5f9a4a');

function ore(t: Tile, host: 'stone' | 'dark' | 'ember', c: RGB, glow = false) {
  paint(t, host === 'stone' ? 'stone' : host === 'dark' ? 'darkstone' : 'emberstone');
  for (let i = 0; i < 5; i++) {
    const cx = 2 + Math.floor(t.r() * 12), cy = 2 + Math.floor(t.r() * 12);
    const pts = [[0, 0], [1, 0], [0, 1], [1, 1], [-1, 0], [0, -1]].slice(0, 3 + Math.floor(t.r() * 3));
    for (const [dx, dy] of pts) t.px(cx + dx, cy + dy, mul(c, 0.8 + t.r() * 0.4));
    t.px(cx, cy, glow ? mix(c, [255, 255, 255], 0.5) : mul(c, 1.25));
  }
}
function plankTex(t: Tile, c: RGB) {
  t.fill((x, y) => {
    const row = Math.floor(y / 4);
    const seam = y % 4 === 3 || (x === (row * 7 + 3) % 16);
    const grain = Math.sin((x + row * 5) * 0.9) * 0.05;
    return mul(c, seam ? 0.7 : 0.95 + grain + (t.r() - 0.5) * 0.08);
  });
}
function bricksTex(t: Tile, brick: RGB, mortar: RGB, bw = 8, bh = 4) {
  t.fill((x, y) => {
    const row = Math.floor(y / bh);
    const off = row % 2 ? bw / 2 : 0;
    if (y % bh === bh - 1 || (x + off) % bw === bw - 1) return mul(mortar, 0.95 + t.r() * 0.1);
    return mul(brick, 0.88 + t.r() * 0.2);
  });
}
function plantSprite(t: Tile, stem: RGB, leaf: RGB, kind: 'grass' | 'fern' | 'bush' | 'sapling' | 'reed' | 'dead') {
  t.clear();
  const r = t.r;
  if (kind === 'grass' || kind === 'fern') {
    for (let i = 0; i < 9; i++) {
      const x = 1 + Math.floor(r() * 14), h = 5 + Math.floor(r() * 9);
      let xx = x;
      for (let y = 15; y > 15 - h; y--) { t.px(xx, y, mul(leaf, 0.75 + (15 - y) / h * 0.4)); if (kind === 'fern' && y % 3 === 0) { t.px(xx - 1, y, leaf); t.px(xx + 1, y, leaf); } if (r() < 0.25) xx += r() < 0.5 ? -1 : 1; }
    }
  } else if (kind === 'sapling') {
    t.line(8, 15, 8, 8, stem);
    for (let i = 0; i < 18; i++) t.px(5 + Math.floor(r() * 7), 3 + Math.floor(r() * 7), mul(leaf, 0.8 + r() * 0.4));
  } else if (kind === 'dead') {
    t.line(8, 15, 8, 9, stem); t.line(8, 11, 4, 6, stem); t.line(8, 10, 12, 5, stem); t.line(6, 8, 6, 4, stem); t.line(11, 7, 13, 7, stem);
  } else if (kind === 'reed') {
    for (const x of [3, 7, 11, 13]) { for (let y = 0; y < 16; y++) t.px(x, y, mul(leaf, y % 5 === 0 ? 0.75 : 1 + (x % 3) * 0.05)); t.px(x + 1, (x * 3) % 12 + 2, mul(leaf, 1.1)); }
  } else {
    for (let i = 0; i < 70; i++) { const x = Math.floor(r() * 16), y = 3 + Math.floor(r() * 13); t.px(x, y, mul(leaf, 0.7 + r() * 0.4)); }
  }
}
function flower(t: Tile, petal: RGB, center: RGB, style: number) {
  t.clear();
  const stem = hex('#3f7a2e');
  t.line(8, 15, 8, 7, stem); t.px(7, 11, stem); t.px(6, 10, stem); t.px(9, 12, stem); t.px(10, 11, stem);
  if (style === 0) { for (const [dx, dy] of [[0, -2], [-2, 0], [2, 0], [0, 2], [-1, -1], [1, -1], [-1, 1], [1, 1]]) t.px(8 + dx, 5 + dy, petal); t.px(8, 5, center); }
  else if (style === 1) { t.rect(6, 2, 10, 5, petal); t.px(6, 2, [0, 0, 0]); t.d[(2 * TS + 6) * 4 + 3] = 0; t.px(8, 4, center); t.px(8, 1, petal); }
  else if (style === 2) { for (let y = 1; y < 7; y++) t.px(8, y, mul(petal, 0.8 + y * 0.05)); for (const y of [2, 4]) { t.px(7, y, petal); t.px(9, y, petal); } t.px(8, 0, center); }
  else { t.rect(7, 3, 9, 6, petal); t.px(6, 4, petal); t.px(10, 4, petal); t.px(8, 2, petal); t.px(8, 5, center); }
}
function cropStage(t: Tile, key: string, stage: number, stages: number) {
  t.clear();
  const g = stage / (stages - 1);
  const leaf = mix(hex('#4a9a3a'), key === 'wheat_crop' ? hex('#c8a83a') : hex('#4a9a3a'), key === 'wheat_crop' ? g : 0);
  const h = 3 + Math.round(g * 11);
  for (const x of [2, 5, 8, 11, 14]) {
    for (let y = 15; y > 15 - h; y--) t.px(x, y, mul(leaf, 0.8 + (15 - y) / 30));
    if (key === 'wheat_crop' && stage >= stages - 2) { for (let y = 15 - h; y < 15 - h + 3; y++) { t.px(x - 1, y, hex('#d8b84a')); t.px(x + 1, y + 1, hex('#c8a83a')); } }
    if (key !== 'wheat_crop' && stage >= stages - 1) {
      const c = key === 'carrot_crop' ? hex('#ef8a1f') : key === 'potato_crop' ? hex('#c8a060') : hex('#9a1a3a');
      t.px(x, 15, c); t.px(x - 1, 14, c);
    }
  }
}

/* ------------------------------------------------------------------ tile painters */
function paint(t: Tile, name: string): void {
  const fam = /^(log_top|stripped_top|log|stripped|planks|leaves|sapling|wool|concrete)_(oak|pine|birch|teak|thorn|willow|white|black|red|orange|yellow|green|blue|purple)$/.exec(name);
  const [base, arg] = fam ? [fam[1], fam[2]] : [name, ''];
  const wc = WOOD_COL[arg];
  switch (base) {
    case 'grass_top': t.noise(GRASS, 0.14).speckle(hex('#76b85a'), 0.12).speckle(hex('#4a7e3a'), 0.1); return;
    case 'dirt': t.noise(DIRT, 0.14).speckle(hex('#94735a'), 0.06).speckle(hex('#5e4230'), 0.08); return;
    case 'grass_side': {
      paint(t, 'dirt');
      const depth = Array.from({ length: TS }, () => 2 + Math.floor(t.r() * 3));
      for (let x = 0; x < TS; x++) for (let y = 0; y < depth[x]; y++) t.px(x, y, mul(GRASS, 0.85 + t.r() * 0.3));
      return;
    }
    case 'stone': t.noise(STONE, 0.07).blobs(hex('#6c6e75'), 6, 1, 2).speckle(hex('#90939a'), 0.05); return;
    case 'smooth_stone': t.noise(hex('#9a9ca2'), 0.04).border(hex('#7e8086')); return;
    case 'cobblestone': t.fill((x, y) => {
      const cell = hash32(Math.floor((x + (y >> 2)) / 4), Math.floor(y / 4) + 31) % 5;
      const edge = (x + (y >> 2)) % 4 === 0 || y % 4 === 0;
      return mul(STONE, edge ? 0.62 : 0.82 + cell * 0.07 + (t.r() - 0.5) * 0.06);
    }); return;
    case 'mossy_cobblestone': paint(t, 'cobblestone'); t.blobs(hex('#4f7a3a'), 7, 1, 2.2); return;
    case 'darkstone': t.noise(hex('#4c4b56'), 0.08).fill((x, y) => (y % 5 === 0 && t.r() < 0.5 ? mul(hex('#3e3d47'), 1) : null)); return;
    case 'cobbled_darkstone': paint(t, 'cobblestone'); t.fill((x, y) => mul(t.get(x, y), 0.6)); return;
    case 'bedrock': t.noise(hex('#3a3a3e'), 0.3, 2).blobs(hex('#1e1e22'), 6, 1, 2.5); return;
    case 'sand': t.noise(hex('#dccb95'), 0.06).speckle(hex('#c4b07a'), 0.1); return;
    case 'red_sand': t.noise(hex('#b8642f'), 0.07).speckle(hex('#d07a40'), 0.1); return;
    case 'sandstone': t.fill((x, y) => mul(hex('#d8c48a'), y < 3 ? 1.05 : y > 12 ? 0.85 : 0.95 + (t.r() - 0.5) * 0.06)); t.line(0, 3, 15, 3, hex('#c0aa70')); return;
    case 'sandstone_top': t.noise(hex('#dccb95'), 0.04); return;
    case 'gravel': t.fill(() => mul(hex('#857a76'), 0.7 + t.r() * 0.5)).blobs(hex('#6a605c'), 6, 1, 1.6); return;
    case 'clay': t.noise(hex('#9aa3b5'), 0.06); return;
    case 'mud': t.noise(hex('#3e3530'), 0.12).speckle(hex('#55483f'), 0.1); return;
    case 'snow': t.noise(hex('#eef4f8'), 0.03).speckle(hex('#d8e4ee'), 0.08); return;
    case 'ice': t.fill((x, y) => [...mul(hex('#9cc8f0'), 0.92 + ((x + y) % 7 === 0 ? 0.15 : 0) + t.r() * 0.05), 200] as [number, number, number, number]); return;
    case 'packed_ice': t.noise(hex('#8ab8e8'), 0.05).line(2, 13, 13, 2, hex('#b8dcf8')); return;
    case 'water': case 'water_flow': t.fill((x, y) => [...mul(hex('#3a6fd0'), 0.85 + Math.sin((x + y * 2) * 0.7) * 0.08 + t.r() * 0.06), 255] as [number, number, number, number]); return;
    case 'lava': case 'lava_flow': t.fill((x, y) => { const v = Math.sin(x * 0.8) + Math.cos(y * 0.6 + x * 0.3); return mix(hex('#d04a10'), hex('#ffc040'), Math.max(0, Math.min(1, 0.4 + v * 0.3 + t.r() * 0.15))); }); return;
    case 'obsidian': t.noise(hex('#1c1428'), 0.2).speckle(hex('#3c2a5a'), 0.08); return;
    case 'terracotta': t.noise(hex('#9a5a42'), 0.05); return;
    case 'sporeturf_top': t.noise(hex('#7a6a8a'), 0.15).speckle(hex('#a890b8'), 0.15); return;
    case 'sporeturf_side': paint(t, 'dirt'); for (let x = 0; x < TS; x++) for (let y = 0; y < 2 + (x % 3); y++) t.px(x, y, mul(hex('#7a6a8a'), 0.9 + t.r() * 0.2)); return;
    case 'farmland': t.fill((x, y) => mul(hex('#5a3f2a'), y % 4 === 0 ? 0.7 : 0.95 + t.r() * 0.1)); return;
    case 'path_top': t.noise(hex('#9a7a4a'), 0.08); return;
    case 'path_side': paint(t, 'dirt'); t.rect(0, 0, 15, 1, hex('#9a7a4a')); return;
    case 'log_top': case 'stripped_top': {
      const bark = base === 'log_top' ? wc.bark : wc.core;
      t.fill((x, y) => { const d = Math.hypot(x - 7.5, y - 7.5); if (d > 6.8) return mul(bark, 0.9 + t.r() * 0.15); return mul(wc.core, Math.floor(d) % 2 ? 0.88 : 1.02); }); return;
    }
    case 'log': {
      if (arg === 'birch') { t.noise(wc.bark, 0.04); for (let i = 0; i < 7; i++) { const y = Math.floor(t.r() * 16), x = Math.floor(t.r() * 12); t.line(x, y, x + 2 + Math.floor(t.r() * 3), y, hex('#2e2a26')); } return; }
      t.fill((x) => mul(wc.bark, (x % 4 === 0 ? 0.72 : 0.95) + (t.r() - 0.5) * 0.12)); return;
    }
    case 'stripped': t.fill((x) => mul(wc.core, (x % 5 === 0 ? 0.88 : 1) + (t.r() - 0.5) * 0.06)); return;
    case 'planks': plankTex(t, wc.plank); return;
    case 'leaves': t.fill(() => (t.r() < 0.22 ? null : mul(wc.leaf, 0.65 + t.r() * 0.55))); return;
    case 'sapling': plantSprite(t, wc.bark, wc.leaf, 'sapling'); return;
    case 'wool': t.fill((x, y) => mul(DYE[arg], 0.9 + ((x + y * 3) % 5 === 0 ? -0.06 : 0) + t.r() * 0.06)); return;
    case 'concrete': t.noise(DYE[arg], 0.025); return;
    case 'terracotta_orange': case 'terracotta_red': case 'terracotta_yellow': case 'terracotta_white': return;
    case 'door_wood': plankTex(t, WOOD_COL.oak.plank); t.rect(3, 2, 6, 6, (x, y) => [0, 0, 0]); for (const [x, y] of [[3, 2], [4, 2], [5, 2], [6, 2], [3, 3], [4, 3], [5, 3], [6, 3], [3, 4], [4, 4], [5, 4], [6, 4], [3, 5], [4, 5], [5, 5], [6, 5]]) t.d[(y * TS + x) * 4 + 3] = 0; for (const x of [9, 10, 11, 12]) for (const y of [2, 3, 4, 5]) t.d[(y * TS + x) * 4 + 3] = 0; t.px(12, 9, hex('#3a3a3a')); t.border(mul(WOOD_COL.oak.plank, 0.65)); return;
    case 'door_iron': t.noise(hex('#c8ccd0'), 0.03).border(hex('#8f9399')); t.line(2, 4, 13, 4, hex('#8f9399')); t.line(2, 11, 13, 11, hex('#8f9399')); t.px(12, 8, hex('#3a3a3a')); return;
    case 'trapdoor_wood': plankTex(t, WOOD_COL.oak.plank); for (const [x, y] of [[4, 4], [5, 4], [10, 4], [11, 4], [4, 11], [5, 11], [10, 11], [11, 11], [4, 5], [5, 5], [10, 5], [11, 5]]) t.d[(y * TS + x) * 4 + 3] = 0; t.border(mul(WOOD_COL.oak.plank, 0.6)); return;
    case 'ladder': t.clear(); for (let y = 0; y < 16; y++) { t.px(2, y, WOOD_COL.oak.bark); t.px(13, y, WOOD_COL.oak.bark); } for (const y of [2, 6, 10, 14]) t.line(2, y, 13, y, mul(WOOD_COL.oak.plank, 0.85)); return;
    case 'stone_bricks': bricksTex(t, hex('#8a8c92'), hex('#5e6066'), 8, 8); return;
    case 'mossy_stone_bricks': paint(t, 'stone_bricks'); t.blobs(hex('#4f7a3a'), 5, 1, 2); return;
    case 'cracked_stone_bricks': paint(t, 'stone_bricks'); t.line(3, 0, 6, 7, hex('#4a4c52')); t.line(6, 7, 4, 15, hex('#4a4c52')); return;
    case 'bricks': bricksTex(t, hex('#9a4a36'), hex('#c8b8a8'), 8, 4); return;
    case 'glass': t.clear().border(hex('#d8eef4')); t.line(4, 11, 11, 4, hex('#f0fafc'), 200); t.line(5, 12, 12, 5, hex('#f0fafc'), 140); return;
    case 'iron_bars': t.clear(); for (const x of [1, 6, 9, 14]) for (let y = 0; y < 16; y++) t.px(x, y, hex('#9a9ea4')); t.line(0, 0, 15, 0, hex('#9a9ea4')); t.line(0, 15, 15, 15, hex('#9a9ea4')); return;
    case 'bookshelf': plankTex(t, WOOD_COL.oak.plank); for (const y0 of [1, 9]) for (let x = 1; x < 15; x++) { const c = [hex('#8a2a2a'), hex('#2a5a8a'), hex('#3a7a3a'), hex('#8a6a2a'), hex('#5a3a7a')][hash32(x, y0) % 5]; for (let y = y0; y < y0 + 6; y++) t.px(x, y, mul(c, x % 2 ? 0.9 : 1.05)); } return;
    case 'hay_top': t.fill((x, y) => mul(hex('#c8a83a'), ((x * 3 + y) % 5 === 0 ? 0.75 : 1) * (0.9 + t.r() * 0.15))); t.border(hex('#8a6a2a')); return;
    case 'hay_side': t.fill((x, y) => mul(hex('#c8a83a'), (x % 3 === 0 ? 0.8 : 1) * (0.9 + t.r() * 0.15))); t.line(0, 4, 15, 4, hex('#7a3a2a')); t.line(0, 11, 15, 11, hex('#7a3a2a')); return;
    case 'torch': t.clear(); for (let y = 6; y < 16; y++) t.px(7, y, WOOD_COL.oak.bark), t.px(8, y, WOOD_COL.oak.plank); t.rect(7, 3, 8, 5, hex('#ffd85a')); t.px(7, 2, hex('#fff0a0')); t.px(8, 4, hex('#ff8a2a')); return;
    case 'lantern': t.clear().rect(4, 3, 11, 15, (x, y) => (x === 4 || x === 11 || y === 3 || y === 15 ? hex('#3a3a40') : mix(hex('#ffcf4a'), hex('#fff4c0'), 1 - Math.abs(x - 7.5) / 4))); return;
    case 'lumen': t.fill(() => mix(hex('#c89a2a'), hex('#fff0a0'), t.r())).blobs(hex('#fffad0'), 4, 1, 1.5); return;
    case 'bed_top': t.fill((x, y) => (y < 5 ? mul(hex('#f0f0f0'), 0.95 + t.r() * 0.05) : mul(hex('#a83a3a'), 0.9 + t.r() * 0.1))); return;
    case 'bed_side': t.fill((x, y) => (y < 6 ? mul(hex('#a83a3a'), 0.9) : y < 10 ? mul(WOOD_COL.oak.plank, 0.9) : null)); return;
    case 'coal_ore': ore(t, 'stone', hex('#25252a')); return;
    case 'copper_ore': ore(t, 'stone', hex('#d27a4a')); t.blobs(hex('#4aa088'), 2, 0.6, 1); return;
    case 'iron_ore': ore(t, 'stone', hex('#d8b49a')); return;
    case 'gold_ore': ore(t, 'stone', hex('#f6d23a')); return;
    case 'pulsite_ore': ore(t, 'stone', hex('#e02a2a'), true); return;
    case 'azurite_ore': ore(t, 'stone', hex('#2f4fbf')); return;
    case 'diamond_ore': ore(t, 'stone', hex('#5ee8e0'), true); return;
    case 'verdite_ore': ore(t, 'stone', hex('#2bb05d'), true); return;
    case 'starmetal_ore': ore(t, 'dark', hex('#b8a0ff'), true); return;
    case 'cinderite_ore': t.fill((x, y) => mul(hex('#4a3434'), (y % 3 === 0 ? 0.75 : 1) * (0.9 + t.r() * 0.2))); t.blobs(hex('#c87a5a'), 3, 1, 1.5); t.border(hex('#2e1e1e')); return;
    case 'flarequartz_ore': ore(t, 'ember', hex('#f4ecdc'), true); return;
    case 'coal_block': t.noise(hex('#202024'), 0.15).border(hex('#121214')); return;
    case 'copper_block': t.noise(hex('#c4683c'), 0.06).border(hex('#8f4a28')); t.line(2, 2, 13, 2, hex('#e8946a')); return;
    case 'iron_block': t.noise(hex('#d8dbde'), 0.03).border(hex('#a8acb2')); t.line(2, 2, 13, 2, hex('#f4f6f8')); return;
    case 'gold_block': t.noise(hex('#f0c42a'), 0.05).border(hex('#c09018')); t.line(2, 2, 13, 2, hex('#fff0a0')); return;
    case 'diamond_block': t.noise(hex('#5ee8e0'), 0.05).border(hex('#2a9e98')); t.line(2, 2, 13, 2, hex('#d8fffc')); return;
    case 'azurite_block': t.noise(hex('#2f4fbf'), 0.12).speckle(hex('#8faaf8'), 0.05); return;
    case 'verdite_block': t.noise(hex('#2bb05d'), 0.06).border(hex('#1a7a3a')); t.line(2, 2, 13, 2, hex('#a5f3b8')); return;
    case 'pulsite_block': t.noise(hex('#b02020'), 0.12).speckle(hex('#ff6a5a'), 0.12).border(hex('#701010')); return;
    case 'workbench_top': plankTex(t, WOOD_COL.oak.plank); t.border(WOOD_COL.oak.bark); t.line(1, 7, 14, 7, mul(WOOD_COL.oak.plank, 0.6)); t.line(7, 1, 7, 14, mul(WOOD_COL.oak.plank, 0.6)); return;
    case 'workbench_side': plankTex(t, WOOD_COL.oak.plank); t.rect(2, 2, 5, 6, hex('#8f9399')); t.line(3, 7, 3, 12, WOOD_COL.oak.bark); t.rect(9, 3, 13, 5, hex('#8f9399')); t.line(11, 6, 11, 12, WOOD_COL.oak.bark); return;
    case 'workbench_front': paint(t, 'workbench_side'); t.line(1, 13, 14, 13, WOOD_COL.oak.bark); return;
    case 'furnace_top': t.noise(hex('#8a8c90'), 0.06).border(hex('#5e6066')); return;
    case 'furnace_side': paint(t, 'cobblestone'); return;
    case 'furnace_front': case 'furnace_front_lit': paint(t, 'cobblestone'); t.rect(4, 8, 11, 13, base === 'furnace_front_lit' ? (x, y) => mix(hex('#ff6a1a'), hex('#ffd060'), (y - 8) / 6) : hex('#1a1a1e')); t.line(3, 4, 12, 4, hex('#4a4c52')); return;
    case 'smoker_top': plankTex(t, WOOD_COL.pine.plank); t.rect(5, 5, 10, 10, hex('#2a2a2e')); return;
    case 'smoker_side': t.fill((x, y) => mul(y < 4 || y > 11 ? WOOD_COL.pine.bark : hex('#6a6c70'), 0.9 + t.r() * 0.15)); return;
    case 'smoker_front': case 'smoker_front_lit': paint(t, 'smoker_side'); t.rect(4, 6, 11, 10, base.endsWith('lit') ? hex('#ff8a2a') : hex('#1a1a1e')); return;
    case 'blast_top': t.noise(hex('#6a6c72'), 0.05).rect(4, 4, 11, 11, hex('#3a3c42')); return;
    case 'blast_side': t.fill((x, y) => mul(hex('#5e6066'), (y % 4 === 0 ? 0.7 : 1) * (0.9 + t.r() * 0.15))); t.border(hex('#9a9ca2')); return;
    case 'blast_front': case 'blast_front_lit': paint(t, 'blast_side'); t.rect(4, 7, 11, 12, base.endsWith('lit') ? hex('#ff5a1a') : hex('#1a1a1e')); for (const x of [6, 9]) t.line(x, 7, x, 12, hex('#5e6066')); return;
    case 'chest_top': plankTex(t, hex('#9a6a32')); t.border(hex('#5a3a18')); return;
    case 'chest_side': plankTex(t, hex('#9a6a32')); t.border(hex('#5a3a18')); t.line(1, 5, 14, 5, hex('#5a3a18')); return;
    case 'chest_front': paint(t, 'chest_side'); t.rect(7, 4, 8, 7, hex('#d8dbde')); return;
    case 'anvil': t.noise(hex('#4a4c52'), 0.08).border(hex('#2e3036')); return;
    case 'altar_top': t.noise(hex('#7a2a3a'), 0.08).border(hex('#3a1020')); t.rect(5, 5, 10, 10, hex('#3a2a6a')); t.px(7, 7, hex('#a8f0ff')); t.px(8, 8, hex('#a8f0ff')); return;
    case 'altar_side': t.fill((x, y) => (y < 4 ? mul(hex('#7a2a3a'), 0.9 + t.r() * 0.1) : mul(hex('#1c1428'), 0.8 + t.r() * 0.4))); for (let x = 2; x < 14; x += 3) t.px(x, 9, hex('#6ae0f0')); return;
    case 'brew_top': t.clear(); t.rect(6, 6, 9, 9, hex('#c8a83a')); return;
    case 'brew_side': t.clear(); t.line(7, 0, 7, 15, hex('#c8a83a')); t.line(8, 0, 8, 15, hex('#a08020')); for (const x of [2, 12]) t.rect(x, 9, x + 2, 14, hex('#cfe8f0')); return;
    case 'dispenser_front': paint(t, 'cobblestone'); t.rect(5, 5, 10, 10, hex('#1a1a1e')); t.rect(6, 6, 9, 9, hex('#3a3a3e')); return;
    case 'hopper_top': t.noise(hex('#4a4c52'), 0.06).rect(3, 3, 12, 12, hex('#1e1e22')); return;
    case 'hopper_side': t.noise(hex('#4a4c52'), 0.08).border(hex('#2e3036')); return;
    case 'pulse_wire': case 'pulse_wire_on': { t.clear(); const c = base === 'pulse_wire_on' ? hex('#ff3a2a') : hex('#6a1010'); t.rect(6, 6, 9, 9, c); t.rect(7, 0, 8, 15, c); t.rect(0, 7, 15, 8, c); return; }
    case 'pulse_torch_on': case 'pulse_torch_off': t.clear(); for (let y = 6; y < 16; y++) t.px(7, y, WOOD_COL.oak.bark), t.px(8, y, WOOD_COL.oak.plank); t.rect(7, 3, 8, 5, base.endsWith('on') ? hex('#ff3a2a') : hex('#5a1a1a')); return;
    case 'repeater_top': t.noise(hex('#a0a2a8'), 0.04); t.line(7, 1, 7, 14, hex('#8a1a1a')); t.line(8, 1, 8, 14, hex('#8a1a1a')); t.px(7, 0, hex('#c8c8c8')); return;
    case 'comparator_top': t.noise(hex('#a0a2a8'), 0.04); t.line(4, 2, 4, 13, hex('#8a1a1a')); t.line(11, 2, 11, 13, hex('#8a1a1a')); t.line(4, 8, 11, 8, hex('#8a1a1a')); return;
    case 'lamp_off': t.noise(hex('#5a3a2a'), 0.1).border(hex('#3a2418')); t.rect(4, 4, 11, 11, hex('#6a4a30')); return;
    case 'lamp_on': t.noise(hex('#e8a83a'), 0.1).border(hex('#8a5a28')); t.rect(4, 4, 11, 11, hex('#fff0b0')); return;
    case 'piston_top': case 'piston_top_sticky': plankTex(t, WOOD_COL.oak.plank); t.border(hex('#8f9399')); if (base.endsWith('sticky')) t.blobs(hex('#6fbf4f'), 4, 1.5, 3); return;
    case 'piston_bottom': paint(t, 'cobblestone'); t.rect(6, 6, 9, 9, hex('#8f9399')); return;
    case 'piston_side': t.fill((x, y) => (y < 4 ? mul(WOOD_COL.oak.plank, 0.95 + t.r() * 0.08) : mul(STONE, 0.75 + t.r() * 0.2))); t.line(0, 4, 15, 4, hex('#8f9399')); return;
    case 'keg_top': plankTex(t, hex('#7a5030')); t.rect(5, 5, 10, 10, hex('#2a2a2e')); t.px(7, 7, hex('#e0e0e0')); return;
    case 'keg_side': t.fill((x, y) => mul(hex('#8a5a30'), (x % 4 === 0 ? 0.75 : 1) * (0.9 + t.r() * 0.1))); for (const y of [2, 13]) t.line(0, y, 15, y, hex('#3a3a40')); t.rect(3, 6, 12, 9, hex('#c8c8c0')); t.line(4, 7, 11, 7, hex('#a02020')); return;
    case 'rail': t.clear(); for (let y = 0; y < 16; y += 3) t.line(1, y, 14, y, WOOD_COL.oak.bark); for (let y = 0; y < 16; y++) { t.px(3, y, hex('#a8acb2')); t.px(12, y, hex('#a8acb2')); } return;
    case 'fire': t.clear(); for (let x = 0; x < 16; x++) { const h = 6 + Math.floor(t.r() * 9); for (let y = 15; y > 15 - h; y--) t.px(x, y, mix(hex('#ff4a0a'), hex('#ffe070'), (15 - y) / h > 0.6 ? 0.2 : 1 - (15 - y) / h)); } return;
    case 'mob_cage': t.clear(); t.border(hex('#2e3036')); for (const x of [4, 8, 11]) t.line(x, 0, x, 15, hex('#3e4048')); for (const y of [4, 8, 11]) t.line(0, y, 15, y, hex('#3e4048')); t.px(7, 7, hex('#e04a2a')); return;
    case 'tall_grass': plantSprite(t, GRASS, hex('#6aa84e'), 'grass'); return;
    case 'fern': plantSprite(t, GRASS, hex('#4a8a3a'), 'fern'); return;
    case 'dead_bush': plantSprite(t, hex('#8a6a3a'), hex('#8a6a3a'), 'dead'); return;
    case 'flower_red': flower(t, hex('#d8342a'), hex('#2a2a2a'), 0); return;
    case 'flower_yellow': flower(t, hex('#f4d02a'), hex('#e8a02a'), 1); return;
    case 'flower_blue': flower(t, hex('#5a8af0'), hex('#f0f0a0'), 0); return;
    case 'flower_purple': flower(t, hex('#9a4ad8'), hex('#5a2a8a'), 2); return;
    case 'flower_orange': flower(t, hex('#f08a2a'), hex('#a04a1a'), 3); return;
    case 'flower_white': flower(t, hex('#f4f4f4'), hex('#f0d02a'), 0); return;
    case 'mushroom_red': t.clear(); t.rect(7, 9, 8, 15, hex('#e8e0d0')); t.rect(4, 5, 11, 8, hex('#c82a2a')); t.rect(5, 4, 10, 4, hex('#c82a2a')); t.px(6, 6, hex('#ffffff')); t.px(9, 5, hex('#ffffff')); return;
    case 'mushroom_brown': t.clear(); t.rect(7, 10, 8, 15, hex('#e8e0d0')); t.rect(3, 8, 12, 9, hex('#8a6040')); t.rect(5, 7, 10, 7, hex('#8a6040')); return;
    case 'mushroom_cap_red': t.noise(hex('#c02a2a'), 0.06).blobs(hex('#f4f0e8'), 4, 1, 1.8); return;
    case 'mushroom_cap_brown': t.noise(hex('#8a6040'), 0.08); return;
    case 'mushroom_stem': t.noise(hex('#e0d8c4'), 0.05); return;
    case 'cactus_top': t.noise(hex('#4a8a3a'), 0.06).border(hex('#2e5e24')); t.px(7, 7, hex('#f0e0a0')); return;
    case 'cactus_side': t.fill((x, y) => (x === 0 || x === 15 ? null : mul(hex('#4a8a3a'), x % 4 === 1 ? 0.75 : 1))); for (let i = 0; i < 6; i++) t.px(1 + Math.floor(t.r() * 14), Math.floor(t.r() * 16), hex('#e8e0b0')); return;
    case 'reeds': plantSprite(t, hex('#86b85a'), hex('#86b85a'), 'reed'); return;
    case 'vine': t.clear(); for (let i = 0; i < 5; i++) { let x = 1 + Math.floor(t.r() * 14); for (let y = 0; y < 16; y++) { t.px(x, y, mul(hex('#3a7a2a'), 0.8 + t.r() * 0.4)); if (t.r() < 0.3) t.px(x + 1, y, hex('#4a9a3a')); if (t.r() < 0.2) x += t.r() < 0.5 ? -1 : 1; } } return;
    case 'lily_pad': t.clear(); for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const d = Math.hypot(x - 7.5, y - 7.5); if (d < 7 && !(x > 7 && Math.abs(y - 7.5) < 1.5)) t.px(x, y, mul(hex('#3a8a2a'), 0.85 + t.r() * 0.2)); } return;
    case 'cobweb': t.clear(); t.line(0, 0, 15, 15, hex('#e8e8e8'), 220); t.line(15, 0, 0, 15, hex('#e8e8e8'), 220); t.line(8, 0, 8, 15, hex('#e8e8e8'), 220); t.line(0, 8, 15, 8, hex('#e8e8e8'), 220); for (const r of [3, 6]) for (let a = 0; a < 16; a++) t.px(Math.round(7.5 + Math.cos(a / 16 * 6.28) * r), Math.round(7.5 + Math.sin(a / 16 * 6.28) * r), hex('#d8d8d8'), 200); return;
    case 'pumpkin_top': t.noise(hex('#d8801a'), 0.06); t.rect(7, 6, 8, 9, hex('#5a4a1a')); return;
    case 'pumpkin_side': t.fill((x) => mul(hex('#d8801a'), x % 4 === 0 ? 0.78 : 1 + (t.r() - 0.5) * 0.08)); return;
    case 'melon_top': t.noise(hex('#5a9a2a'), 0.08); t.px(7, 7, hex('#3a5a1a')); return;
    case 'melon_side': t.fill((x, y) => mul((x + Math.floor(y / 3)) % 4 === 0 ? hex('#3a6a1a') : hex('#6aaa3a'), 0.9 + t.r() * 0.15)); return;
    case 'berry_bush_1': case 'berry_bush_3': plantSprite(t, hex('#3a6a2a'), hex('#3a7a3a'), 'bush'); if (base === 'berry_bush_3') for (let i = 0; i < 7; i++) t.px(2 + Math.floor(t.r() * 12), 5 + Math.floor(t.r() * 10), hex('#f0a020')); return;
    case 'emberstone': t.noise(hex('#6d2a26'), 0.15).speckle(hex('#8a3a32'), 0.12).speckle(hex('#4a1a18'), 0.1); return;
    case 'ashsand': t.noise(hex('#5a4a44'), 0.12).speckle(hex('#7a6a60'), 0.1); return;
    case 'basalt_top': t.fill((x, y) => mul(hex('#4a4a52'), Math.hypot(x - 7.5, y - 7.5) % 3 < 1 ? 0.8 : 1 + (t.r() - 0.5) * 0.1)); return;
    case 'basalt_side': t.fill((x) => mul(hex('#4a4a52'), x % 5 === 0 ? 0.7 : 1 + (t.r() - 0.5) * 0.12)); return;
    case 'magma': t.fill((x, y) => ((x + y * 3) % 7 < 2 ? mix(hex('#ff6a1a'), hex('#ffc040'), t.r()) : mul(hex('#4a1a14'), 0.8 + t.r() * 0.3))); return;
    case 'ember_bricks': bricksTex(t, hex('#5a1a1e'), hex('#2a0a0e'), 8, 4); return;
    case 'ashroot': t.clear(); for (const x of [4, 8, 11]) { for (let y = 8; y < 16; y++) t.px(x, y, hex('#9a2a2a')); t.rect(x - 1, 6, x + 1, 8, hex('#d8584a')); } return;
    case 'ember_fungus': t.clear(); t.rect(7, 9, 8, 15, hex('#f0c08a')); t.rect(3, 5, 12, 8, hex('#ff7a1a')); t.px(5, 6, hex('#ffe08a')); t.px(10, 6, hex('#ffe08a')); return;
    case 'pale_stone': t.noise(hex('#d9d5b7'), 0.06).speckle(hex('#c4c09e'), 0.12); return;
    case 'pale_bricks': bricksTex(t, hex('#e0dcbc'), hex('#a8a488'), 8, 8); return;
    case 'pylon_top': t.noise(hex('#5a2f8a'), 0.1).rect(5, 5, 10, 10, hex('#e0c8ff')); return;
    case 'pylon_side': t.fill((x, y) => mix(hex('#3a1a5a'), hex('#c8a0ff'), ((x + y) % 6) / 6)); return;
    case 'void_bloom': t.clear(); t.line(8, 15, 8, 6, hex('#5a3a8a')); for (const [dx, dy] of [[0, -3], [-2, -1], [2, -1], [-1, 1], [1, 1], [0, 0]]) t.px(8 + dx, 5 + dy, hex('#c8a0ff')); t.px(8, 4, hex('#ffffff')); return;
    case 'riftcore_top': t.noise(hex('#2a1a1a'), 0.1).rect(4, 4, 11, 11, (x, y) => mix(hex('#ff5a1a'), hex('#ffd060'), Math.hypot(x - 7.5, y - 7.5) / 5)); return;
    case 'riftcore_side': t.noise(hex('#1c1428'), 0.15).border(hex('#f0c42a')); t.rect(6, 5, 9, 10, hex('#ff7a1a')); return;
    case 'voidcore_top': t.noise(hex('#1a1a2a'), 0.1).rect(4, 4, 11, 11, (x, y) => mix(hex('#8a4aff'), hex('#e0d0ff'), Math.hypot(x - 7.5, y - 7.5) / 5)); return;
    case 'voidcore_side': t.noise(hex('#1c1428'), 0.15).border(hex('#c8a0ff')); t.rect(6, 5, 9, 10, hex('#a070e0')); return;
    case 'rift_pad': t.fill((x, y) => [...mix(hex('#ff5a1a'), hex('#ffd890'), (Math.sin(x * 0.9 + y * 0.4) + 1) / 2), 210] as [number, number, number, number]); return;
    case 'rift_pad_home': t.fill((x, y) => [...mix(hex('#5a8aff'), hex('#e0f0ff'), (Math.sin(x * 0.9 - y * 0.4) + 1) / 2), 210] as [number, number, number, number]); return;
    default:
      if (base.startsWith('destroy')) {
        const stage = Number(name.split('_')[1]);
        t.clear();
        const rr = mulberry(77);
        for (let i = 0; i < (stage + 1) * 5; i++) { let x = Math.floor(rr() * 16), y = Math.floor(rr() * 16); for (let k = 0; k < 3 + stage; k++) { t.px(x, y, [20, 20, 20], 170); x += Math.floor(rr() * 3) - 1; y += Math.floor(rr() * 3) - 1; } }
        return;
      }
      if (base.endsWith('_crop') || /_crop_\d$/.test(name)) {
        const key = name.replace(/_\d$/, '');
        const stage = Number(name.slice(-1));
        cropStage(t, key, stage, key === 'wheat_crop' ? 8 : 4);
        return;
      }
      if (name.startsWith('terracotta_')) {
        const c = { orange: '#b8602a', red: '#8a3428', yellow: '#b8862a', white: '#c8aa98' }[name.slice(11)] ?? '#9a5a42';
        t.noise(hex(c), 0.05); return;
      }
      t.fill((x, y) => ((x >> 2) + (y >> 2)) % 2 ? [255, 0, 255] : [0, 0, 0]);
  }
}

let tileData: Uint8Array | null = null;
/** RGBA data for every tile, stacked as layers of a texture array */
export function buildTileArray(): Uint8Array {
  if (tileData) return tileData;
  const out = new Uint8Array(TS * TS * 4 * TILE_NAMES.length);
  TILE_NAMES.forEach((n, i) => {
    const t = new Tile(hash32(i * 31 + 7, n.length, n.charCodeAt(0), n.charCodeAt(n.length - 1)));
    paint(t, n);
    // texture arrays are sampled with v pointing up; flip rows so that y=0 in the painter is the top of the face
    for (let y = 0; y < TS; y++) out.set(t.d.subarray(y * TS * 4, (y + 1) * TS * 4), i * TS * TS * 4 + (TS - 1 - y) * TS * 4);
  });
  tileData = out;
  return out;
}
export function tileCanvas(index: number): HTMLCanvasElement {
  const data = buildTileArray();
  const c = document.createElement('canvas'); c.width = c.height = TS;
  const g = c.getContext('2d')!;
  const im = g.createImageData(TS, TS);
  for (let y = 0; y < TS; y++) im.data.set(data.subarray(index * TS * TS * 4 + (TS - 1 - y) * TS * 4, index * TS * TS * 4 + (TS - y) * TS * 4), y * TS * 4);
  g.putImageData(im, 0, 0);
  return c;
}

/* ------------------------------------------------------------------ item icons */
// 16x16 templates: '.' empty, 1 primary, 2 secondary, 3 tertiary/handle, k outline (darkened 2)
const TPL: Record<string, string[]> = {
  pickaxe: ['................', '...111111111....', '..12222222221...', '.12..1kkk1..21..', '.1..1k3.k1...1..', '....1.k3.1......', '.......k3.......', '........3k......', '.........3k.....', '..........3k....', '...........3k...', '............3k..', '.............3k.', '..............3.', '................', '................'],
  axe: ['................', '.......111......', '......12221.....', '.....122221.....', '.....1222k3.....', '......11k3......', '.......k3.......', '......k3........', '.....k3.........', '....k3..........', '...k3...........', '..k3............', '.k3.............', '.3..............', '................', '................'],
  shovel: ['................', '..........111...', '.........12221..', '.........122221.', '..........12221.', '..........k111..', '.........k3.....', '........k3......', '.......k3.......', '......k3........', '.....k3.........', '....k3..........', '...k3...........', '..33............', '..3.............', '................'],
  hoe: ['................', '.......11111....', '......122222k...', '.......111.k3...', '..........k3....', '.........k3.....', '........k3......', '.......k3.......', '......k3........', '.....k3.........', '....k3..........', '...k3...........', '..k3............', '..3.............', '................', '................'],
  sword: ['................', '.............11.', '............121.', '...........121..', '..........121...', '.........121....', '........121.....', '.......121......', '..1...121.......', '..k1.121........', '...k121.........', '....k3k.........', '...k3.k1........', '..33...k........', '..3.............', '................'],
  shears: ['................', '....11..........', '...1221.........', '....1221........', '.....1221..11...', '......122112....', '.......1221.....', '......22.22.....', '.....33...33....', '....3.3...3.3...', '....3.3...3.3...', '.....3.....3....', '................', '................', '................', '................'],
  ingot: ['................', '................', '................', '................', '.....11111111...', '....1222222221..', '...12222222221..', '..1kkkkkkkkkk1..', '..1kkkkkkkkk1...', '...1111111111...', '................', '................', '................', '................', '................', '................'],
  gem: ['................', '................', '......1111......', '.....122221.....', '....12222221....', '...1222222221...', '...k12222221k...', '....k122221k....', '.....k1221k.....', '......k11k......', '.......kk.......', '................', '................', '................', '................', '................'],
  lump: ['................', '................', '................', '......111.......', '....1122211.....', '...122222221....', '...12221222k....', '..1222222221k...', '..k12222222k....', '...kk1222kk.....', '.....kkkk.......', '................', '................', '................', '................', '................'],
  dust: ['................', '................', '................', '................', '.......1........', '.....1.2.1......', '....12212221....', '...1222222221...', '..122222222221..', '..kkkkkkkkkkkk..', '................', '................', '................', '................', '................', '................'],
  orb: ['................', '................', '.....111111.....', '....12222221....', '...1222222221...', '..122222222221..', '..122221122221..', '..122221122221..', '..122222222221..', '..k1222222221k..', '...k12222221k...', '....kk1111kk....', '................', '................', '................', '................'],
  stick: ['................', '................', '............1...', '...........12...', '..........12....', '.........12.....', '........12......', '.......12.......', '......12........', '.....12.........', '....12..........', '...12...........', '...2............', '................', '................', '................'],
  ball: ['................', '................', '................', '.....1111.......', '....122221......', '...12222221.....', '...12222221.....', '...12222221.....', '...k122221k.....', '....k1111k......', '.....kkkk.......', '................', '................', '................', '................', '................'],
  bone: ['................', '................', '...11...........', '..1221..........', '..12221.........', '...12221........', '....12221.......', '.....12221......', '......12221.....', '.......12221....', '........12221...', '.........1221...', '..........11....', '................', '................', '................'],
  string: ['................', '...11...........', '....1...........', '....1...........', '.....1..........', '.....1..........', '......1.........', '......11........', '.......1........', '........1.......', '........1.......', '.........11.....', '..........1.....', '...........1....', '...........1....', '................'],
  feather: ['................', '............11..', '...........1221.', '..........12221.', '.........12221..', '........12221...', '.......12221....', '......12221.....', '.....12221......', '....12221.......', '...1221.........', '..k11...........', '.k..............', '................', '................', '................'],
  hide: ['................', '................', '...1.1111..1....', '...1122221111...', '....12222222....', '...122222221....', '...12222222k....', '...12222222k....', '...1222222k.....', '....122222k.....', '...11.1111.1....', '...1........1...', '................', '................', '................', '................'],
  paper: ['................', '................', '....11111111....', '....12222221....', '....12111121....', '....12222221....', '....12111121....', '....12222221....', '....12111121....', '....12222221....', '....11111111....', '................', '................', '................', '................', '................'],
  book: ['................', '................', '....11111111....', '...122222222k...', '...1222222222k..', '...12222222222k.', '...12222222222k.', '...12222222222k.', '...12222222222k.', '...1222222222k..', '...k2222222kk...', '....kkkkkkk.....', '................', '................', '................', '................'],
  wheat: ['................', '.........1......', '........121.....', '.......1.1.1....', '......121.21....', '.....1.1.1......', '....121.21......', '...1.1.1........', '....2.2.........', '...2.2..........', '..2.2...........', '.2..............', '................', '................', '................', '................'],
  reed: ['................', '.......1........', '.......2........', '.......1....1...', '.......1...1....', '.......2..1.....', '.......1.1......', '.......11.......', '.......1........', '.......2........', '.......1........', '.......1........', '.......2........', '.......1........', '................', '................'],
  seeds: ['................', '................', '................', '................', '.....1...1......', '...1...2...1....', '.....2...1..2...', '...1...1.2......', '.....2.....1....', '...1..1.2.......', '................', '................', '................', '................', '................', '................'],
  bottle: ['................', '.......kk.......', '.......11.......', '.......11.......', '......1..1......', '.....1....1.....', '....1......1....', '....1......1....', '....1......1....', '....1......1....', '.....1....1.....', '......1111......', '................', '................', '................', '................'],
  potion: ['................', '.......kk.......', '.......22.......', '.......22.......', '......2..2......', '.....2....2.....', '....21111112....', '....21111112....', '....21111112....', '....21111112....', '.....211112.....', '......2222......', '................', '................', '................', '................'],
  dye: ['................', '................', '................', '......1111......', '.....111111.....', '....11111111....', '....11121111....', '....11111111....', '.....111111.....', '......1111......', '................', '................', '................', '................', '................', '................'],
  bow: ['................', '..........1111..', '........112..3..', '.......12....3..', '......12.....3..', '.....12......3..', '....12......3...', '...12......3....', '...1......3.....', '...1.....3......', '...1....3.......', '...12..3........', '....1.3.........', '....13..........', '................', '................'],
  arrow: ['................', '.............22.', '............222.', '...........121..', '..........1.....', '.........1......', '........1.......', '.......1........', '......1.........', '.....1..........', '....1...........', '..331...........', '..33............', '.3..............', '................', '................'],
  shield: ['................', '...1111111111...', '...1222222221...', '...1222112221...', '...1221221221...', '...1222112221...', '...1222222221...', '...1222222221...', '....12222221....', '....12222221....', '.....122221.....', '......1221......', '.......11.......', '................', '................', '................'],
  rod: ['................', '.............1..', '............1.2.', '...........1..2.', '..........1...2.', '.........1....2.', '........1.....2.', '.......1......2.', '......1.......2.', '.....1........2.', '....1.........2.', '...1.........222', '..1.............', '................', '................', '................'],
  striker: ['................', '................', '.........1111...', '........1222k...', '.......12222k...', '......12222k....', '........kkk.....', '................', '...33333........', '..3.....3.......', '..3.....3.......', '...33333........', '................', '................', '................', '................'],
  bucket: ['................', '................', '...1........1...', '....1......1....', '...1111111111...', '...1222222221...', '...1222222221...', '...k12222221k...', '....1111111k....', '....k111111k....', '.....kkkkkk.....', '................', '................', '................', '................', '................'],
  saddle: ['................', '................', '................', '.....111111.....', '....12222221....', '...1222222221...', '..122222222221..', '..1k22222222k1..', '...k12222221k...', '....k.2..2.k....', '......3..3......', '......3..3......', '................', '................', '................', '................'],
  lead: ['................', '..1111..........', '.1....1.........', '.1....1.........', '..1..1..........', '...22...........', '....2...........', '.....2..........', '......2.........', '.......2........', '........2.......', '.........2......', '..........22....', '............2...', '................', '................'],
  boat: ['................', '................', '................', '................', '................', '.1............1.', '.12..........21.', '.122222222222k1.', '..122222222kk1..', '...1111111111...', '................', '................', '................', '................', '................', '................'],
  cart: ['................', '................', '................', '..1..........1..', '..12222222222k..', '..12222222222k..', '..12222222222k..', '..1kkkkkkkkkkk..', '...kk......kk...', '...kk......kk...', '................', '................', '................', '................', '................', '................'],
  wand: ['................', '.............2..', '............222.', '.............2..', '............1...', '...........1....', '..........1.....', '.........1......', '........1.......', '.......1........', '......1.........', '.....1..........', '....1...........', '...1............', '................', '................'],
  door: ['................', '....11111111....', '....12222221....', '....12111121....', '....12122121....', '....12122121....', '....12111121....', '....12222221....', '....12222221....', '....12222k21....', '....12222221....', '....12222221....', '....12222221....', '....12222221....', '....11111111....', '................'],
  armor_helmet: ['................', '................', '................', '....11111111....', '...1222222221...', '...1222222221...', '...12kkkkkk21...', '...12k....k21...', '...11......11...', '................', '................', '................', '................', '................', '................', '................'],
  armor_chest: ['................', '..111......111..', '..1221111112k1..', '..122222222kk1..', '...1222222221...', '...1222222221...', '...1222222221...', '...1222222221...', '...1222222221...', '...1222222221...', '...1kkkkkkkk1...', '...1111111111...', '................', '................', '................', '................'],
  armor_legs: ['................', '...1111111111...', '...1222222221...', '...1kkkkkkkk1...', '...1221..1221...', '...1221..1221...', '...1221..1221...', '...1221..1221...', '...1221..1221...', '...1221..1221...', '...1111..1111...', '................', '................', '................', '................', '................'],
  armor_boots: ['................', '................', '................', '................', '................', '...1111..1111...', '...1221..1221...', '...1221..1221...', '...1221..1221...', '..12221..12221..', '..1kkk1..1kkk1..', '..11111..11111..', '................', '................', '................', '................'],
  apple: ['................', '.........3......', '........32......', '....1111.1111...', '...11111111111..', '..1111111111111.', '..111111111111k.', '..111111111111k.', '..111111111111k.', '...11111111111k.', '...k11111111kk..', '....kkk..kkk....', '................', '................', '................', '................'],
  bread: ['................', '................', '................', '................', '.....111111.....', '...11222222111..', '..1222222222221.', '..1212212212221.', '..1222222222221.', '..k11111111111k.', '...kkkkkkkkkkk..', '................', '................', '................', '................', '................'],
  carrot: ['................', '..........222...', '.........22.2...', '........1122....', '.......11112....', '......1111k.....', '.....111k1......', '....111k1.......', '...111k1........', '...11k1.........', '..11k1..........', '..1k............', '.1..............', '................', '................', '................'],
  potato: ['................', '................', '................', '.....11111......', '....1112111.....', '...111111111....', '...1121111211...', '...111111111k...', '...k11111112k...', '....k1111111k...', '.....kkkkkkk....', '................', '................', '................', '................', '................'],
  berries: ['................', '................', '.......2........', '......2.2.......', '.....2...2......', '....11...11.....', '...1111.1111....', '...1121.1121....', '...1111.1111....', '....11.11.11....', '......1111......', '......1121......', '......1111......', '.......11.......', '................', '................'],
  melon: ['................', '................', '................', '................', '...2222222222...', '...k11111111k...', '....11k11k11....', '.....1111111....', '......11111.....', '.......111......', '........1.......', '................', '................', '................', '................', '................'],
  cookie: ['................', '................', '................', '.....111111.....', '....11111111....', '...1121111211...', '...1111111111...', '...1111211111...', '...1211111121...', '....11111111....', '.....111111.....', '................', '................', '................', '................', '................'],
  bowl: ['................', '................', '................', '................', '................', '...2222222222...', '..122222222221..', '..111111111111..', '...1111111111...', '....11111111....', '.....kkkkkk.....', '................', '................', '................', '................', '................'],
  meat: ['................', '................', '.....111111.....', '....12222221....', '...1222222221...', '...1222222221...', '...1222222221...', '...122222221k...', '....1222221k....', '....k1111kk.....', '......k33.......', '.......33.......', '................', '................', '................', '................'],
  drumstick: ['................', '................', '.....1111.......', '....122221......', '...12222221.....', '...12222221.....', '...1222222k.....', '....122221k.....', '.....1111kk.....', '.......k33......', '........33......', '.......3333.....', '.......3..3.....', '................', '................', '................'],
  fish: ['................', '................', '................', '................', '.......1111.....', '.....11222211...', '...1122222k221..', '.1.1222222222211', '.11122222222221.', '.1.1222222222211', '...1122222221...', '.....11111111...', '................', '................', '................', '................'],
  egg: ['................', '................', '.......111......', '......12221.....', '.....1222221....', '.....1222221....', '....122222221...', '....122222221...', '....122222221...', '....k1222222k...', '.....k11111k....', '......kkkkk.....', '................', '................', '................', '................'],
  key: ['................', '................', '...1111.........', '..1....1........', '..1....1........', '..1....11111111.', '...1111....1.1..', '...........1.1..', '................', '................', '................', '................', '................', '................', '................', '................'],
};

const iconCache = new Map<string, string>();
function darken(c: RGB) { return mul(c, 0.55); }

export function itemIconCanvas(s: { id: number; data?: string }): HTMLCanvasElement {
  const d = ITEMS[s.id];
  const c = document.createElement('canvas'); c.width = c.height = 32;
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  if ('block' in d.icon) {
    drawBlockIcon(g, d.icon.block);
    return c;
  }
  const cols = d.icon.c.map(hex);
  if (d.key === 'potion') cols[0] = hex(POTIONS[s.data ?? 'water']?.color ?? '#3f76e4');
  const tpl = TPL[d.icon.tpl] ?? TPL.lump;
  const handle = cols[2] ?? hex('#6b4a28');
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const ch = tpl[y]?.[x] ?? '.';
    if (ch === '.') continue;
    const col = ch === '1' ? cols[0] : ch === '2' ? cols[1] : ch === '3' ? handle : darken(cols[1] ?? cols[0]);
    g.fillStyle = `rgb(${col[0] | 0},${col[1] | 0},${col[2] | 0})`;
    g.fillRect(x * 2, y * 2, 2, 2);
  }
  return c;
}
function drawBlockIcon(g: CanvasRenderingContext2D, id: number) {
  const def = BLOCKS[id];
  if (SHAPE[id] === 2 || def.layer === 1 && SHAPE[id] === 4 && !['chest', 'glass_pane'].includes(def.key)) {
    const tc = tileCanvas(faceTile(id, def.key.endsWith('_crop') ? 7 : def.key === 'berry_bush' ? 3 : 0, 3));
    g.drawImage(tc, 0, 0, 32, 32);
    return;
  }
  const top = tileCanvas(faceTile(id, 0, 3)), left = tileCanvas(faceTile(id, 0, 5)), right = tileCanvas(faceTile(id, 0, 1));
  const shade = (cv: HTMLCanvasElement, k: number) => {
    const c2 = document.createElement('canvas'); c2.width = c2.height = 16;
    const g2 = c2.getContext('2d')!;
    g2.drawImage(cv, 0, 0);
    g2.fillStyle = `rgba(0,0,0,${k})`; g2.globalCompositeOperation = 'source-atop'; g2.fillRect(0, 0, 16, 16);
    return c2;
  };
  const thin = def.key.includes('slab') || def.key === 'snow_layer' || def.key === 'pressure_plate' || def.key === 'rail' || def.key.includes('carpet');
  const h = thin ? 0.5 : 1;
  g.save();
  // top face
  g.setTransform(1, 0.5, -1, 0.5, 16, thin ? 8 + 4 : 2);
  g.drawImage(top, 0, 0, 14, 14);
  g.restore();
  g.save();
  g.setTransform(1, 0.5, 0, 1, 2, 9 + (thin ? 7 : 0));
  g.drawImage(shade(left, 0.25), 0, 16 * (1 - h), 16, 16 * h, 0, 0, 14, 15 * h);
  g.restore();
  g.save();
  g.setTransform(1, -0.5, 0, 1, 16, 16 + (thin ? 7 : 0));
  g.drawImage(shade(right, 0.45), 0, 16 * (1 - h), 16, 16 * h, 0, 0, 14, 15 * h);
  g.restore();
}
export function itemIconURL(s: ItemStack | { id: number; data?: string }): string {
  const k = `${s.id}:${s.data ?? ''}`;
  let u = iconCache.get(k);
  if (!u) { u = itemIconCanvas(s).toDataURL(); iconCache.set(k, u); }
  return u;
}

/* ------------------------------------------------------------------ entity skins */
export function skinCanvas(w: number, h: number, fn: (x: number, y: number, r: () => number) => RGB | null, seed = 1): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  const im = g.createImageData(w, h);
  const r = mulberry(seed);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const col = fn(x, y, r);
    const i = (y * w + x) * 4;
    if (!col) { im.data[i + 3] = 0; continue; }
    im.data[i] = col[0]; im.data[i + 1] = col[1]; im.data[i + 2] = col[2]; im.data[i + 3] = 255;
  }
  g.putImageData(im, 0, 0);
  return c;
}
export { hex, mul, mix };
export type { RGB };
export const WOOD_KEYS = WOODS;
