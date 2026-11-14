import * as THREE from 'three';
import { CHUNK, HEIGHT, CHUNK_AREA, Dim, TICKS_PER_SECOND, DAY_TICKS, DIRS, SEA_LEVEL } from './constants';
import { B, BLOCKS, SOLID, OPAQUE, cropStages, tileId, faceTile } from './registry/blocks';
import { ITEMS, itemByKey, type ItemStack, POTIONS } from './registry/items';
import { smeltResult, fuelValue, brewResult } from './registry/recipes';
import { createTerrainMaterials, lightLevel } from './gfx/materials';
import { Sky } from './gfx/sky';
import { Particles } from './gfx/particles';
import { buildTileArray, TS } from './gfx/textures';
import { World, type Chunk, type BlockEntity } from './world/World';
import { BIOMES, Bi, Terrain } from './world/gen/terrain';
import { growTree, giantMushroom, type GenFeature } from './world/gen/writer';
import { emberBastionNear, HOLLOW_ARENA_Y } from './world/gen/generate';
import { EntityManager, ItemEntity, XPOrb, FallingBlock, Mob, Boat, Cart, Bobber, setTerrainMats, blockGeometry, itemTexture, Entity } from './entity/entities';
import { MOBS } from './entity/mobs';
import { Player } from './player/Player';
import { insertInto, OFFHAND } from './player/inventory';
import { PulseSystem, TICK_PULSE, TICK_BUTTON, TICK_PLATE, TICK_KEG } from './systems/pulse';
import { fluidTick, isFluid, fluidDelay } from './systems/fluids';
import { audio } from './audio/audio';
import { rollLoot } from './loot';
import { savedChunkKeys, saveChunks, saveState, loadState, putWorld, type WorldMeta, type GameRules } from './save/db';
import { mulberry, hash32 } from './world/noise';
import type { Settings } from './settings';
import type { GameCtx } from './types';
import { useUI, type Panel } from '../ui/store';
import { Interact } from './interact';
import { Spawner } from './spawning';

const TICK_GRAVITY = 5, TICK_SUPPORT = 6, TICK_FIRE = 7;

export interface PersistState {
  player: ReturnType<Player['serialize']> | null;
  time: number; day: number;
  weather: { rain: number; target: number; thunder: boolean; timer: number };
  villages: Record<string, { x: number; y: number; z: number; rep: number; hero: boolean; lastSiege: number; stoneward: boolean }>;
  bosses: Record<string, 'spawned' | 'defeated'>;
  portals: { overworld: [number, number, number] | null; ember: [number, number, number] | null };
  stats: { mined: number; placed: number; kills: number; deaths: number; crafted: number };
  spawn: [number, number, number] | null;
  sovereignDefeated: boolean;
  colossusDefeated: boolean;
  creditsShown: boolean;
  spawnDone: boolean;
}

export class Game implements GameCtx {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(75, 1, 0.05, 1000);
  handScene = new THREE.Scene();
  handCam = new THREE.PerspectiveCamera(70, 1, 0.01, 10);
  mats: ReturnType<typeof createTerrainMaterials>;
  sky = new Sky();
  parts = new Particles();
  world!: World;
  entities!: EntityManager;
  player!: Player;
  pulse!: PulseSystem;
  interact!: Interact;
  spawner!: Spawner;
  meta!: WorldMeta;
  state!: PersistState;
  settings: Settings;
  running = false;
  paused = true;
  time = 0.02;
  daylight = 1;
  tickCount = 0;
  private acc = 0;
  private last = 0;
  private raf = 0;
  keys = new Set<string>();
  mouse = [false, false, false];
  private hudT = 0;
  private saveT = 0;
  private stateSaveT = 0;
  private lastFrame = 0;
  fps = 0; private fpsAcc = 0; private fpsN = 0;
  debug = false;
  selection: THREE.LineSegments;
  crack: THREE.Mesh;
  hand: THREE.Group;
  handItem: THREE.Object3D | null = null;
  handKey = '';
  swing = 0;
  bossInfo: { name: string; frac: number; shield: boolean } | null = null;
  bossSeen = 0;
  flash = 0;
  portalT = 0;
  portalLock = false;
  sleepT = 0;
  bobbers = new Map<string, Bobber>();
  private bePollT = 0;
  private beList: [number, number, number, BlockEntity][] = [];
  shadowTex: THREE.Texture;
  private shadows: THREE.Mesh[] = [];
  difficulty = 2;
  signsDirty = true;
  private signMeshes = new Map<string, THREE.Mesh>();
  private signT = 0;
  get dim(): Dim { return this.world?.dim ?? Dim.Overworld; }
  get rules(): GameRules { return this.meta.rules; }
  get creative() { return this.player?.creative ?? false; }

  constructor(public canvas: HTMLCanvasElement, settings: Settings) {
    this.settings = settings;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: settings.antialias, powerPreference: 'high-performance' });
    this.renderer.autoClear = false;
    this.renderer.info.autoReset = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.mats = createTerrainMaterials(settings.mipmaps);
    setTerrainMats({ opaque: this.mats.opaque, cutout: this.mats.cutout });
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.sky.group);
    this.scene.add(this.parts.points);
    // selection outline
    const eg = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
    this.selection = new THREE.LineSegments(eg, new THREE.LineBasicMaterial({ color: 0x101010, transparent: true, opacity: 0.55 }));
    this.selection.visible = false;
    this.scene.add(this.selection);
    // crack overlay cube
    this.crack = new THREE.Mesh(blockGeometry(B.stone).clone(), this.mats.crack);
    this.crack.visible = false;
    this.scene.add(this.crack);
    // first-person hand
    this.hand = new THREE.Group();
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.55), new THREE.MeshBasicMaterial({ color: 0xd8a888 }));
    arm.position.set(0, 0, 0.1);
    arm.name = 'arm';
    this.hand.add(arm);
    this.handScene.add(this.hand);
    this.handScene.add(new THREE.AmbientLight(0xffffff, 1));
    // drop shadow texture
    const sc = document.createElement('canvas'); sc.width = sc.height = 32;
    const sg = sc.getContext('2d')!;
    const gr = sg.createRadialGradient(16, 16, 2, 16, 16, 16); gr.addColorStop(0, 'rgba(0,0,0,0.45)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    sg.fillStyle = gr; sg.fillRect(0, 0, 32, 32);
    this.shadowTex = new THREE.CanvasTexture(sc);
    this.applySettings(settings);
    window.addEventListener('resize', this.onResize);
    this.onResize();
  }

  applySettings(s: Settings) {
    this.settings = s;
    this.camera.fov = s.fov;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2) * s.pixelRatio);
    this.onResize();
    this.mats.uniforms.aoStrength.value = s.ao ? 1 : 0.35;
    if (this.world) {
      this.world.renderDistance = s.renderDistance;
    }
    this.parts.limit = [1, 0.5, 0.2][s.particles];
    audio.vol = { master: s.master, music: s.music, sfx: s.sfx, ambient: s.ambient, muted: s.muted };
    audio.applyVolumes();
    const tex = this.mats.texture;
    const wantMip = s.mipmaps;
    if (tex.generateMipmaps !== wantMip) {
      tex.generateMipmaps = wantMip;
      tex.minFilter = wantMip ? THREE.NearestMipmapLinearFilter : THREE.NearestFilter;
      tex.needsUpdate = true;
    }
  }
  onResize = () => {
    const w = this.canvas.clientWidth || window.innerWidth, h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.handCam.aspect = w / h; this.handCam.updateProjectionMatrix();
    this.parts.setPixelScale(h * this.renderer.getPixelRatio());
  };

  /* ================================================================ lifecycle */
  async start(meta: WorldMeta) {
    this.meta = meta;
    this.difficulty = meta.difficulty;
    const ui = useUI.getState();
    ui.set({ screen: 'loading', loadingText: 'Reading world…', worldMeta: meta });
    let st: PersistState | null = null;
    try { st = (await loadState(meta.id)) as PersistState | null; } catch (e) { console.warn('state unreadable', e); ui.toast('Some world data could not be read. Your terrain is safe; your player was reset.', 'warn'); }
    this.state = {
      player: null, time: 0.02, day: 0, weather: { rain: 0, target: 0, thunder: false, timer: 12000 }, villages: {}, bosses: {}, portals: { overworld: null, ember: null },
      stats: { mined: 0, placed: 0, kills: 0, deaths: 0, crafted: 0 }, spawn: null, sovereignDefeated: false, colossusDefeated: false, creditsShown: false, spawnDone: false,
      ...(st ?? {}),
    };
    this.time = this.state.time;
    this.player = new Player(0, 90, 0);
    this.player.load(this.state.player);
    this.player.creative = meta.mode === 'creative';
    if (!this.player.creative) this.player.flying = false;
    this.entities = new EntityManager(this);
    this.scene.add(this.entities.group);
    this.interact = new Interact(this);
    this.spawner = new Spawner(this);
    await this.openDimension(this.player.dim, !this.state.spawnDone);
    if (!this.state.spawnDone) {
      this.state.spawnDone = true;
      if (meta.mode === 'survival' && meta.bonusChest) this.placeBonusChest();
      if (meta.mode === 'survival') this.giveStarterKit();
    }
    this.running = true;
    this.paused = false;
    this.last = performance.now();
    this.loop(this.last);
    ui.set({ screen: 'playing' });
    meta.lastPlayed = Date.now();
    putWorld(meta).catch(() => {});
  }
  private giveStarterKit() {
    const kit = (this.meta as WorldMeta & { kit?: string }).kit;
    if (kit === 'basic') for (const [k, n] of [['wood_pickaxe', 1], ['wood_axe', 1], ['wood_sword', 1], ['bread', 8], ['torch', 16]] as [string, number][]) this.player.inv.add({ id: itemByKey(k).id, count: n });
  }

  /** load a dimension around the player (first spawn finds a safe location) */
  async openDimension(dim: Dim, firstSpawn: boolean, arrival?: [number, number, number]) {
    const ui = useUI.getState();
    ui.set({ screen: 'loading', loadingText: dim === Dim.Overworld ? 'Shaping the land…' : dim === Dim.Ember ? 'Descending into Emberdeep…' : 'Crossing into The Hollow…' });
    if (this.world) {
      await this.saveWorldChunks(true);
      this.scene.remove(this.world.group);
      this.world.dispose();
      this.entities.clear();
    }
    const workers = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
    this.world = new World(this.meta.id, this.meta.seed, dim, [this.mats.opaque, this.mats.cutout, this.mats.translucent], workers);
    this.world.renderDistance = this.settings.renderDistance;
    this.world.savedKeys = await savedChunkKeys(this.meta.id);
    this.world.hooks = {
      onFeatures: (d, c, f) => this.onFeatures(d, c, f),
      onChunkEntities: (_d, _c, ents) => this.entities.restore(ents),
      onBlockChanged: (x, y, z, o, n) => this.onBlockChanged(x, y, z, o, n),
    };
    this.scene.add(this.world.group);
    this.pulse = new PulseSystem(this.world, this, {
      dispense: (x, y, z) => this.interact.dispense(x, y, z),
      primeKeg: (x, y, z) => this.primeKeg(x, y, z),
      container: (x, y, z) => { const be = this.world.blockEntity(x, y, z); return be?.items ?? null; },
    });
    this.pulse.platePressedFn = (x, y, z) => this.somethingOn(x, y, z);
    this.pulse.pushEntities = (x, y, z, dx, dy, dz) => this.pushEntities(x, y, z, dx, dy, dz);
    this.player.dim = dim;
    const p = this.player.body;
    if (arrival) { p.x = arrival[0]; p.y = arrival[1]; p.z = arrival[2]; }
    if (firstSpawn && dim === Dim.Overworld) {
      const sp = await this.findSpawn();
      p.x = sp[0]; p.y = sp[1]; p.z = sp[2];
      this.state.spawn = sp;
    }
    // stream until the area around the player is meshed
    const t0 = performance.now();
    await new Promise<void>((res) => {
      const step = () => {
        this.world.update(p.x, p.z);
        const done = this.world.isReadyAround(p.x, p.z, 1);
        const n = this.world.chunks.size;
        useUI.getState().set({ loadingText: `${dim === Dim.Overworld ? 'Shaping the land' : dim === Dim.Ember ? 'Descending into Emberdeep' : 'Crossing into The Hollow'}… ${n} chunks` });
        if (done || performance.now() - t0 > 25000) res(); else setTimeout(step, 30);
      };
      step();
    });
    if (dim === Dim.Ember && arrival) this.buildArrivalPortal();
    if (dim === Dim.Void) this.ensureSovereign();
    // make sure we are not inside terrain
    this.unstick();
    this.player.body.vx = this.player.body.vy = this.player.body.vz = 0;
    this.player.body.fallDist = 0;
    this.portalLock = true;
    ui.set({ screen: this.running ? 'playing' : 'loading' });
  }
  private async findSpawn(): Promise<[number, number, number]> {
    const T = new Terrain(this.meta.seed);
    for (let r = 0; r < 2000; r += 16) for (let a = 0; a < 8; a++) {
      const x = Math.round(Math.cos((a / 8) * Math.PI * 2) * r), z = Math.round(Math.sin((a / 8) * Math.PI * 2) * r);
      const c = T.sample(x, z);
      if (c.h > SEA_LEVEL && c.h < 96 && ![Bi.Ocean, Bi.DeepOcean, Bi.River, Bi.FrozenOcean].includes(c.biome)) return [x + 0.5, c.h + 2, z + 0.5];
    }
    return [0.5, 100, 0.5];
  }
  unstick() {
    const p = this.player.body;
    const x = Math.floor(p.x), z = Math.floor(p.z);
    let y = Math.floor(p.y);
    if (this.dim === Dim.Overworld && y < 2) y = this.world.surfaceY(x, z) + 1;
    for (let i = 0; i < 128; i++) {
      if (!SOLID[this.world.id(x, y, z)] && !SOLID[this.world.id(x, y + 1, z)] && this.world.id(x, y, z) !== B.lava) break;
      y++;
    }
    p.y = Math.max(p.y, y);
  }

  async exit() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    try { await this.saveAll(); } catch (e) { console.error(e); useUI.getState().toast('Saving failed: ' + (e as Error).message, 'warn'); }
    if (document.pointerLockElement) document.exitPointerLock();
    this.world?.dispose();
    this.entities?.clear();
    this.scene.remove(this.world.group);
    this.scene.remove(this.entities.group);
    this.parts.clear();
  }
  dispose() { window.removeEventListener('resize', this.onResize); this.renderer.dispose(); }

  /* ================================================================ saving */
  private collect = (c: Chunk) => this.entities.takeChunk(c.cx, c.cz, false);
  async saveWorldChunks(all = false) {
    const recs = this.world.dirtyRecords(this.collect, all);
    await saveChunks(recs);
  }
  async saveAll() {
    if (!this.world || !this.meta) return;
    await this.saveWorldChunks(true);
    this.state.player = this.player.serialize();
    this.state.time = this.time;
    await saveState(this.meta.id, this.state);
    this.meta.lastPlayed = Date.now();
    await putWorld(this.meta);
  }

  /* ================================================================ main loop */
  loop = (now: number) => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.loop);
    const cap = this.settings.fpsCap;
    if (cap > 0 && now - this.lastFrame < 1000 / cap - 1) return;
    let dt = (now - this.last) / 1000;
    this.last = now;
    this.lastFrame = now;
    dt = Math.min(dt, 0.1);
    this.fpsAcc += dt; this.fpsN++;
    if (this.fpsAcc >= 0.5) { this.fps = Math.round(this.fpsN / this.fpsAcc); this.fpsAcc = 0; this.fpsN = 0; }
    const ui = useUI.getState();
    const simulate = !this.paused && ui.screen !== 'loading';
    if (simulate) {
      this.frameUpdate(dt);
      this.acc += dt;
      let n = 0;
      while (this.acc >= 1 / TICKS_PER_SECOND && n < 5) { this.acc -= 1 / TICKS_PER_SECOND; this.tick(); n++; }
      if (n >= 5) this.acc = 0;
    }
    this.world.update(this.player.x, this.player.z);
    this.saveT += dt;
    if (this.saveT > 20 && simulate) {
      this.saveT = 0;
      const recs = this.world.unloadFar((c) => this.entities.takeChunk(c.cx, c.cz, true));
      recs.push(...this.world.dirtyRecords(this.collect));
      saveChunks(recs).catch((e) => ui.toast('Autosave failed: ' + (e as Error).message, 'warn'));
    }
    this.stateSaveT += dt;
    if (this.stateSaveT > 30 && simulate) {
      this.stateSaveT = 0;
      this.state.player = this.player.serialize(); this.state.time = this.time;
      saveState(this.meta.id, this.state).catch(() => {});
    }
    this.render(dt);
    this.hudT += dt;
    if (this.hudT > 0.1) { this.hudT = 0; this.publishHud(); }
  };

  /** variable-rate: player control, entities, camera */
  private frameUpdate(dt: number) {
    const p = this.player;
    const ui = useUI.getState();
    const inGame = ui.screen === 'playing';
    const k = this.settings.keys;
    const inp = {
      f: inGame ? (this.keys.has(k.forward) ? 1 : 0) - (this.keys.has(k.back) ? 1 : 0) : 0,
      s: inGame ? (this.keys.has(k.right) ? 1 : 0) - (this.keys.has(k.left) ? 1 : 0) : 0,
      jump: inGame && this.keys.has(k.jump),
      sneak: inGame && this.keys.has(k.sneak),
      sprint: inGame && this.keys.has(k.sprint),
    };
    if (!p.dead) {
      if (p.riding) this.interact.rideUpdate(dt, inp);
      else {
        const fall = p.updateMovement(dt, inp, this.world);
        if (fall > 0) p.hurt(fall, { kind: 'fall' });
      }
      if (inGame) this.interact.frame(dt);
    }
    this.entities.update(dt);
    this.pickup();
    this.parts.update(dt, (x, y, z) => SOLID[this.world.id(x, y, z)] === 1);
    // portal standing
    this.portalCheck(dt);
    if (p.dead && ui.screen !== 'dead') this.onDeath();
  }

  /** fixed 20 TPS world simulation */
  private tick() {
    this.tickCount++;
    const w = this.world;
    w.tick++;
    if (this.rules.daylightCycle && this.dim === Dim.Overworld) {
      this.time += 1 / DAY_TICKS;
      if (this.time >= 1) { this.time -= 1; this.state.day++; }
    }
    this.player.tick(w, this.rules, this.difficulty);
    // scheduled block ticks
    for (const [x, y, z, kind] of w.takeScheduled()) {
      if (kind === 0) fluidTick(w, this, x, y, z);
      else if (kind === TICK_PULSE || kind === TICK_BUTTON || kind === TICK_PLATE || kind === TICK_KEG) this.pulse.tick(x, y, z, kind);
      else if (kind === TICK_GRAVITY) this.gravityCheck(x, y, z);
      else if (kind === TICK_SUPPORT) this.supportCheck(x, y, z);
      else if (kind === TICK_FIRE) this.fireTick(x, y, z);
    }
    this.pulse.process();
    this.randomTicks();
    this.containerTicks();
    if (this.tickCount % 4 === 0) this.plateCheck();
    if (this.tickCount % 20 === 0) this.spawner.tick();
    this.weatherTick();
    this.sleepTick();
  }

  /* ================================================================ rendering */
  private render(dt: number) {
    const p = this.player;
    const cam = this.camera;
    const bob = this.settings.headBob && p.body.onGround && !p.flying ? Math.sin(p.walkDist * 2.2) * 0.05 : 0;
    cam.position.set(p.x, p.eyeY() + Math.abs(bob) * 0.6, p.z);
    cam.rotation.set(p.pitch, p.yaw, bob * 0.15);
    const fovTarget = this.settings.fov * (p.sprinting ? 1.1 : 1) * (this.interact.bowDraw > 0 ? 1 - this.interact.bowDraw * 0.15 : 1);
    cam.fov += (fovTarget - cam.fov) * Math.min(1, dt * 8);
    cam.updateProjectionMatrix();
    cam.far = Math.max(200, this.settings.renderDistance * CHUNK * 1.6);
    audio.listener = { x: p.x, y: p.eyeY(), z: p.z, yaw: p.yaw };
    // sky + lighting uniforms
    const biome = this.dim === Dim.Overworld ? BIOMES[this.world.biomeAt(Math.floor(p.x), Math.floor(p.z))] ?? BIOMES[5] : BIOMES[5];
    const rain = this.state.weather.rain;
    const snowy = !!biome?.snow || p.y > 110;
    this.daylight = this.sky.update(cam, this.time, this.dim, rain, this.state.weather.thunder, snowy, (x, z) => this.world.surfaceY(x, z) + 1, dt, biome.sky, biome.fog);
    const u = this.mats.uniforms;
    const nv = p.effect('night_vision') ? 0.55 : 0;
    u.daylight.value = Math.max(this.daylight, this.dim === Dim.Ember ? 0 : 0.06);
    u.ambient.value = (this.dim === Dim.Ember ? 0.26 : this.dim === Dim.Void ? 0.14 : 0.035) + nv;
    u.skyTint.value.setRGB(1, 1, 1).lerp(new THREE.Color(0.75, 0.82, 1), 1 - this.daylight);
    u.time.value += dt;
    this.flash = Math.max(0, this.flash - dt * 2.5);
    u.flash.value = this.flash;
    const fogFar = this.settings.renderDistance * CHUNK;
    if (p.body.eyeInWater) { u.fogColor.value.setRGB(0.08, 0.2, 0.42).multiplyScalar(0.4 + this.daylight * 0.6); u.fogNear.value = 0; u.fogFar.value = 18 + nv * 30; }
    else if (this.world.id(Math.floor(p.x), Math.floor(p.eyeY()), Math.floor(p.z)) === B.lava) { u.fogColor.value.setRGB(0.8, 0.25, 0.05); u.fogNear.value = 0; u.fogFar.value = 2; }
    else {
      u.fogColor.value.copy(this.sky.fogColor);
      const cave = this.dim === Dim.Overworld && p.y < 50 && this.world.skyLight(Math.floor(p.x), Math.floor(p.eyeY()), Math.floor(p.z)) < 4;
      if (cave) u.fogColor.value.lerp(new THREE.Color(0.02, 0.02, 0.03), 0.8);
      u.fogNear.value = this.dim === Dim.Ember ? 8 : fogFar * (rain > 0.5 ? 0.35 : 0.55);
      u.fogFar.value = this.dim === Dim.Ember ? fogFar * 0.7 : fogFar * (rain > 0.5 ? 0.8 : 1);
    }
    this.scene.background = null;
    if (!this.scene.fog) this.scene.fog = new THREE.Fog(0xffffff, 60, 120);
    const sf = this.scene.fog as THREE.Fog;
    sf.color.copy(u.fogColor.value); sf.near = u.fogNear.value; sf.far = u.fogFar.value;
    this.renderer.setClearColor(u.fogColor.value);
    (this.sky.group.children[3] as THREE.Object3D).visible = this.settings.clouds && this.dim === Dim.Overworld;
    // selection + crack
    this.interact.updateSelection();
    // entities
    const entDist = this.settings.renderDistance * CHUNK * (this.settings.entityDistance / 100);
    this.entities.render(1);
    // hide anything standing on terrain that hasn't been drawn yet, so nothing appears to float at the horizon
    for (const e of this.entities.list) {
      const c = this.world.chunkAt(Math.floor(e.x), Math.floor(e.z));
      e.obj.visible = e.distTo(p.x, p.y, p.z) < entDist && !!c && c.meshVersion >= 0;
    }
    this.updateShadows();
    this.updateSigns(dt);
    // hand
    this.updateHand(dt);
    this.renderer.info.reset();
    this.renderer.clear();
    this.renderer.render(this.scene, cam);
    if (!p.dead && useUI.getState().screen !== 'credits') {
      this.renderer.clearDepth();
      this.renderer.render(this.handScene, this.handCam);
    }
    // ambience
    const exposed = this.world.skyLight(Math.floor(p.x), Math.floor(p.eyeY()), Math.floor(p.z)) > 10;
    audio.setAmbience(this.dim === Dim.Overworld && exposed ? rain : 0, this.dim === Dim.Overworld && p.y > 90 ? 1 : this.dim === Dim.Void ? 0.6 : 0.15, this.dim === Dim.Ember ? 1 : 0);
    const mood = this.dim === Dim.Ember ? 'ember' : this.dim === Dim.Void ? 'void' : p.y < 50 && !exposed ? 'cave' : this.daylight > 0.4 ? 'day' : 'night';
    audio.musicTick(dt, mood);
  }
  private updateSigns(dt: number) {
    this.signT -= dt;
    if (this.signT > 0 && !this.signsDirty) return;
    this.signT = 1; this.signsDirty = false;
    const seen = new Set<string>();
    for (const [x, y, z, be] of this.world.allBlockEntities()) {
      if (be.type !== 'sign' || !Array.isArray(be.text) || this.world.id(x, y, z) !== B.wood_sign) continue;
      const lines = be.text as string[];
      const k = `${x},${y},${z}|${lines.join('\n')}`;
      seen.add(k);
      if (this.signMeshes.has(k)) continue;
      const c = document.createElement('canvas'); c.width = 192; c.height = 128;
      const g = c.getContext('2d')!;
      g.fillStyle = '#2a1a0c'; g.font = '22px VT323, monospace'; g.textAlign = 'center';
      lines.forEach((l, i) => g.fillText(l, 96, 30 + i * 26));
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 0.5), new THREE.MeshBasicMaterial({ map: t, transparent: true }));
      const f = this.world.meta(x, y, z) & 3;
      const [fx, fz] = [[0, -1], [1, 0], [0, 1], [-1, 0]][f];
      m.position.set(x + 0.5 - fx * 0.36, y + 0.5, z + 0.5 - fz * 0.36);
      m.rotation.y = Math.atan2(-fx, -fz);
      this.scene.add(m);
      this.signMeshes.set(k, m);
    }
    for (const [k, m] of this.signMeshes) if (!seen.has(k)) { this.scene.remove(m); m.geometry.dispose(); ((m.material as THREE.MeshBasicMaterial).map)?.dispose(); this.signMeshes.delete(k); }
  }
  private updateShadows() {
    const want = this.settings.shadows ? this.entities.list.filter((e) => e instanceof Mob && e.obj.visible).slice(0, 40) : [];
    while (this.shadows.length < want.length) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: this.shadowTex, transparent: true, depthWrite: false }));
      m.rotation.x = -Math.PI / 2;
      this.scene.add(m); this.shadows.push(m);
    }
    this.shadows.forEach((s, i) => {
      const e = want[i] as Mob | undefined;
      s.visible = !!e;
      if (!e) return;
      let y = Math.floor(e.y);
      for (let k = 0; k < 4 && !SOLID[this.world.id(Math.floor(e.x), y - 1, Math.floor(e.z))]; k++) y--;
      s.position.set(e.x, y + 0.02, e.z);
      s.scale.setScalar(e.body.hw * 3);
    });
  }
  private updateHand(dt: number) {
    const held = this.player.inv.held;
    const key = held ? `${held.id}:${held.data ?? ''}` : '';
    if (key !== this.handKey) {
      this.handKey = key;
      if (this.handItem) { this.hand.remove(this.handItem); this.handItem = null; }
      if (held) {
        const d = ITEMS[held.id];
        if (d.id < 256 && BLOCKS[d.id].shape !== 'cross' && BLOCKS[d.id].item) {
          const m = new THREE.Mesh(blockGeometry(d.id), BLOCKS[d.id].layer === 1 ? this.mats.cutout : this.mats.opaque);
          m.scale.setScalar(0.32);
          m.position.set(-0.05, -0.05, -0.15);
          m.rotation.y = Math.PI / 4;
          this.handItem = m;
        } else {
          const m = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), new THREE.MeshBasicMaterial({ map: itemTexture(held), transparent: true, alphaTest: 0.5, side: THREE.DoubleSide }));
          m.position.set(-0.08, 0.14, -0.12);
          m.rotation.set(0.1, -0.5, 0.15);
          this.handItem = m;
        }
        this.hand.add(this.handItem);
      }
      (this.hand.getObjectByName('arm') as THREE.Mesh).visible = !held;
    }
    this.swing = Math.max(0, this.swing - dt * 3.5);
    const s = Math.sin((1 - this.swing) * Math.PI);
    const p = this.player;
    const bob = this.settings.headBob ? Math.sin(p.walkDist * 2.2) : 0;
    const eat = this.interact.useT > 0 && this.interact.useKind === 'eat' ? Math.sin(this.interact.useT * 20) * 0.03 : 0;
    const block = this.player.blocking ? 0.2 : 0;
    const draw = this.interact.bowDraw;
    this.hand.position.set(0.42 - s * 0.15 - block - draw * 0.25, -0.38 + bob * 0.015 - s * 0.1 + eat + (this.interact.useKind === 'eat' && this.interact.useT > 0 ? 0.12 : 0), -0.6 - s * 0.12);
    this.hand.rotation.set(-s * 0.9, s * 0.4 + block * 2, 0);
    const l = lightLevel(this.world.skyLight(Math.floor(p.x), Math.floor(p.eyeY()), Math.floor(p.z)), this.world.blockLight(Math.floor(p.x), Math.floor(p.eyeY()), Math.floor(p.z)), this.daylight, this.mats.uniforms.ambient.value);
    this.hand.traverse((o) => { const m = (o as THREE.Mesh).material as THREE.MeshBasicMaterial; if (m && m.color && (m as THREE.Material) !== this.mats.opaque && (m as THREE.Material) !== this.mats.cutout) { const base = o.name === 'arm' ? [0.85, 0.66, 0.53] : [1, 1, 1]; const k = Math.min(1, l + 0.08); m.color.setRGB(base[0] * k, base[1] * k, base[2] * k); } });
  }

  /* ================================================================ GameCtx implementation */
  lightAt(x: number, y: number, z: number) {
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    return lightLevel(this.world.skyLight(ix, iy, iz), this.world.blockLight(ix, iy, iz), Math.max(this.daylight, 0.06), this.mats.uniforms.ambient.value);
  }
  spawnItem(x: number, y: number, z: number, s: ItemStack, vx?: number, vy?: number, vz?: number, delay = 0.5) {
    if (!s || s.count <= 0) return;
    const e = new ItemEntity(x, y, z, { ...s });
    e.body.vx = vx ?? (Math.random() - 0.5) * 2.5;
    e.body.vy = vy ?? 3 + Math.random() * 1.5;
    e.body.vz = vz ?? (Math.random() - 0.5) * 2.5;
    e.pickupDelay = delay;
    this.entities.add(e);
  }
  spawnXP(x: number, y: number, z: number, amount: number) {
    while (amount > 0) { const a = Math.min(amount, amount > 20 ? 10 : amount > 6 ? 3 : 1); amount -= a; this.entities.add(new XPOrb(x, y, z, a)); }
  }
  particles(x: number, y: number, z: number, color: [number, number, number], n: number, speed = 2, gravity = 9, size = 0.1) { this.parts.spawn(x, y, z, color, n, speed, gravity, size); }
  private tileColors = new Map<number, [number, number, number]>();
  blockColor(id: number): [number, number, number] {
    let c = this.tileColors.get(id);
    if (!c) {
      const data = buildTileArray();
      const t = faceTile(id, 0, 1);
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < TS * TS; i++) { const o = (t * TS * TS + i) * 4; if (data[o + 3] < 128) continue; r += data[o]; g += data[o + 1]; b += data[o + 2]; n++; }
      c = n ? [r / n / 255, g / n / 255, b / n / 255] : [0.5, 0.5, 0.5];
      this.tileColors.set(id, c);
    }
    return c;
  }
  blockParticles(x: number, y: number, z: number, id: number, n = 18) {
    const c = this.blockColor(id);
    const l = this.lightAt(x + 0.5, y + 0.5, z + 0.5);
    for (let i = 0; i < n; i++) this.parts.spawn(x + Math.random(), y + Math.random(), z + Math.random(), [c[0] * l, c[1] * l, c[2] * l], 1, 3, 14, 0.08);
  }
  message(text: string, tone: 'info' | 'warn' | 'good' = 'info') { useUI.getState().toast(text, tone); }
  setBoss(name: string | null, frac = 1, shield = false) {
    if (name) { this.bossInfo = { name, frac, shield }; this.bossSeen = 2; }
  }
  onBossDefeated(key: string, x: number, y: number, z: number) {
    if (key === 'colossus') {
      this.state.colossusDefeated = true;
      for (const k of Object.keys(this.state.bosses)) if (k.startsWith('1:') && this.state.bosses[k] === 'spawned') this.state.bosses[k] = 'defeated';
      this.message('The Magma Colossus has fallen. Its Ember Core can open the way to The Hollow.', 'good');
    } else if (key === 'sovereign') {
      this.state.sovereignDefeated = true;
      this.state.bosses['2:sovereign'] = 'defeated';
      // homeward gate at the arena centre
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) { this.world.set(dx, HOLLOW_ARENA_Y, dz, B.pale_bricks); this.world.set(dx, HOLLOW_ARENA_Y + 1, dz, B.return_gate); }
      this.message('The Shard Sovereign is shattered. A Homeward Gate has opened at the centre of the arena.', 'good');
      if (!this.state.creditsShown) { this.state.creditsShown = true; setTimeout(() => { if (document.pointerLockElement) document.exitPointerLock(); useUI.getState().set({ screen: 'credits' }); }, 6000); }
    }
    void x; void y; void z;
    this.saveAll().catch(() => {});
  }
  breakBlock(x: number, y: number, z: number, dropItems: boolean, tool?: ItemStack | null) { this.interact.breakAt(x, y, z, dropItems, tool ?? null, false); }
  explode(x: number, y: number, z: number, power: number, fire: boolean, sourceIsPlayer = false) {
    const w = this.world;
    audio.explode([x, y, z]);
    this.particles(x, y, z, [0.35, 0.35, 0.38], 40 + power * 10, power * 3, -0.5, 0.35);
    this.particles(x, y, z, [1, 0.6, 0.2], 20, power * 2.5, 2, 0.2);
    const griefing = this.rules.mobGriefing || sourceIsPlayer;
    if (power > 0 && griefing && this.dim !== Dim.Void) {
      const destroyed = new Set<string>();
      const rng = mulberry(hash32(Math.floor(x * 7), Math.floor(y * 7), Math.floor(z * 7), this.tickCount));
      for (let i = 0; i < 260; i++) {
        const u = rng() * 2 - 1, th = rng() * Math.PI * 2, s = Math.sqrt(1 - u * u);
        const dx = s * Math.cos(th), dy = u, dz = s * Math.sin(th);
        let intensity = power * (0.7 + rng() * 0.6);
        let px = x, py = y, pz = z;
        while (intensity > 0) {
          const bx = Math.floor(px), by = Math.floor(py), bz = Math.floor(pz);
          const id = w.id(bx, by, bz);
          if (id) {
            const d = BLOCKS[id];
            const res = d.hardness < 0 ? 1e9 : id === B.obsidian ? 1200 : isFluid(id) ? 100 : d.hardness * 1.2;
            intensity -= (res + 0.3) * 0.3;
            if (intensity > 0 && !isFluid(id)) destroyed.add(`${bx},${by},${bz}`);
          }
          intensity -= 0.225;
          px += dx * 0.3; py += dy * 0.3; pz += dz * 0.3;
        }
      }
      for (const k of destroyed) {
        const [bx, by, bz] = k.split(',').map(Number);
        const id = w.id(bx, by, bz);
        if (!id) continue;
        if (id === B.powder_keg) { w.set(bx, by, bz, 0); this.primeKeg(bx, by, bz, 0.5 + Math.random()); continue; }
        this.interact.breakAt(bx, by, bz, Math.random() < 0.3, null, false, true);
        if (fire && Math.random() < 0.3 && SOLID[w.id(bx, by - 1, bz)]) w.set(bx, by, bz, B.fire);
      }
    }
    // damage entities
    const R = Math.max(2, power * 2);
    const dmgFor = (d: number) => Math.max(0, (1 - d / R)) * (power * 7 + 1);
    const p = this.player;
    const pd = Math.hypot(p.x - x, p.y + 0.9 - y, p.z - z);
    if (pd < R && !p.dead) {
      if (p.hurt(dmgFor(pd) * [0.3, 0.5, 1, 1.5][this.difficulty], { kind: 'explosion', x, y, z })) p.knock(p.x - x, p.z - z, (1 - pd / R) * 2);
    }
    for (const e of this.entities.list) {
      const d = e.distTo(x, y, z);
      if (d > R) continue;
      if (e instanceof Mob) { e.hurt(dmgFor(d), this, sourceIsPlayer ? 'player' : 'env'); e.knockback(e.x - x, e.z - z, (1 - d / R) * 2); }
      else if (e instanceof ItemEntity && e.age > 0.5 && Math.random() < 0.5) e.dead = true;
    }
  }
  primeKeg(x: number, y: number, z: number, delay = 3) {
    const e = new FallingBlock(x, y, z, B.powder_keg);
    (e as unknown as { update: Entity['update'] }).update = (dt: number) => {
      e.age += dt;
      e.obj.visible = Math.floor(e.age * 6) % 2 === 0;
      if (e.age >= delay) { e.dead = true; this.explode(x + 0.5, y + 0.5, z + 0.5, 4, false, true); }
    };
    audio.fuse([x, y, z]);
    this.entities.add(e);
  }
  private pushEntities(x: number, y: number, z: number, dx: number, dy: number, dz: number) {
    const all: { body: { x: number; y: number; z: number } }[] = [this.player, ...this.entities.list];
    for (const e of all) {
      const b = e.body;
      if (Math.floor(b.x) === x && Math.floor(b.y) >= y - 1 && Math.floor(b.y) <= y && Math.floor(b.z) === z) { b.x += dx; b.y += dy + (dy ? 0 : 0.05); b.z += dz; }
    }
  }

  /* ================================================================ world rules */
  private onFeatures(dim: Dim, c: Chunk, f: GenFeature[]) {
    const w = this.world;
    for (const ft of f) {
      if (ft.kind === 'chest') {
        const be = w.blockEntity(ft.x, ft.y, ft.z, 'chest')!;
        be.items = rollLoot(ft.data, mulberry(hash32(ft.x, ft.y, ft.z, this.meta.seed)));
      } else if (ft.kind === 'cage') {
        const be = w.blockEntity(ft.x, ft.y, ft.z, 'cage')!;
        be.mob = ft.data; be.delay = 5;
      } else if (ft.kind === 'npc') {
        const m = this.entities.spawnMob('wayfolk', ft.x + 0.5, ft.y, ft.z + 0.5, { prof: ft.data });
        m.home = [ft.x, ft.y, ft.z];
        const v = this.nearestVillage(ft.x, ft.z);
        if (v) m.villageId = v;
      } else if (ft.kind === 'village') {
        if (!this.state.villages[ft.data]) this.state.villages[ft.data] = { x: ft.x, y: ft.y, z: ft.z, rep: 0, hero: false, lastSiege: -1, stoneward: false };
        const v = this.state.villages[ft.data];
        if (!v.stoneward) { v.stoneward = true; const m = this.entities.spawnMob('stoneward', ft.x + 3.5, ft.y + 1, ft.z + 3.5); m.home = [ft.x + 3, ft.y, ft.z + 3]; }
      } else if (ft.kind === 'boss') {
        const id = `${dim}:${ft.x},${ft.y},${ft.z}`;
        if (ft.data === 'colossus' && !this.state.bosses[id]) {
          this.state.bosses[id] = 'spawned';
          const m = this.entities.spawnMob('colossus', ft.x + 0.5, ft.y, ft.z + 0.5);
          m.bossId = id;
        }
      }
    }
    if (f.length) c.saveDirty = true;
    // initial animal herds
    if (dim === Dim.Overworld) {
      const r = mulberry(hash32(c.cx, c.cz, this.meta.seed, 17));
      if (r() < 0.1) {
        const lx = Math.floor(r() * 16), lz = Math.floor(r() * 16);
        const bi = c.biomes[lx + lz * CHUNK];
        const list = BIOMES[bi]?.animals.filter((a) => !MOBS[a].aquatic) ?? [];
        if (list.length) {
          const kind = list[Math.floor(r() * list.length)];
          const x = c.cx * CHUNK + lx, z = c.cz * CHUNK + lz;
          let y = HEIGHT - 2;
          while (y > 1 && !SOLID[c.blocks[lx + lz * CHUNK + y * CHUNK_AREA]] && c.blocks[lx + lz * CHUNK + y * CHUNK_AREA] !== B.water) y--;
          if (c.blocks[lx + lz * CHUNK + y * CHUNK_AREA] !== B.water && y > SEA_LEVEL - 2) {
            const n = 2 + Math.floor(r() * 3);
            for (let i = 0; i < n; i++) this.entities.spawnMob(kind, x + 0.5 + (r() - 0.5) * 3, y + 1.2, z + 0.5 + (r() - 0.5) * 3);
          }
        }
      }
    }
  }
  nearestVillage(x: number, z: number): string | null {
    let best: string | null = null, bd = 80 * 80;
    for (const [id, v] of Object.entries(this.state.villages)) { const d = (v.x - x) ** 2 + (v.z - z) ** 2; if (d < bd) { bd = d; best = id; } }
    return best;
  }
  private ensureSovereign() {
    if (this.state.sovereignDefeated) return;
    if (this.entities.list.some((e) => e instanceof Mob && e.def.key === 'sovereign')) return;
    const m = this.entities.spawnMob('sovereign', 0, HOLLOW_ARENA_Y + 16, 0);
    m.bossId = '2:sovereign';
    this.state.bosses['2:sovereign'] = 'spawned';
    this.message('The Shard Sovereign stirs. Break the four Ward Pylons to bring down its shield.', 'warn');
  }

  private onBlockChanged(x: number, y: number, z: number, _old: number, nu: number) {
    const w = this.world;
    if (isFluid(nu)) w.schedule(x, y, z, fluidDelay(nu, this.dim));
    for (let d = 0; d < 6; d++) {
      const nx = x + DIRS[d][0], ny = y + DIRS[d][1], nz = z + DIRS[d][2];
      const nid = w.id(nx, ny, nz);
      if (!nid) continue;
      if (isFluid(nid)) w.schedule(nx, ny, nz, fluidDelay(nid, this.dim));
      const nd = BLOCKS[nid];
      if (nd.gravity) w.schedule(nx, ny, nz, 2, TICK_GRAVITY);
      if (nd.needs || nd.orient === 'door' || nid === B.cactus || nid === B.reeds || nid === B.piston_head) w.schedule(nx, ny, nz, 1, TICK_SUPPORT);
      if (nid === B.fire) w.schedule(nx, ny, nz, 20, TICK_FIRE);
    }
    if (BLOCKS[nu].gravity) w.schedule(x, y, z, 2, TICK_GRAVITY);
    if (nu === B.fire) w.schedule(x, y, z, 30 + Math.floor(Math.random() * 30), TICK_FIRE);
    this.pulse.touch(x, y, z);
  }
  private gravityCheck(x: number, y: number, z: number) {
    const w = this.world, id = w.id(x, y, z);
    if (!BLOCKS[id].gravity) return;
    const below = w.id(x, y - 1, z);
    if (y > 0 && (below === 0 || BLOCKS[below].replaceable)) {
      w.set(x, y, z, 0);
      this.entities.add(new FallingBlock(x, y, z, id));
    }
  }
  /** blocks that need support break when it disappears */
  private supportCheck(x: number, y: number, z: number) {
    const w = this.world, id = w.id(x, y, z);
    if (!id) return;
    const d = BLOCKS[id], m = w.meta(x, y, z);
    const below = w.id(x, y - 1, z);
    let ok = true;
    if (d.orient === 'door') {
      const other = m & 8 ? w.id(x, y - 1, z) : w.id(x, y + 1, z);
      ok = other === id && (m & 8 ? true : SOLID[below] === 1);
    } else if (id === B.piston_head) {
      const f = m & 7;
      const bx = x - DIRS[f][0], by = y - DIRS[f][1], bz = z - DIRS[f][2];
      const base = w.id(bx, by, bz);
      ok = (base === B.piston || base === B.sticky_piston) && (w.meta(bx, by, bz) & 8) !== 0;
    } else if (id === B.cactus) {
      ok = below === B.cactus || below === B.sand || below === B.red_sand;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (SOLID[w.id(x + dx, y, z + dz)]) ok = false;
    } else if (id === B.reeds) {
      ok = below === B.reeds || ((below === B.grass || below === B.dirt || below === B.sand || below === B.mud) && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => w.id(x + dx, y - 1, z + dz) === B.water));
    } else if (d.needs) ok = this.interact.supported(id, m, x, y, z);
    if (!ok) this.interact.breakAt(x, y, z, true, null, false);
  }
  private fireTick(x: number, y: number, z: number) {
    const w = this.world;
    if (w.id(x, y, z) !== B.fire) return;
    const below = w.id(x, y - 1, z);
    const permanent = below === B.magma_block || below === B.emberstone;
    if (this.state.weather.rain > 0.5 && w.skyLight(x, y, z) >= 14 && !permanent) { w.set(x, y, z, 0); return; }
    // burn neighbours
    if (this.rules.fireSpread) {
      for (let d = 0; d < 6; d++) {
        const nx = x + DIRS[d][0], ny = y + DIRS[d][1], nz = z + DIRS[d][2];
        const nid = w.id(nx, ny, nz);
        if (nid && BLOCKS[nid].flammable && Math.random() < 0.18) {
          if (nid === B.powder_keg) { w.set(nx, ny, nz, 0); this.primeKeg(nx, ny, nz); }
          else w.set(nx, ny, nz, Math.random() < 0.5 ? B.fire : 0);
        }
      }
      for (let i = 0; i < 2; i++) {
        const fx = x + Math.floor(Math.random() * 3) - 1, fy = y + Math.floor(Math.random() * 3) - 1, fz = z + Math.floor(Math.random() * 3) - 1;
        if (w.id(fx, fy, fz) === 0 && DIRS.some((dd) => { const q = w.id(fx + dd[0], fy + dd[1], fz + dd[2]); return q && BLOCKS[q].flammable; }) && Math.random() < 0.3) w.set(fx, fy, fz, B.fire);
      }
    }
    if (!permanent && Math.random() < 0.25) { w.set(x, y, z, 0); return; }
    if (!SOLID[below] && !permanent && !DIRS.some((dd) => { const q = w.id(x + dd[0], y + dd[1], z + dd[2]); return q && BLOCKS[q].flammable; })) { w.set(x, y, z, 0); return; }
    w.schedule(x, y, z, 30 + Math.floor(Math.random() * 40), TICK_FIRE);
    if (Math.random() < 0.3) audio.fire([x, y, z]);
  }

  private randomTicks() {
    const w = this.world;
    const pcx = Math.floor(this.player.x / CHUNK), pcz = Math.floor(this.player.z / CHUNK);
    const R = this.settings.simDistance;
    const snowing = this.state.weather.rain > 0.5;
    for (const c of w.chunks.values()) {
      if (Math.abs(c.cx - pcx) > R || Math.abs(c.cz - pcz) > R) continue;
      for (let s = 0; s < 8; s++) for (let k = 0; k < 3; k++) {
        const lx = (Math.random() * 16) | 0, lz = (Math.random() * 16) | 0, y = s * 16 + ((Math.random() * 16) | 0);
        const id = c.blocks[lx + lz * CHUNK + y * CHUNK_AREA];
        if (!id) continue;
        const x = c.cx * CHUNK + lx, z = c.cz * CHUNK + lz;
        this.randomTick(x, y, z, id, c.meta[lx + lz * CHUNK + y * CHUNK_AREA]);
      }
      // weather surface effects
      if (snowing && this.dim === Dim.Overworld && Math.random() < 0.05) {
        const lx = (Math.random() * 16) | 0, lz = (Math.random() * 16) | 0;
        const bi = c.biomes[lx + lz * CHUNK];
        if (BIOMES[bi]?.snow) {
          const x = c.cx * CHUNK + lx, z = c.cz * CHUNK + lz, y = w.surfaceY(x, z);
          const top = w.id(x, y, z);
          if (top === B.water && w.meta(x, y, z) === 0) w.set(x, y, z, B.ice);
          else if (y > 0 && SOLID[top] && OPAQUE[top] && w.id(x, y + 1, z) === 0) w.set(x, y + 1, z, B.snow_layer);
        }
      }
    }
  }
  private randomTick(x: number, y: number, z: number, id: number, m: number) {
    const w = this.world;
    const above = w.id(x, y + 1, z);
    const light = Math.max(w.skyLight(x, y + 1, z) * (this.daylight > 0.3 ? 1 : 0.4), w.blockLight(x, y + 1, z));
    const d = BLOCKS[id];
    if (id === B.grass) {
      if (OPAQUE[above]) { w.set(x, y, z, B.dirt); return; }
      if (light >= 9) {
        const tx = x + Math.floor(Math.random() * 3) - 1, ty = y + Math.floor(Math.random() * 5) - 3, tz = z + Math.floor(Math.random() * 3) - 1;
        if (w.id(tx, ty, tz) === B.dirt && !OPAQUE[w.id(tx, ty + 1, tz)] && w.skyLight(tx, ty + 1, tz) >= 4) w.set(tx, ty, tz, B.grass);
      }
    } else if (id === B.farmland) {
      let wet = false;
      for (let dx = -4; dx <= 4 && !wet; dx++) for (let dz = -4; dz <= 4 && !wet; dz++) for (const dy of [0, 1]) if (w.id(x + dx, y + dy, z + dz) === B.water) { wet = true; break; }
      if (this.state.weather.rain > 0.5 && w.skyLight(x, y + 1, z) >= 14) wet = true;
      if (wet) { if (m !== 7) w.setMeta(x, y, z, 7); }
      else if (m > 0) w.setMeta(x, y, z, m - 1);
      else if (!BLOCKS[above].key.endsWith('_crop')) w.set(x, y, z, B.dirt);
    } else if (d.key.endsWith('_crop')) {
      const max = cropStages(d.key) - 1;
      if (m < max && light >= 9) {
        const wet = w.meta(x, y - 1, z) === 7;
        if (Math.random() < (wet ? 0.35 : 0.15)) w.set(x, y, z, id, m + 1);
      }
    } else if (d.key.endsWith('_sapling')) {
      if (light >= 9 && Math.random() < 0.12) this.growSapling(x, y, z, id);
    } else if (id === B.berry_bush) {
      if (m < 3 && light >= 9 && Math.random() < 0.2) w.set(x, y, z, id, m + 1);
    } else if (id === B.reeds || id === B.cactus) {
      if (above === 0 && Math.random() < 0.25) {
        let h = 1;
        while (w.id(x, y - h, z) === id) h++;
        if (h < 3) w.set(x, y + 1, z, id);
      }
    } else if (d.key.endsWith('_leaves')) {
      if (m & 4) return; // player placed
      let near = false;
      for (let dx = -4; dx <= 4 && !near; dx++) for (let dy = -4; dy <= 4 && !near; dy++) for (let dz = -4; dz <= 4; dz++) { const q = w.id(x + dx, y + dy, z + dz); if (q && BLOCKS[q].key.endsWith('_log')) { near = true; break; } }
      if (!near) this.interact.breakAt(x, y, z, true, null, false);
    } else if (id === B.ice || id === B.snow_layer) {
      if (w.blockLight(x, y, z) > 11 || (this.dim === Dim.Ember)) w.set(x, y, z, id === B.ice ? B.water : 0);
    } else if (id === B.mushroom_red || id === B.mushroom_brown) {
      if (light < 12 && Math.random() < 0.02) {
        const tx = x + Math.floor(Math.random() * 3) - 1, tz = z + Math.floor(Math.random() * 3) - 1;
        if (w.id(tx, y, tz) === 0 && SOLID[w.id(tx, y - 1, tz)]) w.set(tx, y, tz, id);
      }
    } else if (id === B.fire) {
      w.schedule(x, y, z, 1, TICK_FIRE);
    }
  }
  growSapling(x: number, y: number, z: number, id: number) {
    const w = this.world;
    const sp = BLOCKS[id].key.replace('_sapling', '');
    for (let i = 1; i < 6; i++) if (SOLID[w.id(x, y + i, z)]) return false;
    w.set(x, y, z, 0);
    const writer = { get: (a: number, b: number, c: number) => w.id(a, b, c), set: (a: number, b: number, c: number, i2: number, m = 0) => { w.set(a, b, c, i2, m); }, soft: (a: number, b: number, c: number, i2: number, m = 0) => { const cur = w.id(a, b, c); if (cur === 0 || BLOCKS[cur].replaceable || BLOCKS[cur].plant) w.set(a, b, c, i2, m); } };
    growTree(writer, sp, x, y, z, mulberry(hash32(x, y, z, this.tickCount)));
    return true;
  }
  growMushroom(x: number, y: number, z: number) {
    const w = this.world;
    const writer = { get: (a: number, b: number, c: number) => w.id(a, b, c), set: (a: number, b: number, c: number, i2: number, m = 0) => { w.set(a, b, c, i2, m); }, soft: (a: number, b: number, c: number, i2: number, m = 0) => { if (w.id(a, b, c) === 0) w.set(a, b, c, i2, m); } };
    w.set(x, y, z, 0);
    giantMushroom(writer, x, y, z, mulberry(hash32(x, y, z, 5)));
  }

  /* ================================================================ containers */
  private containerTicks() {
    this.bePollT--;
    if (this.bePollT <= 0) { this.bePollT = 20; this.beList = this.world.allBlockEntities().filter(([, , , be]) => ['furnace', 'smoker', 'blast', 'brewing', 'hopper', 'cage'].includes(be.type)); }
    const w = this.world;
    for (const [x, y, z, be] of this.beList) {
      const id = w.id(x, y, z);
      const def = BLOCKS[id];
      if (!def.container && be.type !== 'cage') continue;
      if (be.type === 'furnace' || be.type === 'smoker' || be.type === 'blast') this.furnaceTick(x, y, z, id, be);
      else if (be.type === 'brewing') this.brewTick(be);
      else if (be.type === 'hopper' && this.tickCount % 8 === 0) this.hopperTick(x, y, z, be);
      else if (be.type === 'cage' && this.tickCount % 20 === 0 && id === B.mob_cage) this.spawner.cage(x, y, z, be);
    }
  }
  private furnaceTick(x: number, y: number, z: number, id: number, be: BlockEntity) {
    const it = (be.items ??= [null, null, null]);
    const kind = be.type as 'furnace' | 'smoker' | 'blast';
    let burn = (be.burn as number) ?? 0, cook = (be.cook as number) ?? 0;
    const speed = kind === 'furnace' ? 1 : 2;
    const inp = it[0];
    const res = inp ? smeltResult(inp.id, kind) : null;
    const outId = res ? itemByKey(res.out).id : -1;
    const canOut = !!res && (!it[2] || (it[2].id === outId && it[2].count < ITEMS[outId].stack));
    if (burn <= 0 && canOut && it[1] && fuelValue(it[1].id) > 0) {
      const fv = fuelValue(it[1].id);
      burn = fv; be.burnMax = fv;
      if (ITEMS[it[1].id].key === 'lava_bucket') it[1] = { id: itemByKey('bucket').id, count: 1 };
      else { it[1].count--; if (it[1].count <= 0) it[1] = null; }
    }
    if (burn > 0) {
      burn -= speed;
      if (canOut) {
        cook += speed;
        if (cook >= 200) {
          cook = 0;
          inp!.count--; if (inp!.count <= 0) it[0] = null;
          if (it[2]) it[2].count++; else it[2] = { id: outId, count: 1 };
          be.xp = ((be.xp as number) ?? 0) + res!.xp;
        }
      } else cook = 0;
    } else cook = Math.max(0, cook - 2);
    be.burn = burn; be.cook = cook;
    const lit = burn > 0;
    const m = w_meta(this.world, x, y, z);
    if (lit !== !!(m & 8)) this.world.set(x, y, z, id, lit ? m | 8 : m & ~8, false);
    if (this.tickCount % 20 === 0) this.world.touchBE(x, z);
  }
  private brewTick(be: BlockEntity) {
    const it = (be.items ??= [null, null, null, null, null]);
    let fuel = (be.fuel as number) ?? 0;
    if (fuel <= 0 && it[4] && ITEMS[it[4].id].key === 'ember_dust') { fuel = 20; it[4].count--; if (it[4].count <= 0) it[4] = null; }
    const ing = it[3];
    const results = [0, 1, 2].map((i) => { const b = it[i]; return b && ITEMS[b.id].key === 'potion' && ing ? brewResult(b.data ?? 'water', ing.id) : null; });
    const can = fuel > 0 && results.some(Boolean);
    let t = (be.brew as number) ?? 0;
    if (can) {
      t++;
      if (t >= 400) {
        t = 0; fuel--;
        results.forEach((r, i) => { if (r) it[i] = { id: itemByKey('potion').id, count: 1, data: r }; });
        ing!.count--; if (ing!.count <= 0) it[3] = null;
        audio.drink();
      }
    } else t = 0;
    be.brew = t; be.fuel = fuel;
  }
  private hopperTick(x: number, y: number, z: number, be: BlockEntity) {
    const w = this.world;
    const m = w.meta(x, y, z);
    if (m & 8) return; // locked by pulse
    const it = (be.items ??= [null, null, null, null, null]);
    // push
    const out = m & 7; // 0 down, 1..4 facing
    const [ox, oy, oz] = out === 0 ? [x, y - 1, z] : [x + [0, 1, 0, -1][out - 1], y, z + [-1, 0, 1, 0][out - 1]];
    const target = w.blockEntity(ox, oy, oz);
    const tid = w.id(ox, oy, oz);
    if (target && BLOCKS[tid].container) {
      const si = it.findIndex(Boolean);
      if (si >= 0) {
        const one = { ...it[si]!, count: 1 };
        const range = this.insertRange(target, tid, out === 0 ? 'top' : 'side', one);
        if (range && !insertInto(target.items!, one, range)) { it[si]!.count--; if (it[si]!.count <= 0) it[si] = null; w.touchBE(ox, oz); }
      }
    }
    // pull from above
    const src = w.blockEntity(x, y + 1, z);
    const sid = w.id(x, y + 1, z);
    if (src && BLOCKS[sid].container && src.items) {
      const from = src.type === 'furnace' || src.type === 'smoker' || src.type === 'blast' ? [2] : src.type === 'brewing' ? [0, 1, 2] : src.items.map((_, i) => i);
      for (const i of from) {
        const s = src.items[i];
        if (!s) continue;
        const one = { ...s, count: 1 };
        if (!insertInto(it, one)) { s.count--; if (s.count <= 0) src.items[i] = null; break; }
      }
    } else {
      for (const e of this.entities.list) {
        if (!(e instanceof ItemEntity) || e.dead) continue;
        if (Math.floor(e.x) === x && Math.floor(e.z) === z && e.y >= y + 0.5 && e.y < y + 2) {
          const left = insertInto(it, e.stack);
          if (!left) e.dead = true; else e.stack = left;
          break;
        }
      }
    }
    w.touchBE(x, z);
  }
  /** which slots of a container accept items arriving from a hopper */
  insertRange(be: BlockEntity, id: number, from: 'top' | 'side', s: ItemStack): number[] | null {
    const d = BLOCKS[id];
    be.items ??= new Array(d.container === 'chest' ? 27 : d.container === 'dispenser' ? 9 : d.container === 'hopper' ? 5 : d.container === 'brewing' ? 5 : 3).fill(null);
    if (d.container === 'furnace' || d.container === 'smoker' || d.container === 'blast') return from === 'top' ? [0] : fuelValue(s.id) > 0 ? [1] : null;
    if (d.container === 'brewing') return ITEMS[s.id].key === 'ember_dust' ? [4] : ITEMS[s.id].key === 'potion' ? [0, 1, 2] : [3];
    return be.items.map((_, i) => i);
  }

  /* ================================================================ misc ticks */
  private somethingOn(x: number, y: number, z: number) {
    const near = (b: { x: number; y: number; z: number }) => Math.floor(b.x) === x && Math.floor(b.z) === z && b.y >= y - 0.01 && b.y < y + 0.6;
    if (!this.player.dead && near(this.player.body)) return true;
    return this.entities.list.some((e) => !e.dead && (e instanceof Mob || e instanceof ItemEntity) && near(e.body));
  }
  private plateCheck() {
    const w = this.world;
    const check = (b: { x: number; y: number; z: number }) => {
      const x = Math.floor(b.x), y = Math.floor(b.y + 0.05), z = Math.floor(b.z);
      if (w.id(x, y, z) === B.pressure_plate && !(w.meta(x, y, z) & 8)) {
        w.set(x, y, z, B.pressure_plate, w.meta(x, y, z) | 8);
        audio.lever([x, y, z]);
        w.schedule(x, y, z, 10, TICK_PLATE);
      }
    };
    if (!this.player.dead) check(this.player.body);
    for (const e of this.entities.list) if (e instanceof Mob || e instanceof ItemEntity) check(e.body);
  }
  private weatherTick() {
    const wt = this.state.weather;
    if (this.rules.weatherCycle) {
      wt.timer--;
      if (wt.timer <= 0) {
        if (wt.target > 0) { wt.target = 0; wt.thunder = false; wt.timer = 12000 + Math.random() * 24000; }
        else { wt.target = 1; wt.thunder = Math.random() < 0.3; wt.timer = 6000 + Math.random() * 9000; }
      }
    }
    wt.rain += Math.sign(wt.target - wt.rain) * Math.min(Math.abs(wt.target - wt.rain), 0.002);
    if (wt.thunder && wt.rain > 0.8 && this.dim === Dim.Overworld && Math.random() < 1 / 300) this.lightning();
  }
  private lightning() {
    const p = this.player;
    const x = Math.floor(p.x + (Math.random() - 0.5) * 96), z = Math.floor(p.z + (Math.random() - 0.5) * 96);
    if (!this.world.loaded(x, z)) return;
    const y = this.world.surfaceY(x, z);
    this.flash = 1;
    setTimeout(() => audio.thunder(), 300 + Math.hypot(x - p.x, z - p.z) * 15);
    // bolt visual
    const pts: THREE.Vector3[] = [];
    let bx = x + 0.5, bz = z + 0.5;
    for (let yy = y + 60; yy > y; yy -= 4) { pts.push(new THREE.Vector3(bx, yy, bz)); bx += (Math.random() - 0.5) * 2; bz += (Math.random() - 0.5) * 2; }
    pts.push(new THREE.Vector3(x + 0.5, y + 1, z + 0.5));
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xeef4ff }));
    this.scene.add(line);
    setTimeout(() => { this.scene.remove(line); line.geometry.dispose(); }, 250);
    if (this.rules.fireSpread && this.world.id(x, y + 1, z) === 0 && SOLID[this.world.id(x, y, z)]) this.world.set(x, y + 1, z, B.fire);
    if (Math.hypot(p.x - x, p.z - z) < 3) { p.hurt(5, { kind: 'fire' }); p.setFire(5); }
    for (const e of this.entities.list) if (e instanceof Mob && e.distTo(x, y + 1, z) < 3) { e.hurt(5, this, 'env'); e.fireT = 6; }
  }
  private sleepTick() {
    const p = this.player;
    if (!p.sleeping) { this.sleepT = 0; return; }
    this.sleepT += 0.05;
    if (this.sleepT > 2.5) {
      p.sleeping = false;
      this.time = 0.0;
      this.state.day++;
      this.state.weather.target = 0; this.state.weather.rain = 0; this.state.weather.thunder = false;
      this.message('You wake rested. A new day begins.', 'good');
      this.saveAll().catch(() => {});
    }
  }

  /* ================================================================ portals */
  private portalCheck(dt: number) {
    const p = this.player;
    const x = Math.floor(p.x), y = Math.floor(p.y + 0.05), z = Math.floor(p.z);
    const id = this.world.id(x, y, z);
    if (id !== B.rift_pad && id !== B.return_gate) { this.portalLock = false; this.portalT = 0; return; }
    if (this.portalLock || p.dead) return;
    this.portalT += dt;
    if (Math.random() < 0.4) this.particles(p.x + (Math.random() - 0.5), p.y + Math.random() * 2, p.z + (Math.random() - 0.5), id === B.return_gate ? [0.5, 0.7, 1] : [1, 0.5, 0.2], 1, 1, -2, 0.12);
    if (this.portalT < 2.5) return;
    this.portalT = 0;
    if (id === B.return_gate) { this.travel(Dim.Overworld); return; }
    // which core is this pad attached to?
    let core = 0;
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) { const c = this.world.id(x + dx, y - 1, z + dz); if (c === B.rift_core || c === B.void_core) core = c; }
    if (!core) return;
    if (this.dim === Dim.Overworld) this.travel(core === B.void_core ? Dim.Void : Dim.Ember, [x, y, z]);
    else this.travel(Dim.Overworld);
  }
  async travel(to: Dim, from?: [number, number, number]) {
    audio.portal();
    const p = this.player;
    if (this.dim === Dim.Overworld && from) this.state.portals.overworld = [from[0] + 0.5, from[1] + 1, from[2] + 0.5];
    let arrival: [number, number, number];
    if (to === Dim.Ember) {
      // aim near a bastion so the Colossus is findable
      const bast = emberBastionNear(this.meta.seed, p.x, p.z);
      const ax = bast && Math.hypot(bast[0] - p.x, bast[1] - p.z) < 260 ? bast[0] + 60 : p.x, az = bast && Math.hypot(bast[0] - p.x, bast[1] - p.z) < 260 ? bast[1] : p.z;
      arrival = [Math.floor(ax) + 0.5, 60, Math.floor(az) + 0.5];
      this.state.portals.ember = arrival;
      if (bast) this.message(`An Ember Bastion looms to the west of your arrival point. Its master guards the throne.`, 'info');
    } else if (to === Dim.Void) arrival = [0.5, HOLLOW_ARENA_Y + 1, 47.5];
    else {
      const o = this.state.portals.overworld ?? this.state.spawn ?? [0.5, 90, 0.5];
      arrival = [o[0], o[1], o[2]];
      if (this.dim === Dim.Void) arrival = (this.player.spawn ?? this.state.spawn ?? arrival) as [number, number, number];
    }
    await this.openDimension(to, false, arrival);
  }
  /** Emberdeep arrival: carve a safe pocket and build a return rift */
  private buildArrivalPortal() {
    const w = this.world, p = this.player.body;
    const x = Math.floor(p.x), z = Math.floor(p.z);
    let y = 40;
    for (let yy = 40; yy < 100; yy++) if (SOLID[w.id(x, yy - 1, z)] && !SOLID[w.id(x, yy, z)] && !SOLID[w.id(x, yy + 1, z)] && !isFluid(w.id(x, yy, z))) { y = yy; break; }
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
      w.set(x + dx, y - 1, z + dz, B.obsidian);
      for (let dy = 0; dy < 4; dy++) w.set(x + dx, y + dy, z + dz, 0);
    }
    w.set(x + 2, y - 1, z, B.rift_core);
    for (let dx = 1; dx <= 3; dx++) for (let dz = -1; dz <= 1; dz++) {
      if (dx === 2 && dz === 0) continue;
      w.set(x + dx, y - 1, z + dz, B.obsidian);
      w.set(x + dx, y, z + dz, B.rift_pad);
    }
    p.x = x + 0.5 - 1; p.y = y; p.z = z + 0.5;
  }

  /* ================================================================ items on the ground */
  private pickup() {
    const p = this.player;
    if (p.dead) return;
    for (const e of this.entities.list) {
      if (e.dead) continue;
      if (e instanceof ItemEntity) {
        if (e.pickupDelay > 0) continue;
        if (Math.abs(e.x - p.x) < 1.2 && e.y > p.y - 0.6 && e.y < p.y + 2.2 && Math.abs(e.z - p.z) < 1.2) {
          const left = p.inv.add(e.stack);
          if (!left) e.dead = true; else if (left.count !== e.stack.count) e.stack = left; else continue;
          audio.pickup();
          useUI.getState().set({ invVersion: p.inv.version });
        }
      } else if (e instanceof XPOrb) {
        if (e.distTo(p.x, p.y + 0.8, p.z) < 1.2) {
          e.dead = true;
          // mending repairs held/armor items first
          let amt = e.amount;
          const mend = [p.inv.selected, OFFHAND, 36, 37, 38, 39].map((i) => [i, p.inv.slots[i]] as const).find(([, s]) => s && s.ench?.mending && (s.dmg ?? 0) > 0);
          if (mend) { const s = mend[1]!; const fix = Math.min(s.dmg ?? 0, amt * 2); s.dmg = (s.dmg ?? 0) - fix; amt -= Math.ceil(fix / 2); p.inv.changed(); }
          if (amt > 0) p.addXP(amt);
        }
      }
    }
  }

  /* ================================================================ death */
  private onDeath() {
    const p = this.player;
    this.state.stats.deaths++;
    if (!this.rules.keepInventory) {
      for (let i = 0; i < p.inv.slots.length; i++) {
        const s = p.inv.slots[i];
        if (s) this.spawnItem(p.x, p.y + 1, p.z, s, (Math.random() - 0.5) * 6, 3, (Math.random() - 0.5) * 6, 1);
      }
      p.inv.clear();
      const xp = Math.min(100, p.level * 7);
      if (xp) this.spawnXP(p.x, p.y + 1, p.z, xp);
      p.level = 0; p.xp = 0;
    }
    p.riding = null;
    if (document.pointerLockElement) document.exitPointerLock();
    useUI.getState().set({ screen: 'dead', deathMsg: p.deathMsg });
    this.saveAll().catch(() => {});
  }
  async respawn() {
    const p = this.player;
    p.dead = false; p.hp = p.maxHp; p.hunger = 20; p.sat = 5; p.air = 15; p.fireT = 0; p.effects.clear(); p.absorption = 0; p.exhaustion = 0;
    p.body.vx = p.body.vy = p.body.vz = 0; p.body.fallDist = 0;
    let target = this.state.spawn ?? [0.5, 90, 0.5];
    if (p.spawn) {
      const [bx, by, bz] = p.spawn;
      if (this.dim !== Dim.Overworld || this.world.id(Math.floor(bx), Math.floor(by), Math.floor(bz)) === B.bed || !this.world.loaded(bx, bz)) target = [bx + 0.5, by + 0.6, bz + 0.5];
      else { p.spawn = null; this.message('Your bed was missing, so you woke at the world spawn.', 'warn'); }
    }
    if (this.dim !== Dim.Overworld) await this.openDimension(Dim.Overworld, false, target as [number, number, number]);
    else { p.body.x = target[0]; p.body.y = target[1]; p.body.z = target[2]; this.world.update(p.x, p.z); }
    this.unstick();
    useUI.getState().set({ screen: 'playing' });
  }

  /* ================================================================ HUD */
  private publishHud() {
    const p = this.player;
    const ui = useUI.getState();
    this.bossSeen -= 0.1;
    if (this.bossSeen <= 0) this.bossInfo = null;
    const look = this.interact.target;
    let targetName = '';
    if (look) { const d = BLOCKS[this.world.id(look.x, look.y, look.z)]; targetName = d?.name ?? ''; }
    const biome = this.dim === Dim.Overworld ? BIOMES[this.world.biomeAt(Math.floor(p.x), Math.floor(p.z))]?.name ?? '' : this.dim === Dim.Ember ? 'Emberdeep' : 'The Hollow';
    let debug = '';
    if (this.debug) {
      const c = this.world.chunks.size, ents = this.entities.list.length;
      const info = this.renderer.info.render;
      debug = `Deepwild · ${this.fps} fps · ${info.calls} draws · ${(info.triangles / 1000).toFixed(0)}k tris\nXYZ ${p.x.toFixed(1)} / ${p.y.toFixed(1)} / ${p.z.toFixed(1)}  facing ${['north', 'west', 'south', 'east'][Math.round(((p.yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) / (Math.PI / 2)) % 4]}\nChunk ${Math.floor(p.x / 16)}, ${Math.floor(p.z / 16)} · ${c} loaded · ${this.world.pendingCount()} pending · ${ents} entities\nBiome ${biome} · light sky ${this.world.skyLight(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z))} block ${this.world.blockLight(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z))}\nDay ${this.state.day + 1}, ${this.clock()} · weather ${this.state.weather.rain > 0.5 ? (this.state.weather.thunder ? 'storm' : 'rain') : 'clear'}\nSeed ${this.meta.seed}${look ? `\nLooking at ${targetName} (${look.x}, ${look.y}, ${look.z}) meta ${this.world.meta(look.x, look.y, look.z)}` : ''}`;
    }
    const hb = p.inv.slots.slice(0, 9);
    ui.setHud({
      hp: p.hp, maxHp: p.maxHp, absorption: p.absorption, hunger: p.hunger, armor: p.inv.armorPoints(), air: p.air, underwater: p.body.eyeInWater || p.air < 15,
      level: p.level, xpFrac: p.xp / (7 + p.level * 3 + Math.floor(p.level / 10) * p.level), selected: p.inv.selected, hotbar: hb.map((s) => (s ? { ...s } : null)), offhand: p.inv.slots[OFFHAND] ? { ...p.inv.slots[OFFHAND]! } : null,
      effects: [...p.effects].map(([key, e]) => ({ key, t: e.t, amp: e.amp })), boss: this.bossInfo, creative: p.creative, hurtFlash: p.hurtFlash, fire: p.fireT > 0, portal: this.portalT / 2.5,
      debug, fps: this.fps, targetName, riding: p.riding ? p.riding.kind : '', sleeping: p.sleeping, biome, dim: this.dim, useProgress: this.interact.useProgress(),
    });
    p.hurtFlash = Math.max(0, p.hurtFlash - 0.1);
    if (ui.invVersion !== p.inv.version) ui.set({ invVersion: p.inv.version });
  }
  clock() {
    const h = (this.time * 24 + 6) % 24;
    return `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;
  }

  /* ================================================================ creative/world controls */
  setTime(t: number) { this.time = t; }
  setWeather(kind: 'clear' | 'rain' | 'storm') {
    const w = this.state.weather;
    w.target = kind === 'clear' ? 0 : 1; w.rain = w.target; w.thunder = kind === 'storm'; w.timer = 12000;
  }
  setMode(mode: 'survival' | 'creative') {
    this.meta.mode = mode;
    this.player.creative = mode === 'creative';
    if (!this.player.creative) this.player.flying = false;
    this.message(mode === 'creative' ? 'Creative mode: unlimited blocks, flight (double-tap jump), no damage.' : 'Survival mode.', 'info');
    putWorld(this.meta).catch(() => {});
  }
  openPanel(panel: Panel, pos: [number, number, number] | null, trade: number | null = null) {
    if (document.pointerLockElement) document.exitPointerLock();
    useUI.getState().set({ screen: 'inventory', panel, panelPos: pos, tradeMob: trade });
  }
  placeBonusChest() {
    const p = this.player;
    for (let r = 2; r < 6; r++) {
      const x = Math.floor(p.x) + r, z = Math.floor(p.z);
      const y = this.world.surfaceY(x, z) + 1;
      if (this.world.id(x, y, z) === 0 && SOLID[this.world.id(x, y - 1, z)]) {
        this.world.set(x, y, z, B.chest, 3);
        const be = this.world.blockEntity(x, y, z, 'chest')!;
        be.items = rollLoot('bonus');
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (this.world.id(x + dx, y, z + dz) === 0) this.world.set(x + dx, y, z + dz, B.torch, 0);
        this.message('A bonus chest waits beside you.', 'good');
        return;
      }
    }
  }
}
function w_meta(w: World, x: number, y: number, z: number) { return w.meta(x, y, z); }
export const _unused = [tileId, POTIONS];
