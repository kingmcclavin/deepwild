import { describe, it, expect } from 'vitest';
import { generateChunk } from '../src/game/world/gen/generate';
import { BLOCKS } from '../src/game/registry/blocks';
import { Dim } from '../src/game/constants';

const LEAF = new Set(BLOCKS.filter((b) => b.key.endsWith('_leaves')).map((b) => b.id));
const LOG = new Set(BLOCKS.filter((b) => b.key.endsWith('_log')).map((b) => b.id));

/** leaves in the centre chunk with no trunk within 5 blocks = a canopy cut off at a chunk border */
function orphanLeaves(seed: number, cx: number, cz: number) {
  const ch = new Map<string, Uint8Array>();
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) ch.set(`${dx},${dz}`, generateChunk(seed, Dim.Overworld, cx + dx, cz + dz).blocks);
  const get = (x: number, y: number, z: number) => {
    const kx = Math.floor(x / 16), kz = Math.floor(z / 16);
    const b = ch.get(`${kx},${kz}`);
    if (!b || y < 0 || y > 127) return 0;
    return b[(x - kx * 16) + (z - kz * 16) * 16 + y * 256];
  };
  let leaves = 0, orphans = 0;
  for (let y = 0; y < 128; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
    if (!LEAF.has(get(x, y, z))) continue;
    leaves++;
    let found = false;
    for (let dy = -5; dy <= 5 && !found; dy++) for (let dz = -5; dz <= 5 && !found; dz++) for (let dx = -5; dx <= 5; dx++) if (LOG.has(get(x + dx, y + dy, z + dz))) { found = true; break; }
    if (!found) orphans++;
  }
  return { leaves, orphans };
}

describe('trees', () => {
  it('canopies are never cut off at chunk borders', () => {
    let leaves = 0, orphans = 0;
    for (const [seed, cx, cz] of [[1234, 0, 0], [777, 3, -2], [42, -5, 7], [9, 10, 10], [31337, -8, -3]]) {
      const r = orphanLeaves(seed, cx, cz);
      leaves += r.leaves; orphans += r.orphans;
    }
    expect(leaves).toBeGreaterThan(50);
    expect(orphans).toBe(0);
  });
});
