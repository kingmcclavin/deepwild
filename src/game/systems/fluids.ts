import { B, BLOCKS } from '../registry/blocks';
import { Dim } from '../constants';
import type { World } from '../world/World';
import type { GameCtx } from '../types';
import { audio } from '../audio/audio';

const H4: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
export const isFluid = (id: number) => id === B.water || id === B.lava;
const level = (m: number) => (m & 8 ? 0 : m & 7);

export function fluidDelay(id: number, dim: Dim) { return id === B.water ? 5 : dim === Dim.Ember ? 10 : 30; }
function canFlowInto(id: number) { return id === 0 || (BLOCKS[id].replaceable && !isFluid(id)) || (BLOCKS[id].plant && BLOCKS[id].needs !== 'water' && id !== B.reeds) || id === B.fire; }

export function fluidTick(w: World, g: GameCtx, x: number, y: number, z: number) {
  const id = w.id(x, y, z);
  if (!isFluid(id)) return;
  const other = id === B.water ? B.lava : B.water;
  const step = id === B.lava && g.dim !== Dim.Ember ? 2 : 1;
  const max = 7;
  let m = w.meta(x, y, z);
  // contact reactions
  for (const [dx, dz] of [...H4, [0, 0]] as [number, number][]) {
    for (const dy of dx === 0 && dz === 0 ? [1] : [0]) {
      const nid = w.id(x + dx, y + dy, z + dz);
      if (nid !== other) continue;
      if (id === B.lava) { w.set(x, y, z, level(m) === 0 && !(m & 8) ? B.obsidian : B.cobblestone); fizz(g, x, y, z); return; }
      else { const nm = w.meta(x + dx, y + dy, z + dz); w.set(x + dx, y + dy, z + dz, level(nm) === 0 && !(nm & 8) ? B.obsidian : B.cobblestone); fizz(g, x + dx, y + dy, z + dz); }
    }
  }
  const isSource = m === 0;
  if (!isSource) {
    let expected: number;
    const above = w.id(x, y + 1, z);
    if (above === id) expected = 8;
    else {
      let best = 99, sources = 0;
      for (const [dx, dz] of H4) {
        if (w.id(x + dx, y, z + dz) !== id) continue;
        const nm = w.meta(x + dx, y, z + dz);
        if (nm === 0) sources++;
        // only fluid that is resting on something can feed sideways
        const nb = w.id(x + dx, y - 1, z + dz);
        if (nm & 8 && nb === 0) continue;
        best = Math.min(best, level(nm));
      }
      if (id === B.water && sources >= 2 && (w.solid(x, y - 1, z) || (w.id(x, y - 1, z) === B.water && w.meta(x, y - 1, z) === 0))) expected = 0;
      else expected = best + step;
    }
    if (expected !== 8 && expected > max) { w.set(x, y, z, 0); return; }
    if (expected !== m) { w.set(x, y, z, id, expected); m = expected; w.schedule(x, y, z, fluidDelay(id, g.dim)); }
  }
  // spread down
  const below = w.id(x, y - 1, z);
  if (below === other) {
    if (id === B.water) { w.set(x, y - 1, z, w.meta(x, y - 1, z) === 0 ? B.obsidian : B.cobblestone); fizz(g, x, y - 1, z); }
    else { w.set(x, y - 1, z, B.stone); fizz(g, x, y - 1, z); }
    return;
  }
  if (y > 0 && canFlowInto(below)) {
    breakPlant(g, x, y - 1, z, below);
    w.set(x, y - 1, z, id, 8);
    w.schedule(x, y - 1, z, fluidDelay(id, g.dim));
    if (!isSource) return;
  }
  if (below === id && !isSource) return;
  // spread sideways
  const lv = level(m);
  const nl = lv + step;
  if (nl > max) return;
  for (const [dx, dz] of H4) {
    const nx = x + dx, nz = z + dz;
    if (!w.loaded(nx, nz)) continue;
    const nid = w.id(nx, y, nz);
    if (nid === other) continue;
    if (canFlowInto(nid)) {
      breakPlant(g, nx, y, nz, nid);
      w.set(nx, y, nz, id, nl);
      w.schedule(nx, y, nz, fluidDelay(id, g.dim));
    } else if (nid === id) {
      const nm = w.meta(nx, y, nz);
      if (nm !== 0 && !(nm & 8) && level(nm) > nl) { w.set(nx, y, nz, id, nl); w.schedule(nx, y, nz, fluidDelay(id, g.dim)); }
    }
  }
}
function breakPlant(g: GameCtx, x: number, y: number, z: number, id: number) {
  if (id && BLOCKS[id].plant) g.breakBlock(x, y, z, true);
}
function fizz(g: GameCtx, x: number, y: number, z: number) {
  g.particles(x + 0.5, y + 1, z + 0.5, [0.85, 0.85, 0.9], 8, 1.5, -1);
  audio.noise(0.6, 3000, 0.5, 0.25, 'highpass', [x, y, z], 1200);
}
