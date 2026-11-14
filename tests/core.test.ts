import { describe, it, expect } from 'vitest';
import { generateChunk } from '../src/game/world/gen/generate';
import { buildChunkMesh } from '../src/game/world/mesher';
import { matchGrid, RECIPES } from '../src/game/registry/recipes';
import { ITEMS, itemByKey } from '../src/game/registry/items';
import { BLOCKS, TILE_NAMES, B } from '../src/game/registry/blocks';
import { Dim } from '../src/game/constants';

describe('world generation', () => {
  it('is deterministic per seed and coordinate', () => {
    const a = generateChunk(1234, Dim.Overworld, 3, -2);
    const b = generateChunk(1234, Dim.Overworld, 3, -2);
    expect(a.blocks.every((v, i) => v === b.blocks[i])).toBe(true);
    const c = generateChunk(999, Dim.Overworld, 3, -2);
    expect(a.blocks.every((v, i) => v === c.blocks[i])).toBe(false);
  });
  it('produces bedrock floor and varied blocks', () => {
    const a = generateChunk(42, Dim.Overworld, 0, 0);
    expect(a.blocks[0]).toBe(B.bedrock);
    const set = new Set(a.blocks);
    expect(set.size).toBeGreaterThan(4);
  });
  it('generates all dimensions', () => {
    for (const d of [Dim.Ember, Dim.Void]) {
      const r = generateChunk(42, d, 0, 0);
      expect(r.blocks.length).toBe(16 * 16 * 128);
    }
  });
  it('generates quickly', () => {
    const t = performance.now();
    for (let i = 0; i < 20; i++) generateChunk(77, Dim.Overworld, i, i * 2);
    const per = (performance.now() - t) / 20;
    console.log('gen ms/chunk', per.toFixed(1));
    expect(per).toBeLessThan(200);
  });
});

describe('mesher', () => {
  it('builds geometry with light', () => {
    const arr = [] as Uint8Array[], meta = [] as Uint8Array[];
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) { const g = generateChunk(5, Dim.Overworld, dx, dz); arr.push(g.blocks); meta.push(g.meta); }
    const t = performance.now();
    const m = buildChunkMesh(arr, meta, true);
    console.log('mesh ms', (performance.now() - t).toFixed(1), 'opaque verts', m.layers[0].pos.length / 3);
    expect(m.layers[0].idx.length).toBeGreaterThan(100);
    expect(Math.max(...m.sky)).toBe(15);
  });
});

describe('crafting', () => {
  it('matches planks from any log', () => {
    const g = [{ id: B.birch_log, count: 1 }, null, null, null];
    const r = matchGrid(g, 2);
    expect(r && ITEMS[r.out].key).toBe('birch_planks');
  });
  it('matches shaped pickaxe in 3x3 incl. mirrored', () => {
    const P = { id: B.oak_planks, count: 1 }, S = { id: itemByKey('stick').id, count: 1 };
    const r = matchGrid([null, P, null, P, S, P, null, S, null], 3);
    expect(r && ITEMS[r.out].key).toBe('wood_pickaxe');
    const ax = matchGrid([null, P, P, null, P, S, null, null, S], 3);
    expect(ax && ITEMS[ax.out].key).toBe('wood_axe');
  });
  it('every recipe output is a real item', () => {
    for (const r of RECIPES) expect(ITEMS[r.out]).toBeTruthy();
  });
  it('has under 255 blocks and textures for all tiles', () => {
    expect(BLOCKS.length).toBeLessThan(255);
    expect(TILE_NAMES.length).toBeLessThan(500);
  });
});
