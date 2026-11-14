import { newBody, move, senseEnv, type Body } from '../entity/physics';
import { Inventory, ARMOR0, OFFHAND } from './inventory';
import { ITEMS } from '../registry/items';
import { enchLevel } from '../registry/enchant';
import { B, BLOCKS } from '../registry/blocks';
import type { World } from '../world/World';
import { audio } from '../audio/audio';
import { Dim } from '../constants';

export interface MoveInput { f: number; s: number; jump: boolean; sneak: boolean; sprint: boolean }
export interface Effect { t: number; amp: number }

export const xpForLevel = (l: number) => 7 + l * 3 + Math.floor(l / 10) * l;

export class Player {
  body: Body;
  yaw = 0; pitch = 0;
  inv = new Inventory();
  hp = 20; maxHp = 20; absorption = 0;
  hunger = 20; sat = 5; exhaustion = 0;
  air = 15;
  xp = 0; level = 0; totalXp = 0;
  effects = new Map<string, Effect>();
  fireT = 0;
  invulnT = 0;
  hurtFlash = 0;
  dead = false;
  creative = false;
  flying = false;
  sneaking = false;
  sprinting = false;
  sleeping = false;
  spawn: [number, number, number] | null = null;
  dim: Dim = Dim.Overworld;
  walkDist = 0;
  stepAcc = 0;
  regenT = 0; starveT = 0; drownT = 0; effectT = 0; envT = 0;
  lastJumpTap = 0;
  blocking = false;
  riding: { kind: 'boat' | 'cart' | 'steed'; id: number } | null = null;
  deathMsg = '';
  hw = 0.3;
  h = 1.8;
  onLog: (msg: string) => void = () => {};

  constructor(x: number, y: number, z: number) { this.body = newBody(x, y, z, 0.3, 1.8); }
  get x() { return this.body.x; } get y() { return this.body.y; } get z() { return this.body.z; }
  eyeY() { return this.body.y + (this.sneaking && !this.flying ? 1.32 : this.sleeping ? 0.3 : 1.62); }
  look(): [number, number, number] {
    const cp = Math.cos(this.pitch);
    return [-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp];
  }
  effect(k: string) { return this.effects.get(k); }
  addEffect(key: string, seconds: number, amp: number) {
    if (key === 'instant_health') { this.heal(4 << amp); return; }
    if (key === 'instant_damage') { this.hurt(6 << amp, { kind: 'magic' }); return; }
    const cur = this.effects.get(key);
    if (!cur || cur.amp < amp || cur.t < seconds) this.effects.set(key, { t: seconds, amp });
    if (key === 'absorption') this.absorption = Math.max(this.absorption, 4 * (amp + 1));
  }
  setFire(s: number) { if (!this.effect('fire_resistance') && !this.creative) this.fireT = Math.max(this.fireT, s); }
  heal(n: number) { this.hp = Math.min(this.maxHp, this.hp + n); }
  exhaust(n: number) { if (!this.creative) this.exhaustion += n; }
  knock(dx: number, dz: number, strength: number) {
    const l = Math.hypot(dx, dz) || 1;
    this.body.vx += (dx / l) * 8 * strength; this.body.vz += (dz / l) * 8 * strength;
    this.body.vy = Math.max(this.body.vy, 5.5 * Math.min(1, strength));
  }
  armorItems() { return [0, 1, 2, 3].map((i) => this.inv.slots[ARMOR0 + i]); }

  /** returns true if damage was applied */
  hurt(amount: number, src: { kind: string; x?: number; y?: number; z?: number; attacker?: unknown }): boolean {
    if (this.dead || this.creative || amount <= 0) return false;
    if ((src.kind === 'fire' || src.kind === 'lava' || src.kind === 'fireball') && this.effect('fire_resistance')) return false;
    if (this.invulnT > 0 && src.kind !== 'starve' && src.kind !== 'drown' && src.kind !== 'void') return false;
    let dmg = amount;
    // shield
    if (this.blocking && src.x !== undefined && (src.kind === 'mob' || src.kind === 'projectile' || src.kind === 'explosion' || src.kind === 'fireball')) {
      const [lx, , lz] = this.look();
      const dx = src.x - this.x, dz = (src.z ?? this.z) - this.z, d = Math.hypot(dx, dz) || 1;
      if ((dx / d) * lx + (dz / d) * lz > 0.3) {
        const slot = ITEMS[this.inv.held?.id ?? 0]?.key === 'shield' ? this.inv.selected : OFFHAND;
        this.inv.damageSlot(slot, Math.ceil(dmg));
        audio.noise(0.15, 500, 3, 0.4);
        if (src.kind !== 'explosion') return false;
        dmg *= 0.5;
      }
    }
    const bypassArmor = ['starve', 'drown', 'void', 'fire', 'magic', 'poison', 'suffocate', 'fall'].includes(src.kind);
    if (!bypassArmor) {
      const pts = this.inv.armorPoints(), tough = this.inv.armorToughness();
      const red = Math.min(0.8, pts * 0.034 + tough * 0.012);
      dmg *= 1 - red;
      for (let i = 0; i < 4; i++) if (this.inv.slots[ARMOR0 + i]) this.inv.damageSlot(ARMOR0 + i, Math.max(1, Math.floor(amount / 4)));
    }
    if (src.kind !== 'starve' && src.kind !== 'void') {
      const ward = Math.min(16, this.inv.enchantTotal('ward'));
      dmg *= 1 - ward * 0.04;
    }
    if (src.kind === 'fall') dmg *= 1 - Math.min(0.75, enchLevel(this.inv.slots[ARMOR0 + 3], 'featherfall') * 0.18);
    if (this.absorption > 0) { const a = Math.min(this.absorption, dmg); this.absorption -= a; dmg -= a; }
    this.hp -= dmg;
    this.invulnT = 0.5;
    this.hurtFlash = 0.35;
    this.exhaust(0.1);
    audio.hurt();
    if (this.hp <= 0.001) {
      this.hp = 0;
      this.dead = true;
      this.deathMsg = deathText(src.kind, src.attacker);
      audio.playerDie();
    }
    return true;
  }

  addXP(n: number) {
    this.totalXp += n;
    this.xp += n;
    let leveled = false;
    while (this.xp >= xpForLevel(this.level)) { this.xp -= xpForLevel(this.level); this.level++; leveled = true; }
    if (leveled && this.level % 5 === 0) audio.levelUp(); else audio.xp();
  }
  spendLevels(n: number) {
    this.level = Math.max(0, this.level - n);
    this.xp = Math.min(this.xp, xpForLevel(this.level) - 1);
  }

  /** per-frame movement */
  updateMovement(dt: number, inp: MoveInput, world: World, steedSpeed = 0) {
    const b = this.body;
    const env = senseEnv(world, b);
    if (this.sleeping) { b.vx = b.vy = b.vz = 0; return 0; }
    this.sneaking = inp.sneak && !this.flying;
    const canSprint = (this.hunger > 6 || this.creative) && inp.f > 0 && !this.sneaking;
    if (inp.sprint && canSprint) this.sprinting = true;
    if (!canSprint || b.hitH) this.sprinting = false;
    const speedFx = this.effect('speed'), slowFx = this.effect('slowness');
    let speed = this.flying ? (this.sprinting ? 21 : 11) : this.sneaking ? 1.3 : this.sprinting ? 5.6 : 4.3;
    if (speedFx) speed *= 1 + 0.2 * (speedFx.amp + 1);
    if (slowFx) speed *= Math.max(0.2, 1 - 0.15 * (slowFx.amp + 1));
    if (steedSpeed) speed = steedSpeed * (this.sprinting ? 1.25 : 1);
    if ((b.inWater || b.inLava) && !this.flying) speed = b.inLava ? 1.2 : this.sprinting ? 3.4 : 2.2;
    speed *= b.slow;
    const len = Math.hypot(inp.f, inp.s);
    const f = len > 1 ? inp.f / len : inp.f, s = len > 1 ? inp.s / len : inp.s;
    const sn = Math.sin(this.yaw), cs = Math.cos(this.yaw);
    const tx = (-sn * f + cs * s) * speed, tz = (-cs * f - sn * s) * speed;
    const accel = this.flying ? 9 : b.onGround ? 14 : b.inWater ? 5 : 3.5;
    const k = Math.min(1, accel * dt);
    b.vx += (tx - b.vx) * k; b.vz += (tz - b.vz) * k;
    let jumped = false;
    if (this.flying) {
      const ty = ((inp.jump ? 1 : 0) - (inp.sneak ? 1 : 0)) * 9;
      b.vy += (ty - b.vy) * Math.min(1, 9 * dt);
    } else if (b.inWater || b.inLava) {
      b.vy -= (b.inLava ? 5 : 7) * dt;
      if (inp.jump) b.vy = Math.min(b.vy + 26 * dt, 3.4);
      if (inp.sneak) b.vy = Math.max(b.vy - 10 * dt, -3);
      b.vy = Math.max(b.vy, -3.5);
      // climb out of water at edges
      if (b.hitH && (inp.f > 0 || inp.jump)) b.vy = 7.5;
    } else if (b.climbing) {
      b.vy = inp.jump || (b.hitH && inp.f > 0) ? 2.8 : inp.sneak ? 0 : Math.max(b.vy - 32 * dt, -2.5);
    } else {
      b.vy -= 32 * dt;
      b.vy = Math.max(b.vy, -60);
      if (inp.jump && b.onGround) {
        const jb = this.effect('jump');
        b.vy = (steedSpeed ? 11.5 : 9.0) + (jb ? 1.8 * (jb.amp + 1) : 0);
        if (this.sprinting) { b.vx += -sn * 2; b.vz += -cs * 2; }
        this.exhaust(this.sprinting ? 0.2 : 0.05);
        audio.jump();
        jumped = true;
      }
    }
    // sneak edge guard
    const ox = b.x, oz = b.z;
    const preGround = b.onGround;
    const fallBefore = b.fallDist;
    move(world, b, b.vx * dt, b.vy * dt, b.vz * dt, 0.6);
    if (this.sneaking && preGround && !b.onGround && b.vy <= 0) {
      const supported = (x: number, z: number) => {
        for (const [cx, cz] of [[x - 0.3, z - 0.3], [x + 0.3, z - 0.3], [x - 0.3, z + 0.3], [x + 0.3, z + 0.3]]) if (world.solid(Math.floor(cx), Math.floor(b.y - 0.6), Math.floor(cz))) return true;
        return false;
      };
      if (!supported(b.x, b.z)) {
        if (supported(ox, b.z)) { b.x = ox; } else if (supported(b.x, oz)) { b.z = oz; } else { b.x = ox; b.z = oz; }
        b.y = Math.ceil(b.y - 0.01); b.onGround = true; b.vy = 0;
      }
    }
    // landing
    let fallDamage = 0;
    if (b.onGround || b.inWater || b.climbing || this.flying) {
      if (b.onGround && fallBefore > 3.2 && !b.inWater && !this.flying) {
        const under = world.id(Math.floor(b.x), Math.floor(b.y - 0.1), Math.floor(b.z));
        let d = fallBefore - 3;
        if (under === B.hay_bale) d *= 0.2;
        fallDamage = Math.floor(d);
        audio.land(fallBefore);
      }
      b.fallDist = 0;
    }
    // footsteps
    const moved = Math.hypot(b.x - ox, b.z - oz);
    if (b.onGround && !this.flying) {
      this.walkDist += moved;
      this.stepAcc += moved;
      if (this.stepAcc > (this.sprinting ? 2.2 : 1.8)) {
        this.stepAcc = 0;
        const id = world.id(Math.floor(b.x), Math.floor(b.y - 0.1), Math.floor(b.z));
        if (id && !this.sneaking) audio.step(BLOCKS[id].sound, [b.x, b.y, b.z]);
        this.exhaust(this.sprinting ? 0.1 : 0.01);
      }
    } else if (b.inWater && moved > 0.05) { this.stepAcc += moved; if (this.stepAcc > 2.5) { this.stepAcc = 0; audio.swim(); } }
    if (b.onGround && this.flying && !this.creative) this.flying = false;
    if (b.onGround && this.flying && inp.sneak) this.flying = false;
    void jumped;
    return fallDamage + (env ? 0 : 0);
  }
  envDamage(world: World): number { return senseEnv(world, this.body); }

  /** fixed 20 TPS survival tick */
  tick(world: World, rules: { naturalRegen: boolean }, difficulty: number) {
    const b = this.body;
    if (this.dead) return;
    this.invulnT = Math.max(0, this.invulnT - 0.05);
    // halo bonus
    if (ITEMS[this.inv.slots[ARMOR0]?.id ?? 0]?.key === 'sovereign_halo') {
      if (!this.effect('night_vision') || this.effect('night_vision')!.t < 12) this.effects.set('night_vision', { t: 15, amp: 0 });
      if (this.hp < this.maxHp && Math.random() < 0.02) this.heal(1);
    }
    // effects
    for (const [k, e] of this.effects) {
      e.t -= 0.05;
      if (k === 'regeneration' && Math.random() < 0.05 * (e.amp + 1) * 0.8) this.heal(1);
      if (k === 'poison' && this.hp > 1 && Math.random() < 0.04 * (e.amp + 1)) this.hurt(1, { kind: 'poison' });
      if (k === 'wither' && Math.random() < 0.04 * (e.amp + 1)) this.hurt(1, { kind: 'magic' });
      if (k === 'hunger_fx') this.exhaust(0.005 * (e.amp + 1));
      if (e.t <= 0) { this.effects.delete(k); if (k === 'absorption') this.absorption = 0; }
    }
    if (this.creative) { this.hp = this.maxHp; this.hunger = 20; this.air = 15; this.fireT = 0; return; }
    // hunger
    while (this.exhaustion >= 4) { this.exhaustion -= 4; if (this.sat > 0) this.sat = Math.max(0, this.sat - 1); else if (difficulty > 0) this.hunger = Math.max(0, this.hunger - 1); }
    if (difficulty === 0) { this.hunger = Math.max(this.hunger, 20); if (Math.random() < 0.01) this.heal(1); }
    this.regenT++;
    if (rules.naturalRegen && this.hunger >= 18 && this.hp < this.maxHp) {
      if (this.sat > 0 && this.hunger === 20 && this.regenT >= 10) { this.regenT = 0; const h = Math.min(1, this.sat / 6); this.heal(h); this.exhaust(h * 6); }
      else if (this.regenT >= 80) { this.regenT = 0; this.heal(1); this.exhaust(6); }
    }
    if (this.hunger <= 0) {
      this.starveT++;
      if (this.starveT >= 80) { this.starveT = 0; const floor = difficulty === 3 ? 0 : difficulty === 2 ? 1 : 10; if (this.hp > floor) this.hurt(1, { kind: 'starve' }); }
    }
    // air
    if (b.eyeInWater && !this.effect('water_breathing')) {
      const gills = enchLevel(this.inv.slots[ARMOR0], 'gills');
      if (Math.random() > gills / (gills + 1)) this.air -= 0.05;
      if (this.air <= 0) { this.air = 0; this.drownT++; if (this.drownT >= 20) { this.drownT = 0; this.hurt(2, { kind: 'drown' }); } }
    } else this.air = Math.min(15, this.air + 0.25);
    // fire / lava / contact
    if (b.inLava) { this.setFire(8); if (this.invulnT <= 0) this.hurt(4, { kind: 'lava' }); }
    if (b.inWater) this.fireT = 0;
    if (this.fireT > 0) {
      this.fireT -= 0.05;
      this.envT++;
      if (this.envT >= 20) { this.envT = 0; this.hurt(1, { kind: 'fire' }); }
    }
    const contact = senseEnv(world, b);
    if (contact && this.invulnT <= 0) { const fireLike = world.id(Math.floor(b.x), Math.floor(b.y), Math.floor(b.z)) === B.fire; if (fireLike) this.setFire(3); this.hurt(contact, { kind: fireLike ? 'fire' : 'contact' }); }
    // suffocation
    const head = world.id(Math.floor(b.x), Math.floor(this.eyeY()), Math.floor(b.z));
    if (head && BLOCKS[head].opaque && BLOCKS[head].solid && Math.random() < 0.1) this.hurt(1, { kind: 'suffocate' });
    if (b.y < -64) this.hurt(4, { kind: 'void' });
  }

  serialize() {
    return {
      pos: [this.x, this.y, this.z], yaw: this.yaw, pitch: this.pitch, hp: this.hp, hunger: this.hunger, sat: this.sat, exhaustion: this.exhaustion,
      air: this.air, xp: this.xp, level: this.level, totalXp: this.totalXp, inv: this.inv.serialize(), effects: [...this.effects], fireT: this.fireT,
      spawn: this.spawn, dim: this.dim, flying: this.flying, absorption: this.absorption,
    };
  }
  load(d: ReturnType<Player['serialize']> | null) {
    if (!d) return;
    const n = (v: unknown, def: number) => (typeof v === 'number' && Number.isFinite(v) ? v : def);
    if (Array.isArray(d.pos)) { this.body.x = n(d.pos[0], 0); this.body.y = n(d.pos[1], 80); this.body.z = n(d.pos[2], 0); }
    this.yaw = n(d.yaw, 0); this.pitch = n(d.pitch, 0);
    this.hp = n(d.hp, 20); this.hunger = n(d.hunger, 20); this.sat = n(d.sat, 5); this.exhaustion = n(d.exhaustion, 0);
    this.air = n(d.air, 15); this.xp = n(d.xp, 0); this.level = n(d.level, 0); this.totalXp = n(d.totalXp, 0);
    this.inv.load(d.inv);
    this.effects = new Map(Array.isArray(d.effects) ? d.effects : []);
    this.fireT = n(d.fireT, 0); this.spawn = d.spawn ?? null; this.dim = (d.dim ?? 0) as Dim; this.flying = !!d.flying; this.absorption = n(d.absorption, 0);
    if (this.hp <= 0) this.hp = 1;
  }
}

function deathText(kind: string, attacker: unknown): string {
  const name = (attacker as { name?: string } | undefined)?.name;
  switch (kind) {
    case 'fall': return 'You fell from a high place.';
    case 'lava': return 'You tried to swim in lava.';
    case 'fire': return 'You burned to a crisp.';
    case 'drown': return 'You ran out of air.';
    case 'starve': return 'You starved.';
    case 'void': return 'You fell into the void.';
    case 'explosion': return 'You were caught in a blast.';
    case 'suffocate': return 'You suffocated inside a block.';
    case 'contact': return 'You were pricked to death.';
    case 'poison': case 'magic': return 'You succumbed to dark magic.';
    case 'fireball': return 'You were struck by a fireball.';
    case 'projectile': return name ? `You were shot by a ${name}.` : 'You were shot.';
    default: return name ? `You were slain by a ${name}.` : 'You died.';
  }
}
