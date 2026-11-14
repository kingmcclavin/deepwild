import { B, SOLID, BLOCKS } from './registry/blocks';
import { Dim, SEA_LEVEL } from './constants';
import { BIOMES } from './world/gen/terrain';
import { Mob } from './entity/entities';
import { MOBS } from './entity/mobs';
import type { BlockEntity } from './world/World';
import type { Game } from './Game';

const pick = <T>(list: [T, number][]): T => {
  const tot = list.reduce((a, b) => a + b[1], 0);
  let x = Math.random() * tot;
  for (const [v, w] of list) if ((x -= w) < 0) return v;
  return list[0][0];
};

export class Spawner {
  constructor(private g: Game) {}
  tick() {
    const g = this.g;
    if (g.player.dead) return;
    this.despawn();
    if (!g.rules.mobSpawning) return;
    const hostile = g.entities.count((e) => e instanceof Mob && e.def.hostile && !e.def.boss && !e.cageSpawn);
    const passive = g.entities.count((e) => e instanceof Mob && !e.def.hostile && e.def.ai === 'passive');
    const fish = g.entities.count((e) => e instanceof Mob && !!e.def.aquatic);
    const cap = [0, 18, 26, 34][g.difficulty];
    if (g.difficulty > 0 && hostile < cap) for (let i = 0; i < 3; i++) this.trySpawnHostile();
    if (g.dim === Dim.Overworld && passive < 14 && Math.random() < 0.08) this.trySpawnPassive();
    if (g.dim === Dim.Overworld && fish < 8 && Math.random() < 0.2) this.trySpawnFish();
    this.siegeCheck();
  }
  private despawn() {
    const g = this.g, p = g.player;
    for (const e of g.entities.list) {
      if (!(e instanceof Mob) || e.persistent || e.def.boss) continue;
      const d = e.distTo(p.x, p.y, p.z);
      if (d > 96) e.dead = true;
      else if (d > 40 && Math.random() < 0.01) e.dead = true;
      // daylight thinning for undead that can't burn (in shade)
    }
  }
  private randomSpot(minR: number, maxR: number): [number, number] | null {
    const p = this.g.player;
    const a = Math.random() * Math.PI * 2, r = minR + Math.random() * (maxR - minR);
    const x = Math.floor(p.x + Math.cos(a) * r), z = Math.floor(p.z + Math.sin(a) * r);
    if (!this.g.world.loaded(x, z)) return null;
    return [x, z];
  }
  /** is (x,y,z) a valid standing spot for a mob of height h */
  private fits(x: number, y: number, z: number, h: number) {
    const w = this.g.world;
    const below = w.id(x, y - 1, z);
    if (!SOLID[below] || below === B.cactus || BLOCKS[below].key.endsWith('_leaves') || below === B.glass || below === B.bedrock && this.g.dim !== Dim.Ember) return false;
    for (let i = 0; i < Math.ceil(h); i++) { const id = w.id(x, y + i, z); if (SOLID[id] || id === B.water || id === B.lava) return false; }
    return true;
  }
  private trySpawnHostile() {
    const g = this.g, w = g.world, p = g.player;
    const spot = this.randomSpot(24, 56);
    if (!spot) return;
    const [x, z] = spot;
    let y: number;
    if (g.dim === Dim.Overworld) {
      // either surface or a random cave spot
      if (Math.random() < 0.5) y = w.surfaceY(x, z) + 1;
      else { y = 6 + Math.floor(Math.random() * Math.max(1, Math.min(p.y + 20, 110) - 6)); while (y > 2 && !SOLID[w.id(x, y - 1, z)]) y--; }
    } else if (g.dim === Dim.Ember) { y = Math.floor(p.y) + Math.floor(Math.random() * 30) - 15; while (y > 2 && !SOLID[w.id(x, y - 1, z)]) y--; }
    else { y = w.surfaceY(x, z) + 1; }
    if (y < 1 || y > 126) return;
    const sky = w.skyLight(x, y, z), blk = w.blockLight(x, y, z);
    const light = Math.max(blk, Math.round(sky * (g.dim === Dim.Overworld ? g.daylight : 0)));
    let kind: string;
    if (g.dim === Dim.Overworld) {
      if (light > 7) return;
      const deep = y < 40;
      const list: [string, number][] = [['shambler', 40], ['rattler', 30], ['fusebloom', 22], ['skitterfang', 26], ['brute', deep ? 4 : 1.5]];
      if (deep) list.push(['wisp', 14]);
      if (g.difficulty >= 2 && sky > 10 && g.daylight < 0.2) list.push(['hexwarden', 0.8]);
      kind = pick(list);
    } else if (g.dim === Dim.Ember) {
      if (blk > 11 && Math.random() < 0.5) return;
      kind = pick([['cinder_imp', 18], ['ashen_knight', 22], ['emberling', 26]]);
    } else {
      if (Math.hypot(x, z) < 70) return;
      kind = 'voidstalker';
    }
    const def = MOBS[kind];
    if (def.flying) { y += 2 + Math.floor(Math.random() * 4); if (SOLID[w.id(x, y, z)]) return; }
    else if (!this.fits(x, y, z, def.h)) return;
    if (Math.hypot(x - p.x, y - p.y, z - p.z) < 20) return;
    const n = kind === 'hexwarden' || kind === 'brute' ? 1 : 1 + Math.floor(Math.random() * (g.difficulty === 3 ? 3 : 2));
    for (let i = 0; i < n; i++) {
      const ox = i ? Math.floor(Math.random() * 3) - 1 : 0, oz = i ? Math.floor(Math.random() * 3) - 1 : 0;
      if (!def.flying && !this.fits(x + ox, y, z + oz, def.h)) continue;
      g.entities.spawnMob(kind, x + ox + 0.5, y, z + oz + 0.5);
    }
  }
  private trySpawnPassive() {
    const g = this.g, w = g.world;
    const spot = this.randomSpot(24, 64);
    if (!spot) return;
    const [x, z] = spot;
    const y = w.surfaceY(x, z) + 1;
    if (w.id(x, y - 1, z) !== B.grass && w.id(x, y - 1, z) !== B.sporeturf && w.id(x, y - 1, z) !== B.snow_block && w.id(x, y, z) !== B.snow_layer) return;
    if (w.skyLight(x, y, z) < 9) return;
    const animals = BIOMES[w.biomeAt(x, z)]?.animals.filter((a) => !MOBS[a].aquatic) ?? [];
    if (!animals.length) return;
    const kind = animals[Math.floor(Math.random() * animals.length)];
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const ox = Math.floor(Math.random() * 5) - 2, oz = Math.floor(Math.random() * 5) - 2;
      const yy = w.surfaceY(x + ox, z + oz) + 1;
      if (this.fits(x + ox, yy, z + oz, MOBS[kind].h) || w.id(x + ox, yy, z + oz) === B.snow_layer) g.entities.spawnMob(kind, x + ox + 0.5, yy, z + oz + 0.5);
    }
  }
  private trySpawnFish() {
    const g = this.g, w = g.world;
    const spot = this.randomSpot(12, 40);
    if (!spot) return;
    const [x, z] = spot;
    const y = SEA_LEVEL - 2 - Math.floor(Math.random() * 6);
    if (w.id(x, y, z) !== B.water || w.id(x, y + 1, z) !== B.water) return;
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) g.entities.spawnMob('finling', x + 0.5 + Math.random(), y + 0.2, z + 0.5 + Math.random());
  }
  /** creature cage (spawner) blocks */
  cage(x: number, y: number, z: number, be: BlockEntity) {
    const g = this.g, p = g.player;
    if (Math.hypot(p.x - x, p.y - y, p.z - z) > 16 || g.difficulty === 0) return;
    be.delay = ((be.delay as number) ?? 10) - 1;
    if ((be.delay as number) > 0) return;
    be.delay = 10 + Math.floor(Math.random() * 30);
    const kind = (be.mob as string) ?? 'shambler';
    const def = MOBS[kind];
    if (!def) return;
    const near = g.entities.count((e) => e instanceof Mob && e.def.key === kind && e.distTo(x, y, z) < 9);
    if (near >= 6) return;
    if (def.hostile && g.world.blockLight(x, y + 1, z) > 11) return;
    for (let i = 0; i < 2 + Math.floor(Math.random() * 2); i++) {
      for (let t = 0; t < 6; t++) {
        const sx = x + Math.floor(Math.random() * 9) - 4, sz = z + Math.floor(Math.random() * 9) - 4, sy = y + Math.floor(Math.random() * 3) - 1;
        if (def.flying ? !SOLID[g.world.id(sx, sy, sz)] : this.fits(sx, sy, sz, def.h)) {
          const m = g.entities.spawnMob(kind, sx + 0.5, sy, sz + 0.5);
          m.cageSpawn = true;
          g.particles(sx + 0.5, sy + 0.5, sz + 0.5, [0.9, 0.3, 0.2], 10, 1.5, -1);
          break;
        }
      }
    }
  }
  /** village sieges at night */
  private siegeCheck() {
    const g = this.g, p = g.player;
    if (g.dim !== Dim.Overworld || g.difficulty === 0) return;
    const night = g.time > 0.55 && g.time < 0.9;
    const vid = g.nearestVillage(p.x, p.z);
    if (!vid) return;
    const v = g.state.villages[vid];
    const sieging = g.entities.list.filter((e) => e instanceof Mob && e.siege && !e.dead) as Mob[];
    if ((v as { sieging?: boolean }).sieging && !sieging.length) {
      (v as { sieging?: boolean }).sieging = false;
      v.rep += 25; v.hero = true;
      g.message('The siege is broken! The Wayfolk will remember your courage: their prices drop for you.', 'good');
      p.addEffect('regeneration', 20, 1);
      return;
    }
    if (!night || v.lastSiege === g.state.day || Math.hypot(p.x - v.x, p.z - v.z) > 48) return;
    v.lastSiege = g.state.day;
    if (Math.random() > 0.35) return;
    (v as { sieging?: boolean }).sieging = true;
    g.message('A siege descends on the village! Defend the Wayfolk.', 'warn');
    const n = 6 + g.difficulty * 2;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = 26 + Math.random() * 8;
      const x = Math.floor(v.x + Math.cos(a) * r), z = Math.floor(v.z + Math.sin(a) * r);
      if (!g.world.loaded(x, z)) continue;
      const y = g.world.surfaceY(x, z) + 1;
      const m = g.entities.spawnMob(i % 4 === 3 ? 'rattler' : 'shambler', x + 0.5, y, z + 0.5);
      m.siege = true; m.persistent = false;
    }
  }
}
