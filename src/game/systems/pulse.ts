// "Pulse" signal network – an original block-logic system.
import { B, BLOCKS, OPAQUE } from '../registry/blocks';
import { DIRS, FACING_VEC } from '../constants';
import type { World } from '../world/World';
import type { GameCtx } from '../types';
import { audio } from '../audio/audio';

const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
const isPulse = (id: number) => !!BLOCKS[id]?.pulse;

/** Kinds of scheduled ticks */
export const TICK_FLUID = 0, TICK_PULSE = 1, TICK_BUTTON = 2, TICK_PLATE = 3, TICK_KEG = 4;

export class PulseSystem {
  private queue = new Set<string>();
  private doneWires = new Set<string>();
  constructor(private w: World, private g: GameCtx, private hooks: { dispense(x: number, y: number, z: number): void; primeKeg(x: number, y: number, z: number): void; container(x: number, y: number, z: number): ({ id: number; count: number } | null)[] | null }) {}

  /** something changed at x,y,z – re-evaluate it and its neighbourhood */
  touch(x: number, y: number, z: number) {
    this.queue.add(key(x, y, z));
    for (const d of DIRS) {
      const nx = x + d[0], ny = y + d[1], nz = z + d[2];
      this.queue.add(key(nx, ny, nz));
      if (OPAQUE[this.w.id(nx, ny, nz)]) for (const e of DIRS) this.queue.add(key(nx + e[0], ny + e[1], nz + e[2]));
    }
    // wires climb diagonally
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { this.queue.add(key(x + dx, y + 1, z + dz)); this.queue.add(key(x + dx, y - 1, z + dz)); }
  }
  process() {
    if (!this.queue.size) return;
    const items = [...this.queue];
    this.queue.clear();
    this.doneWires.clear();
    for (const k of items) {
      const [x, y, z] = k.split(',').map(Number);
      const id = this.w.id(x, y, z);
      if (!id || !isPulse(id)) continue;
      this.evaluate(x, y, z, id);
    }
  }

  /* --------------------------------------------- emission */
  /** power emitted by block at (x,y,z) into the neighbour in direction d (DIRS index). strongOnly: ignore wires */
  emitted(x: number, y: number, z: number, d: number, viaSolid = true): number {
    const id = this.w.id(x, y, z);
    if (!id) return 0;
    const m = this.w.meta(x, y, z);
    const p = BLOCKS[id].pulse;
    switch (p) {
      case 'lever': case 'button': case 'plate': return m & 8 ? 15 : 0;
      case 'block': return 15;
      case 'torch': {
        if (m & 8) return 0;
        const att = this.torchAttach(m);
        return d === att ? 0 : 15;
      }
      case 'repeater': return m & 8 && d === [4, 1, 5, 0][m & 3] ? 15 : 0;
      case 'comparator': return d === [4, 1, 5, 0][m & 3] ? ((this.w.blockEntity(x, y, z)?.out as number) ?? 0) : 0;
      case 'wire': return d === 3 ? 0 : m & 15;
    }
    if (viaSolid && OPAQUE[id]) return this.solidPower(x, y, z);
    return 0;
  }
  /** direction index (DIRS) from a torch to the block it is attached to */
  torchAttach(m: number) { const a = m & 7; if (a === 0) return 2; const [fx, fz] = FACING_VEC[(a - 1) & 3]; return fx === 1 ? 1 : fx === -1 ? 0 : fz === 1 ? 5 : 4; }
  /** power of a solid block: max of non-solid emitters around it */
  solidPower(x: number, y: number, z: number, strongOnly = false): number {
    let best = 0;
    for (let d = 0; d < 6; d++) {
      const nx = x + DIRS[d][0], ny = y + DIRS[d][1], nz = z + DIRS[d][2];
      const nid = this.w.id(nx, ny, nz);
      if (!nid || OPAQUE[nid]) continue;
      const kind = BLOCKS[nid].pulse;
      if (!kind) continue;
      if (kind === 'wire') { if (strongOnly) continue; if (d === 3 || this.wirePointsInto(nx, ny, nz, x, z)) best = Math.max(best, this.w.meta(nx, ny, nz) & 15); continue; }
      if (kind === 'torch' && d === 2) { if (!(this.w.meta(nx, ny, nz) & 8)) best = 15; continue; } // torch below powers block above
      if (kind === 'torch') continue;
      best = Math.max(best, this.emitted(nx, ny, nz, d ^ 1, false));
    }
    return best;
  }
  private wirePointsInto(wx: number, wy: number, wz: number, tx: number, tz: number) {
    // a wire with no other horizontal connections points in every direction; otherwise only along its line
    const conn = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dz]) => this.wireConnects(wx, wy, wz, dx, dz));
    if (!conn.length) return true;
    const dx = tx - wx, dz = tz - wz;
    if (conn.length === 1) { const [cx, cz] = conn[0]; return (dx === cx && dz === cz) || (dx === -cx && dz === -cz); }
    return conn.some(([cx, cz]) => cx === dx && cz === dz);
  }
  private wireConnects(x: number, y: number, z: number, dx: number, dz: number) {
    const n = this.w.id(x + dx, y, z + dz);
    if (n && BLOCKS[n].pulse && BLOCKS[n].pulse !== 'consumer') return true;
    if (this.w.id(x + dx, y - 1, z + dz) === B.pulse_wire && !OPAQUE[n]) return true;
    if (this.w.id(x + dx, y + 1, z + dz) === B.pulse_wire && !OPAQUE[this.w.id(x, y + 1, z)]) return true;
    return false;
  }
  /** total power arriving at a consumer */
  input(x: number, y: number, z: number, except = -1): number {
    let best = 0;
    for (let d = 0; d < 6; d++) {
      if (d === except) continue;
      const nx = x + DIRS[d][0], ny = y + DIRS[d][1], nz = z + DIRS[d][2];
      const nid = this.w.id(nx, ny, nz);
      if (!nid) continue;
      if (BLOCKS[nid].pulse === 'wire') { if (d !== 2 && (d === 3 || this.wirePointsInto(nx, ny, nz, x, z))) best = Math.max(best, this.w.meta(nx, ny, nz) & 15); continue; }
      best = Math.max(best, this.emitted(nx, ny, nz, d ^ 1));
      if (best >= 15) return 15;
    }
    return best;
  }

  /* --------------------------------------------- evaluation */
  private evaluate(x: number, y: number, z: number, id: number) {
    const d = BLOCKS[id];
    const m = this.w.meta(x, y, z);
    switch (d.pulse) {
      case 'wire': this.updateWires(x, y, z); return;
      case 'torch': {
        const att = this.torchAttach(m);
        const ax = x + DIRS[att][0], ay = y + DIRS[att][1], az = z + DIRS[att][2];
        const aid = this.w.id(ax, ay, az);
        const powered = OPAQUE[aid] ? this.solidPower(ax, ay, az) > 0 : this.emitted(ax, ay, az, att ^ 1) > 0;
        const lit = !(m & 8);
        if (powered === lit) this.w.schedule(x, y, z, 2, TICK_PULSE);
        return;
      }
      case 'repeater': {
        const back = [5, 0, 4, 1][m & 3]; // opposite of facing dir
        const bx = x + DIRS[back][0], by = y, bz = z + DIRS[back][2];
        const inp = this.emitted(bx, by, bz, back ^ 1) > 0 || (BLOCKS[this.w.id(bx, by, bz)].pulse === 'wire' && (this.w.meta(bx, by, bz) & 15) > 0);
        if (inp !== !!(m & 8)) this.w.schedule(x, y, z, 2 * (((m >> 4) & 3) + 1), TICK_PULSE);
        return;
      }
      case 'comparator': {
        const out = this.comparatorOut(x, y, z, m);
        const be = this.w.blockEntity(x, y, z, 'comparator')!;
        if ((be.out as number ?? 0) !== out) this.w.schedule(x, y, z, 2, TICK_PULSE);
        return;
      }
      case 'consumer': this.consumer(x, y, z, id, m); return;
    }
  }
  private comparatorOut(x: number, y: number, z: number, m: number): number {
    const f = m & 3;
    const back = [5, 0, 4, 1][f];
    const bx = x + DIRS[back][0], bz = z + DIRS[back][2];
    let rear = 0;
    const inv = this.hooks.container(bx, y, bz);
    if (inv) {
      let fill = 0;
      for (const s of inv) if (s) fill += s.count / 64;
      rear = fill === 0 ? 0 : Math.max(1, Math.floor((fill / inv.length) * 14) + 1);
    } else {
      const rid = this.w.id(bx, y, bz);
      rear = BLOCKS[rid].pulse === 'wire' ? this.w.meta(bx, y, bz) & 15 : this.emitted(bx, y, bz, back ^ 1);
    }
    const sides = [[1, 3], [0, 2], [1, 3], [0, 2]][f].map((fi) => { const dd = [4, 1, 5, 0][fi]; const sx = x + DIRS[dd][0], sz = z + DIRS[dd][2]; const sid = this.w.id(sx, y, sz); return BLOCKS[sid].pulse === 'wire' ? this.w.meta(sx, y, sz) & 15 : this.emitted(sx, y, sz, dd ^ 1, false); });
    const side = Math.max(...sides);
    return m & 16 ? Math.max(0, rear - side) : rear >= side ? rear : 0;
  }
  /** scheduled tick for delayed components */
  tick(x: number, y: number, z: number, kind: number) {
    const id = this.w.id(x, y, z);
    const m = this.w.meta(x, y, z);
    if (kind === TICK_BUTTON) {
      if ((id === B.stone_button || id === B.wood_button || id === B.lever) && m & 8 && id !== B.lever) { this.w.set(x, y, z, id, m & ~8); audio.lever([x, y, z]); this.touch(x, y, z); }
      return;
    }
    if (kind === TICK_PLATE) {
      if (id === B.pressure_plate && m & 8 && !this.platePressedFn(x, y, z)) { this.w.set(x, y, z, id, m & ~8); audio.lever([x, y, z]); this.touch(x, y, z); }
      else if (id === B.pressure_plate && m & 8) this.w.schedule(x, y, z, 10, TICK_PLATE);
      return;
    }
    if (kind === TICK_KEG) return;
    const d = BLOCKS[id];
    if (d.pulse === 'torch') {
      const att = this.torchAttach(m);
      const ax = x + DIRS[att][0], ay = y + DIRS[att][1], az = z + DIRS[att][2];
      const aid = this.w.id(ax, ay, az);
      const powered = OPAQUE[aid] ? this.solidPower(ax, ay, az) > 0 : this.emitted(ax, ay, az, att ^ 1) > 0;
      const nm = powered ? m | 8 : m & ~8;
      if (nm !== m) { this.w.set(x, y, z, id, nm); this.touch(x, y, z); if (ay !== y + 1) this.touch(x, y + 2, z); }
    } else if (d.pulse === 'repeater') {
      const back = [5, 0, 4, 1][m & 3];
      const bx = x + DIRS[back][0], bz = z + DIRS[back][2];
      const inp = this.emitted(bx, y, bz, back ^ 1) > 0 || (BLOCKS[this.w.id(bx, y, bz)].pulse === 'wire' && (this.w.meta(bx, y, bz) & 15) > 0);
      const nm = inp ? m | 8 : m & ~8;
      if (nm !== m) { this.w.set(x, y, z, id, nm); this.touchFront(x, y, z, m); }
    } else if (d.pulse === 'comparator') {
      const out = this.comparatorOut(x, y, z, m);
      const be = this.w.blockEntity(x, y, z, 'comparator')!;
      if ((be.out ?? 0) !== out) { be.out = out; this.w.set(x, y, z, id, out > 0 ? m | 8 : m & ~8); this.touchFront(x, y, z, m); }
    }
  }
  private touchFront(x: number, y: number, z: number, m: number) {
    const fd = [4, 1, 5, 0][m & 3];
    const fx = x + DIRS[fd][0], fz = z + DIRS[fd][2];
    this.touch(fx, y, fz);
    this.touch(x, y, z);
  }
  platePressedFn: (x: number, y: number, z: number) => boolean = () => false;

  /* --------------------------------------------- wires */
  private updateWires(sx: number, sy: number, sz: number) {
    if (this.doneWires.has(key(sx, sy, sz))) return;
    // collect component
    const comp: [number, number, number][] = [];
    const seen = new Set<string>();
    const st: [number, number, number][] = [[sx, sy, sz]];
    while (st.length && comp.length < 600) {
      const [x, y, z] = st.pop()!;
      const k = key(x, y, z);
      if (seen.has(k)) continue;
      seen.add(k);
      if (this.w.id(x, y, z) !== B.pulse_wire) continue;
      comp.push([x, y, z]);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        st.push([x + dx, y, z + dz]);
        if (!OPAQUE[this.w.id(x, y + 1, z)]) st.push([x + dx, y + 1, z + dz]);
        if (!OPAQUE[this.w.id(x + dx, y, z + dz)]) st.push([x + dx, y - 1, z + dz]);
      }
    }
    for (const c of comp) this.doneWires.add(key(...c));
    // source levels
    const lv = new Map<string, number>();
    const buckets: [number, number, number][][] = Array.from({ length: 16 }, () => []);
    for (const [x, y, z] of comp) {
      let s = 0;
      for (let d = 0; d < 6; d++) {
        if (d === 3 && false) continue;
        const nx = x + DIRS[d][0], ny = y + DIRS[d][1], nz = z + DIRS[d][2];
        const nid = this.w.id(nx, ny, nz);
        if (!nid || nid === B.pulse_wire) continue;
        if (OPAQUE[nid]) s = Math.max(s, this.solidPower(nx, ny, nz, true));
        else s = Math.max(s, this.emitted(nx, ny, nz, d ^ 1, false));
      }
      lv.set(key(x, y, z), s);
      if (s > 0) buckets[s].push([x, y, z]);
    }
    for (let L = 15; L > 1; L--) {
      for (const [x, y, z] of buckets[L]) {
        if ((lv.get(key(x, y, z)) ?? 0) !== L) continue;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (const dy of [0, 1, -1]) {
          const k = key(x + dx, y + dy, z + dz);
          if (!lv.has(k)) continue;
          if (dy === 1 && OPAQUE[this.w.id(x, y + 1, z)]) continue;
          if (dy === -1 && OPAQUE[this.w.id(x + dx, y, z + dz)]) continue;
          if ((lv.get(k) ?? 0) < L - 1) { lv.set(k, L - 1); buckets[L - 1].push([x + dx, y + dy, z + dz]); }
        }
      }
    }
    for (const [x, y, z] of comp) {
      const nl = lv.get(key(x, y, z)) ?? 0;
      if ((this.w.meta(x, y, z) & 15) !== nl) {
        this.w.set(x, y, z, B.pulse_wire, nl, false);
        // notify everything around changed wires (not other wires – they are already solved)
        for (let d = 0; d < 6; d++) {
          const nx = x + DIRS[d][0], ny = y + DIRS[d][1], nz = z + DIRS[d][2];
          const nid = this.w.id(nx, ny, nz);
          if (nid === B.pulse_wire) continue;
          this.queue.add(key(nx, ny, nz));
          if (OPAQUE[nid]) for (const e of DIRS) { const k = key(nx + e[0], ny + e[1], nz + e[2]); if (this.w.id(nx + e[0], ny + e[1], nz + e[2]) !== B.pulse_wire) this.queue.add(k); }
        }
      }
    }
  }

  /* --------------------------------------------- consumers */
  private consumer(x: number, y: number, z: number, id: number, m: number) {
    const power = this.input(x, y, z);
    const on = power > 0;
    const d = BLOCKS[id];
    if (d.key === 'pulse_lamp') { if (on !== !!(m & 8)) this.w.set(x, y, z, id, on ? m | 8 : m & ~8); return; }
    if (d.orient === 'door') {
      const upper = !!(m & 8);
      const ly = upper ? y - 1 : y;
      const lm = this.w.meta(x, ly, z), um = this.w.meta(x, ly + 1, z);
      const p = this.input(x, ly, z) > 0 || this.input(x, ly + 1, z) > 0;
      const mem = !!(lm & 16);
      if (p !== mem) {
        const open = p;
        this.w.set(x, ly, z, id, (lm & ~(4 | 16)) | (open ? 4 : 0) | (p ? 16 : 0));
        this.w.set(x, ly + 1, z, id, (um & ~4) | (open ? 4 : 0) | 8);
        audio.door([x, y, z], open);
      }
      return;
    }
    if (d.key === 'wood_trapdoor') {
      const mem = !!(m & 16);
      if (on !== mem) { this.w.set(x, y, z, id, (m & ~(4 | 16)) | (on ? 4 | 16 : 0)); audio.door([x, y, z], on); }
      return;
    }
    if (d.key === 'piston' || d.key === 'sticky_piston') {
      const ext = !!(m & 8);
      const face = m & 7;
      const p2 = this.input(x, y, z, face);
      if (p2 > 0 && !ext) this.extend(x, y, z, id, m);
      else if (p2 === 0 && ext) this.retract(x, y, z, id, m);
      return;
    }
    if (d.key === 'dispenser') {
      const mem = !!(m & 8);
      if (on && !mem) { this.w.set(x, y, z, id, m | 8, false); this.hooks.dispense(x, y, z); }
      else if (!on && mem) this.w.set(x, y, z, id, m & ~8, false);
      return;
    }
    if (d.key === 'powder_keg') { if (on) { this.w.set(x, y, z, 0); this.hooks.primeKeg(x, y, z); } return; }
    if (d.key === 'hopper') { if (on !== !!(m & 8)) this.w.set(x, y, z, id, on ? m | 8 : m & ~8, false); return; }
  }
  private immovable(id: number) {
    const d = BLOCKS[id];
    return id === B.bedrock || id === B.obsidian || d.hardness < 0 || !!d.container || id === B.piston_head || id === B.enchanting_table || id === B.mob_cage || ((id === B.piston || id === B.sticky_piston) && false);
  }
  private extend(x: number, y: number, z: number, id: number, m: number) {
    const face = m & 7;
    const [dx, dy, dz] = DIRS[face];
    const line: [number, number, number, number, number][] = [];
    let cx = x + dx, cy = y + dy, cz = z + dz;
    for (let i = 0; i <= 12; i++) {
      const cid = this.w.id(cx, cy, cz);
      if (cid === 0 || BLOCKS[cid].replaceable) break;
      if (this.immovable(cid) || i === 12 || cy < 1 || cy > 126) return;
      if ((cid === B.piston || cid === B.sticky_piston) && this.w.meta(cx, cy, cz) & 8) return;
      line.push([cx, cy, cz, cid, this.w.meta(cx, cy, cz)]);
      cx += dx; cy += dy; cz += dz;
    }
    // final cell must be replaceable; break plants there
    const endId = this.w.id(cx, cy, cz);
    if (endId && BLOCKS[endId].plant) this.g.breakBlock(cx, cy, cz, true);
    for (let i = line.length - 1; i >= 0; i--) {
      const [bx, by, bz, bid, bm] = line[i];
      this.w.set(bx + dx, by + dy, bz + dz, bid, bm);
    }
    this.w.set(x + dx, y + dy, z + dz, B.piston_head, face | (id === B.sticky_piston ? 8 : 0));
    this.w.set(x, y, z, id, m | 8);
    audio.piston([x, y, z]);
    this.pushEntities(x + dx, y + dy, z + dz, dx, dy, dz, line.length + 1);
  }
  pushEntities: (x: number, y: number, z: number, dx: number, dy: number, dz: number, n: number) => void = () => {};
  private retract(x: number, y: number, z: number, id: number, m: number) {
    const face = m & 7;
    const [dx, dy, dz] = DIRS[face];
    const hx = x + dx, hy = y + dy, hz = z + dz;
    if (this.w.id(hx, hy, hz) === B.piston_head) this.w.set(hx, hy, hz, 0);
    if (id === B.sticky_piston) {
      const px = hx + dx, py = hy + dy, pz = hz + dz;
      const pid = this.w.id(px, py, pz);
      if (pid && !this.immovable(pid) && !BLOCKS[pid].replaceable && !BLOCKS[pid].plant) {
        const pm = this.w.meta(px, py, pz);
        this.w.set(px, py, pz, 0);
        this.w.set(hx, hy, hz, pid, pm);
      }
    }
    this.w.set(x, y, z, id, m & ~8);
    audio.piston([x, y, z]);
  }
}
