import { describe, it, expect } from 'vitest';
import { buildChunkMesh, singleBlockMesh } from '../src/game/world/mesher';
import { B } from '../src/game/registry/blocks';

function outward(pos: Float32Array, idx: Uint32Array, cx: number, cy: number, cz: number) {
  let good = 0, bad = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const e1 = [pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2]];
    const e2 = [pos[c] - pos[a], pos[c + 1] - pos[a + 1], pos[c + 2] - pos[a + 2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const m = [(pos[a] + pos[b] + pos[c]) / 3 - cx, (pos[a + 1] + pos[b + 1] + pos[c + 1]) / 3 - cy, (pos[a + 2] + pos[b + 2] + pos[c + 2]) / 3 - cz];
    const d = n[0] * m[0] + n[1] * m[1] + n[2] * m[2];
    if (d > 0) good++; else bad++;
  }
  return { good, bad };
}
describe('winding', () => {
  it('greedy cube faces point outward', () => {
    const blocks: (Uint8Array | null)[] = [], meta: (Uint8Array | null)[] = [];
    for (let i = 0; i < 9; i++) { blocks.push(new Uint8Array(32768)); meta.push(new Uint8Array(32768)); }
    blocks[4]![8 + 8 * 16 + 64 * 256] = B.stone;
    const m = buildChunkMesh(blocks, meta, true);
    const r = outward(m.layers[0].pos, m.layers[0].idx, 8.5, 64.5, 8.5);
    expect(r).toEqual({ good: 12, bad: 0 });
  });
  it('model boxes point outward', () => {
    const m = singleBlockMesh(B.stone_slab, 0);
    const r = outward(m.pos, m.idx, 0.5, 0.25, 0.5);
    expect(r.bad).toBe(0);
  });
});
