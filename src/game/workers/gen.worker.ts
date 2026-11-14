/// <reference lib="webworker" />
import { generateChunk } from '../world/gen/generate';

self.onmessage = (e: MessageEvent) => {
  const { id, seed, dim, cx, cz } = e.data as { id: number; seed: number; dim: number; cx: number; cz: number };
  const r = generateChunk(seed, dim, cx, cz);
  (self as unknown as Worker).postMessage({ id, cx, cz, dim, blocks: r.blocks, meta: r.meta, features: r.features, biomes: r.biomes }, [r.blocks.buffer, r.meta.buffer, r.biomes.buffer]);
};
