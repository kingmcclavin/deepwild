import * as THREE from 'three';
import { B, BLOCKS, SOLID } from '../registry/blocks';
import { ITEMS, itemByKey, type ItemStack } from '../registry/items';
import { itemIconCanvas } from '../gfx/textures';
import { singleBlockMesh } from '../world/mesher';
import { newBody, move, senseEnv, raycast, type Body } from './physics';
import { buildModel, MODELS, MOB_TINTS, type ModelInstance } from './models';
import { MOBS, PROFESSIONS, type MobDef } from './mobs';
import { audio } from '../audio/audio';
import type { GameCtx } from '../types';
import { DYE_COLORS } from '../registry/blocks';

let NEXT_ID = 1;
export abstract class Entity {
  id = NEXT_ID++;
  body: Body;
  yaw = 0;
  pitch = 0;
  age = 0;
  dead = false;
  obj: THREE.Object3D = new THREE.Group();
  persistent = false;
  abstract kind: string;
  constructor(x: number, y: number, z: number, hw: number, h: number) { this.body = newBody(x, y, z, hw, h); }
  get x() { return this.body.x; } get y() { return this.body.y; } get z() { return this.body.z; }
  abstract update(dt: number, g: GameCtx): void;
  render(_alpha: number, g: GameCtx) {
    this.obj.position.set(this.body.x, this.body.y, this.body.z);
    this.obj.rotation.y = this.yaw;
    void g;
  }
  dispose() {
    this.obj.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry && !m.geometry.userData.shared) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose()); else mat?.dispose();
    });
  }
  serialize(): Record<string, unknown> | null { return null; }
  distTo(x: number, y: number, z: number) { return Math.hypot(this.body.x - x, this.body.y - y, this.body.z - z); }
}

/* ======================================================================= Items */
const blockGeoCache = new Map<number, THREE.BufferGeometry>();
export function blockGeometry(id: number, meta = 0): THREE.BufferGeometry {
  let g = blockGeoCache.get(id);
  if (!g) {
    const m = singleBlockMesh(id, meta);
    g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(m.pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(m.uv, 2));
    g.setAttribute('attr', new THREE.BufferAttribute(m.attr, 4));
    g.setIndex(new THREE.BufferAttribute(m.idx, 1));
    g.translate(-0.5, 0, -0.5);
    g.userData.shared = true;
    blockGeoCache.set(id, g);
  }
  return g;
}
const spriteTexCache = new Map<string, THREE.Texture>();
export function itemTexture(s: ItemStack): THREE.Texture {
  const k = `${s.id}:${s.data ?? ''}`;
  let t = spriteTexCache.get(k);
  if (!t) {
    t = new THREE.CanvasTexture(itemIconCanvas(s));
    t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace;
    spriteTexCache.set(k, t);
  }
  return t;
}
export let terrainMats: { opaque: THREE.Material; cutout: THREE.Material } | null = null;
export function setTerrainMats(m: { opaque: THREE.Material; cutout: THREE.Material }) { terrainMats = m; }

export class ItemEntity extends Entity {
  kind = 'item';
  pickupDelay = 0.6;
  private mat: THREE.MeshBasicMaterial | null = null;
  constructor(x: number, y: number, z: number, public stack: ItemStack) {
    super(x, y, z, 0.125, 0.25);
    this.persistent = true;
    const d = ITEMS[stack.id];
    if (d.block !== undefined && d.id < 256 && BLOCKS[d.id].shape !== 'cross' && terrainMats) {
      const mesh = new THREE.Mesh(blockGeometry(d.id), BLOCKS[d.id].layer === 1 ? terrainMats.cutout : terrainMats.opaque);
      mesh.scale.setScalar(0.25);
      (this.obj as THREE.Group).add(mesh);
    } else {
      this.mat = new THREE.MeshBasicMaterial({ map: itemTexture(stack), transparent: true, alphaTest: 0.5, side: THREE.DoubleSide });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.4), this.mat);
      m.position.y = 0.2;
      (this.obj as THREE.Group).add(m);
    }
  }
  update(dt: number, g: GameCtx) {
    this.age += dt;
    this.pickupDelay -= dt;
    const b = this.body;
    senseEnv(g.world, b);
    if (b.inWater) { b.vy += (1.2 - b.vy) * dt * 2; } else b.vy -= 18 * dt;
    if (b.inLava && !ITEMS[this.stack.id].key.startsWith('cinderite') && this.stack.id !== itemByKey('ember_core').id && this.stack.id !== itemByKey('sovereign_heart').id) { this.dead = true; g.particles(b.x, b.y, b.z, [1, 0.5, 0.1], 6); return; }
    const f = b.onGround ? Math.pow(0.02, dt) : Math.pow(0.6, dt);
    b.vx *= f; b.vz *= f;
    move(g.world, b, b.vx * dt, b.vy * dt, b.vz * dt, 0);
    if (this.age > 300) this.dead = true;
    if (b.y < -40) this.dead = true;
  }
  render(_a: number, g: GameCtx) {
    this.obj.position.set(this.body.x, this.body.y + 0.1 + Math.sin(this.age * 2.5) * 0.06, this.body.z);
    this.obj.rotation.y = this.age * 1.4;
    if (this.mat) this.mat.color.setScalar(g.lightAt(this.body.x, this.body.y + 0.3, this.body.z));
  }
  serialize() { return { t: 'item', x: this.x, y: this.y, z: this.z, s: this.stack, age: this.age }; }
}

export class XPOrb extends Entity {
  kind = 'xp';
  constructor(x: number, y: number, z: number, public amount: number) {
    super(x, y, z, 0.12, 0.25);
    const s = Math.min(0.35, 0.12 + Math.sqrt(amount) * 0.04);
    const m = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), new THREE.MeshBasicMaterial({ color: 0x9bf05a }));
    (this.obj as THREE.Group).add(m);
    this.body.vx = (Math.random() - 0.5) * 3; this.body.vy = 3 + Math.random() * 2; this.body.vz = (Math.random() - 0.5) * 3;
  }
  update(dt: number, g: GameCtx) {
    this.age += dt;
    const b = this.body, p = g.player;
    const dx = p.x - b.x, dy = p.y + 0.8 - b.y, dz = p.z - b.z, d = Math.hypot(dx, dy, dz);
    if (d < 7 && !p.dead && this.age > 0.4) { const k = (1 - d / 7) * 30 * dt; b.vx += (dx / d) * k; b.vy += (dy / d) * k; b.vz += (dz / d) * k; }
    else b.vy -= 12 * dt;
    b.vx *= Math.pow(0.4, dt); b.vz *= Math.pow(0.4, dt);
    move(g.world, b, b.vx * dt, b.vy * dt, b.vz * dt, 0);
    if (this.age > 300) this.dead = true;
  }
  render() {
    this.obj.position.set(this.body.x, this.body.y + 0.15, this.body.z);
    this.obj.rotation.set(this.age * 2, this.age * 3, 0);
    ((this.obj.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial).color.setHSL(0.25 + Math.sin(this.age * 6) * 0.05, 0.9, 0.6);
  }
}

export class FallingBlock extends Entity {
  kind = 'falling';
  constructor(x: number, y: number, z: number, public block: number) {
    super(x + 0.5, y, z + 0.5, 0.49, 0.98);
    if (terrainMats) (this.obj as THREE.Group).add(new THREE.Mesh(blockGeometry(block), terrainMats.opaque));
  }
  update(dt: number, g: GameCtx) {
    const b = this.body;
    b.vy = Math.max(-30, b.vy - 25 * dt);
    move(g.world, b, 0, b.vy * dt, 0, 0);
    this.age += dt;
    if (b.onGround || this.age > 20) {
      this.dead = true;
      const x = Math.floor(b.x), y = Math.round(b.y), z = Math.floor(b.z);
      const cur = g.world.id(x, y, z);
      if (BLOCKS[cur].replaceable) g.world.set(x, y, z, this.block);
      else g.spawnItem(b.x, b.y + 0.5, b.z, { id: this.block, count: 1 });
    }
  }
}

/* ======================================================================= Projectiles */
export type ProjKind = 'arrow' | 'fireball' | 'shard' | 'hex' | 'snowball' | 'egg';
export class Projectile extends Entity {
  kind = 'proj';
  stuck = false;
  life = 0;
  target: Entity | null = null;
  pickupable = false;
  fire = false;
  constructor(x: number, y: number, z: number, vx: number, vy: number, vz: number, public pk: ProjKind, public fromPlayer: boolean, public damage: number) {
    super(x, y, z, 0.1, 0.2);
    Object.assign(this.body, { vx, vy, vz });
    const g = this.obj as THREE.Group;
    if (pk === 'arrow') {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.6), new THREE.MeshBasicMaterial({ color: 0x8b6236 }));
      const tip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.1), new THREE.MeshBasicMaterial({ color: 0xd8dbde }));
      tip.position.z = 0.32;
      g.add(m, tip);
    } else {
      const col = pk === 'fireball' ? 0xff7a1a : pk === 'shard' ? 0xc8a0ff : pk === 'hex' ? 0x8a4aff : pk === 'egg' ? 0xf0e0c0 : 0xffffff;
      const s = pk === 'fireball' ? 0.45 : pk === 'shard' ? 0.5 : 0.25;
      g.add(new THREE.Mesh(new THREE.BoxGeometry(s, s, s), new THREE.MeshBasicMaterial({ color: col })));
    }
  }
  update(dt: number, g: GameCtx) {
    this.life += dt;
    const b = this.body;
    if (this.stuck) { if (this.life > 30) this.dead = true; return; }
    if (this.life > 12) { this.dead = true; return; }
    const grav = this.pk === 'arrow' ? 16 : this.pk === 'snowball' || this.pk === 'egg' ? 14 : 0;
    b.vy -= grav * dt;
    if ((this.pk === 'shard' || this.pk === 'hex') && !this.fromPlayer) {
      const p = g.player;
      const dx = p.x - b.x, dy = p.y + 1 - b.y, dz = p.z - b.z, d = Math.hypot(dx, dy, dz) || 1;
      const sp = Math.hypot(b.vx, b.vy, b.vz);
      const k = this.pk === 'shard' ? 2.2 : 1.4;
      b.vx += (dx / d * sp - b.vx) * k * dt; b.vy += (dy / d * sp - b.vy) * k * dt; b.vz += (dz / d * sp - b.vz) * k * dt;
    }
    const sp = Math.hypot(b.vx, b.vy, b.vz);
    const step = sp * dt;
    // block hit
    const hit = raycast(g.world, b.x, b.y, b.z, b.vx / sp, b.vy / sp, b.vz / sp, step);
    if (this.pk === 'fireball' || this.pk === 'shard' || this.pk === 'hex') g.particles(b.x, b.y, b.z, this.pk === 'fireball' ? [1, 0.5, 0.1] : [0.7, 0.5, 1], 1, 0.5, 0, 0.12);
    // entity hit
    const ents = (g as unknown as { entities: EntityManager }).entities;
    if (this.fromPlayer) {
      for (const e of ents.list) {
        if (!(e instanceof Mob) || e.dead) continue;
        if (segmentHits(b, e.body, step / sp)) { this.hitMob(e, g); return; }
      }
    } else {
      const p = g.player;
      if (!p.dead && Math.abs(b.x - p.x) < 0.5 && b.y > p.y - 0.1 && b.y < p.y + 1.9 && Math.abs(b.z - p.z) < 0.5) {
        if (p.hurt(this.damage, { kind: this.pk === 'fireball' ? 'fireball' : 'projectile', x: b.x, y: b.y, z: b.z })) {
          p.knock(b.vx, b.vz, 0.5);
          if (this.pk === 'fireball') p.setFire(4);
          if (this.pk === 'hex') p.addEffect('slowness', 4, 0);
        }
        this.impact(g); return;
      }
      for (const e of ents.list) {
        if (e instanceof Mob && (e.def.key === 'wayfolk' || e.def.key === 'stoneward') && segmentHits(b, e.body, step / sp)) { e.hurt(this.damage, g, null); this.impact(g); return; }
      }
    }
    if (hit) {
      if (this.pk === 'arrow') {
        b.x += b.vx / sp * hit.dist; b.y += b.vy / sp * hit.dist; b.z += b.vz / sp * hit.dist;
        this.stuck = true; this.life = 0; b.vx = b.vy = b.vz = 0;
        audio.noise(0.08, 900, 2, 0.3, 'bandpass', [b.x, b.y, b.z]);
        if (this.fire && hit.id === B.powder_keg) { g.world.set(hit.x, hit.y, hit.z, 0); g.explode(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5, 4, false, true); }
      } else this.impact(g, hit.x, hit.y, hit.z, hit.nx, hit.ny, hit.nz);
      return;
    }
    b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
  }
  hitMob(e: Mob, g: GameCtx) {
    const sp = Math.hypot(this.body.vx, this.body.vy, this.body.vz);
    const dmg = this.pk === 'arrow' ? Math.ceil(this.damage * Math.min(1.2, sp / 30)) : this.damage;
    if (e.hurt(dmg, g, 'player')) {
      e.knockback(this.body.vx, this.body.vz, 0.4);
      if (this.fire) e.fireT = 5;
    }
    this.impact(g);
  }
  impact(g: GameCtx, bx?: number, by?: number, bz?: number, nx = 0, ny = 0, nz = 0) {
    this.dead = true;
    const b = this.body;
    if (this.pk === 'fireball') {
      if (this.fromPlayer || this.damage >= 6) g.explode(b.x, b.y, b.z, 1.2, true, this.fromPlayer);
      else if (bx !== undefined && g.rules.fireSpread) { const fx = bx + nx, fy = by! + ny, fz = bz! + nz; if (g.world.id(fx, fy, fz) === 0) g.world.set(fx, fy, fz, B.fire); }
      g.particles(b.x, b.y, b.z, [1, 0.5, 0.1], 14, 3);
    } else if (this.pk === 'egg') {
      g.particles(b.x, b.y, b.z, [0.95, 0.9, 0.8], 8, 2);
      if (Math.random() < 0.125) (g as unknown as { entities: EntityManager }).entities.spawnMob('cluckit', b.x, b.y, b.z, { baby: true });
    } else g.particles(b.x, b.y, b.z, this.pk === 'snowball' ? [1, 1, 1] : [0.8, 0.6, 1], 8, 2);
  }
  render() {
    const b = this.body;
    this.obj.position.set(b.x, b.y, b.z);
    if (!this.stuck && this.pk === 'arrow') {
      const sp = Math.hypot(b.vx, b.vy, b.vz) || 1;
      this.obj.lookAt(b.x + b.vx / sp, b.y + b.vy / sp, b.z + b.vz / sp);
    } else if (this.pk !== 'arrow') this.obj.rotation.set(this.life * 5, this.life * 7, 0);
  }
}
function segmentHits(p: Body, t: Body, dt: number): boolean {
  const steps = 4;
  for (let i = 0; i <= steps; i++) {
    const x = p.x + p.vx * dt * (i / steps), y = p.y + p.vy * dt * (i / steps), z = p.z + p.vz * dt * (i / steps);
    if (Math.abs(x - t.x) < t.hw + 0.15 && y > t.y - 0.1 && y < t.y + t.h + 0.1 && Math.abs(z - t.z) < t.hw + 0.15) return true;
  }
  return false;
}

/* ======================================================================= Vehicles */
export class Boat extends Entity {
  kind = 'boat';
  rider = false;
  hp = 4;
  constructor(x: number, y: number, z: number) {
    super(x, y, z, 0.6, 0.55);
    this.persistent = true;
    const mat = new THREE.MeshBasicMaterial({ color: 0x9c7546 });
    const g = this.obj as THREE.Group;
    const floor = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.12, 1.8), mat); floor.position.y = 0.1;
    const s1 = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.4, 1.8), mat); s1.position.set(-0.6, 0.3, 0);
    const s2 = s1.clone(); s2.position.x = 0.6;
    const f = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.4, 0.12), mat); f.position.set(0, 0.3, 0.9);
    const bk = f.clone(); bk.position.z = -0.9;
    g.add(floor, s1, s2, f, bk);
  }
  update(dt: number, g: GameCtx) {
    const b = this.body;
    senseEnv(g.world, b);
    const waterBelow = g.world.id(Math.floor(b.x), Math.floor(b.y + 0.2), Math.floor(b.z)) === B.water;
    if (b.inWater || waterBelow) b.vy += ((waterBelow && !b.inWater ? 0 : 2) - b.vy) * dt * 4;
    else b.vy -= 20 * dt;
    const drag = b.inWater || waterBelow ? Math.pow(0.4, dt) : Math.pow(0.02, dt);
    b.vx *= drag; b.vz *= drag;
    move(g.world, b, b.vx * dt, b.vy * dt, b.vz * dt, 0);
  }
  drive(f: number, s: number, yaw: number, dt: number) {
    this.yaw = yaw;
    const sp = 6;
    this.body.vx += (-Math.sin(yaw) * f * sp - this.body.vx) * dt * 1.5 * (f ? 1 : 0);
    this.body.vz += (-Math.cos(yaw) * f * sp - this.body.vz) * dt * 1.5 * (f ? 1 : 0);
    void s;
  }
  serialize() { return { t: 'boat', x: this.x, y: this.y, z: this.z, yaw: this.yaw }; }
}
export class Cart extends Entity {
  kind = 'cart';
  rider = false;
  speed = 0;
  dir: [number, number] = [1, 0];
  hp = 4;
  constructor(x: number, y: number, z: number) {
    super(x, y, z, 0.45, 0.7);
    this.persistent = true;
    const mat = new THREE.MeshBasicMaterial({ color: 0x8f9399 });
    const g = this.obj as THREE.Group;
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.1, 1.1), mat); base.position.y = 0.15;
    g.add(base);
    for (const [px, pz, w, d] of [[-0.45, 0, 0.08, 1.1], [0.45, 0, 0.08, 1.1], [0, 0.55, 0.9, 0.08], [0, -0.55, 0.9, 0.08]] as const) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.45, d), mat); m.position.set(px, 0.4, pz); g.add(m);
    }
  }
  update(dt: number, g: GameCtx) {
    const b = this.body;
    const x = Math.floor(b.x), y = Math.floor(b.y + 0.1), z = Math.floor(b.z);
    const onRail = g.world.id(x, y, z) === B.rail;
    if (!onRail) {
      b.vy -= 20 * dt; b.vx *= Math.pow(0.1, dt); b.vz *= Math.pow(0.1, dt);
      move(g.world, b, b.vx * dt, b.vy * dt, b.vz * dt, 0);
      return;
    }
    const rail = (xx: number, zz: number) => g.world.id(xx, y, zz) === B.rail || g.world.id(xx, y - 1, zz) === B.rail || g.world.id(xx, y + 1, zz) === B.rail;
    // keep direction; turn at corners
    const cx = x + 0.5, cz = z + 0.5;
    const nearCentre = Math.abs(b.x - cx) < 0.15 && Math.abs(b.z - cz) < 0.15;
    if (nearCentre && !rail(x + this.dir[0], z + this.dir[1])) {
      const left: [number, number] = [this.dir[1], -this.dir[0]], right: [number, number] = [-this.dir[1], this.dir[0]];
      if (rail(x + left[0], z + left[1])) { this.dir = left; b.x = cx; b.z = cz; }
      else if (rail(x + right[0], z + right[1])) { this.dir = right; b.x = cx; b.z = cz; }
      else this.speed *= -0.3, this.dir = [-this.dir[0], -this.dir[1]] as [number, number], this.speed = Math.abs(this.speed);
    }
    // align to rail axis
    if (this.dir[0]) b.z += (cz - b.z) * Math.min(1, dt * 10); else b.x += (cx - b.x) * Math.min(1, dt * 10);
    this.speed *= Math.pow(0.85, dt);
    const ny = g.world.id(x + this.dir[0], y + 1, z + this.dir[1]) === B.rail ? 1 : g.world.id(x + this.dir[0], y - 1, z + this.dir[1]) === B.rail ? -1 : 0;
    if (ny < 0) this.speed += 6 * dt;
    if (ny > 0) this.speed -= 4 * dt;
    if (this.speed < 0) { this.speed = -this.speed; this.dir = [-this.dir[0], -this.dir[1]]; }
    b.vx = this.dir[0] * this.speed; b.vz = this.dir[1] * this.speed;
    b.vy = ny > 0 && this.speed > 0.5 ? 6 : -4;
    move(g.world, b, b.vx * dt, b.vy * dt, b.vz * dt, 1.05);
    if (b.hitH) this.speed = 0;
    this.yaw = Math.atan2(-this.dir[0], -this.dir[1]);
  }
  push(f: number, yaw: number) {
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    if (Math.abs(fx) > Math.abs(fz)) this.dir = [Math.sign(fx) as number, 0]; else this.dir = [0, Math.sign(fz) as number];
    this.speed = Math.min(9, this.speed + f);
  }
  serialize() { return { t: 'cart', x: this.x, y: this.y, z: this.z }; }
}

/* ======================================================================= Fishing bobber */
export class Bobber extends Entity {
  kind = 'bobber';
  biteAt = 0;
  biting = 0;
  constructor(x: number, y: number, z: number, vx: number, vy: number, vz: number) {
    super(x, y, z, 0.1, 0.2);
    Object.assign(this.body, { vx, vy, vz });
    const g = this.obj as THREE.Group;
    const r = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.1, 0.15), new THREE.MeshBasicMaterial({ color: 0xd83a3a }));
    const w = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.08, 0.15), new THREE.MeshBasicMaterial({ color: 0xf0f0f0 })); w.position.y = 0.09;
    g.add(r, w);
  }
  update(dt: number, g: GameCtx) {
    this.age += dt;
    const b = this.body;
    senseEnv(g.world, b);
    if (b.inWater) {
      b.vy += (1 - b.vy) * dt * 5; b.vx *= Math.pow(0.05, dt); b.vz *= Math.pow(0.05, dt);
      if (!this.biteAt) this.biteAt = this.age + 5 + Math.random() * 20;
      if (this.age > this.biteAt && !this.biting) { this.biting = 1.2; audio.splash([b.x, b.y, b.z]); g.particles(b.x, b.y + 0.2, b.z, [0.6, 0.75, 1], 10, 2); }
      if (this.biting) { this.biting -= dt; b.vy = -1.5; if (this.biting <= 0) { this.biting = 0; this.biteAt = this.age + 5 + Math.random() * 20; } }
    } else b.vy -= 16 * dt;
    move(g.world, b, b.vx * dt, b.vy * dt, b.vz * dt, 0);
    if (Math.hypot(b.x - g.player.x, b.z - g.player.z) > 32) this.dead = true;
  }
}

/* ======================================================================= Mobs */
interface PathNode { x: number; y: number; z: number }

export class Mob extends Entity {
  kind = 'mob';
  def: MobDef;
  hp: number;
  model: ModelInstance;
  hurtT = 0;
  attackT = 0;
  fireT = 0;
  state: 'idle' | 'wander' | 'flee' | 'chase' | 'home' = 'idle';
  target: { x: number; y: number; z: number } | null = null;
  targetMob: Mob | null = null;
  aggro = false; // provoked (neutral mobs)
  path: PathNode[] = [];
  pathT = 0;
  thinkT = Math.random() * 2;
  walk = 0;
  baby = false;
  growT = 0;
  love = 0;
  breedCd = 0;
  sheared = false;
  regrowT = 0;
  color = 0;
  tamed = false;
  saddled = false;
  leashed = false;
  ridden = false;
  fuse = 0;
  phase = 0;
  special = 0;
  special2 = 0;
  home: [number, number, number] | null = null;
  prof = '';
  trades: { give: [number, number]; get: [number, number]; uses: number; max: number }[] = [];
  rep = 0;
  villageId = '';
  siege = false;
  cageSpawn = false;
  eggT = 0;
  despawnT = 0;
  bossId = '';
  airT = 10;
  idleSoundT = 3 + Math.random() * 10;

  constructor(key: string, x: number, y: number, z: number, opts: { baby?: boolean; color?: number; prof?: string } = {}) {
    const def = MOBS[key];
    super(x, y, z, def.w, def.h);
    this.def = def;
    this.hp = def.hp;
    this.persistent = !def.hostile || !!def.boss;
    this.baby = !!opts.baby;
    if (this.baby) { this.growT = 300; this.body.hw *= 0.5; this.body.h *= 0.5; }
    const tints = MOB_TINTS[key];
    if (opts.color !== undefined) this.color = opts.color;
    else if (tints) this.color = Math.floor(Math.random() * tints.length);
    if (key === 'wayfolk') this.prof = opts.prof ?? 'farmer';
    let tint: string | undefined = tints?.[this.color];
    if (key === 'wayfolk') tint = undefined;
    const def2 = MODELS[def.model];
    const mdef = key === 'wayfolk' ? { ...def2, parts: def2.parts.map((p) => (p.n === 'body' || p.n === 'head' || p.n.startsWith('arm') ? { ...p, c: PROFESSIONS[this.prof]?.robe ?? p.c } : p)) } : key === 'steed' && tints ? { ...def2, parts: def2.parts.map((p) => (['body', 'neck', 'head'].includes(p.n) ? { ...p, c: tints[this.color] } : p)) } : def2;
    this.model = buildModel(key === 'wayfolk' ? `wayfolk_${this.prof}` : key === 'steed' ? `steed_${this.color}` : key, mdef, tint);
    (this.obj as THREE.Group).add(this.model.root);
    if (this.baby) this.model.root.scale.setScalar(0.5);
    if (this.model.parts.saddle) this.model.parts.saddle.visible = false;
    this.yaw = Math.random() * Math.PI * 2;
    if (key === 'wayfolk') this.genTrades();
  }
  get name() { return this.def.key === 'wayfolk' ? `${PROFESSIONS[this.prof]?.name ?? 'Wayfolk'}` : this.def.name; }
  genTrades() {
    const p = PROFESSIONS[this.prof] ?? PROFESSIONS.farmer;
    this.trades = p.trades.map(([gi, gc, ri, rc]) => ({ give: [itemByKey(gi).id, gc], get: [itemByKey(ri).id, rc], uses: 0, max: 8 + Math.floor(Math.random() * 6) }));
  }

  /* ---------- combat ---------- */
  hurt(amount: number, g: GameCtx, src: 'player' | 'mob' | 'env' | null, crit = false): boolean {
    if (this.dead || this.hurtT > 0.45) return false;
    if (this.def.key === 'sovereign' && this.special2 > 0) amount *= 0.1; // shielded
    this.hp -= amount;
    this.hurtT = 0.5;
    audio.creature(this.def.voice, [this.x, this.y + 1, this.z], 'hurt');
    audio.hit([this.x, this.y + 1, this.z], crit);
    if (src === 'player') {
      this.aggro = true;
      if (!this.def.hostile && this.def.ai !== 'guardian' && this.def.ai !== 'villager') { this.state = 'flee'; this.thinkT = 5; }
      if (this.def.ai === 'villager') { this.rep -= 5; this.state = 'flee'; this.thinkT = 4; }
      if (this.def.ai === 'guardian') this.targetPlayer = true;
    }
    if (this.hp <= 0) this.die(g, src === 'player');
    return true;
  }
  targetPlayer = false;
  knockback(dx: number, dz: number, strength: number) {
    const r = 1 - (this.def.knockResist ?? 0);
    if (r <= 0) return;
    const l = Math.hypot(dx, dz) || 1;
    this.body.vx += (dx / l) * 9 * strength * r;
    this.body.vz += (dz / l) * 9 * strength * r;
    this.body.vy = Math.max(this.body.vy, 5 * strength * r);
  }
  lootingBonus = 0;
  die(g: GameCtx, byPlayer: boolean) {
    this.dead = true;
    audio.creature(this.def.voice, [this.x, this.y + 1, this.z], 'death');
    g.particles(this.x, this.y + this.body.h / 2, this.z, [0.85, 0.85, 0.85], 14, 2.5, -2, 0.18);
    if (this.baby) return;
    for (const d of this.def.drops) {
      if (d.chance !== undefined && Math.random() > d.chance + (byPlayer ? this.lootingBonus * 0.02 : 0)) continue;
      let n = d.min + Math.floor(Math.random() * (d.max - d.min + 1));
      if (d.looting && byPlayer) n += Math.floor(Math.random() * (this.lootingBonus + 1));
      let key = d.item;
      if (this.fireT > 0 && key.startsWith('raw_')) key = 'cooked_' + key.slice(4);
      if (n > 0) g.spawnItem(this.x, this.y + 0.5, this.z, { id: itemByKey(key).id, count: n });
    }
    if (this.def.key === 'fluffer' && !this.sheared) g.spawnItem(this.x, this.y + 0.5, this.z, { id: B[`wool_${DYE_COLORS[[0, 0, 0, 1, 7, 0][this.color] ?? 0]}`], count: 1 });
    if (this.saddled) g.spawnItem(this.x, this.y + 0.5, this.z, { id: itemByKey('saddle').id, count: 1 });
    if (byPlayer && this.def.xp) g.spawnXP(this.x, this.y + 0.5, this.z, this.def.xp);
    if (this.def.boss) g.onBossDefeated(this.def.key, this.x, this.y, this.z);
  }

  /* ---------- AI helpers ---------- */
  private walkable(g: GameCtx, x: number, y: number, z: number): boolean {
    const w = g.world;
    const h = Math.ceil(this.body.h);
    for (let i = 0; i < h; i++) { const id = w.get(x, y + i, z); if (id < 0 || SOLID[id] || id === B.lava || id === B.fire) return false; }
    const below = w.get(x, y - 1, z);
    return below > 0 && (SOLID[below] === 1 || below === B.water) && below !== B.cactus && below !== B.magma_block;
  }
  findPath(g: GameCtx, tx: number, ty: number, tz: number, maxNodes = 260): PathNode[] {
    const sx = Math.floor(this.body.x), sy = Math.floor(this.body.y + 0.01), sz = Math.floor(this.body.z);
    const gx = Math.floor(tx), gy = Math.floor(ty), gz = Math.floor(tz);
    const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
    const open: { x: number; y: number; z: number; g: number; f: number }[] = [{ x: sx, y: sy, z: sz, g: 0, f: 0 }];
    const came = new Map<string, string>();
    const gs = new Map<string, number>([[key(sx, sy, sz), 0]]);
    let best = open[0], bestH = Infinity, n = 0;
    while (open.length && n++ < maxNodes) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
      const c = open.splice(bi, 1)[0];
      const h = Math.abs(c.x - gx) + Math.abs(c.y - gy) + Math.abs(c.z - gz);
      if (h < bestH) { bestH = h; best = c; }
      if (h <= 1) break;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        for (const dy of [0, 1, -1, -2]) {
          const nx = c.x + dx, ny = c.y + dy, nz = c.z + dz;
          if (dy === 1 && SOLID[g.world.id(c.x, c.y + Math.ceil(this.body.h), c.z)]) continue;
          if (!this.walkable(g, nx, ny, nz)) continue;
          const k = key(nx, ny, nz);
          const ng = c.g + 1 + (dy > 0 ? 0.5 : 0);
          if (ng >= (gs.get(k) ?? Infinity)) continue;
          gs.set(k, ng); came.set(k, key(c.x, c.y, c.z));
          open.push({ x: nx, y: ny, z: nz, g: ng, f: ng + Math.abs(nx - gx) + Math.abs(ny - gy) + Math.abs(nz - gz) });
          break;
        }
      }
    }
    const path: PathNode[] = [];
    let k: string | undefined = key(best.x, best.y, best.z);
    while (k && k !== key(sx, sy, sz)) { const [x, y, z] = k.split(',').map(Number); path.unshift({ x, y, z }); k = came.get(k); }
    return path;
  }
  private steer(g: GameCtx, tx: number, tz: number, speed: number, dt: number) {
    const b = this.body;
    const dx = tx - b.x, dz = tz - b.z, d = Math.hypot(dx, dz);
    if (d < 0.05) return;
    const want = Math.atan2(dx, dz);
    let dy = want - this.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.yaw += dy * Math.min(1, dt * 8);
    const s = speed * b.slow * (this.baby ? 1.2 : 1);
    const k = Math.min(1, dt * (b.onGround || this.def.flying || b.inWater ? 10 : 2));
    b.vx += ((dx / d) * s - b.vx) * k;
    b.vz += ((dz / d) * s - b.vz) * k;
    if (b.hitH && b.onGround && !this.def.flying) b.vy = 8.2;
    if (b.hitH && this.def.climbs) b.vy = 3.5;
    void g;
  }
  private followPath(g: GameCtx, speed: number, dt: number) {
    if (!this.path.length) return false;
    const n = this.path[0];
    const b = this.body;
    if (Math.abs(b.x - (n.x + 0.5)) < 0.35 && Math.abs(b.z - (n.z + 0.5)) < 0.35 && Math.abs(b.y - n.y) < 1.2) { this.path.shift(); if (!this.path.length) return false; }
    const t = this.path[0];
    this.steer(g, t.x + 0.5, t.z + 0.5, speed, dt);
    if (t.y > b.y + 0.5 && b.onGround) b.vy = 8.2;
    return true;
  }
  private cliffAhead(g: GameCtx): boolean {
    const b = this.body;
    const fx = Math.floor(b.x + Math.sin(this.yaw) * 0.8), fz = Math.floor(b.z + Math.cos(this.yaw) * 0.8);
    for (let i = 1; i <= 3; i++) if (g.world.solid(fx, Math.floor(b.y) - i, fz)) return false;
    return true;
  }
  canSee(g: GameCtx, x: number, y: number, z: number): boolean {
    const ex = this.body.x, ey = this.body.y + this.body.h * 0.85, ez = this.body.z;
    const dx = x - ex, dy = y - ey, dz = z - ez, d = Math.hypot(dx, dy, dz);
    const h = raycast(g.world, ex, ey, ez, dx / d, dy / d, dz / d, d);
    return !h || (h.id !== 0 && !BLOCKS[h.id].opaque && BLOCKS[h.id].layer !== 0);
  }

  /* ---------- main update ---------- */
  update(dt: number, g: GameCtx) {
    const b = this.body;
    this.age += dt;
    this.hurtT = Math.max(0, this.hurtT - dt);
    this.attackT = Math.max(0, this.attackT - dt);
    this.thinkT -= dt;
    this.idleSoundT -= dt;
    if (this.idleSoundT <= 0) { this.idleSoundT = 6 + Math.random() * 14; if (Math.hypot(this.x - g.player.x, this.z - g.player.z) < 20) audio.creature(this.def.voice, [this.x, this.y + 1, this.z], 'idle'); }
    const envDmg = senseEnv(g.world, b);
    // environment
    if (b.inLava && !this.def.fireImmune) { this.fireT = 8; if (this.hurtT <= 0) this.hurt(4, g, 'env'); }
    if (envDmg && !this.def.fireImmune && this.hurtT <= 0 && !this.def.flying) this.hurt(envDmg, g, 'env');
    if (this.fireT > 0) {
      this.fireT -= dt;
      if (b.inWater) this.fireT = 0;
      if (!this.def.fireImmune && Math.floor(this.fireT) !== Math.floor(this.fireT + dt)) this.hurt(1, g, 'env');
    }
    if (this.def.burns && g.daylight > 0.6 && g.dim === 0 && !b.inWater && g.world.skyLight(Math.floor(b.x), Math.floor(b.y + b.h), Math.floor(b.z)) >= 15 && Math.random() < dt) this.fireT = Math.max(this.fireT, 4);
    if (this.def.aquatic && !b.inWater) { this.airT -= dt; if (this.airT < 0 && Math.random() < dt) this.hurt(1, g, 'env'); } else this.airT = 10;
    if (!this.def.aquatic && b.eyeInWater && !this.def.flying) { this.airT -= dt * 0.5; if (this.airT < 0 && Math.random() < dt) this.hurt(2, g, 'env'); }
    if (this.baby) { this.growT -= dt; if (this.growT <= 0) { this.baby = false; this.body.hw = this.def.w; this.body.h = this.def.h; this.model.root.scale.setScalar(1); } }
    this.love = Math.max(0, this.love - dt);
    this.breedCd = Math.max(0, this.breedCd - dt);
    if (b.y < -40) { this.dead = true; return; }

    switch (this.def.ai) {
      case 'passive': this.aiPassive(g, dt); break;
      case 'swim': this.aiSwim(g, dt); break;
      case 'melee': this.aiMelee(g, dt); break;
      case 'ranged': this.aiRanged(g, dt); break;
      case 'exploder': this.aiExploder(g, dt); break;
      case 'flyer': this.aiFlyer(g, dt, false); break;
      case 'imp': this.aiFlyer(g, dt, true); break;
      case 'caster': this.aiCaster(g, dt); break;
      case 'blob': this.aiBlob(g, dt); break;
      case 'stalker': this.aiStalker(g, dt); break;
      case 'guardian': this.aiGuardian(g, dt); break;
      case 'villager': this.aiVillager(g, dt); break;
      case 'colossus': this.aiColossus(g, dt); break;
      case 'sovereign': this.aiSovereign(g, dt); break;
    }
    // physics
    if (this.def.flying) {
      b.vx *= Math.pow(0.3, dt); b.vz *= Math.pow(0.3, dt); b.vy *= Math.pow(0.3, dt);
    } else if (b.inWater || b.inLava) {
      b.vy -= 6 * dt;
      if (!this.def.aquatic && (b.eyeInWater || b.inLava)) b.vy += 14 * dt; // swim up
      b.vy = Math.max(b.vy, -3);
      b.vx *= Math.pow(0.3, dt); b.vz *= Math.pow(0.3, dt);
      if (this.def.aquatic) b.vy *= Math.pow(0.2, dt);
    } else {
      b.vy -= 28 * dt;
      if (b.climbing || (this.def.climbs && b.hitH)) b.vy = Math.max(b.vy, b.hitH ? 3 : -2);
      if (this.def.key === 'cluckit') b.vy = Math.max(b.vy, -3);
      if (!b.onGround) { b.vx *= Math.pow(0.6, dt); b.vz *= Math.pow(0.6, dt); }
      else { b.vx *= Math.pow(0.002, dt); b.vz *= Math.pow(0.002, dt); }
    }
    const preFall = b.fallDist;
    move(g.world, b, b.vx * dt, b.vy * dt, b.vz * dt, this.def.flying ? 0 : 0.6);
    if (b.onGround || b.inWater || this.def.flying) {
      if (preFall > 3.5 && b.onGround && !this.def.flying && this.def.key !== 'cluckit') this.hurt(Math.floor(preFall - 3), g, 'env');
      b.fallDist = 0;
    }
    if (Math.hypot(b.vx, b.vz) > 0.3) this.walk += dt * Math.hypot(b.vx, b.vz) * 3;
    // stuck in a block (e.g. sand fell) -> suffocate
    if (SOLID[g.world.id(Math.floor(b.x), Math.floor(b.y + b.h * 0.8), Math.floor(b.z))] && BLOCKS[g.world.id(Math.floor(b.x), Math.floor(b.y + b.h * 0.8), Math.floor(b.z))].opaque && Math.random() < dt) this.hurt(1, g, 'env');
  }

  private playerTarget(g: GameCtx): boolean {
    const p = g.player;
    if (p.dead || p.creative || g.difficulty === 0) return false;
    const det = this.def.detect ?? 16;
    const d = this.distTo(p.x, p.y, p.z);
    if (d > det) return false;
    if (this.def.neutralDay && !this.aggro && g.lightAt(this.x, this.y + 0.5, this.z) > 0.55) return false;
    return d < 4 || this.aggro || this.canSee(g, p.x, p.y + 1.5, p.z);
  }
  private nearestVictim(g: GameCtx): Mob | null {
    if (!this.siege) return null;
    const ents = (g as unknown as { entities: EntityManager }).entities;
    let best: Mob | null = null, bd = 20;
    for (const e of ents.list) if (e instanceof Mob && !e.dead && (e.def.key === 'wayfolk' || e.def.key === 'stoneward')) { const d = e.distTo(this.x, this.y, this.z); if (d < bd) { bd = d; best = e; } }
    return best;
  }
  private meleeTarget(g: GameCtx): { x: number; y: number; z: number; hw: number; mob: Mob | null } | null {
    if (this.playerTarget(g)) return { x: g.player.x, y: g.player.y, z: g.player.z, hw: 0.3, mob: null };
    const v = this.nearestVictim(g);
    return v ? { x: v.x, y: v.y, z: v.z, hw: v.body.hw, mob: v } : null;
  }
  private wander(g: GameCtx, dt: number, speed: number, radius = 8) {
    if (this.thinkT <= 0) {
      this.thinkT = 3 + Math.random() * 7;
      if (Math.random() < 0.6) {
        const tx = this.body.x + (Math.random() - 0.5) * radius * 2, tz = this.body.z + (Math.random() - 0.5) * radius * 2;
        if (this.home && Math.hypot(tx - this.home[0], tz - this.home[2]) > 20) this.path = this.findPath(g, this.home[0], this.home[1], this.home[2], 200);
        else this.path = this.findPath(g, tx, this.body.y, tz, 120);
      } else this.path = [];
    }
    if (!this.followPath(g, speed, dt)) { this.body.vx *= 0.8; this.body.vz *= 0.8; }
  }
  private chase(g: GameCtx, dt: number, tx: number, ty: number, tz: number, speed: number) {
    const d = Math.hypot(tx - this.body.x, tz - this.body.z);
    this.pathT -= dt;
    if (d < 3 && Math.abs(ty - this.body.y) < 1.5) { this.path = []; this.steer(g, tx, tz, speed, dt); return; }
    if (this.pathT <= 0 || !this.path.length) {
      this.pathT = 0.8 + Math.random() * 0.6;
      this.path = this.findPath(g, tx, ty, tz, 300);
    }
    if (!this.followPath(g, speed, dt)) this.steer(g, tx, tz, speed, dt);
  }

  private aiPassive(g: GameCtx, dt: number) {
    const p = g.player;
    if (this.ridden) return;
    if (this.state === 'flee') {
      if (this.thinkT <= 0) this.state = 'idle';
      const ax = this.x - p.x, az = this.z - p.z, d = Math.hypot(ax, az) || 1;
      this.steer(g, this.x + (ax / d) * 4, this.z + (az / d) * 4, this.def.speed * 1.6, dt);
      return;
    }
    if (this.leashed) {
      const d = this.distTo(p.x, p.y, p.z);
      if (d > 3) this.steer(g, p.x, p.z, this.def.speed * 1.3, dt);
      if (d > 7) { const k = (d - 7) / d; this.body.vx += (p.x - this.x) * k * 3; this.body.vz += (p.z - this.z) * k * 3; this.body.vy = Math.max(this.body.vy, (p.y - this.y) * 2); }
      if (d > 14) this.leashed = false;
      return;
    }
    // love: seek partner
    const ents = (g as unknown as { entities: EntityManager }).entities;
    if (this.love > 0) {
      const mate = ents.list.find((e) => e !== this && e instanceof Mob && e.def.key === this.def.key && e.love > 0 && !e.baby && e.distTo(this.x, this.y, this.z) < 10) as Mob | undefined;
      if (mate) {
        if (mate.distTo(this.x, this.y, this.z) < 1.5) {
          this.love = mate.love = 0; this.breedCd = mate.breedCd = 300;
          ents.spawnMob(this.def.key, this.x, this.y, this.z, { baby: true, color: Math.random() < 0.5 ? this.color : mate.color });
          g.spawnXP(this.x, this.y + 0.5, this.z, 1 + Math.floor(Math.random() * 6));
          g.particles(this.x, this.y + 1, this.z, [1, 0.4, 0.5], 8, 1.5, -1);
        } else this.steer(g, mate.x, mate.z, this.def.speed, dt);
        return;
      }
    }
    // tempt by held breed item
    const held = (p as unknown as { inv: { held: ItemStack | null } }).inv?.held;
    if (held && this.def.breed?.includes(ITEMS[held.id].key) && this.distTo(p.x, p.y, p.z) < 9 && !p.dead) {
      if (this.distTo(p.x, p.y, p.z) > 2) this.steer(g, p.x, p.z, this.def.speed * 1.1, dt);
      this.yaw = Math.atan2(p.x - this.x, p.z - this.z);
      return;
    }
    if (this.def.key === 'cluckit' && !this.baby) { this.eggT -= dt; if (this.eggT <= 0) { this.eggT = 300 + Math.random() * 300; if (this.age > 5) g.spawnItem(this.x, this.y + 0.3, this.z, { id: itemByKey('egg').id, count: 1 }); } }
    if (this.sheared) { this.regrowT -= dt; if (this.regrowT <= 0 && g.world.id(Math.floor(this.x), Math.floor(this.y - 0.5), Math.floor(this.z)) === B.grass) { this.sheared = false; this.model.parts.body.visible = true; } }
    if (this.def.key === 'burrowkin' && this.body.onGround && Math.hypot(this.body.vx, this.body.vz) > 0.5) this.body.vy = 5;
    if (this.cliffAhead(g) && this.body.onGround && this.path.length) { this.path = []; this.body.vx = this.body.vz = 0; }
    this.wander(g, dt, this.def.speed * 0.6);
  }
  private aiSwim(g: GameCtx, dt: number) {
    const b = this.body;
    if (!b.inWater) { if (b.onGround && Math.random() < dt * 2) b.vy = 4; return; }
    if (this.thinkT <= 0) { this.thinkT = 1 + Math.random() * 3; this.target = { x: b.x + (Math.random() - 0.5) * 8, y: b.y + (Math.random() - 0.5) * 3, z: b.z + (Math.random() - 0.5) * 8 }; }
    if (this.target) {
      if (g.world.id(Math.floor(this.target.x), Math.floor(this.target.y), Math.floor(this.target.z)) !== B.water) { this.thinkT = 0; return; }
      this.steer(g, this.target.x, this.target.z, this.def.speed, dt);
      b.vy += (Math.sign(this.target.y - b.y) * 1.5 - b.vy) * dt * 2;
    }
  }
  private aiMelee(g: GameCtx, dt: number) {
    const t = this.meleeTarget(g);
    if (!t) { this.wander(g, dt, this.def.speed * 0.5); return; }
    this.chase(g, dt, t.x, t.y, t.z, this.def.speed * (g.difficulty === 3 ? 1.15 : 1));
    const reach = this.body.hw + t.hw + 0.9;
    if (Math.hypot(t.x - this.x, t.z - this.z) < reach && Math.abs(t.y - this.y) < this.body.h && this.attackT <= 0) {
      this.attackT = this.def.attackCd ?? 1;
      this.swingT = 0.3;
      const dmg = this.def.dmg * [0, 0.6, 1, 1.5][g.difficulty];
      if (t.mob) { t.mob.hurt(dmg, g, 'mob'); t.mob.knockback(t.x - this.x, t.z - this.z, 0.5); }
      else if (g.player.hurt(dmg, { kind: 'mob', x: this.x, y: this.y, z: this.z, attacker: this })) {
        g.player.knock(g.player.x - this.x, g.player.z - this.z, this.def.key === 'brute' ? 1.4 : 0.6);
        if (this.def.key === 'shambler' && g.difficulty === 3 && Math.random() < 0.1) g.player.addEffect('hunger_fx', 10, 0);
      }
    }
  }
  swingT = 0;
  private aiRanged(g: GameCtx, dt: number) {
    if (!this.playerTarget(g)) { this.wander(g, dt, this.def.speed * 0.5); return; }
    const p = g.player;
    const d = this.distTo(p.x, p.y, p.z);
    this.yaw = Math.atan2(p.x - this.x, p.z - this.z);
    if (d > 12) this.chase(g, dt, p.x, p.y, p.z, this.def.speed);
    else if (d < 5) this.steer(g, this.x - (p.x - this.x), this.z - (p.z - this.z), this.def.speed, dt);
    else { const s = Math.sin(this.age * 0.8); this.steer(g, this.x + Math.cos(this.yaw) * s * 2, this.z - Math.sin(this.yaw) * s * 2, this.def.speed * 0.5, dt); }
    if (this.attackT <= 0 && d < 16 && this.canSee(g, p.x, p.y + 1.5, p.z)) {
      this.attackT = g.difficulty === 3 ? 1.5 : 2.2;
      this.shoot(g, 'arrow', p.x, p.y + 1.3, p.z, 24, this.def.dmg * [0, 0.7, 1, 1.4][g.difficulty], 0.06);
      audio.bow();
    }
  }
  shoot(g: GameCtx, kind: ProjKind, tx: number, ty: number, tz: number, speed: number, dmg: number, spread = 0) {
    const sx = this.x, sy = this.y + this.body.h * 0.8, sz = this.z;
    const dx = tx - sx, dz = tz - sz, hd = Math.hypot(dx, dz);
    let dy = ty - sy;
    if (kind === 'arrow') dy += hd * hd * 8 / (speed * speed); // compensate gravity
    const l = Math.hypot(dx, dy, dz) || 1;
    const r = () => (Math.random() - 0.5) * spread * 2;
    const pr = new Projectile(sx, sy, sz, (dx / l + r()) * speed, (dy / l + r()) * speed, (dz / l + r()) * speed, kind, false, dmg);
    (g as unknown as { entities: EntityManager }).entities.add(pr);
  }
  private aiExploder(g: GameCtx, dt: number) {
    const p = g.player;
    if (!this.playerTarget(g)) { this.fuse = Math.max(0, this.fuse - dt); this.wander(g, dt, this.def.speed * 0.5); return; }
    const d = this.distTo(p.x, p.y, p.z);
    if (this.fuse > 0 || d < 2.6) {
      if (this.fuse === 0) audio.fuse([this.x, this.y + 1, this.z]);
      this.fuse += dt;
      this.body.vx *= 0.5; this.body.vz *= 0.5;
      if (d > 6) this.fuse = Math.max(0, this.fuse - dt * 3);
      if (this.fuse >= 1.5) { this.dead = true; g.explode(this.x, this.y + 0.8, this.z, g.difficulty === 3 ? 3.6 : 3, false); }
    } else this.chase(g, dt, p.x, p.y, p.z, this.def.speed);
  }
  private aiFlyer(g: GameCtx, dt: number, ranged: boolean) {
    const p = g.player, b = this.body;
    const hasT = this.playerTarget(g);
    let tx: number, ty: number, tz: number;
    if (hasT) {
      const d = this.distTo(p.x, p.y, p.z);
      if (ranged) {
        const a = this.age * 0.4 + this.id;
        tx = p.x + Math.cos(a) * 9; tz = p.z + Math.sin(a) * 9; ty = p.y + 5;
        if (this.attackT <= 0 && d < 24 && this.canSee(g, p.x, p.y + 1.5, p.z)) { this.attackT = 2.5 + Math.random(); this.shoot(g, 'fireball', p.x, p.y + 1, p.z, 14, this.def.dmg); audio.creature('imp', [this.x, this.y, this.z]); }
      } else {
        tx = p.x; ty = p.y + 1.2; tz = p.z;
        if (d < 1.4 && this.attackT <= 0) { this.attackT = 1; if (p.hurt(this.def.dmg * [0, 0.6, 1, 1.5][g.difficulty], { kind: 'mob', x: this.x, y: this.y, z: this.z, attacker: this })) p.knock(p.x - this.x, p.z - this.z, 0.4); }
      }
      this.yaw = Math.atan2(p.x - this.x, p.z - this.z);
    } else {
      if (this.thinkT <= 0 || !this.target) { this.thinkT = 3 + Math.random() * 4; this.target = { x: b.x + (Math.random() - 0.5) * 14, y: b.y + (Math.random() - 0.5) * 6, z: b.z + (Math.random() - 0.5) * 14 }; }
      ({ x: tx, y: ty, z: tz } = this.target);
    }
    const dx = tx - b.x, dy = ty - b.y, dz = tz - b.z, l = Math.hypot(dx, dy, dz) || 1;
    const s = this.def.speed;
    b.vx += (dx / l * s - b.vx) * dt * 3; b.vy += (dy / l * s - b.vy) * dt * 3; b.vz += (dz / l * s - b.vz) * dt * 3;
    if (!hasT) this.yaw = Math.atan2(b.vx, b.vz);
  }
  private aiCaster(g: GameCtx, dt: number) {
    const p = g.player, b = this.body;
    // hover a little above ground
    const ground = g.world.solid(Math.floor(b.x), Math.floor(b.y - 1.2), Math.floor(b.z));
    b.vy += ((ground ? 1.5 : -1.5) - b.vy) * dt * 3;
    if (!this.playerTarget(g)) { this.wander(g, dt, this.def.speed * 0.4); return; }
    const d = this.distTo(p.x, p.y, p.z);
    this.yaw = Math.atan2(p.x - this.x, p.z - this.z);
    if (d > 12) this.chase(g, dt, p.x, p.y, p.z, this.def.speed);
    else if (d < 7) this.steer(g, this.x - (p.x - this.x), this.z - (p.z - this.z), this.def.speed, dt);
    if (this.attackT <= 0 && this.canSee(g, p.x, p.y + 1.5, p.z)) {
      this.attackT = 2.6;
      for (let i = -1; i <= 1; i++) this.shoot(g, 'hex', p.x + i * 1.5, p.y + 1, p.z + i * 1.5, 7, this.def.dmg);
      audio.creature('crystal', [this.x, this.y + 1, this.z]);
    }
    if (this.hp < this.def.hp / 2 && !this.special) {
      this.special = 1;
      const ents = (g as unknown as { entities: EntityManager }).entities;
      for (let i = 0; i < 3; i++) ents.spawnMob('wisp', this.x + (Math.random() - 0.5) * 3, this.y + 1.5, this.z + (Math.random() - 0.5) * 3);
      g.message('The Hexwarden calls on the wisps!', 'warn');
    }
  }
  private aiBlob(g: GameCtx, dt: number) {
    const b = this.body, p = g.player;
    const t = this.playerTarget(g);
    if (b.onGround) {
      b.vx *= 0.5; b.vz *= 0.5;
      this.thinkT -= dt;
      if (this.thinkT <= 0) {
        this.thinkT = 0.8 + Math.random() * 0.8;
        const a = t ? Math.atan2(p.x - b.x, p.z - b.z) : Math.random() * Math.PI * 2;
        this.yaw = a;
        b.vy = 7; b.vx = Math.sin(a) * this.def.speed * 1.4; b.vz = Math.cos(a) * this.def.speed * 1.4;
      }
    }
    if (t && this.distTo(p.x, p.y, p.z) < 1.2 && this.attackT <= 0) { this.attackT = 1; if (p.hurt(this.def.dmg, { kind: 'mob', x: this.x, y: this.y, z: this.z })) { p.knock(p.x - this.x, p.z - this.z, 0.5); p.setFire(2); } }
  }
  private aiStalker(g: GameCtx, dt: number) {
    const p = g.player, b = this.body;
    const ground = g.world.solid(Math.floor(b.x), Math.floor(b.y - 0.8), Math.floor(b.z));
    b.vy += ((ground ? 0.8 : -1.2) - b.vy) * dt * 3;
    if (!this.playerTarget(g)) { this.wander(g, dt, this.def.speed * 0.4); return; }
    this.special -= dt;
    const d = this.distTo(p.x, p.y, p.z);
    if (this.special <= 0 && d > 3) {
      // blink to a spot near the player
      this.special = 5 + Math.random() * 3;
      for (let i = 0; i < 10; i++) {
        const a = Math.random() * Math.PI * 2;
        const nx = p.x + Math.cos(a) * 2.5, nz = p.z + Math.sin(a) * 2.5;
        const ny = Math.floor(p.y);
        if (!g.world.solid(Math.floor(nx), ny, Math.floor(nz)) && !g.world.solid(Math.floor(nx), ny + 1, Math.floor(nz)) && !g.world.solid(Math.floor(nx), ny + 2, Math.floor(nz))) {
          g.particles(b.x, b.y + 1, b.z, [0.6, 0.3, 1], 16, 3);
          b.x = nx; b.y = ny; b.z = nz;
          g.particles(b.x, b.y + 1, b.z, [0.6, 0.3, 1], 16, 3);
          audio.creature('crystal', [b.x, b.y, b.z]);
          break;
        }
      }
    }
    this.yaw = Math.atan2(p.x - this.x, p.z - this.z);
    this.steer(g, p.x, p.z, this.def.speed, dt);
    if (d < 1.8 && this.attackT <= 0) { this.attackT = 1.2; if (p.hurt(this.def.dmg * [0, 0.6, 1, 1.5][g.difficulty], { kind: 'mob', x: this.x, y: this.y, z: this.z })) p.knock(p.x - this.x, p.z - this.z, 0.6); }
  }
  private aiGuardian(g: GameCtx, dt: number) {
    const ents = (g as unknown as { entities: EntityManager }).entities;
    if (this.thinkT <= 0 && !this.targetMob) {
      this.thinkT = 1;
      let best: Mob | null = null, bd = 16;
      for (const e of ents.list) if (e instanceof Mob && e.def.hostile && !e.dead && !e.def.boss) { const d = e.distTo(this.x, this.y, this.z); if (d < bd) { bd = d; best = e; } }
      this.targetMob = best;
    }
    if (this.targetPlayer && !g.player.dead && !g.player.creative) {
      const p = g.player;
      this.chase(g, dt, p.x, p.y, p.z, this.def.speed * 1.2);
      if (this.distTo(p.x, p.y, p.z) < 2.2 && this.attackT <= 0) { this.attackT = this.def.attackCd!; this.swingT = 0.4; if (p.hurt(this.def.dmg * 0.7, { kind: 'mob', x: this.x, y: this.y, z: this.z })) { p.knock(p.x - this.x, p.z - this.z, 1.6); } }
      if (this.distTo(p.x, p.y, p.z) > 24) this.targetPlayer = false;
      return;
    }
    const t = this.targetMob;
    if (t && !t.dead && t.distTo(this.x, this.y, this.z) < 24) {
      this.chase(g, dt, t.x, t.y, t.z, this.def.speed * 1.2);
      if (t.distTo(this.x, this.y, this.z) < this.body.hw + t.body.hw + 1.2 && this.attackT <= 0) { this.attackT = this.def.attackCd!; this.swingT = 0.4; t.hurt(this.def.dmg, g, 'mob'); t.knockback(t.x - this.x, t.z - this.z, 1.5); }
    } else { this.targetMob = null; this.wander(g, dt, this.def.speed * 0.4, 6); }
  }
  private aiVillager(g: GameCtx, dt: number) {
    const ents = (g as unknown as { entities: EntityManager }).entities;
    // flee from nearby hostiles
    if (this.thinkT <= 0 || this.state === 'flee') {
      const threat = ents.list.find((e) => e instanceof Mob && e.def.hostile && !e.dead && e.distTo(this.x, this.y, this.z) < 8) as Mob | undefined;
      if (threat) {
        this.state = 'flee';
        this.steer(g, this.x - (threat.x - this.x) * 2, this.z - (threat.z - this.z) * 2, this.def.speed * 1.5, dt);
        return;
      }
      if (this.state === 'flee' && this.thinkT <= 0) this.state = 'idle';
    }
    const night = g.time > 0.5 && g.time < 0.98;
    if ((night || g.player.sleeping) && this.home) {
      const d = Math.hypot(this.x - this.home[0] - 0.5, this.z - this.home[2] - 0.5);
      if (d > 1.2) {
        if (this.thinkT <= 0 || !this.path.length) { this.thinkT = 2; this.path = this.findPath(g, this.home[0] + 0.5, this.home[1], this.home[2] + 0.5, 400); }
        if (!this.followPath(g, this.def.speed, dt)) this.steer(g, this.home[0] + 0.5, this.home[2] + 0.5, this.def.speed, dt);
      } else { this.body.vx *= 0.5; this.body.vz *= 0.5; }
      return;
    }
    // look at a nearby player
    const p = g.player;
    if (this.distTo(p.x, p.y, p.z) < 4 && !p.dead) { this.yaw = Math.atan2(p.x - this.x, p.z - this.z); this.body.vx *= 0.7; this.body.vz *= 0.7; return; }
    this.wander(g, dt, this.def.speed * 0.6, 8);
  }
  private aiColossus(g: GameCtx, dt: number) {
    const p = g.player, b = this.body;
    const has = !p.dead && !p.creative && this.distTo(p.x, p.y, p.z) < 40 && g.difficulty > 0;
    g.setBoss(has ? this.def.name : null, this.hp / this.def.hp);
    if (!has) { b.vx *= 0.9; b.vz *= 0.9; return; }
    const d = this.distTo(p.x, p.y, p.z);
    this.yaw = Math.atan2(p.x - this.x, p.z - this.z);
    this.special -= dt; this.special2 -= dt;
    if (this.phase === 1) {
      // slam wind-up
      this.special -= 0;
      b.vx = b.vz = 0;
      if (this.special <= 0) {
        this.phase = 0; this.special = 3 + Math.random() * 2;
        g.explode(b.x, b.y + 0.5, b.z, 0, false);
        g.particles(b.x, b.y + 0.2, b.z, [1, 0.5, 0.1], 40, 6);
        audio.explode([b.x, b.y, b.z]);
        if (Math.hypot(p.x - b.x, p.z - b.z) < 6 && p.y - b.y < 2.5) { if (p.hurt(this.def.dmg * [0, 0.6, 1, 1.4][g.difficulty], { kind: 'mob', x: b.x, y: b.y, z: b.z })) p.knock(p.x - b.x, p.z - b.z, 2.2); }
      }
      return;
    }
    if (d < 5 && this.special <= 0) { this.phase = 1; this.special = 1.1; audio.creature('boss', [b.x, b.y + 2, b.z]); return; }
    if (this.special2 <= 0) {
      this.special2 = 5;
      for (let i = -1; i <= 1; i++) this.shoot(g, 'fireball', p.x + i * 2, p.y + 1, p.z + i * 2, 13, 8);
    }
    const ents = (g as unknown as { entities: EntityManager }).entities;
    const frac = this.hp / this.def.hp;
    if ((frac < 0.66 && this.bossStage < 1) || (frac < 0.33 && this.bossStage < 2)) {
      this.bossStage++;
      for (let i = 0; i < 3; i++) ents.spawnMob('emberling', b.x + (Math.random() - 0.5) * 4, b.y + 1, b.z + (Math.random() - 0.5) * 4);
      g.message('The Colossus sheds burning fragments!', 'warn');
    }
    this.chase(g, dt, p.x, p.y, p.z, this.def.speed * (frac < 0.33 ? 1.4 : 1));
  }
  bossStage = 0;
  pylons: [number, number, number][] = [];
  private aiSovereign(g: GameCtx, dt: number) {
    const p = g.player, b = this.body;
    if (!this.pylons.length) for (let k = 0; k < 4; k++) { const a = (k / 4) * Math.PI * 2 + Math.PI / 4; this.pylons.push([Math.round(Math.cos(a) * 30), 86, Math.round(Math.sin(a) * 30)]); }
    const alive = this.pylons.filter(([x, y, z]) => g.world.id(x, y, z) === B.ward_pylon).length;
    this.special2 = alive;
    const has = !p.dead && Math.hypot(p.x, p.z) < 110;
    g.setBoss(has ? this.def.name : null, this.hp / this.def.hp, alive > 0);
    if (alive > 0 && this.hp < this.def.hp) this.hp = Math.min(this.def.hp, this.hp + dt * alive * 0.5);
    this.special -= dt; this.attackT -= dt;
    let tx: number, ty: number, tz: number;
    if (this.phase === 1 && has) {
      // dive at the player
      tx = p.x; ty = p.y + 1; tz = p.z;
      this.special3 -= dt;
      if (this.distTo(p.x, p.y + 1, p.z) < 2.5) { if (p.hurt(this.def.dmg * [0, 0.6, 1, 1.4][g.difficulty], { kind: 'mob', x: b.x, y: b.y, z: b.z })) p.knock(p.x - b.x, p.z - b.z, 1.8); this.phase = 0; this.special = 6; }
      if (this.special3 <= 0) { this.phase = 0; this.special = 6; }
    } else {
      const a = this.age * 0.25;
      tx = Math.cos(a) * 22; tz = Math.sin(a) * 22; ty = 80 + Math.sin(this.age * 0.7) * 4;
      if (has && this.attackT <= 0) {
        this.attackT = alive ? 4 : 2.8;
        for (let i = 0; i < 3; i++) this.shoot(g, 'shard', p.x + (i - 1) * 3, p.y + 1, p.z, 10, 6);
        audio.creature('crystal', [b.x, b.y, b.z]);
      }
      if (has && this.special <= 0 && !alive) { this.phase = 1; this.special3 = 4; audio.creature('boss', [b.x, b.y, b.z]); }
      else if (has && this.special <= 0) this.special = 6;
    }
    if (this.hp < this.def.hp * 0.5 && this.bossStage < 1) {
      this.bossStage = 1;
      const ents = (g as unknown as { entities: EntityManager }).entities;
      for (let i = 0; i < 3; i++) ents.spawnMob('voidstalker', (Math.random() - 0.5) * 20, 66, (Math.random() - 0.5) * 20);
      g.message('Voidstalkers answer the Sovereign!', 'warn');
    }
    const dx = tx - b.x, dy = ty - b.y, dz = tz - b.z, l = Math.hypot(dx, dy, dz) || 1;
    const s = this.phase === 1 ? 14 : this.def.speed * 2;
    b.vx += (dx / l * s - b.vx) * dt * 2; b.vy += (dy / l * s - b.vy) * dt * 2; b.vz += (dz / l * s - b.vz) * dt * 2;
    this.yaw = has ? Math.atan2(p.x - b.x, p.z - b.z) : this.yaw;
  }
  special3 = 0;

  render(_a: number, g: GameCtx) {
    const b = this.body;
    this.obj.position.set(b.x, b.y, b.z);
    this.obj.rotation.y = this.yaw;
    const P = this.model.parts;
    const sw = Math.sin(this.walk) * 0.7 * Math.min(1, Math.hypot(b.vx, b.vz) / 1.5);
    for (const k of ['leg0', 'leg3', 'legL']) if (P[k]) P[k].rotation.x = sw;
    for (const k of ['leg1', 'leg2', 'legR']) if (P[k]) P[k].rotation.x = -sw;
    for (let i = 0; i < 3; i++) { if (P[`legL${i}`]) P[`legL${i}`].rotation.z = Math.sin(this.walk * 2 + i) * 0.3; if (P[`legR${i}`]) P[`legR${i}`].rotation.z = -Math.sin(this.walk * 2 + i) * 0.3; }
    this.swingT = Math.max(0, this.swingT - 1 / 60);
    if (P.armL && P.armR) {
      if (this.def.key === 'shambler') { P.armL.rotation.x = P.armR.rotation.x = -1.3 + Math.sin(this.age * 2) * 0.1; }
      else { P.armL.rotation.x = -sw * 0.8 - this.swingT * 4; P.armR.rotation.x = sw * 0.8 - this.swingT * 4; }
    }
    if (P.wingL) { P.wingL.rotation.y = Math.sin(this.age * 14) * 0.6; P.wingR.rotation.y = -Math.sin(this.age * 14) * 0.6; }
    if (P.tail && this.def.key !== 'finling') P.tail.rotation.y = Math.sin(this.age * 3) * 0.2;
    if (P.tail && this.def.key === 'finling') P.tail.rotation.y = Math.sin(this.age * 10) * 0.5;
    if (this.def.key === 'fusebloom') {
      const open = Math.min(1, this.fuse / 1.5);
      for (let i = 0; i < 4; i++) { const pp = P[`petal${i}`]; if (pp) { if (i < 2) pp.rotation.x = (i === 0 ? -1 : 1) * open * 1.2; else pp.rotation.z = (i === 2 ? 1 : -1) * open * 1.2; } }
      const s = 1 + open * 0.25 + (open > 0 ? Math.sin(this.age * 30) * 0.05 * open : 0);
      P.bulb.scale.setScalar(s);
    }
    if (this.def.key === 'sovereign') {
      for (let i = 0; i < 4; i++) { const o = P[`orb${i}`]; if (o) o.rotation.y = this.age * 1.5 + i * Math.PI / 2; }
      for (let i = 0; i < 6; i++) { const c = P[`crown${i}`]; if (c) c.position.y = 18 + Math.sin(this.age * 2 + i) * 1.5; }
    }
    if (this.def.key === 'voidstalker') for (let i = 0; i < 4; i++) { const s = P[`s${i}`]; if (s) s.rotation.y = this.age * (0.5 + i * 0.3); }
    if (this.def.key === 'wisp' || this.def.key === 'hexwarden') { this.obj.position.y += Math.sin(this.age * 3) * 0.1; if (P.rune0) { P.rune0.position.set(Math.cos(this.age * 2) * 9, 18, Math.sin(this.age * 2) * 9); P.rune1.position.set(-Math.cos(this.age * 2) * 9, 18, -Math.sin(this.age * 2) * 9); } }
    if (P.head && this.def.ai === 'villager') P.head.rotation.x = Math.sin(this.age * 0.7) * 0.05;
    if (P.saddle) P.saddle.visible = this.saddled;
    if (this.def.key === 'fluffer' || this.def.key === 'sporeback') { const bod = this.def.key === 'fluffer' ? P.body : P.cap1; if (bod) bod.visible = !this.sheared; if (this.def.key === 'sporeback' && P.cap2) P.cap2.visible = !this.sheared; }
    // light + hurt flash
    const l = g.lightAt(b.x, b.y + b.h * 0.6, b.z);
    const r = this.hurtT > 0.25 ? 1 : 0;
    for (const m of this.model.mats) { m.color.setRGB(l + r * 0.6, l * (1 - r * 0.5), l * (1 - r * 0.5)); }
    for (const m of this.model.glowMats) { m.color.setRGB(1, 1 - r * 0.5, 1 - r * 0.5); }
    if (this.fireT > 0 && Math.random() < 0.3) g.particles(b.x + (Math.random() - 0.5) * b.hw * 2, b.y + Math.random() * b.h, b.z + (Math.random() - 0.5) * b.hw * 2, [1, 0.55, 0.1], 1, 0.6, -1, 0.15);
    if (this.love > 0 && Math.random() < 0.05) g.particles(b.x, b.y + b.h + 0.3, b.z, [1, 0.35, 0.45], 1, 0.4, -0.5, 0.15);
  }
  serialize() {
    if (!this.persistent || this.dead) return null;
    return {
      t: 'mob', k: this.def.key, x: this.x, y: this.y, z: this.z, hp: this.hp, yaw: this.yaw, baby: this.baby, growT: this.growT, color: this.color,
      tamed: this.tamed, saddled: this.saddled, sheared: this.sheared, home: this.home, prof: this.prof, trades: this.trades, rep: this.rep, villageId: this.villageId, bossId: this.bossId, bossStage: this.bossStage,
    };
  }
}

/* ======================================================================= Manager */
export class EntityManager {
  list: Entity[] = [];
  group = new THREE.Group();
  constructor(private g: GameCtx) {}
  add<T extends Entity>(e: T): T { this.list.push(e); this.group.add(e.obj); return e; }
  spawnMob(key: string, x: number, y: number, z: number, opts: { baby?: boolean; color?: number; prof?: string } = {}): Mob {
    return this.add(new Mob(key, x, y, z, opts));
  }
  count(pred: (e: Entity) => boolean) { let n = 0; for (const e of this.list) if (pred(e)) n++; return n; }
  update(dt: number) {
    for (const e of this.list) {
      if (e.dead) continue;
      if (!this.g.world.loaded(Math.floor(e.x), Math.floor(e.z))) continue; // frozen in unloaded chunks
      e.update(dt, this.g);
    }
    // merge item stacks lazily
    for (let i = this.list.length - 1; i >= 0; i--) {
      const e = this.list[i];
      if (e.dead) { this.group.remove(e.obj); e.dispose(); this.list.splice(i, 1); }
    }
  }
  render(alpha: number) { for (const e of this.list) { e.obj.visible = true; e.render(alpha, this.g); } }
  clear() { for (const e of this.list) { this.group.remove(e.obj); e.dispose(); } this.list = []; }
  /** serialisable entities inside chunk (cx,cz) – removed from the world when `remove` */
  takeChunk(cx: number, cz: number, remove: boolean): unknown[] {
    const out: unknown[] = [];
    for (const e of this.list) {
      if (e.dead) continue;
      if (Math.floor(e.x / 16) !== cx || Math.floor(e.z / 16) !== cz) continue;
      const s = e.serialize();
      if (s) out.push(s);
      if (remove) e.dead = true;
      else if (!s && e instanceof Mob && !e.persistent && remove) e.dead = true;
    }
    if (remove) for (const e of this.list) if (!e.dead && Math.floor(e.x / 16) === cx && Math.floor(e.z / 16) === cz) e.dead = true;
    return out;
  }
  restore(data: unknown[]) {
    for (const r0 of data) {
      const r = r0 as Record<string, unknown> & { t: string; x: number; y: number; z: number };
      try {
        if (r.t === 'item') { const it = this.add(new ItemEntity(r.x, r.y, r.z, r.s as ItemStack)); it.age = (r.age as number) ?? 0; }
        else if (r.t === 'boat') { const b = this.add(new Boat(r.x, r.y, r.z)); b.yaw = (r.yaw as number) ?? 0; }
        else if (r.t === 'cart') this.add(new Cart(r.x, r.y, r.z));
        else if (r.t === 'mob' && MOBS[r.k as string]) {
          const m = this.spawnMob(r.k as string, r.x, r.y, r.z, { baby: r.baby as boolean, color: r.color as number, prof: r.prof as string });
          Object.assign(m, { hp: r.hp, yaw: r.yaw, growT: r.growT ?? 0, tamed: !!r.tamed, saddled: !!r.saddled, sheared: !!r.sheared, home: r.home ?? null, rep: r.rep ?? 0, villageId: r.villageId ?? '', bossId: r.bossId ?? '', bossStage: r.bossStage ?? 0 });
          if (Array.isArray(r.trades) && r.trades.length) m.trades = r.trades as Mob['trades'];
        }
      } catch (e) { console.warn('Could not restore entity', r, e); }
    }
  }
}
type ProjKindT = ProjKind;
export type { ProjKindT };
