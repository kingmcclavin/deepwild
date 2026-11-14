import { describe, it, expect } from 'vitest';
import { TILE_NAMES } from '../src/game/registry/blocks';
import { buildTileArray, TS } from '../src/game/gfx/textures';

describe('textures', () => {
  it('paints every tile (no magenta fallback)', () => {
    const d = buildTileArray();
    const missing: string[] = [];
    TILE_NAMES.forEach((n, i) => {
      let mag = 0;
      for (let p = 0; p < TS * TS; p++) { const o = (i * TS * TS + p) * 4; if (d[o] === 255 && d[o + 1] === 0 && d[o + 2] === 255) mag++; }
      if (mag > 20) missing.push(n);
    });
    expect(missing).toEqual([]);
  });
});
