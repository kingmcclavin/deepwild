import { BLOCKS, collisionBoxes, B } from '../registry/blocks';
import type { World } from '../world/World';

export interface Body {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  hw: number; h: number; // half width, height
  onGround: boolean;
  hitH: boolean; // horizontal collision this step
  inWater: boolean; inLava: boolean; eyeInWater: boolean;
  climbing: boolean;
  fallDist: number;
  slow: number;
}
export const newBody = (x: number, y: number, z: number, hw: number, h: number): Body => ({ x, y, z, vx: 0, vy: 0, vz: 0, hw, h, onGround: false, hitH: false, inWater: false, inLava: false, eyeInWater: false, climbing: false, fallDist: 0, slow: 1 });

type AABB = [number, number, number, number, number, number];
const tmp: AABB[] = [];

function gather(world: World, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): AABB[] {
  tmp.length = 0;
  for (let y = Math.floor(y0); y <= Math.floor(y1); y++) for (let z = Math.floor(z0); z <= Math.floor(z1); z++) for (let x = Math.floor(x0); x <= Math.floor(x1); x++) {
    const id = world.get(x, y, z);
    if (id < 0) { tmp.push([x, y, z, x + 1, y + 1, z + 1]); continue; } // unloaded = wall
    if (!id) continue;
    const d = BLOCKS[id];
    if (!d.solid) continue;
    const m = world.meta(x, y, z);
    for (const b of collisionBoxes(id, m, (dx, dy, dz) => world.id(x + dx, y + dy, z + dz))) {
      tmp.push([x + b[0] / 16, y + b[1] / 16, z + b[2] / 16, x + b[3] / 16, y + b[4] / 16, z + b[5] / 16]);
    }
  }
  return tmp;
}

function clip(boxes: AABB[], a: AABB, axis: 0 | 1 | 2, d: number): number {
  const o1 = axis === 0 ? 1 : 0, o2 = axis === 2 ? 1 : 2;
  for (const b of boxes) {
    if (b[o1 + 3] <= a[o1] + 1e-7 || b[o1] >= a[o1 + 3] - 1e-7) continue;
    if (b[o2 + 3] <= a[o2] + 1e-7 || b[o2] >= a[o2 + 3] - 1e-7) continue;
    if (d > 0 && b[axis] >= a[axis + 3] - 1e-7) d = Math.min(d, b[axis] - a[axis + 3]);
    else if (d < 0 && b[axis + 3] <= a[axis] + 1e-7) d = Math.max(d, b[axis + 3] - a[axis]);
  }
  return d;
}

/** move body by (dx,dy,dz) with collision; supports step-up */
export function move(world: World, b: Body, dx: number, dy: number, dz: number, step = 0.6) {
  const wasGround = b.onGround;
  const run = (ddx: number, ddy: number, ddz: number, a: AABB): [number, number, number] => {
    const boxes = gather(world, Math.min(a[0], a[0] + ddx), Math.min(a[1], a[1] + ddy), Math.min(a[2], a[2] + ddz), Math.max(a[3], a[3] + ddx), Math.max(a[4], a[4] + ddy), Math.max(a[5], a[5] + ddz));
    const ry = clip(boxes, a, 1, ddy); a[1] += ry; a[4] += ry;
    const rx = clip(boxes, a, 0, ddx); a[0] += rx; a[3] += rx;
    const rz = clip(boxes, a, 2, ddz); a[2] += rz; a[5] += rz;
    return [rx, ry, rz];
  };
  const a: AABB = [b.x - b.hw, b.y, b.z - b.hw, b.x + b.hw, b.y + b.h, b.z + b.hw];
  const start = [...a] as AABB;
  let [rx, ry, rz] = run(dx, dy, dz, a);
  const blockedH = Math.abs(rx - dx) > 1e-6 || Math.abs(rz - dz) > 1e-6;
  if (blockedH && step > 0 && (wasGround || (dy < 0 && ry !== dy))) {
    // try stepping up
    const a2 = [...start] as AABB;
    const up = run(0, step, 0, a2)[1];
    const [sx, , sz] = run(dx, 0, dz, a2);
    const down = run(0, -up - 0.01, 0, a2)[1];
    if (sx * sx + sz * sz > rx * rx + rz * rz + 1e-6) {
      a.splice(0, 6, ...a2);
      rx = sx; rz = sz; ry = up + down;
    }
  }
  b.x = (a[0] + a[3]) / 2; b.y = a[1]; b.z = (a[2] + a[5]) / 2;
  b.hitH = Math.abs(rx - dx) > 1e-6 || Math.abs(rz - dz) > 1e-6;
  if (Math.abs(rx - dx) > 1e-6) b.vx = 0;
  if (Math.abs(rz - dz) > 1e-6) b.vz = 0;
  b.onGround = dy < 0 && ry > dy + 1e-6;
  if (Math.abs(ry - dy) > 1e-6) b.vy = 0;
  if (ry < 0) b.fallDist -= ry;
}

/** sample the environment around the body */
export function senseEnv(world: World, b: Body) {
  const x0 = Math.floor(b.x - b.hw + 0.01), x1 = Math.floor(b.x + b.hw - 0.01);
  const z0 = Math.floor(b.z - b.hw + 0.01), z1 = Math.floor(b.z + b.hw - 0.01);
  b.inWater = false; b.inLava = false; b.climbing = false; b.slow = 1;
  let damage = 0;
  for (let y = Math.floor(b.y); y <= Math.floor(b.y + b.h * 0.6); y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
    const id = world.id(x, y, z);
    if (!id) continue;
    if (id === B.water) b.inWater = true;
    else if (id === B.lava) b.inLava = true;
    const d = BLOCKS[id];
    if (d.climbable) b.climbing = true;
    if (d.slow && !d.solid) b.slow = Math.min(b.slow, d.slow);
    if (d.damage && !d.solid) damage = Math.max(damage, d.damage);
  }
  // standing on
  const under = world.id(Math.floor(b.x), Math.floor(b.y - 0.05), Math.floor(b.z));
  if (under) {
    const d = BLOCKS[under];
    if (d.slow && d.solid) b.slow = Math.min(b.slow, d.slow);
    if (d.damage && d.solid && b.onGround) damage = Math.max(damage, d.damage);
  }
  // cactus touch (slightly inset collision)
  for (let z = z0 - 1; z <= z1 + 1; z++) for (let x = x0 - 1; x <= x1 + 1; x++) {
    if (world.id(x, Math.floor(b.y + 0.5), z) === B.cactus) {
      if (b.x + b.hw > x + 0.0 && b.x - b.hw < x + 1 && b.z + b.hw > z && b.z - b.hw < z + 1) damage = Math.max(damage, 1);
    }
  }
  b.eyeInWater = world.id(Math.floor(b.x), Math.floor(b.y + b.h * 0.9), Math.floor(b.z)) === B.water;
  return damage;
}

/** voxel ray cast (DDA). returns hit block, face normal and previous cell */
export interface RayHit { x: number; y: number; z: number; id: number; nx: number; ny: number; nz: number; dist: number; fx: number; fy: number; fz: number }
export function raycast(world: World, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxD: number, hitFluids = false): RayHit | null {
  let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
  const sx = Math.sign(dx), sy = Math.sign(dy), sz = Math.sign(dz);
  const tdx = dx ? Math.abs(1 / dx) : Infinity, tdy = dy ? Math.abs(1 / dy) : Infinity, tdz = dz ? Math.abs(1 / dz) : Infinity;
  let tx = dx > 0 ? (x + 1 - ox) / dx : dx < 0 ? (ox - x) / -dx : Infinity;
  let ty = dy > 0 ? (y + 1 - oy) / dy : dy < 0 ? (oy - y) / -dy : Infinity;
  let tz = dz > 0 ? (z + 1 - oz) / dz : dz < 0 ? (oz - z) / -dz : Infinity;
  let nx = 0, ny = 0, nz = 0, t = 0;
  for (let i = 0; i < 256 && t <= maxD; i++) {
    const id = world.id(x, y, z);
    if (id) {
      const d = BLOCKS[id];
      const fluid = d.shape === 'liquid';
      if (!fluid || hitFluids) {
        if (d.shape === 'model' || d.shape === 'cross' || (fluid && hitFluids)) {
          // precise test against sub-boxes
          const boxes = fluid ? [[0, 0, 0, 16, 14, 16]] : d.shape === 'cross' ? [[3, 0, 3, 13, 13, 13]] : (d.model ? d.model(world.meta(x, y, z), (a, b2, c) => world.id(x + a, y + b2, z + c)) : [[0, 0, 0, 16, 16, 16]]);
          let best = Infinity, bn = [0, 0, 0];
          for (const bx of boxes) {
            const r = rayBox(ox, oy, oz, dx, dy, dz, x + bx[0] / 16, y + bx[1] / 16, z + bx[2] / 16, x + (bx[3] as number) / 16, y + (bx[4] as number) / 16, z + (bx[5] as number) / 16);
            if (r && r[0] < best) { best = r[0]; bn = r[1]; }
          }
          if (best <= maxD) return { x, y, z, id, nx: bn[0], ny: bn[1], nz: bn[2], dist: best, fx: ox + dx * best - x, fy: oy + dy * best - y, fz: oz + dz * best - z };
        } else return { x, y, z, id, nx, ny, nz, dist: t, fx: ox + dx * t - x, fy: oy + dy * t - y, fz: oz + dz * t - z };
      }
    }
    if (tx < ty && tx < tz) { x += sx; t = tx; tx += tdx; nx = -sx; ny = 0; nz = 0; }
    else if (ty < tz) { y += sy; t = ty; ty += tdy; nx = 0; ny = -sy; nz = 0; }
    else { z += sz; t = tz; tz += tdz; nx = 0; ny = 0; nz = -sz; }
  }
  return null;
}
export function rayBox(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): [number, number[]] | null {
  let tmin = -Infinity, tmax = Infinity, n = [0, 0, 0];
  const axes: [number, number, number, number, number][] = [[ox, dx, x0, x1, 0], [oy, dy, y0, y1, 1], [oz, dz, z0, z1, 2]];
  for (const [o, d, a, b2, ax] of axes) {
    if (Math.abs(d) < 1e-9) { if (o < a || o > b2) return null; continue; }
    let t1 = (a - o) / d, t2 = (b2 - o) / d, s = -1;
    if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; s = 1; }
    if (t1 > tmin) { tmin = t1; n = [0, 0, 0]; n[ax] = s; }
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  if (tmax < 0) return null;
  return [Math.max(0, tmin), n];
}
