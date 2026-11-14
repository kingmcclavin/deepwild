// Lighting + greedy meshing. Pure functions; executed inside mesh workers.
import { CHUNK, HEIGHT, CHUNK_AREA } from '../constants';
import { BLOCKS, OPAQUE, LIGHT_FILTER, SHAPE, LAYER, emission, faceTile, modelBoxes, tileId, type Box } from '../registry/blocks';

const P = 48; // padded width (3 chunks)
const PA = P * P;
const PVOL = PA * HEIGHT;
const pidx = (x: number, y: number, z: number) => (x + 16) + (z + 16) * P + y * PA;

const WATER_ID = BLOCKS.find((b) => b.key === 'water')!.id;
const LAVA_ID = BLOCKS.find((b) => b.key === 'lava')!.id;
const LEAVES = new Uint8Array(256);
BLOCKS.forEach((b) => { if (b.key.endsWith('_leaves')) LEAVES[b.id] = 1; });

export interface MeshLayer { pos: Float32Array; uv: Float32Array; attr: Float32Array; idx: Uint32Array }
export interface MeshResult { layers: MeshLayer[]; skyMax: Uint8Array; sky: Uint8Array; blk: Uint8Array }

class Buf {
  pos: number[] = []; uv: number[] = []; attr: number[] = []; idx: number[] = [];
  vert(x: number, y: number, z: number, u: number, v: number, tile: number, sky: number, blk: number, shade: number) {
    this.pos.push(x, y, z); this.uv.push(u, v); this.attr.push(tile, sky, blk, shade);
  }
  quad(flip: boolean) {
    const b = this.pos.length / 3 - 4;
    if (flip) this.idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
    else this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  out(): MeshLayer {
    return { pos: new Float32Array(this.pos), uv: new Float32Array(this.uv), attr: new Float32Array(this.attr), idx: new Uint32Array(this.idx) };
  }
}

const FACE_SHADE = [0.78, 0.78, 0.55, 1.0, 0.88, 0.88];
const AO_CURVE = [0.5, 0.68, 0.84, 1];
// for each dir: axis, sign
const DIR_AXIS = [0, 0, 1, 1, 2, 2];
const DIR_SIGN = [-1, 1, -1, 1, -1, 1];
// u, v axes per primary axis
const UV_AXES = [[2, 1], [0, 2], [0, 1]];
const NATURAL_SIGN = [-1, -1, 1]; // sign of cross(U,V) along axis

/**
 * blocks/meta: 9 chunk arrays ordered by (dz+1)*3+(dx+1); center = index 4. Missing chunks may be null.
 */
export function buildChunkMesh(blocksN: (Uint8Array | null)[], metaN: (Uint8Array | null)[], hasSky: boolean): MeshResult {
  const blocks = new Uint8Array(PVOL);
  const meta = new Uint8Array(PVOL);
  for (let n = 0; n < 9; n++) {
    const bn = blocksN[n], mn = metaN[n];
    if (!bn) continue;
    const ox = ((n % 3) - 1) * CHUNK, oz = (Math.floor(n / 3) - 1) * CHUNK;
    for (let y = 0; y < HEIGHT; y++) for (let z = 0; z < CHUNK; z++) {
      const src = z * CHUNK + y * CHUNK_AREA;
      const dst = pidx(ox, y, oz + z);
      blocks.set(bn.subarray(src, src + CHUNK), dst);
      if (mn) meta.set(mn.subarray(src, src + CHUNK), dst);
    }
  }
  const sky = new Uint8Array(PVOL);
  const blk = new Uint8Array(PVOL);
  const queue = new Int32Array(PVOL);
  const skyMax = new Uint8Array(CHUNK_AREA); // heightmap of first light-blocking block in centre chunk
  // ---- sky light
  if (hasSky) {
    for (let z = 0; z < P; z++) for (let x = 0; x < P; x++) {
      let l = 15;
      for (let y = HEIGHT - 1; y >= 0; y--) {
        const i = x + z * P + y * PA;
        const f = LIGHT_FILTER[blocks[i]];
        if (f >= 15) { l = 0; }
        else if (f > 0) l = Math.max(0, l - f);
        sky[i] = l;
        if (l === 0) break;
      }
    }
    let qh = 0, qt = 0;
    for (let y = 0; y < HEIGHT; y++) for (let z = 1; z < P - 1; z++) for (let x = 1; x < P - 1; x++) {
      const i = x + z * P + y * PA;
      const l = sky[i];
      if (l < 2) continue;
      if (sky[i - 1] < l - 1 || sky[i + 1] < l - 1 || sky[i - P] < l - 1 || sky[i + P] < l - 1 || (y > 0 && sky[i - PA] < l - 1)) queue[qt++] = i;
    }
    spread(sky, blocks, queue, qh, qt);
  }
  // ---- block light
  {
    let qt = 0;
    for (let i = 0; i < PVOL; i++) {
      const id = blocks[i];
      if (!id) continue;
      const e = emission(id, meta[i]);
      if (e > 0) { blk[i] = e; queue[qt++] = i; }
    }
    spread(blk, blocks, queue, 0, qt);
  }
  // heightmap for centre chunk (used for weather / spawning)
  for (let z = 0; z < CHUNK; z++) for (let x = 0; x < CHUNK; x++) {
    let y = HEIGHT - 1;
    while (y > 0 && !OPAQUE[blocks[pidx(x, y, z)]] && blocks[pidx(x, y, z)] !== WATER_ID) y--;
    skyMax[x + z * CHUNK] = y;
  }

  const L = [new Buf(), new Buf(), new Buf()];
  const get = (x: number, y: number, z: number) => (y < 0 ? 1 : y >= HEIGHT ? 0 : blocks[pidx(x, y, z)]);
  const occl = (x: number, y: number, z: number) => (y < 0 || y >= HEIGHT ? 0 : OPAQUE[blocks[pidx(x, y, z)]]);

  // ---- greedy cubes
  const mask = new Int32Array(CHUNK * HEIGHT);
  const maskAo = new Uint8Array(CHUNK * HEIGHT * 4);
  const p = [0, 0, 0], q = [0, 0, 0];
  for (let d = 0; d < 6; d++) {
    const axis = DIR_AXIS[d], sgn = DIR_SIGN[d];
    const [ua, va] = UV_AXES[axis];
    const dimA = axis === 1 ? HEIGHT : CHUNK;
    const dimU = ua === 1 ? HEIGHT : CHUNK, dimV = va === 1 ? HEIGHT : CHUNK;
    const flip = sgn !== NATURAL_SIGN[axis];
    for (let s = 0; s < dimA; s++) {
      let any = false;
      for (let v = 0; v < dimV; v++) for (let u = 0; u < dimU; u++) {
        p[axis] = s; p[ua] = u; p[va] = v;
        const mi = u + v * dimU;
        mask[mi] = 0;
        const i = pidx(p[0], p[1], p[2]);
        const id = blocks[i];
        if (!id || SHAPE[id] !== 1) continue;
        q[0] = p[0]; q[1] = p[1]; q[2] = p[2]; q[axis] += sgn;
        if (q[1] < 0 || q[1] >= HEIGHT) { if (q[1] < 0) continue; }
        const nb = q[1] >= HEIGHT ? 0 : blocks[pidx(q[0], q[1], q[2])];
        if (OPAQUE[nb]) continue;
        const layer = LAYER[id];
        if (nb === id && !LEAVES[id]) continue;
        if (layer === 2 && LAYER[nb] === 2 && SHAPE[nb] === 1) continue;
        const ni = q[1] >= HEIGHT ? -1 : pidx(q[0], q[1], q[2]);
        const sl = ni < 0 ? 15 : sky[ni], bl = ni < 0 ? 0 : blk[ni];
        const tile = faceTile(id, meta[i], d);
        // AO
        let a0 = 3, a1 = 3, a2 = 3, a3 = 3;
        if (layer !== 2) {
          const ao = (du: number, dv: number) => {
            const s1x = q[0] + (ua === 0 ? du : 0) + (va === 0 ? 0 : 0), s1y = q[1] + (ua === 1 ? du : 0), s1z = q[2] + (ua === 2 ? du : 0);
            const s2x = q[0] + (va === 0 ? dv : 0), s2y = q[1] + (va === 1 ? dv : 0), s2z = q[2] + (va === 2 ? dv : 0);
            const o1 = occl(s1x, s1y, s1z), o2 = occl(s2x, s2y, s2z);
            const o3 = occl(s1x + (va === 0 ? dv : 0), s1y + (va === 1 ? dv : 0), s1z + (va === 2 ? dv : 0));
            return o1 && o2 ? 0 : 3 - (o1 + o2 + o3);
          };
          a0 = ao(-1, -1); a1 = ao(1, -1); a2 = ao(1, 1); a3 = ao(-1, 1);
        }
        const uniform = a0 === a1 && a1 === a2 && a2 === a3;
        const key = (tile + 1) | (sl << 9) | (bl << 13) | (a0 << 17) | (layer << 19) | ((uniform ? 0 : 1) << 21) | (1 << 22);
        mask[mi] = key;
        const mo = mi * 4;
        maskAo[mo] = a0; maskAo[mo + 1] = a1; maskAo[mo + 2] = a2; maskAo[mo + 3] = a3;
        any = true;
      }
      if (!any) continue;
      for (let v = 0; v < dimV; v++) for (let u = 0; u < dimU;) {
        const key = mask[u + v * dimU];
        if (!key) { u++; continue; }
        let w = 1, h = 1;
        if (!((key >> 21) & 1)) {
          while (u + w < dimU && mask[u + w + v * dimU] === key) w++;
          outer: while (v + h < dimV) {
            for (let k = 0; k < w; k++) if (mask[u + k + (v + h) * dimU] !== key) break outer;
            h++;
          }
        }
        const mo = (u + v * dimU) * 4;
        const ao = [maskAo[mo], maskAo[mo + 1], maskAo[mo + 2], maskAo[mo + 3]];
        const tile = (key & 511) - 1, sl = (key >> 9) & 15, bl = (key >> 13) & 15, layer = (key >> 19) & 3;
        const buf = L[layer];
        const base = s + (sgn > 0 ? 1 : 0);
        const corner = (cu: number, cv: number, k: number) => {
          p[axis] = base; p[ua] = cu; p[va] = cv;
          buf.vert(p[0], p[1], p[2], (cu - u), (cv - v), tile, sl / 15, bl / 15, FACE_SHADE[d] * AO_CURVE[ao[k]]);
        };
        // uv: u axis -> texture u, v axis -> texture v (for side faces v is height)
        corner(u, v, 0); corner(u + w, v, 1); corner(u + w, v + h, 2); corner(u, v + h, 3);
        const aoFlip = ao[0] + ao[2] < ao[1] + ao[3];
        if (aoFlip) {
          const bi = buf.pos.length / 3 - 4;
          if (!flip) buf.idx.push(bi + 1, bi + 2, bi + 3, bi + 1, bi + 3, bi);
          else buf.idx.push(bi + 1, bi + 3, bi + 2, bi + 1, bi, bi + 3);
        } else buf.quad(flip);
        for (let hh = 0; hh < h; hh++) for (let k = 0; k < w; k++) mask[u + k + (v + hh) * dimU] = 0;
        u += w;
      }
    }
  }

  // ---- non-cube shapes
  for (let y = 0; y < HEIGHT; y++) for (let z = 0; z < CHUNK; z++) for (let x = 0; x < CHUNK; x++) {
    const i = pidx(x, y, z);
    const id = blocks[i];
    const sh = SHAPE[id];
    if (sh < 2) continue;
    const m = meta[i];
    const sl = sky[i] / 15, bl = blk[i] / 15;
    if (sh === 2) {
      const buf = L[1];
      const t = faceTile(id, m, 0);
      const o = 0.15;
      const quads: [number, number, number, number][] = [[o, o, 1 - o, 1 - o], [o, 1 - o, 1 - o, o]];
      for (const [ax, az, bx, bz] of quads) {
        for (const back of [false, true]) {
          buf.vert(x + ax, y, z + az, 0, 0, t, sl, bl, 1);
          buf.vert(x + bx, y, z + bz, 1, 0, t, sl, bl, 1);
          buf.vert(x + bx, y + 1, z + bz, 1, 1, t, sl, bl, 1);
          buf.vert(x + ax, y + 1, z + az, 0, 1, t, sl, bl, 1);
          buf.quad(back);
        }
      }
    } else if (sh === 3) {
      liquid(L, blocks, meta, sky, blk, x, y, z, id, m);
    } else {
      const nfn = (dx: number, dy: number, dz: number) => get(x + dx, y + dy, z + dz);
      const boxes = modelBoxes(id, m, nfn);
      const buf = L[LAYER[id] === 2 ? 2 : LAYER[id]];
      for (const bx of boxes) emitBox(buf, bx, x, y, z, id, m, sl, bl, get);
    }
  }
  // light of the centre chunk, returned for entity lighting / spawn rules
  const csky = new Uint8Array(CHUNK_AREA * HEIGHT), cblk = new Uint8Array(CHUNK_AREA * HEIGHT);
  for (let y = 0; y < HEIGHT; y++) for (let z = 0; z < CHUNK; z++) {
    const src = pidx(0, y, z), dst = z * CHUNK + y * CHUNK_AREA;
    csky.set(sky.subarray(src, src + CHUNK), dst);
    cblk.set(blk.subarray(src, src + CHUNK), dst);
  }
  return { layers: L.map((b) => b.out()), skyMax, sky: csky, blk: cblk };
}

function spread(light: Uint8Array, blocks: Uint8Array, q: Int32Array, head: number, tail: number) {
  const N = q.length;
  while (head !== tail) {
    const i = q[head]; head = (head + 1) % N;
    const l = light[i];
    if (l <= 1) continue;
    const y = Math.floor(i / PA), r = i - y * PA, z = Math.floor(r / P), x = r - z * P;
    const nb = (j: number) => {
      const f = LIGHT_FILTER[blocks[j]];
      if (f >= 15) return;
      const nl = l - 1 - f;
      if (nl > light[j]) { light[j] = nl; q[tail] = j; tail = (tail + 1) % N; }
    };
    if (x > 0) nb(i - 1);
    if (x < P - 1) nb(i + 1);
    if (z > 0) nb(i - P);
    if (z < P - 1) nb(i + P);
    if (y > 0) nb(i - PA);
    if (y < HEIGHT - 1) nb(i + PA);
  }
}

function liquidHeight(id: number, m: number, above: number): number {
  if (above === id) return 1;
  if (m & 8) return 0.92; // falling
  const lvl = m & 7;
  return lvl === 0 ? 0.88 : Math.max(0.12, 0.88 - lvl * 0.11);
}
function liquid(L: Buf[], blocks: Uint8Array, meta: Uint8Array, sky: Uint8Array, blk: Uint8Array, x: number, y: number, z: number, id: number, m: number) {
  const buf = id === LAVA_ID ? L[0] : L[2];
  const above = y + 1 < HEIGHT ? blocks[pidx(x, y + 1, z)] : 0;
  const h = liquidHeight(id, m, above);
  const tile = tileId((m & 7) || m & 8 ? (id === WATER_ID ? 'water_flow' : 'lava_flow') : id === WATER_ID ? 'water' : 'lava');
  const i = pidx(x, y, z);
  const sl = sky[i] / 15, bl = blk[i] / 15;
  // top
  if (above !== id) {
    const shade = 1;
    buf.vert(x, y + h, z, 0, 0, tile, sl, bl, shade);
    buf.vert(x + 1, y + h, z, 1, 0, tile, sl, bl, shade);
    buf.vert(x + 1, y + h, z + 1, 1, 1, tile, sl, bl, shade);
    buf.vert(x, y + h, z + 1, 0, 1, tile, sl, bl, shade);
    buf.quad(true);
    // underside of surface so it is visible from below the water
    if (id === WATER_ID) {
      buf.vert(x, y + h, z, 0, 0, tile, sl, bl, 0.7);
      buf.vert(x + 1, y + h, z, 1, 0, tile, sl, bl, 0.7);
      buf.vert(x + 1, y + h, z + 1, 1, 1, tile, sl, bl, 0.7);
      buf.vert(x, y + h, z + 1, 0, 1, tile, sl, bl, 0.7);
      buf.quad(false);
    }
  }
  const sides: [number, number, number][] = [[-1, 0, 0], [1, 0, 0], [0, 0, -1], [0, 0, 1], [0, -1, 0]];
  for (const [dx, dy, dz] of sides) {
    if (y + dy < 0) continue;
    const nb = blocks[pidx(x + dx, y + dy, z + dz)];
    if (nb === id || OPAQUE[nb]) continue;
    const j = pidx(x + dx, y + dy, z + dz);
    const s2 = Math.max(sky[j], sky[i]) / 15, b2 = Math.max(blk[j], blk[i]) / 15;
    const shade = dy ? 0.55 : dx ? 0.78 : 0.88;
    if (dy === -1) {
      buf.vert(x, y, z, 0, 0, tile, s2, b2, shade); buf.vert(x + 1, y, z, 1, 0, tile, s2, b2, shade);
      buf.vert(x + 1, y, z + 1, 1, 1, tile, s2, b2, shade); buf.vert(x, y, z + 1, 0, 1, tile, s2, b2, shade);
      buf.quad(false);
      continue;
    }
    // vertical quad on face
    const fx = dx > 0 ? x + 1 : x, fz = dz > 0 ? z + 1 : z;
    if (dx) {
      buf.vert(fx, y, z, 0, 0, tile, s2, b2, shade); buf.vert(fx, y, z + 1, 1, 0, tile, s2, b2, shade);
      buf.vert(fx, y + h, z + 1, 1, h, tile, s2, b2, shade); buf.vert(fx, y + h, z, 0, h, tile, s2, b2, shade);
      buf.quad(dx > 0);
    } else {
      buf.vert(x, y, fz, 0, 0, tile, s2, b2, shade); buf.vert(x + 1, y, fz, 1, 0, tile, s2, b2, shade);
      buf.vert(x + 1, y + h, fz, 1, h, tile, s2, b2, shade); buf.vert(x, y + h, fz, 0, h, tile, s2, b2, shade);
      buf.quad(dz < 0);
    }
  }
}

/** Emits the 6 faces of a sub-box. Faces on the block boundary are culled against opaque neighbours. */
export function emitBox(buf: Buf, b: Box, x: number, y: number, z: number, id: number, m: number, sl: number, bl: number, get: (x: number, y: number, z: number) => number) {
  const x0 = b[0] / 16, y0 = b[1] / 16, z0 = b[2] / 16, x1 = b[3] / 16, y1 = b[4] / 16, z1 = b[5] / 16;
  const override = b[6] ? tileId(b[6]) : -1;
  for (let d = 0; d < 6; d++) {
    // cull
    const onEdge = [x0 === 0, x1 === 1, y0 === 0, y1 === 1, z0 === 0, z1 === 1][d];
    if (onEdge) {
      const [dx, dy, dz] = [[-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1]][d];
      if (OPAQUE[get(x + dx, y + dy, z + dz)]) continue;
    }
    const tile = override >= 0 ? override : faceTile(id, m, d);
    const sh = FACE_SHADE[d];
    const X0 = x + x0, X1 = x + x1, Y0 = y + y0, Y1 = y + y1, Z0 = z + z0, Z1 = z + z1;
    switch (d) {
      case 0: // -X  (u=z, v=y)
        buf.vert(X0, Y0, Z0, z0, y0, tile, sl, bl, sh); buf.vert(X0, Y0, Z1, z1, y0, tile, sl, bl, sh);
        buf.vert(X0, Y1, Z1, z1, y1, tile, sl, bl, sh); buf.vert(X0, Y1, Z0, z0, y1, tile, sl, bl, sh);
        buf.quad(false); break;
      case 1:
        buf.vert(X1, Y0, Z0, 1 - z0, y0, tile, sl, bl, sh); buf.vert(X1, Y0, Z1, 1 - z1, y0, tile, sl, bl, sh);
        buf.vert(X1, Y1, Z1, 1 - z1, y1, tile, sl, bl, sh); buf.vert(X1, Y1, Z0, 1 - z0, y1, tile, sl, bl, sh);
        buf.quad(true); break;
      case 2: // -Y (u=x, v=z)
        buf.vert(X0, Y0, Z0, x0, z0, tile, sl, bl, sh); buf.vert(X1, Y0, Z0, x1, z0, tile, sl, bl, sh);
        buf.vert(X1, Y0, Z1, x1, z1, tile, sl, bl, sh); buf.vert(X0, Y0, Z1, x0, z1, tile, sl, bl, sh);
        buf.quad(false); break;
      case 3:
        buf.vert(X0, Y1, Z0, x0, z0, tile, sl, bl, sh); buf.vert(X1, Y1, Z0, x1, z0, tile, sl, bl, sh);
        buf.vert(X1, Y1, Z1, x1, z1, tile, sl, bl, sh); buf.vert(X0, Y1, Z1, x0, z1, tile, sl, bl, sh);
        buf.quad(true); break;
      case 4: // -Z (u=x, v=y)
        buf.vert(X0, Y0, Z0, 1 - x0, y0, tile, sl, bl, sh); buf.vert(X1, Y0, Z0, 1 - x1, y0, tile, sl, bl, sh);
        buf.vert(X1, Y1, Z0, 1 - x1, y1, tile, sl, bl, sh); buf.vert(X0, Y1, Z0, 1 - x0, y1, tile, sl, bl, sh);
        buf.quad(true); break;
      case 5:
        buf.vert(X0, Y0, Z1, x0, y0, tile, sl, bl, sh); buf.vert(X1, Y0, Z1, x1, y0, tile, sl, bl, sh);
        buf.vert(X1, Y1, Z1, x1, y1, tile, sl, bl, sh); buf.vert(X0, Y1, Z1, x0, y1, tile, sl, bl, sh);
        buf.quad(false); break;
    }
  }
}

/** Geometry for a single block in isolation (held items, dropped items, falling blocks) */
export function singleBlockMesh(id: number, m = 0): MeshLayer {
  const buf = new Buf();
  const get = () => 0;
  const sh = SHAPE[id];
  if (sh === 2) {
    const t = faceTile(id, m, 0);
    for (const back of [false, true]) {
      buf.vert(0, 0, 0.5, 0, 0, t, 1, 0, 1); buf.vert(1, 0, 0.5, 1, 0, t, 1, 0, 1);
      buf.vert(1, 1, 0.5, 1, 1, t, 1, 0, 1); buf.vert(0, 1, 0.5, 0, 1, t, 1, 0, 1);
      buf.quad(back);
    }
  } else {
    const boxes = sh === 4 ? modelBoxes(id, m, () => 0) : [[0, 0, 0, 16, 16, 16] as Box];
    for (const b of boxes) emitBox(buf, b, 0, 0, 0, id, m, 1, 0, get);
  }
  return buf.out();
}
