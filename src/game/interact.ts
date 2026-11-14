import * as THREE from 'three';
import { B, BLOCKS, SOLID, OPAQUE, cropStages, modelBoxes, tileId, type BlockDef } from './registry/blocks';
import { ITEMS, itemByKey, type ItemStack, POTIONS } from './registry/items';
import { enchLevel } from './registry/enchant';
import { DIRS, FACING_VEC, Dim } from './constants';
import { raycast, rayBox, type RayHit } from './entity/physics';
import { Mob, Boat, Cart, Bobber, Projectile, ItemEntity, type Entity } from './entity/entities';
import { audio } from './audio/audio';
import { FISHING } from './loot';
import { TICK_BUTTON } from './systems/pulse';
import type { Game } from './Game';
import type { MoveInput } from './player/Player';
import { useUI } from '../ui/store';
import { DYE_COLORS } from './registry/blocks';

const facingFromYaw = (yaw: number) => {
  // player looks along (-sin yaw, -cos yaw)
  const lx = -Math.sin(yaw), lz = -Math.cos(yaw);
  if (Math.abs(lx) > Math.abs(lz)) return lx > 0 ? 1 : 3;
  return lz > 0 ? 2 : 0;
};
const facingIndex = (dx: number, dz: number) => FACING_VEC.findIndex(([a, b]) => a === dx && b === dz);

export class Interact {
  target: RayHit | null = null;
  entityTarget: Entity | null = null;
  breakProgress = 0;
  private breakKey = '';
  private digT = 0;
  useT = 0;
  useKind: '' | 'eat' | 'drink' | 'bow' | 'shield' = '';
  bowDraw = 0;
  private attackT = 0;
  private placeT = 0;
  private lastSwing = 0;
  private wandA: [number, number, number] | null = null;
  private wandB: [number, number, number] | null = null;
  private jumpTapT = 0;
  constructor(private g: Game) {}

  /* ------------------------------------------------ input entry points */
  mouseDown(btn: number) {
    const p = this.g.player;
    if (p.dead || p.sleeping) return;
    if (btn === 0) {
      this.swingArm();
      const held = p.inv.held;
      if (held && ITEMS[held.id].use === 'wand' && p.creative && this.target) { this.wandA = [this.target.x, this.target.y, this.target.z]; this.g.message(`Corner A set at ${this.wandA.join(', ')}`); return; }
      if (this.entityTarget) this.attack(this.entityTarget);
      else if (p.creative && this.target) { this.creativeBreak(); }
    } else if (btn === 2) {
      this.placeT = 0;
      this.rightClick(true);
    } else if (btn === 1 && this.target) {
      // pick block
      const id = this.g.world.id(this.target.x, this.target.y, this.target.z);
      const item = this.itemForBlock(id);
      if (item < 0) return;
      const inv = p.inv;
      const slot = inv.slots.findIndex((s, i) => i < 9 && s?.id === item);
      if (slot >= 0) inv.selected = slot;
      else if (p.creative) { inv.held = { id: item, count: 64 }; }
      else { const any = inv.slots.findIndex((s, i) => i >= 9 && i < 36 && s?.id === item); if (any >= 0) { const t = inv.slots[inv.selected]; inv.slots[inv.selected] = inv.slots[any]; inv.slots[any] = t; } }
      inv.changed();
    }
  }
  mouseUp(btn: number) {
    if (btn === 2) this.releaseUse();
    if (btn === 0) { this.breakProgress = 0; this.breakKey = ''; }
  }
  itemForBlock(id: number): number {
    const d = BLOCKS[id];
    if (!id || !d) return -1;
    if (d.key.endsWith('_crop')) return itemByKey({ wheat_crop: 'wheat_seeds', carrot_crop: 'carrot', potato_crop: 'potato', beet_crop: 'beetroot_seeds' }[d.key]!).id;
    if (d.key === 'pulse_wire') return itemByKey('pulsite').id;
    if (d.key === 'berry_bush') return itemByKey('sunberries').id;
    if (d.key === 'wood_door' || d.key === 'iron_door') return itemByKey(d.key).id;
    if (!d.item) return -1;
    return id;
  }
  jumpPressed() {
    const p = this.g.player;
    const now = performance.now();
    if (p.creative && now - this.jumpTapT < 300) { p.flying = !p.flying; p.body.vy = 0; this.jumpTapT = 0; return; }
    this.jumpTapT = now;
  }
  swingArm() { this.g.swing = 1; if (performance.now() - this.lastSwing > 200) { audio.swing(); this.lastSwing = performance.now(); } }

  /* ------------------------------------------------ per-frame */
  frame(dt: number) {
    const g = this.g, p = g.player;
    this.attackT += dt;
    // mining
    if (g.mouse[0] && this.target && !this.entityTarget && !p.creative) this.mine(dt);
    else if (g.mouse[0] && p.creative && this.target && !this.entityTarget) { this.placeT -= dt; if (this.placeT <= 0 && this.breakKey) this.creativeBreak(); }
    else { this.breakProgress = 0; this.breakKey = ''; }
    // right button held
    if (g.mouse[2]) {
      if (this.useKind) this.continueUse(dt);
      else { this.placeT -= dt; if (this.placeT <= 0) this.rightClick(false); }
    }
    p.blocking = this.useKind === 'shield';
  }
  updateSelection() {
    const g = this.g, p = g.player;
    const [lx, ly, lz] = p.look();
    const reach = p.creative ? 6 : 4.6;
    const ex = p.x, ey = p.eyeY(), ez = p.z;
    const hit = p.dead ? null : raycast(g.world, ex, ey, ez, lx, ly, lz, reach);
    // entity under crosshair
    let best: Entity | null = null, bd = hit ? hit.dist : reach;
    if (!p.dead) for (const e of g.entities.list) {
      if (e.dead || !(e instanceof Mob || e instanceof Boat || e instanceof Cart)) continue;
      if (p.riding && p.riding.id === e.id) continue;
      const b = e.body;
      const r = rayBox(ex, ey, ez, lx, ly, lz, b.x - b.hw - 0.05, b.y, b.z - b.hw - 0.05, b.x + b.hw + 0.05, b.y + b.h, b.z + b.hw + 0.05);
      if (r && r[0] < bd && r[0] < (p.creative ? 6 : 3.6)) { bd = r[0]; best = e; }
    }
    this.entityTarget = best;
    this.target = best ? null : hit;
    const sel = g.selection;
    if (this.target) {
      const { x, y, z, id } = this.target;
      const d = BLOCKS[id];
      let bx0 = 0, by0 = 0, bz0 = 0, bx1 = 1, by1 = 1, bz1 = 1;
      if (d.shape === 'model') {
        const boxes = modelBoxes(id, g.world.meta(x, y, z), (a, b, c) => g.world.id(x + a, y + b, z + c));
        bx0 = Math.min(...boxes.map((b) => b[0])) / 16; by0 = Math.min(...boxes.map((b) => b[1])) / 16; bz0 = Math.min(...boxes.map((b) => b[2])) / 16;
        bx1 = Math.max(...boxes.map((b) => b[3])) / 16; by1 = Math.max(...boxes.map((b) => b[4])) / 16; bz1 = Math.max(...boxes.map((b) => b[5])) / 16;
      } else if (d.shape === 'cross') { bx0 = bz0 = 0.15; bx1 = bz1 = 0.85; by1 = 0.85; }
      sel.visible = true;
      sel.scale.set(bx1 - bx0 + 0.004, by1 - by0 + 0.004, bz1 - bz0 + 0.004);
      sel.position.set(x + (bx0 + bx1) / 2, y + (by0 + by1) / 2, z + (bz0 + bz1) / 2);
      const stage = Math.min(7, Math.floor(this.breakProgress * 8));
      g.crack.visible = this.breakProgress > 0.02;
      if (g.crack.visible) {
        g.crack.position.set(x + 0.5 - 0.001, y - 0.001, z + 0.5 - 0.001);
        g.crack.scale.setScalar(1.002);
        const attr = g.crack.geometry.getAttribute('attr') as THREE.BufferAttribute;
        const t = tileId(`destroy_${stage}`);
        for (let i = 0; i < attr.count; i++) attr.setXYZW(i, t, 1, 1, 1);
        attr.needsUpdate = true;
      }
    } else { sel.visible = false; g.crack.visible = false; }
  }
  useProgress() { return this.useKind === 'eat' || this.useKind === 'drink' ? Math.min(1, this.useT / 1.6) : this.useKind === 'bow' ? this.bowDraw : 0; }

  /* ------------------------------------------------ mining */
  breakTime(id: number, tool: ItemStack | null): number {
    const d = BLOCKS[id];
    if (d.hardness < 0) return Infinity;
    if (d.hardness === 0) return 0.05;
    const t = tool ? ITEMS[tool.id].tool : undefined;
    const harvest = this.canHarvest(d, tool);
    let speed = 1;
    if (t && (t.kind === d.tool || (t.kind === 'sword' && (id === B.cobweb || d.key.endsWith('_leaves'))) || (t.kind === 'shears' && (d.key.endsWith('_leaves') || d.key.startsWith('wool') || id === B.cobweb || id === B.vine)))) {
      speed = t.kind === 'sword' ? (id === B.cobweb ? 15 : 1.5) : t.speed;
      const h = enchLevel(tool, 'haste');
      if (h) speed += h * h + 1;
    }
    const p = this.g.player;
    let time = (d.hardness * (harvest ? 1.5 : 5)) / speed;
    if (p.body.eyeInWater && !enchLevel(p.inv.slots[36], 'gills')) time *= 5;
    if (!p.body.onGround && !p.flying && !p.body.climbing) time *= 5;
    return time;
  }
  canHarvest(d: BlockDef, tool: ItemStack | null): boolean {
    if (d.tier < 0) return true;
    const t = tool ? ITEMS[tool.id].tool : undefined;
    return !!t && t.kind === d.tool && t.tier >= d.tier;
  }
  private mine(dt: number) {
    const g = this.g, p = g.player, t = this.target!;
    const k = `${t.x},${t.y},${t.z}`;
    if (k !== this.breakKey) { this.breakKey = k; this.breakProgress = 0; }
    const tool = p.inv.held;
    const time = this.breakTime(t.id, tool);
    if (!isFinite(time)) return;
    this.breakProgress += dt / time;
    this.digT -= dt;
    if (this.digT <= 0) { this.digT = 0.22; audio.dig(BLOCKS[t.id].sound, [t.x + 0.5, t.y + 0.5, t.z + 0.5]); g.blockParticles(t.x, t.y, t.z, t.id, 2); this.swingArm(); }
    if (this.breakProgress >= 1) {
      this.breakProgress = 0; this.breakKey = '';
      p.exhaust(0.005);
      this.breakAt(t.x, t.y, t.z, true, tool, true);
      if (tool && ITEMS[tool.id].tool && BLOCKS[t.id].hardness > 0) {
        const kind = ITEMS[tool.id].tool!.kind;
        if (p.inv.damageSlot(p.inv.selected, kind === 'sword' ? 2 : 1)) { audio.breakBlock('metal', [p.x, p.y + 1, p.z]); g.message('Your tool broke.', 'warn'); }
      }
    }
  }
  private creativeBreak() {
    const t = this.target;
    if (!t) return;
    const held = this.g.player.inv.held;
    if (held && ITEMS[held.id].tool?.kind === 'sword') return;
    this.breakAt(t.x, t.y, t.z, false, null, true);
    this.placeT = 0.2;
    this.breakKey = 'c';
  }
  /** remove a block, spawning drops / side effects */
  breakAt(x: number, y: number, z: number, drops: boolean, tool: ItemStack | null, byPlayer: boolean, explosion = false) {
    const g = this.g, w = g.world;
    const id = w.id(x, y, z);
    if (!id) return;
    const d = BLOCKS[id];
    if (d.hardness < 0 && byPlayer) return;
    const m = w.meta(x, y, z);
    // container contents
    const be = w.blockEntity(x, y, z);
    if (be?.items && drops !== undefined) for (const s of be.items) if (s) g.spawnItem(x + 0.5, y + 0.5, z + 0.5, s);
    if (be?.xp && byPlayer) g.spawnXP(x + 0.5, y + 0.5, z + 0.5, Math.floor(be.xp as number));
    // doors: remove other half
    if (d.orient === 'door') { const oy = m & 8 ? y - 1 : y + 1; if (w.id(x, oy, z) === id) w.set(x, oy, z, 0); }
    // piston base with head
    if ((id === B.piston || id === B.sticky_piston) && m & 8) { const f = m & 7; const hx = x + DIRS[f][0], hy = y + DIRS[f][1], hz = z + DIRS[f][2]; if (w.id(hx, hy, hz) === B.piston_head) w.set(hx, hy, hz, 0); }
    if (id === B.piston_head) { const f = m & 7; const bx = x - DIRS[f][0], by = y - DIRS[f][1], bz = z - DIRS[f][2]; const bid = w.id(bx, by, bz); if (bid === B.piston || bid === B.sticky_piston) { w.set(x, y, z, 0); this.breakAt(bx, by, bz, drops, tool, byPlayer); return; } }
    // ice turns to water
    let replacement = 0;
    if (id === B.ice && !explosion && w.id(x, y - 1, z) !== 0) replacement = B.water;
    if (w.id(x, y + 1, z) === B.water || [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => w.id(x + a, y, z + b) === B.water && w.meta(x + a, y, z + b) === 0)) {
      if (!d.solid && d.shape !== 'liquid' && !replacement) replacement = 0;
    }
    w.set(x, y, z, replacement);
    if (!explosion || Math.random() < 0.3) g.blockParticles(x, y, z, id, explosion ? 4 : 16);
    if (!explosion) audio.breakBlock(d.sound, [x + 0.5, y + 0.5, z + 0.5]);
    if (byPlayer) g.state.stats.mined++;
    if (!drops || g.player.creative && byPlayer) return;
    if (!this.canHarvest(d, tool) && byPlayer) return;
    const fortune = enchLevel(tool, 'bounty');
    const out: ItemStack[] = [];
    const tk = tool ? ITEMS[tool.id] : null;
    if (d.key.endsWith('_leaves') && tk?.key === 'shears') out.push({ id, count: 1 });
    else if ((id === B.tall_grass || id === B.fern || id === B.vine) && tk?.key === 'shears') out.push({ id, count: 1 });
    else if (d.key.startsWith('wool') && tk?.key === 'shears') out.push({ id, count: 1 });
    else if (d.key.endsWith('_crop')) {
      const mature = (m & 7) >= cropStages(d.key) - 1;
      const prod = { wheat_crop: 'wheat', carrot_crop: 'carrot', potato_crop: 'potato', beet_crop: 'beetroot' }[d.key]!;
      const seed = { wheat_crop: 'wheat_seeds', carrot_crop: 'carrot', potato_crop: 'potato', beet_crop: 'beetroot_seeds' }[d.key]!;
      if (mature) {
        out.push({ id: itemByKey(prod).id, count: prod === 'carrot' || prod === 'potato' ? 2 + Math.floor(Math.random() * 3) : 1 });
        if (prod === 'wheat' || prod === 'beetroot') out.push({ id: itemByKey(seed).id, count: 1 + Math.floor(Math.random() * 3) });
      } else out.push({ id: itemByKey(seed).id, count: 1 });
    } else if (id === B.berry_bush) {
      if (m >= 3) out.push({ id: itemByKey('sunberries').id, count: 2 + Math.floor(Math.random() * 2) });
      out.push({ id: itemByKey('sunberries').id, count: 1 });
    } else if (d.drops === 'none') { /* nothing */ }
    else if (!d.drops || d.drops === 'self') { const it = this.itemForBlock(id); if (it >= 0) out.push({ id: it, count: 1 }); }
    else {
      for (const dr of d.drops) {
        if (dr.chance !== undefined && Math.random() > dr.chance * (1 + fortune * 0.5)) continue;
        let n = (dr.min ?? 1) + Math.floor(Math.random() * ((dr.max ?? dr.min ?? 1) - (dr.min ?? 1) + 1));
        if (dr.fortune && fortune) n *= 1 + Math.floor(Math.random() * (fortune + 1));
        if (n > 0) out.push({ id: itemByKey(dr.item).id, count: n });
      }
    }
    for (const s of out) g.spawnItem(x + 0.5, y + 0.3, z + 0.5, s);
    if (d.xp && byPlayer) g.spawnXP(x + 0.5, y + 0.5, z + 0.5, d.xp[0] + Math.floor(Math.random() * (d.xp[1] - d.xp[0] + 1)));
    if (id === B.mob_cage && byPlayer) g.spawnXP(x + 0.5, y + 0.5, z + 0.5, 20);
  }

  /* ------------------------------------------------ combat */
  attack(e: Entity) {
    const g = this.g, p = g.player;
    if (e instanceof Boat || e instanceof Cart) {
      e.hp -= p.creative ? 10 : 1;
      if (e.hp <= 0) { e.dead = true; if (!p.creative) g.spawnItem(e.x, e.y + 0.5, e.z, { id: itemByKey(e instanceof Boat ? 'boat' : 'minecart').id, count: 1 }); }
      return;
    }
    if (!(e instanceof Mob)) return;
    const held = p.inv.held;
    const tool = held ? ITEMS[held.id].tool : undefined;
    const cd = tool?.cooldown ?? 0.5;
    const charge = Math.min(1, this.attackT / cd);
    this.attackT = 0;
    let dmg = (tool?.damage ?? 1) * (0.2 + charge * charge * 0.8);
    const str = p.effect('strength');
    if (str) dmg += 3 * (str.amp + 1);
    const keen = enchLevel(held, 'keen');
    if (keen) dmg += keen * 1.25 * charge;
    const crit = charge > 0.9 && p.body.vy < -0.5 && !p.body.onGround && !p.body.inWater;
    if (crit) { dmg *= 1.5; g.particles(e.x, e.y + e.body.h * 0.7, e.z, [1, 1, 0.8], 10, 2.5, 4, 0.08); }
    if (p.creative) dmg = Math.max(dmg, 1000 * (e.def.boss ? 0 : 1) + dmg);
    e.lootingBonus = enchLevel(held, 'plunder');
    if (e.hurt(dmg, g, 'player', crit)) {
      const kb = (p.sprinting && charge > 0.9 ? 1.2 : 0.6) + enchLevel(held, 'shove') * 0.6;
      e.knockback(e.x - p.x, e.z - p.z, kb);
      if (enchLevel(held, 'blaze')) e.fireT = 4 * enchLevel(held, 'blaze');
      if (tool && !p.creative) p.inv.damageSlot(p.inv.selected, tool.kind === 'sword' ? 1 : 2);
      p.exhaust(0.1);
      p.sprinting = false;
      if (e.dead) g.state.stats.kills++;
    }
  }

  /* ------------------------------------------------ right click */
  private rightClick(first: boolean) {
    const g = this.g, p = g.player;
    this.placeT = 0.22;
    const held = p.inv.held;
    const hd = held ? ITEMS[held.id] : null;
    // 1. entity
    if (this.entityTarget && first) { if (this.useOnEntity(this.entityTarget, held)) { this.swingArm(); return; } }
    // 2. block interaction (sneak bypasses)
    if (this.target && !p.sneaking && first) { if (this.useBlock(this.target)) { this.swingArm(); return; } }
    if (this.target && !p.sneaking && !first) { const d = BLOCKS[this.target.id]; if (d.ui || d.container || d.orient === 'door') return; }
    // 3. held item
    if (held && hd) {
      if (this.useItem(held, first)) return;
      if (hd.block !== undefined && hd.id < 256 && BLOCKS[hd.id].item) { if (this.target) this.place(hd.id, held); return; }
    }
    // offhand placement (torches etc.)
    const off = p.inv.slots[40];
    if ((!held || !hd?.use) && off && ITEMS[off.id].block !== undefined && off.id < 256 && this.target) this.place(off.id, off, true);
    else if ((!held || !hd?.use) && off && ITEMS[off.id].key === 'shield' && first) { this.useKind = 'shield'; this.useT = 0; }
  }
  private releaseUse() {
    const g = this.g, p = g.player;
    if (this.useKind === 'bow' && this.bowDraw > 0.15) {
      const held = p.inv.held;
      const power = this.bowDraw;
      const arrowId = itemByKey('arrow').id;
      const endless = enchLevel(held, 'endless') > 0;
      if (p.creative || p.inv.countId(arrowId) > 0) {
        if (!p.creative && !endless) p.inv.remove((s) => s.id === arrowId, 1);
        const [lx, ly, lz] = p.look();
        const sp = 38 * power;
        const dmg = 3 + 3 * power + enchLevel(held, 'force') * 1.2;
        const pr = new Projectile(p.x + lx * 0.4, p.eyeY() - 0.1, p.z + lz * 0.4, lx * sp, ly * sp, lz * sp, 'arrow', true, dmg);
        if (enchLevel(held, 'flame')) pr.fire = true;
        g.entities.add(pr);
        audio.bow();
        if (!p.creative) p.inv.damageSlot(p.inv.selected, 1);
      }
    }
    this.useKind = ''; this.useT = 0; this.bowDraw = 0;
  }
  private continueUse(dt: number) {
    const p = this.g.player;
    this.useT += dt;
    const held = p.inv.held;
    if (this.useKind === 'bow') { this.bowDraw = Math.min(1, this.useT / 1.0); return; }
    if (this.useKind === 'shield') return;
    if (!held) { this.useKind = ''; return; }
    if (Math.floor(this.useT * 5) !== Math.floor((this.useT - dt) * 5)) { if (this.useKind === 'eat') { audio.eat(); this.g.particles(p.x + p.look()[0] * 0.4, p.eyeY() - 0.2, p.z + p.look()[2] * 0.4, [0.8, 0.6, 0.4], 3, 1.5, 9, 0.06); } else audio.drink(); }
    if (this.useT >= 1.6) {
      const d = ITEMS[held.id];
      if (this.useKind === 'eat' && d.food) {
        p.hunger = Math.min(20, p.hunger + d.food.hunger);
        p.sat = Math.min(p.hunger, p.sat + d.food.sat);
        for (const [k, t, a, ch] of d.food.effects ?? []) if (Math.random() < (ch ?? 1)) p.addEffect(k, t, a);
        p.inv.consumeHeld();
        if (d.food.returns) p.inv.add({ id: itemByKey(d.food.returns).id, count: 1 });
      } else if (this.useKind === 'drink') {
        if (d.key === 'milk_bucket') { p.effects.clear(); p.absorption = 0; p.inv.held = { id: itemByKey('bucket').id, count: 1 }; }
        else if (d.key === 'potion') {
          const eff = POTIONS[held.data ?? 'water']?.effect;
          if (eff) p.addEffect(eff[0], eff[1], eff[2]);
          p.inv.held = { id: itemByKey('glass_bottle').id, count: 1 };
        }
      }
      p.inv.changed();
      this.useKind = ''; this.useT = 0;
      this.placeT = 0.4;
    }
  }

  private useOnEntity(e: Entity, held: ItemStack | null): boolean {
    const g = this.g, p = g.player;
    const hk = held ? ITEMS[held.id].key : '';
    if (e instanceof Boat || e instanceof Cart) {
      if (p.riding) return false;
      p.riding = { kind: e instanceof Boat ? 'boat' : 'cart', id: e.id };
      g.message('Press crouch to get out.');
      return true;
    }
    if (!(e instanceof Mob)) return false;
    if (e.def.ai === 'villager') {
      if (e.baby) return false;
      g.openPanel('trade', null, e.id);
      audio.creature('folk', [e.x, e.y + 1, e.z]);
      return true;
    }
    if (hk === 'lead' && !e.def.hostile && e.def.ai === 'passive') {
      e.leashed = !e.leashed;
      if (e.leashed && !p.creative) p.inv.consumeHeld();
      return true;
    }
    if (e.leashed && !held) { e.leashed = false; g.spawnItem(e.x, e.y + 0.5, e.z, { id: itemByKey('lead').id, count: 1 }); return true; }
    if (e.def.breed && held && e.def.breed.includes(hk)) {
      if (e.baby) { e.growT -= 60; } else if (e.breedCd <= 0 && e.love <= 0 && (e.def.key !== 'steed' || e.tamed)) { e.love = 30; } else return false;
      if (!p.creative) p.inv.consumeHeld();
      audio.eat();
      g.particles(e.x, e.y + e.body.h, e.z, [1, 0.35, 0.45], 6, 1, -1);
      return true;
    }
    if (e.def.shear && hk === 'shears' && !e.sheared && !e.baby) {
      e.sheared = true; e.regrowT = 60 + Math.random() * 120;
      if (e.def.key === 'fluffer') { const wool = B[`wool_${DYE_COLORS[[0, 0, 0, 1, 7, 0][e.color] ?? 0]}`]; g.spawnItem(e.x, e.y + 1, e.z, { id: wool, count: 1 + Math.floor(Math.random() * 3) }); }
      else g.spawnItem(e.x, e.y + 1, e.z, { id: B.mushroom_red, count: 2 + Math.floor(Math.random() * 3) });
      audio.noise(0.15, 3000, 2, 0.3, 'bandpass', [e.x, e.y, e.z]);
      if (!p.creative) p.inv.damageSlot(p.inv.selected, 1);
      return true;
    }
    if (e.def.key === 'fluffer' && hk.startsWith('dye_')) {
      const color = hk.slice(4);
      const tintIdx = { white: 0, black: 3, orange: 4 }[color as 'white'];
      if (tintIdx !== undefined) { e.color = tintIdx; e.model.mats.forEach(() => {}); if (!p.creative) p.inv.consumeHeld(); g.message(`Dye takes on the fleece (shear to collect ${color} fleece).`); return true; }
      return false;
    }
    if (e.def.milk && hk === 'bucket') { p.inv.consumeHeld(); p.inv.add({ id: itemByKey('milk_bucket').id, count: 1 }); audio.drink(); return true; }
    if (e.def.key === 'sporeback' && hk === 'bowl') { p.inv.consumeHeld(); p.inv.add({ id: itemByKey('mushroom_stew').id, count: 1 }); return true; }
    if (e.def.ride && !e.baby) {
      if (hk === 'saddle' && e.tamed && !e.saddled) { e.saddled = true; if (!p.creative) p.inv.consumeHeld(); audio.place('wool', [e.x, e.y, e.z]); return true; }
      if (!e.tamed) {
        if (Math.random() < 0.3 || p.creative) { e.tamed = true; g.message('The steed trusts you now. Give it a saddle to ride it.', 'good'); g.particles(e.x, e.y + e.body.h, e.z, [1, 0.35, 0.45], 8, 1, -1); }
        else { audio.creature('neigh', [e.x, e.y + 1, e.z], 'hurt'); g.message('The steed bucks you off. Keep trying.'); p.knock(p.x - e.x, p.z - e.z, 0.6); }
        return true;
      }
      if (e.saddled) { p.riding = { kind: 'steed', id: e.id }; e.ridden = true; g.message('Press crouch to dismount.'); return true; }
    }
    return false;
  }

  /** returns true if the block consumed the click */
  private useBlock(h: RayHit): boolean {
    const g = this.g, w = g.world, p = g.player;
    const { x, y, z, id } = h;
    const d = BLOCKS[id];
    const m = w.meta(x, y, z);
    const held = p.inv.held;
    const hk = held ? ITEMS[held.id].key : '';
    if (d.ui === 'crafting') { g.openPanel('crafting', [x, y, z]); return true; }
    if (d.ui === 'enchant') { g.openPanel('enchant', [x, y, z]); return true; }
    if (d.ui === 'anvil') { g.openPanel('anvil', [x, y, z]); return true; }
    if (d.container) {
      const panel = d.container === 'chest' ? 'chest' : d.container === 'dispenser' ? 'dispenser' : d.container === 'hopper' ? 'hopper' : d.container === 'brewing' ? 'brewing' : 'furnace';
      const be = w.blockEntity(x, y, z, d.container)!;
      be.items ??= new Array(d.container === 'chest' ? 27 : d.container === 'dispenser' ? 9 : d.container === 'hopper' || d.container === 'brewing' ? 5 : 3).fill(null);
      g.openPanel(panel, [x, y, z]);
      if (d.container === 'chest') audio.door([x, y, z], true);
      return true;
    }
    if (d.orient === 'door' && id !== B.iron_door) {
      const ly = m & 8 ? y - 1 : y;
      const lm = w.meta(x, ly, z), um = w.meta(x, ly + 1, z);
      const open = !(lm & 4);
      w.set(x, ly, z, id, open ? lm | 4 : lm & ~4);
      w.set(x, ly + 1, z, id, open ? um | 4 : um & ~4);
      audio.door([x, y, z], open);
      return true;
    }
    if (id === B.wood_trapdoor) { w.set(x, y, z, id, m ^ 4); audio.door([x, y, z], !(m & 4)); return true; }
    if (id === B.wood_fence_gate) { const f = facingFromYaw(p.yaw); w.set(x, y, z, id, m & 4 ? m & ~4 : ((m & ~3) | (f & 1 ? 1 : 0)) | 4); audio.door([x, y, z], !(m & 4)); return true; }
    if (id === B.lever) { w.set(x, y, z, id, m ^ 8); audio.lever([x, y, z]); return true; }
    if (id === B.stone_button || id === B.wood_button) { if (!(m & 8)) { w.set(x, y, z, id, m | 8); audio.lever([x, y, z]); w.schedule(x, y, z, id === B.stone_button ? 20 : 30, TICK_BUTTON); } return true; }
    if (id === B.repeater) { const delay = ((m >> 4) + 1) & 3; w.set(x, y, z, id, (m & ~48) | (delay << 4)); audio.lever([x, y, z]); g.message(`Delay: ${delay + 1}`); return true; }
    if (id === B.comparator) { w.set(x, y, z, id, m ^ 16); audio.lever([x, y, z]); g.message(m & 16 ? 'Compare mode' : 'Subtract mode'); g.pulse.touch(x, y, z); return true; }
    if (id === B.bed) {
      if (g.dim !== Dim.Overworld) { g.explode(x + 0.5, y + 0.5, z + 0.5, 3, true, true); g.message('Beds are not safe here.', 'warn'); return true; }
      p.spawn = [x, y, z];
      const night = g.time > 0.52 && g.time < 0.98;
      if (!night && !g.state.weather.thunder) { g.message('Spawn point set. You can only sleep at night or during storms.'); return true; }
      const threat = g.entities.list.some((e) => e instanceof Mob && e.def.hostile && e.distTo(x, y, z) < 8);
      if (threat) { g.message('You may not rest now; there are creatures nearby.', 'warn'); return true; }
      p.sleeping = true; p.body.x = x + 0.5; p.body.z = z + 0.5; p.body.y = y + 0.6;
      g.message('Spawn point set. Sleeping…');
      return true;
    }
    if (id === B.berry_bush && m >= 3) { w.set(x, y, z, id, 1); g.spawnItem(x + 0.5, y + 0.6, z + 0.5, { id: itemByKey('sunberries').id, count: 2 + Math.floor(Math.random() * 2) }); return true; }
    if ((id === B.rift_core || id === B.void_core) && hk === 'igniter') {
      let ok = true;
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if ((dx || dz) && w.id(x + dx, y, z + dz) !== B.obsidian) ok = false;
      if (!ok) { g.message('A rift core must sit in the middle of a 3×3 ring of obsidian.', 'warn'); return true; }
      if (id === B.void_core && g.dim !== Dim.Overworld) { g.message('The Hollow can only be reached from the Overworld.', 'warn'); return true; }
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if ((dx || dz) && w.id(x + dx, y + 1, z + dz) === 0) w.set(x + dx, y + 1, z + dz, B.rift_pad);
      audio.portal();
      g.particles(x + 0.5, y + 1.5, z + 0.5, id === B.rift_core ? [1, 0.5, 0.2] : [0.7, 0.4, 1], 40, 4, -1);
      g.message(id === B.rift_core ? 'The rift to Emberdeep opens. Stand on it to travel.' : 'The rift to The Hollow opens. There is no way back until its master falls.', 'good');
      if (!p.creative) p.inv.damageSlot(p.inv.selected, 1);
      return true;
    }
    if (id === B.powder_keg && hk === 'igniter') { w.set(x, y, z, 0); g.primeKeg(x, y, z); p.inv.damageSlot(p.inv.selected, 1); return true; }
    if (id === B.wood_sign) { this.openSign(x, y, z); return true; }
    if (id === B.flower_red && false) return true;
    return false;
  }
  openSign(x: number, y: number, z: number) {
    if (document.pointerLockElement) document.exitPointerLock();
    useUI.getState().set({ screen: 'sign', panelPos: [x, y, z] });
  }

  private placementPos(h: RayHit): [number, number, number] {
    const d = BLOCKS[h.id];
    if (d.replaceable && h.id !== B.water && h.id !== B.lava) return [h.x, h.y, h.z];
    return [h.x + h.nx, h.y + h.ny, h.z + h.nz];
  }
  supported(id: number, m: number, x: number, y: number, z: number): boolean {
    const w = this.g.world, d = BLOCKS[id];
    const below = w.id(x, y - 1, z);
    switch (d.needs) {
      case 'soil': return [B.grass, B.dirt, B.farmland, B.sporeturf, B.mud, B.path].includes(below);
      case 'farmland': return below === B.farmland;
      case 'sand': return [B.sand, B.red_sand, B.terracotta, B.dirt, B.grass].includes(below);
      case 'solid': return SOLID[below] === 1 && below !== B.cactus;
      case 'water': return below === B.water || (id === B.reeds && (below === B.reeds || [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => w.id(x + a, y - 1, z + b) === B.water)));
      case 'ember': return [B.emberstone, B.ashsand, B.basalt, B.magma_block].includes(below);
      case 'wall': {
        const isLadder = id === B.ladder || id === B.vine;
        if (isLadder) { const [fx, fz] = FACING_VEC[m & 3]; return SOLID[w.id(x + fx, y, z + fz)] === 1 || (id === B.vine && SOLID[w.id(x, y + 1, z)] === 1) || (id === B.vine && w.id(x, y + 1, z) === B.vine); }
        const a = m & 7;
        if (a === 0) return SOLID[below] === 1 || below === B.wood_fence || below === B.cobble_wall;
        const [fx, fz] = FACING_VEC[(a - 1) & 3];
        return SOLID[w.id(x + fx, y, z + fz)] === 1;
      }
    }
    return true;
  }
  /** place block `bid` from stack */
  place(bid: number, stack: ItemStack, offhand = false): boolean {
    const g = this.g, w = g.world, p = g.player, h = this.target;
    if (!h) return false;
    const [x, y, z] = this.placementPos(h);
    if (y < 0 || y >= 128) return false;
    const cur = w.id(x, y, z);
    if (cur && !BLOCKS[cur].replaceable) return false;
    const d = BLOCKS[bid];
    let meta = 0;
    const f = facingFromYaw(p.yaw);
    switch (d.orient) {
      case 'facing': {
        if (bid === B.piston || bid === B.sticky_piston) {
          const [lx, ly, lz] = p.look();
          const ax = Math.abs(lx), ay = Math.abs(ly), az = Math.abs(lz);
          meta = ay > ax && ay > az ? (ly > 0 ? 2 : 3) : ax > az ? (lx > 0 ? 0 : 1) : (lz > 0 ? 4 : 5);
        } else if (bid === B.repeater || bid === B.comparator || bid === B.wood_fence_gate || bid === B.bed) meta = f;
        else if (bid === B.wood_trapdoor) meta = f | (h.ny === -1 || (h.ny === 0 && h.fy > 0.5) ? 8 : 0);
        else if (bid === B.wood_sign) {
          if (h.ny !== 0) { g.message('Signs hang on walls.'); return false; }
          meta = facingIndex(-h.nx, -h.nz);
        } else meta = (f + 2) & 3;
        break;
      }
      case 'axis': meta = h.ny ? 0 : h.nx ? 1 : 2; break;
      case 'slab': {
        meta = h.ny === -1 || (h.ny === 0 && h.fy > 0.5) ? 1 : 0;
        // merge into a full block? slabs of same type stacking -> keep simple: second slab on top half becomes full plank/stone
        if (h.id === bid && ((w.meta(h.x, h.y, h.z) === 0 && h.ny === 1) || (w.meta(h.x, h.y, h.z) === 1 && h.ny === -1))) {
          const full = bid === B.wood_slab ? B.oak_planks : bid === B.stone_slab ? B.smooth_stone : B.bricks;
          w.set(h.x, h.y, h.z, full); this.afterPlace(stack, offhand, full, h.x, h.y, h.z); return true;
        }
        break;
      }
      case 'stairs': meta = f | (h.ny === -1 || (h.ny === 0 && h.fy > 0.5) ? 4 : 0); break;
      case 'door': meta = f; break;
      case 'wall': {
        if (bid === B.ladder || bid === B.vine) { if (h.ny !== 0) return false; meta = facingIndex(-h.nx, -h.nz); }
        else if (h.ny === 1) meta = 0;
        else if (h.ny === -1) return false;
        else meta = 1 + facingIndex(-h.nx, -h.nz);
        break;
      }
    }
    if (bid === B.hopper) meta = h.ny !== 0 ? 0 : 1 + facingIndex(-h.nx, -h.nz);
    if (d.key.endsWith('_leaves')) meta = 4;
    if (bid === B.farmland) meta = 7;
    if (!this.supported(bid, meta, x, y, z) || (bid === B.cactus && !this.supportedCactus(x, y, z))) return false;
    // collision with entities
    if (d.solid) {
      const boxes = modelBoxes(bid, meta, (a, b, c) => w.id(x + a, y + b, z + c));
      const hits = (bb: { x: number; y: number; z: number; hw: number; h: number }) => boxes.some((bx) => x + bx[3] / 16 > bb.x - bb.hw && x + bx[0] / 16 < bb.x + bb.hw && y + bx[4] / 16 > bb.y && y + bx[1] / 16 < bb.y + bb.h && z + bx[5] / 16 > bb.z - bb.hw && z + bx[2] / 16 < bb.z + bb.hw);
      if (hits(p.body)) return false;
      if (g.entities.list.some((e) => e instanceof Mob && hits(e.body))) return false;
    }
    if (d.orient === 'door') {
      if (!(w.id(x, y + 1, z) === 0 || BLOCKS[w.id(x, y + 1, z)].replaceable)) return false;
      if (!SOLID[w.id(x, y - 1, z)]) return false;
      w.set(x, y, z, bid, meta);
      w.set(x, y + 1, z, bid, meta | 8);
    } else w.set(x, y, z, bid, meta);
    if (d.container) { const be = w.blockEntity(x, y, z, d.container)!; be.items ??= new Array(d.container === 'chest' ? 27 : d.container === 'dispenser' ? 9 : d.container === 'hopper' || d.container === 'brewing' ? 5 : 3).fill(null); }
    this.afterPlace(stack, offhand, bid, x, y, z);
    if (bid === B.wood_sign) this.openSign(x, y, z);
    return true;
  }
  private supportedCactus(x: number, y: number, z: number) {
    const w = this.g.world;
    for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (SOLID[w.id(x + a, y, z + b)]) return false;
    const below = w.id(x, y - 1, z);
    return below === B.sand || below === B.red_sand || below === B.cactus;
  }
  private afterPlace(stack: ItemStack, offhand: boolean, bid: number, x: number, y: number, z: number) {
    const g = this.g, p = g.player;
    audio.place(BLOCKS[bid].sound, [x + 0.5, y + 0.5, z + 0.5]);
    this.swingArm();
    g.state.stats.placed++;
    if (!p.creative) {
      stack.count--;
      if (stack.count <= 0) { if (offhand) p.inv.slots[40] = null; else p.inv.held = null; }
      p.inv.changed();
    }
  }

  /** item right-click behaviours; returns true if handled */
  private useItem(held: ItemStack, first: boolean): boolean {
    const g = this.g, w = g.world, p = g.player;
    const d = ITEMS[held.id];
    const h = this.target;
    // tools on blocks
    if (h && d.tool) {
      const k = d.tool.kind;
      if (k === 'hoe' && (h.id === B.grass || h.id === B.dirt || h.id === B.path) && w.id(h.x, h.y + 1, h.z) === 0) {
        w.set(h.x, h.y, h.z, B.farmland, 0); audio.place('gravel', [h.x, h.y, h.z]); this.swingArm(); if (!p.creative) p.inv.damageSlot(p.inv.selected, 1); return true;
      }
      if (k === 'shovel' && h.id === B.grass && w.id(h.x, h.y + 1, h.z) === 0) { w.set(h.x, h.y, h.z, B.path); audio.place('gravel', [h.x, h.y, h.z]); this.swingArm(); if (!p.creative) p.inv.damageSlot(p.inv.selected, 1); return true; }
      if (k === 'axe' && BLOCKS[h.id].key.endsWith('_log')) { const sp = BLOCKS[h.id].key.replace('_log', '_stripped'); w.set(h.x, h.y, h.z, B[sp], w.meta(h.x, h.y, h.z)); audio.place('wood', [h.x, h.y, h.z]); this.swingArm(); if (!p.creative) p.inv.damageSlot(p.inv.selected, 1); return true; }
    }
    if (d.food && first) {
      if (p.hunger < 20 || d.food.always || p.creative) { this.useKind = 'eat'; this.useT = 0; }
      return true;
    }
    const use = d.use ?? '';
    if (!use) return false;
    const [verb, arg] = use.split(':');
    switch (verb) {
      case 'place': { if (!h) return true; this.place(B[arg], held); return true; }
      case 'plant': {
        if (!h || h.ny !== 1) return true;
        const bid = B[arg];
        if (!this.supported(bid, 0, h.x, h.y + 1, h.z) || w.id(h.x, h.y + 1, h.z) !== 0) return true;
        w.set(h.x, h.y + 1, h.z, bid, 0);
        this.afterPlace(held, false, bid, h.x, h.y + 1, h.z);
        return true;
      }
      case 'door': { if (!h) return true; this.place(B[arg], held); return true; }
      case 'bucket': {
        if (!first) return true;
        const fh = raycast(w, p.x, p.eyeY(), p.z, ...p.look(), 5, true);
        if (fh && (fh.id === B.water || fh.id === B.lava) && w.meta(fh.x, fh.y, fh.z) === 0) {
          w.set(fh.x, fh.y, fh.z, 0);
          const filled = { id: itemByKey(fh.id === B.water ? 'water_bucket' : 'lava_bucket').id, count: 1 };
          if (p.creative) p.inv.add(filled); else if (held.count === 1) p.inv.held = filled; else { held.count--; if (p.inv.add(filled)) g.spawnItem(p.x, p.y + 1, p.z, filled); }
          p.inv.changed();
          audio.splash([fh.x, fh.y, fh.z]);
        }
        return true;
      }
      case 'pour': {
        if (!first || !h) return true;
        const [x, y, z] = this.placementPos(h);
        const cur = w.id(x, y, z);
        if (cur && !BLOCKS[cur].replaceable) return true;
        if (arg === 'water' && g.dim === Dim.Ember) { g.particles(x + 0.5, y + 0.5, z + 0.5, [0.9, 0.9, 0.9], 20, 2, -2); audio.noise(0.6, 3000, 0.5, 0.3, 'highpass'); }
        else w.set(x, y, z, B[arg], 0);
        if (!p.creative) { p.inv.held = { id: itemByKey('bucket').id, count: 1 }; }
        audio.splash([x, y, z]);
        return true;
      }
      case 'drink_milk': case 'drink': if (first) { this.useKind = 'drink'; this.useT = 0; } return true;
      case 'fill_bottle': {
        if (!first) return true;
        const fh = raycast(w, p.x, p.eyeY(), p.z, ...p.look(), 5, true);
        if (fh && fh.id === B.water) { p.inv.consumeHeld(); const pot = { id: itemByKey('potion').id, count: 1, data: 'water' }; if (p.inv.add(pot)) g.spawnItem(p.x, p.y + 1, p.z, pot); audio.drink(); }
        return true;
      }
      case 'bonemeal': {
        if (!h) return true;
        if (this.bonemeal(h.x, h.y, h.z)) { if (!p.creative) p.inv.consumeHeld(); g.particles(h.x + 0.5, h.y + 0.8, h.z + 0.5, [0.5, 1, 0.5], 10, 1.5, -1); this.swingArm(); }
        this.placeT = 0.25;
        return true;
      }
      case 'ignite': {
        if (!first || !h) return true;
        const [x, y, z] = [h.x + h.nx, h.y + h.ny, h.z + h.nz];
        if (w.id(x, y, z) === 0) { w.set(x, y, z, B.fire); audio.fire([x, y, z]); if (!p.creative) p.inv.damageSlot(p.inv.selected, 1); }
        return true;
      }
      case 'throw': {
        if (!first) return true;
        const [lx, ly, lz] = p.look();
        g.entities.add(new Projectile(p.x + lx * 0.5, p.eyeY() - 0.1, p.z + lz * 0.5, lx * 22, ly * 22 + 2, lz * 22, arg as 'snowball' | 'egg', true, arg === 'snowball' ? 0.5 : 0.5));
        if (!p.creative) p.inv.consumeHeld();
        this.swingArm();
        return true;
      }
      case 'bow': {
        if (first && (p.creative || p.inv.countId(itemByKey('arrow').id) > 0)) { this.useKind = 'bow'; this.useT = 0; }
        return true;
      }
      case 'shield': if (first) { this.useKind = 'shield'; this.useT = 0; } return true;
      case 'fish': {
        if (!first) return true;
        const key = 'player';
        const cur = g.bobbers.get(key);
        if (cur && !cur.dead) {
          if (cur.biting > 0) {
            const r = Math.random();
            const pool = r < 0.75 ? FISHING.fish : r < 0.92 ? FISHING.junk : FISHING.treasure;
            const [k] = pool[Math.floor(Math.random() * pool.length)];
            const it = new ItemEntity(cur.x, cur.y + 0.3, cur.z, { id: itemByKey(k).id, count: 1 });
            const dx = p.x - cur.x, dy = p.y + 1.5 - cur.y, dz = p.z - cur.z;
            it.body.vx = dx * 1.1; it.body.vy = dy * 1.1 + Math.sqrt(Math.hypot(dx, dz)) * 2.2; it.body.vz = dz * 1.1;
            it.pickupDelay = 0;
            g.entities.add(it);
            g.spawnXP(p.x, p.y + 1, p.z, 1 + Math.floor(Math.random() * 6));
            audio.splash([cur.x, cur.y, cur.z]);
          }
          cur.dead = true; g.bobbers.delete(key);
          if (!p.creative) p.inv.damageSlot(p.inv.selected, 1);
        } else {
          const [lx, ly, lz] = p.look();
          const b = new Bobber(p.x + lx * 0.5, p.eyeY(), p.z + lz * 0.5, lx * 12, ly * 12 + 3, lz * 12);
          g.entities.add(b); g.bobbers.set(key, b);
          audio.noise(0.2, 1500, 1, 0.2, 'highpass');
        }
        this.swingArm();
        return true;
      }
      case 'boat': {
        if (!first) return true;
        const fh = raycast(w, p.x, p.eyeY(), p.z, ...p.look(), 5, true);
        if (fh) { g.entities.add(new Boat(fh.x + 0.5, fh.y + (fh.id === B.water ? 0.6 : 1), fh.z + 0.5)).yaw = p.yaw; if (!p.creative) p.inv.consumeHeld(); }
        return true;
      }
      case 'cart': {
        if (!first || !h) return true;
        if (h.id === B.rail) { g.entities.add(new Cart(h.x + 0.5, h.y + 0.05, h.z + 0.5)); if (!p.creative) p.inv.consumeHeld(); }
        else g.message('Rail Carts must be placed on rails.');
        return true;
      }
      case 'lead': return false;
      case 'wand': {
        if (!first || !h) return true;
        if (!p.creative) { g.message("The Builder's Wand only works in creative mode."); return true; }
        this.wandB = [h.x, h.y, h.z];
        g.message(`Corner B set at ${this.wandB.join(', ')}. Press G to fill with your offhand block, H to clear.`);
        return true;
      }
    }
    return false;
  }
  bonemeal(x: number, y: number, z: number): boolean {
    const g = this.g, w = g.world, id = w.id(x, y, z), d = BLOCKS[id], m = w.meta(x, y, z);
    if (d.key.endsWith('_crop')) { const max = cropStages(d.key) - 1; if (m >= max) return false; w.set(x, y, z, id, Math.min(max, m + 2 + Math.floor(Math.random() * 3))); return true; }
    if (d.key.endsWith('_sapling')) { if (Math.random() < 0.45) g.growSapling(x, y, z, id); return true; }
    if (id === B.berry_bush) { if (m >= 3) return false; w.set(x, y, z, id, 3); return true; }
    if (id === B.mushroom_red || id === B.mushroom_brown) { if (Math.random() < 0.4) g.growMushroom(x, y, z); return true; }
    if (id === B.grass) {
      for (let i = 0; i < 24; i++) {
        const tx = x + Math.floor(Math.random() * 7) - 3, tz = z + Math.floor(Math.random() * 7) - 3;
        if (w.id(tx, y, tz) === B.grass && w.id(tx, y + 1, tz) === 0) w.set(tx, y + 1, tz, Math.random() < 0.8 ? B.tall_grass : [B.flower_red, B.flower_yellow, B.flower_white][Math.floor(Math.random() * 3)]);
      }
      return true;
    }
    return false;
  }

  /* ------------------------------------------------ dispensers */
  dispense(x: number, y: number, z: number) {
    const g = this.g, w = g.world;
    const be = w.blockEntity(x, y, z);
    if (!be?.items) return;
    const idxs = be.items.map((s, i) => (s ? i : -1)).filter((i) => i >= 0);
    if (!idxs.length) { audio.click(); return; }
    const i = idxs[Math.floor(Math.random() * idxs.length)];
    const s = be.items[i]!;
    const f = w.meta(x, y, z) & 3;
    const [fx, fz] = FACING_VEC[(f + 2) & 3].map((v) => -v) as [number, number];
    const ox = x + 0.5 + fx * 0.7, oy = y + 0.5, oz = z + 0.5 + fz * 0.7;
    const tx = x + fx, tz = z + fz;
    const k = ITEMS[s.id].key;
    const take = () => { s.count--; if (s.count <= 0) be.items![i] = null; w.touchBE(x, z); };
    if (k === 'arrow') { g.entities.add(new Projectile(ox, oy, oz, fx * 26, 1.5, fz * 26, 'arrow', true, 4)); take(); audio.bow(); }
    else if (k === 'snowball' || k === 'egg') { g.entities.add(new Projectile(ox, oy, oz, fx * 18, 2, fz * 18, k, true, 0.5)); take(); }
    else if (k === 'water_bucket' || k === 'lava_bucket') { if (w.id(tx, y, tz) === 0 || BLOCKS[w.id(tx, y, tz)].replaceable) { w.set(tx, y, tz, k === 'water_bucket' ? B.water : B.lava, 0); be.items[i] = { id: itemByKey('bucket').id, count: 1 }; } }
    else if (k === 'bucket') { const t = w.id(tx, y, tz); if ((t === B.water || t === B.lava) && w.meta(tx, y, tz) === 0) { w.set(tx, y, tz, 0); be.items[i] = { id: itemByKey(t === B.water ? 'water_bucket' : 'lava_bucket').id, count: 1 }; } }
    else if (k === 'bone_meal') { if (this.bonemeal(tx, y, tz) || this.bonemeal(tx, y - 1, tz)) take(); }
    else if (k === 'powder_keg') { take(); g.primeKeg(tx, y, tz); }
    else if (k === 'igniter') { if (w.id(tx, y, tz) === 0) { w.set(tx, y, tz, B.fire); s.dmg = (s.dmg ?? 0) + 1; if (s.dmg >= 64) be.items[i] = null; } }
    else { const one = { ...s, count: 1 }; take(); g.spawnItem(ox, oy - 0.2, oz, one, fx * 4, 1.5, fz * 4, 0.3); }
    audio.click();
  }

  /* ------------------------------------------------ riding */
  rideUpdate(dt: number, inp: MoveInput) {
    const g = this.g, p = g.player;
    const e = g.entities.list.find((x) => x.id === p.riding!.id);
    if (!e || e.dead) { p.riding = null; return; }
    if (inp.sneak) { this.dismount(e); return; }
    if (e instanceof Boat) {
      e.drive(inp.f, inp.s, p.yaw, dt);
      p.body.x = e.x; p.body.y = e.y + 0.2; p.body.z = e.z;
    } else if (e instanceof Cart) {
      if (inp.f > 0) e.push(dt * 6, p.yaw);
      p.body.x = e.x; p.body.y = e.y + 0.25; p.body.z = e.z;
    } else if (e instanceof Mob) {
      // steer the steed with the player's controller on the steed's body
      const saved = p.body;
      p.body = e.body;
      p.updateMovement(dt, { ...inp, sneak: false }, g.world, 7.5);
      p.body = saved;
      e.yaw = p.yaw + Math.PI;
      p.body.x = e.x; p.body.y = e.y + 1.0; p.body.z = e.z;
      p.body.vx = p.body.vy = p.body.vz = 0; p.body.fallDist = 0;
    }
  }
  dismount(e: Entity) {
    const p = this.g.player;
    p.riding = null;
    if (e instanceof Mob) e.ridden = false;
    p.body.y = e.y + e.body.h + 0.1;
    p.body.x += 0.6;
    this.g.unstick();
  }

  /* ------------------------------------------------ keys */
  dropHeld(all: boolean) {
    const g = this.g, p = g.player;
    const h = p.inv.held;
    if (!h) return;
    const n = all ? h.count : 1;
    const [lx, ly, lz] = p.look();
    g.spawnItem(p.x + lx * 0.3, p.eyeY() - 0.3, p.z + lz * 0.3, { ...h, count: n }, lx * 6, ly * 6 + 2, lz * 6, 1.5);
    h.count -= n;
    if (h.count <= 0) p.inv.held = null;
    p.inv.changed();
    this.swingArm();
  }
  swapOffhand() {
    const inv = this.g.player.inv;
    const t = inv.slots[inv.selected];
    inv.slots[inv.selected] = inv.slots[40];
    inv.slots[40] = t;
    inv.changed();
  }
  wand(fill: boolean) {
    const g = this.g, p = g.player, w = g.world;
    if (!p.creative) return;
    if (!this.wandA || !this.wandB) { g.message("Set two corners with the Builder's Wand first (left and right click).", 'warn'); return; }
    const off = p.inv.slots[40];
    const bid = fill ? (off && off.id < 256 && BLOCKS[off.id].item ? off.id : -1) : 0;
    if (bid < 0) { g.message('Hold the block to fill with in your offhand (press F to swap).', 'warn'); return; }
    const [a, b] = [this.wandA, this.wandB];
    const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), y0 = Math.max(0, Math.min(a[1], b[1])), y1 = Math.min(127, Math.max(a[1], b[1])), z0 = Math.min(a[2], b[2]), z1 = Math.max(a[2], b[2]);
    const vol = (x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1);
    if (vol > 65536) { g.message(`That region has ${vol} blocks; the limit is 65,536.`, 'warn'); return; }
    let n = 0;
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) if (w.loaded(x, z) && w.set(x, y, z, bid, 0, false)) n++;
    g.message(`${fill ? 'Filled' : 'Cleared'} ${n} blocks.`, 'good');
  }
}
export const _ref = [OPAQUE];
