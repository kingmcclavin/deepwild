/// <reference lib="webworker" />
import { buildChunkMesh } from '../world/mesher';

self.onmessage = (e: MessageEvent) => {
  const { id, blocks, meta, hasSky, cx, cz, dim, version } = e.data;
  const r = buildChunkMesh(blocks, meta, hasSky);
  const transfer: ArrayBuffer[] = [r.skyMax.buffer as ArrayBuffer, r.sky.buffer as ArrayBuffer, r.blk.buffer as ArrayBuffer];
  for (const l of r.layers) transfer.push(l.pos.buffer as ArrayBuffer, l.uv.buffer as ArrayBuffer, l.attr.buffer as ArrayBuffer, l.idx.buffer as ArrayBuffer);
  (self as unknown as Worker).postMessage({ id, cx, cz, dim, version, layers: r.layers, skyMax: r.skyMax, sky: r.sky, blk: r.blk }, transfer);
};
