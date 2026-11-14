import * as THREE from 'three';
import { skinCanvas, hex, mul, mix, type RGB } from '../gfx/textures';

/** A box part. Sizes in 1/16 block. Pivot is relative to the entity's feet; offset moves the box from the pivot. */
export interface Part { n: string; s: [number, number, number]; p: [number, number, number]; o?: [number, number, number]; c: string; face?: string; pat?: string; parent?: string; glow?: boolean; c2?: string }
export interface ModelDef { parts: Part[]; scale?: number }

const FACES = ['side', 'side', 'top', 'bottom', 'front', 'back'] as const;

function skin(p: Part, face: typeof FACES[number], w: number, h: number): THREE.Texture {
  const base = hex(p.c), alt = hex(p.c2 ?? p.c);
  const W = Math.max(2, Math.min(16, Math.round(w))), H = Math.max(2, Math.min(16, Math.round(h)));
  const cv = skinCanvas(W, H, (x, y, r) => {
    let c: RGB = mul(base, 0.88 + r() * 0.2);
    switch (p.pat) {
      case 'fur': if (r() < 0.25) c = mul(alt, 0.9 + r() * 0.2); break;
      case 'stripes': if (y % 3 === 0) c = mul(alt, 0.95); break;
      case 'spots': if (r() < 0.12) c = alt; break;
      case 'stone': c = mul(base, 0.75 + r() * 0.35); if (r() < 0.08) c = alt; break;
      case 'cracks': if ((x * 7 + y * 3) % 11 === 0 || r() < 0.06) c = alt; break;
      case 'crystal': c = mix(base, alt, ((x + y) % 4) / 4); break;
      case 'wool': c = mul(base, 0.85 + (((x + y * 2) % 3) === 0 ? 0.2 : 0.1) * r() + 0.05); break;
      case 'robe': if (x === 0 || x === W - 1) c = mul(alt, 0.9); if (y === H - 1) c = alt; break;
      case 'moss': if (r() < 0.3) c = mul(hex('#4f7a3a'), 0.9 + r() * 0.2); break;
    }
    if (face === 'front' && p.face) {
      const cx = W / 2, cy = H / 2;
      switch (p.face) {
        case 'eyes': if ((Math.abs(x - (cx - W / 4)) < 0.6 || Math.abs(x - (cx + W / 4 - 1)) < 0.6) && Math.abs(y - (cy - 1)) < 0.6) c = [25, 25, 30]; break;
        case 'glow_eyes': if ((Math.abs(x - (cx - W / 4)) < 0.6 || Math.abs(x - (cx + W / 4 - 1)) < 0.6) && Math.abs(y - (cy - 1)) < 0.6) c = [230, 240, 200]; break;
        case 'red_eyes': if ((x === Math.floor(cx - 2) || x === Math.floor(cx + 1)) && y === Math.floor(cy - 1)) c = [230, 40, 40]; break;
        case 'many_eyes': if (y < cy && (x + y) % 2 === 0 && x > 0 && x < W - 1 && y > 0) c = [220, 40, 50]; break;
        case 'snout': if (y >= cy && x >= cx - 2 && x <= cx + 1) c = mul(alt, 1); if (y === Math.floor(cy) + 1 && (x === Math.floor(cx - 1) || x === Math.floor(cx))) c = [40, 30, 30]; break;
        case 'beak': if (y >= cy - 1 && y <= cy && x >= cx - 1 && x < cx + 1) c = hex('#e8a02a'); if (y === Math.floor(cy - 2) && (x === 1 || x === W - 2)) c = [20, 20, 20]; break;
        case 'hood': if (y > H * 0.3 && y < H * 0.85 && x > 1 && x < W - 2) c = mul(base, 0.35); if (y === Math.floor(H * 0.55) && (x === Math.floor(W / 2) - 2 || x === Math.floor(W / 2) + 1)) c = [255, 210, 110]; break;
        case 'core': if (Math.hypot(x - cx + 0.5, y - cy + 0.5) < Math.min(W, H) * 0.28) c = mix(hex('#ffe08a'), hex('#ff5a1a'), Math.hypot(x - cx, y - cy) / 3); break;
        case 'jaw': if (y > H * 0.55) c = mul(alt, 0.8); if (y === Math.floor(H * 0.55) && x % 2 === 0) c = [230, 225, 200]; if (y === Math.floor(H * 0.3) && (x === 1 || x === W - 2)) c = [255, 140, 40]; break;
        case 'mask': c = hex('#e8e0d0'); if (y === Math.floor(H * 0.4) && (x === 1 || x === W - 2)) c = [120, 60, 220]; break;
        case 'eye': if (Math.hypot(x - cx + 0.5, y - cy + 0.5) < Math.min(W, H) * 0.3) c = [250, 245, 255]; if (Math.hypot(x - cx + 0.5, y - cy + 0.5) < Math.min(W, H) * 0.14) c = [80, 20, 140]; break;
        case 'fish': if (x === W - 2 && y === 1) c = [20, 20, 20]; break;
        case 'flower': if ((x + y) % 3 === 0) c = hex('#f0d040'); break;
      }
    }
    return c;
  }, p.n.length * 13 + face.length);
  const t = new THREE.CanvasTexture(cv);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const texCache = new Map<string, THREE.Texture>();
/** one texture per part: the six face skins side by side (+x,-x,+y,-y,+z,-z) */
function partTexture(model: string, p: Part): THREE.Texture {
  const k = `${model}|${p.n}|${p.c}|${p.face ?? ''}|${p.pat ?? ''}`;
  let t = texCache.get(k);
  if (t) return t;
  const c = document.createElement('canvas'); c.width = 96; c.height = 16;
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  FACES.forEach((f, i) => {
    const w = i < 2 ? p.s[2] : p.s[0], h = i === 2 || i === 3 ? p.s[2] : p.s[1];
    const src = skin(p, f, w, h).image as HTMLCanvasElement;
    g.drawImage(src, i * 16, 0, 16, 16);
  });
  t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace;
  texCache.set(k, t);
  return t;
}
const geoCache = new Map<string, THREE.BoxGeometry>();
function partGeometry(p: Part): THREE.BoxGeometry {
  const k = p.s.join(',');
  let g = geoCache.get(k);
  if (!g) {
    g = new THREE.BoxGeometry(p.s[0], p.s[1], p.s[2]);
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setX(i, (Math.floor(i / 4) + uv.getX(i)) / 6);
    g.clearGroups();
    g.userData.shared = true;
    geoCache.set(k, g);
  }
  return g;
}

export interface ModelInstance { root: THREE.Group; parts: Record<string, THREE.Object3D>; mats: THREE.MeshBasicMaterial[]; glowMats: THREE.MeshBasicMaterial[] }

export function buildModel(key: string, def: ModelDef, tint?: string): ModelInstance {
  const root = new THREE.Group();
  const holder = new THREE.Group();
  root.add(holder);
  const sc = (def.scale ?? 1) / 16;
  holder.scale.setScalar(sc);
  const parts: Record<string, THREE.Object3D> = {};
  const mats: THREE.MeshBasicMaterial[] = [];
  const glowMats: THREE.MeshBasicMaterial[] = [];
  for (const p0 of def.parts) {
    const p = tint && p0.pat === 'wool' ? { ...p0, c: tint } : p0;
    const pivot = new THREE.Group();
    const parent = p.parent ? parts[p.parent] : holder;
    const pp = p.parent ? def.parts.find((q) => q.n === p.parent)!.p : [0, 0, 0];
    pivot.position.set(p.p[0] - pp[0], p.p[1] - pp[1], p.p[2] - pp[2]);
    const mat = new THREE.MeshBasicMaterial({ map: partTexture(key, p) });
    const mesh = new THREE.Mesh(partGeometry(p), mat);
    const o = p.o ?? [0, 0, 0];
    mesh.position.set(o[0], o[1], o[2]);
    pivot.add(mesh);
    parent.add(pivot);
    parts[p.n] = pivot;
    (p.glow ? glowMats : mats).push(mat);
  }
  return { root, parts, mats, glowMats };
}

/* =========================================================== model library (original designs) */
const leg = (n: string, x: number, z: number, h: number, w: number, c: string, parent?: string): Part => ({ n, s: [w, h, w], p: [x, h, z], o: [0, -h / 2, 0], c, parent });

export const MODELS: Record<string, ModelDef> = {
  grazer: { parts: [
    { n: 'body', s: [12, 10, 18], p: [0, 13, 0], c: '#a9784c', pat: 'fur', c2: '#8a5c38' },
    { n: 'mane', s: [14, 12, 6], p: [0, 14, 7], c: '#4a3020', pat: 'fur', c2: '#3a2416' },
    { n: 'head', s: [8, 8, 7], p: [0, 15, 10], o: [0, 0, 3], c: '#9a6a40', face: 'snout', c2: '#d8b090' },
    { n: 'hornL', s: [7, 2, 2], p: [-4, 18, 12], o: [-3, 0, 0], c: '#e8dcc0', parent: 'head' },
    { n: 'hornR', s: [7, 2, 2], p: [4, 18, 12], o: [3, 0, 0], c: '#e8dcc0', parent: 'head' },
    leg('leg0', -4, -6, 8, 4, '#6a4a2a'), leg('leg1', 4, -6, 8, 4, '#6a4a2a'), leg('leg2', -4, 6, 8, 4, '#6a4a2a'), leg('leg3', 4, 6, 8, 4, '#6a4a2a'),
  ] },
  fluffer: { parts: [
    { n: 'body', s: [14, 13, 15], p: [0, 12, 0], c: '#f0f0f0', pat: 'wool' },
    { n: 'head', s: [7, 7, 5], p: [0, 13, 8], o: [0, 0, 2], c: '#3a3434', face: 'glow_eyes' },
    leg('leg0', -4, -4, 6, 3, '#3a3434'), leg('leg1', 4, -4, 6, 3, '#3a3434'), leg('leg2', -4, 4, 6, 3, '#3a3434'), leg('leg3', 4, 4, 6, 3, '#3a3434'),
  ] },
  snoutling: { parts: [
    { n: 'body', s: [10, 9, 15], p: [0, 10, 0], c: '#b8908a', pat: 'spots', c2: '#8a6460' },
    { n: 'ridge', s: [2, 3, 12], p: [0, 15, 0], c: '#5a4038' },
    { n: 'head', s: [8, 7, 6], p: [0, 11, 7], o: [0, 0, 3], c: '#c09a94', face: 'eyes' },
    { n: 'snout', s: [4, 3, 4], p: [0, 10, 13], o: [0, 0, 1], c: '#e0b0aa', parent: 'head' },
    { n: 'tuskL', s: [1, 3, 1], p: [-2.5, 9, 14], c: '#f4f0e0', parent: 'head' },
    { n: 'tuskR', s: [1, 3, 1], p: [2.5, 9, 14], c: '#f4f0e0', parent: 'head' },
    leg('leg0', -3, -5, 6, 3, '#8a6460'), leg('leg1', 3, -5, 6, 3, '#8a6460'), leg('leg2', -3, 5, 6, 3, '#8a6460'), leg('leg3', 3, 5, 6, 3, '#8a6460'),
  ] },
  cluckit: { parts: [
    { n: 'body', s: [7, 7, 8], p: [0, 7, 0], c: '#3aa0a0', pat: 'fur', c2: '#e88a3a' },
    { n: 'head', s: [5, 5, 4], p: [0, 11, 3], o: [0, 1, 1], c: '#e88a3a', face: 'beak' },
    { n: 'crest', s: [1, 5, 4], p: [0, 15, 3], o: [0, 1, 0], c: '#d83a3a', parent: 'head' },
    { n: 'wingL', s: [1, 4, 6], p: [-4, 8, 0], o: [0, 0, 0], c: '#2a8080' },
    { n: 'wingR', s: [1, 4, 6], p: [4, 8, 0], o: [0, 0, 0], c: '#2a8080' },
    leg('leg0', -2, 0, 4, 1, '#e8a02a'), leg('leg1', 2, 0, 4, 1, '#e8a02a'),
  ] },
  steed: { parts: [
    { n: 'body', s: [10, 10, 20], p: [0, 18, 0], c: '#7a4a2a', pat: 'fur', c2: '#6a3a20' },
    { n: 'neck', s: [5, 12, 6], p: [0, 22, 9], o: [0, 4, 1], c: '#7a4a2a' },
    { n: 'head', s: [6, 6, 10], p: [0, 32, 11], o: [0, 0, 3], c: '#7a4a2a', face: 'eyes', parent: 'neck' },
    { n: 'mane', s: [2, 14, 3], p: [0, 26, 7], o: [0, 2, 0], c: '#2a1a10', parent: 'neck' },
    { n: 'tail', s: [3, 10, 3], p: [0, 21, -10], o: [0, -5, -1], c: '#2a1a10' },
    { n: 'saddle', s: [11, 2, 8], p: [0, 23.5, 0], c: '#5a2a14' },
    leg('leg0', -3, -7, 13, 4, '#5a3420'), leg('leg1', 3, -7, 13, 4, '#5a3420'), leg('leg2', -3, 7, 13, 4, '#5a3420'), leg('leg3', 3, 7, 13, 4, '#5a3420'),
  ] },
  burrowkin: { parts: [
    { n: 'body', s: [6, 6, 8], p: [0, 4, 0], c: '#a89070', pat: 'fur', c2: '#c8b090' },
    { n: 'head', s: [5, 5, 5], p: [0, 7, 4], o: [0, 1, 1], c: '#a89070', face: 'eyes' },
    { n: 'earL', s: [1, 8, 2], p: [-1.5, 10, 4], o: [0, 4, 0], c: '#c8b090', parent: 'head' },
    { n: 'earR', s: [1, 8, 2], p: [1.5, 10, 4], o: [0, 4, 0], c: '#c8b090', parent: 'head' },
    { n: 'tail', s: [4, 4, 3], p: [0, 5, -4], o: [0, 0, -1], c: '#f0e8d8' },
    leg('leg0', -2, -2, 2, 2, '#8a7050'), leg('leg1', 2, -2, 2, 2, '#8a7050'),
  ] },
  finling: { parts: [
    { n: 'body', s: [3, 5, 9], p: [0, 3, 0], c: '#5a90c8', face: 'fish', pat: 'stripes', c2: '#3a70a8' },
    { n: 'tail', s: [1, 5, 3], p: [0, 3, -4.5], o: [0, 0, -1.5], c: '#e8a040' },
    { n: 'fin', s: [1, 2, 4], p: [0, 6, 0], c: '#e8a040' },
  ] },
  frostfox: { parts: [
    { n: 'body', s: [6, 6, 11], p: [0, 7, 0], c: '#f0f2f4', pat: 'fur', c2: '#d8dce0' },
    { n: 'head', s: [6, 5, 5], p: [0, 9, 6], o: [0, 0, 2], c: '#f4f6f8', face: 'eyes' },
    { n: 'nose', s: [2, 2, 3], p: [0, 8, 10], c: '#2a2a2a', parent: 'head' },
    { n: 'earL', s: [2, 3, 1], p: [-2, 12, 6], o: [0, 1, 0], c: '#f4f6f8', parent: 'head' },
    { n: 'earR', s: [2, 3, 1], p: [2, 12, 6], o: [0, 1, 0], c: '#f4f6f8', parent: 'head' },
    { n: 'tail', s: [5, 5, 10], p: [0, 8, -5], o: [0, 0, -5], c: '#ffffff' },
    leg('leg0', -2, -4, 4, 2, '#d8dce0'), leg('leg1', 2, -4, 4, 2, '#d8dce0'), leg('leg2', -2, 4, 4, 2, '#d8dce0'), leg('leg3', 2, 4, 4, 2, '#d8dce0'),
  ] },
  miretoad: { parts: [
    { n: 'body', s: [10, 6, 10], p: [0, 4, 0], c: '#5a7a3a', pat: 'spots', c2: '#8aa84a' },
    { n: 'head', s: [9, 4, 5], p: [0, 6, 4], o: [0, 0, 2], c: '#6a8a4a', face: 'eyes' },
    leg('leg0', -5, -3, 2, 3, '#4a6a2a'), leg('leg1', 5, -3, 2, 3, '#4a6a2a'), leg('leg2', -5, 3, 2, 3, '#4a6a2a'), leg('leg3', 5, 3, 2, 3, '#4a6a2a'),
  ] },
  sporeback: { parts: [
    { n: 'body', s: [12, 7, 14], p: [0, 6, 0], c: '#5a3a5a', pat: 'spots', c2: '#8a6a9a' },
    { n: 'cap1', s: [6, 3, 6], p: [-3, 11, -2], c: '#c02a2a', pat: 'spots', c2: '#f4f0e8' },
    { n: 'cap2', s: [5, 2, 5], p: [3, 10.5, 3], c: '#8a6040' },
    { n: 'head', s: [6, 5, 4], p: [0, 6, 8], o: [0, 0, 1], c: '#3a2a3a', face: 'many_eyes' },
    leg('leg0', -5, -4, 3, 2, '#2a1a2a'), leg('leg1', 5, -4, 3, 2, '#2a1a2a'), leg('leg2', -5, 4, 3, 2, '#2a1a2a'), leg('leg3', 5, 4, 3, 2, '#2a1a2a'),
  ] },
  shambler: { parts: [
    { n: 'body', s: [8, 11, 5], p: [0, 13, 0], o: [0, 5, 0], c: '#4a5a4a', pat: 'moss', c2: '#3a4a3a' },
    { n: 'head', s: [7, 7, 7], p: [0, 24, 1], o: [0, 3, 1], c: '#7a8a6a', face: 'glow_eyes', parent: 'body' },
    { n: 'armL', s: [3, 14, 3], p: [-5.5, 23, 0], o: [0, -6, 0], c: '#6a7a5a', parent: 'body' },
    { n: 'armR', s: [3, 14, 3], p: [5.5, 23, 0], o: [0, -6, 0], c: '#6a7a5a', parent: 'body' },
    leg('legL', -2, 0, 13, 3, '#3a3a34'), leg('legR', 2, 0, 13, 3, '#3a3a34'),
  ] },
  fusebloom: { parts: [
    { n: 'body', s: [10, 12, 10], p: [0, 6, 0], o: [0, 6, 0], c: '#6a8a3a', pat: 'stripes', c2: '#4a6a2a' },
    { n: 'bulb', s: [8, 6, 8], p: [0, 18, 0], o: [0, 3, 0], c: '#c84a7a', face: 'flower', glow: true },
    { n: 'petal0', s: [8, 1, 4], p: [0, 18, 4], o: [0, 0, 2], c: '#e86a9a' },
    { n: 'petal1', s: [8, 1, 4], p: [0, 18, -4], o: [0, 0, -2], c: '#e86a9a' },
    { n: 'petal2', s: [4, 1, 8], p: [4, 18, 0], o: [2, 0, 0], c: '#e86a9a' },
    { n: 'petal3', s: [4, 1, 8], p: [-4, 18, 0], o: [-2, 0, 0], c: '#e86a9a' },
    leg('leg0', -3, -3, 6, 2, '#5a4a2a'), leg('leg1', 3, -3, 6, 2, '#5a4a2a'), leg('leg2', -3, 3, 6, 2, '#5a4a2a'), leg('leg3', 3, 3, 6, 2, '#5a4a2a'),
  ] },
  rattler: { parts: [
    { n: 'body', s: [5, 13, 3], p: [0, 14, 0], o: [0, 6, 0], c: '#b8a878', pat: 'stripes', c2: '#8a7a50' },
    { n: 'head', s: [6, 8, 6], p: [0, 27, 0], o: [0, 4, 0], c: '#9a7a40', face: 'red_eyes', pat: 'cracks', c2: '#5a4a20', parent: 'body' },
    { n: 'armL', s: [2, 13, 2], p: [-3.5, 26, 0], o: [0, -6, 0], c: '#b8a878', parent: 'body' },
    { n: 'armR', s: [2, 13, 2], p: [3.5, 26, 0], o: [0, -6, 0], c: '#b8a878', parent: 'body' },
    { n: 'bow', s: [1, 12, 2], p: [3.5, 20, 3], c: '#6b4a28', parent: 'body' },
    leg('legL', -1.5, 0, 14, 2, '#8a7a50'), leg('legR', 1.5, 0, 14, 2, '#8a7a50'),
  ] },
  skitterfang: { parts: [
    { n: 'body', s: [12, 5, 12], p: [0, 6, -2], c: '#3a2a2a', pat: 'spots', c2: '#5a3a2a' },
    { n: 'head', s: [8, 6, 6], p: [0, 7, 5], o: [0, 0, 2], c: '#2a1a1a', face: 'many_eyes' },
    { n: 'pinL', s: [2, 2, 6], p: [-3, 6, 9], o: [0, 0, 3], c: '#6a3a2a', parent: 'head' },
    { n: 'pinR', s: [2, 2, 6], p: [3, 6, 9], o: [0, 0, 3], c: '#6a3a2a', parent: 'head' },
    ...[0, 1, 2].flatMap((i) => [
      { n: `legL${i}`, s: [12, 2, 2] as [number, number, number], p: [-6, 7, -4 + i * 4] as [number, number, number], o: [-6, 0, 0] as [number, number, number], c: '#2a1a1a' },
      { n: `legR${i}`, s: [12, 2, 2] as [number, number, number], p: [6, 7, -4 + i * 4] as [number, number, number], o: [6, 0, 0] as [number, number, number], c: '#2a1a1a' },
    ]),
  ] },
  brute: { scale: 1, parts: [
    { n: 'body', s: [16, 16, 10], p: [0, 16, 0], o: [0, 8, 0], c: '#6a6a72', pat: 'stone', c2: '#4a4a52' },
    { n: 'head', s: [12, 10, 10], p: [0, 32, 2], o: [0, 4, 2], c: '#5a5a62', face: 'jaw', c2: '#3a3a42', parent: 'body' },
    { n: 'armL', s: [6, 20, 6], p: [-11, 30, 0], o: [0, -9, 0], c: '#7a7a82', pat: 'stone', c2: '#4a4a52', parent: 'body' },
    { n: 'armR', s: [6, 20, 6], p: [11, 30, 0], o: [0, -9, 0], c: '#7a7a82', pat: 'stone', c2: '#4a4a52', parent: 'body' },
    leg('legL', -4, 0, 16, 6, '#4a4a52'), leg('legR', 4, 0, 16, 6, '#4a4a52'),
  ] },
  wisp: { parts: [
    { n: 'body', s: [6, 6, 6], p: [0, 6, 0], c: '#a8f0ff', face: 'eyes', glow: true },
    { n: 't0', s: [1, 5, 1], p: [-2, 3, 0], o: [0, -2.5, 0], c: '#6ac0e0', glow: true },
    { n: 't1', s: [1, 4, 1], p: [2, 3, 1], o: [0, -2, 0], c: '#6ac0e0', glow: true },
    { n: 't2', s: [1, 6, 1], p: [0, 3, -2], o: [0, -3, 0], c: '#6ac0e0', glow: true },
  ] },
  hexwarden: { parts: [
    { n: 'body', s: [10, 18, 8], p: [0, 6, 0], o: [0, 9, 0], c: '#3a2a5a', pat: 'robe', c2: '#c8a83a' },
    { n: 'head', s: [8, 8, 8], p: [0, 24, 0], o: [0, 4, 0], c: '#2a1a3a', face: 'mask', parent: 'body' },
    { n: 'rune0', s: [3, 3, 1], p: [9, 18, 0], c: '#a070ff', glow: true },
    { n: 'rune1', s: [3, 3, 1], p: [-9, 18, 0], c: '#a070ff', glow: true },
    { n: 'armL', s: [3, 12, 3], p: [-6.5, 22, 0], o: [0, -5, 0], c: '#3a2a5a', parent: 'body' },
    { n: 'armR', s: [3, 12, 3], p: [6.5, 22, 0], o: [0, -5, 0], c: '#3a2a5a', parent: 'body' },
  ] },
  cinder_imp: { parts: [
    { n: 'body', s: [6, 7, 5], p: [0, 8, 0], o: [0, 3, 0], c: '#a83a1a', pat: 'cracks', c2: '#ffb040' },
    { n: 'head', s: [6, 6, 6], p: [0, 15, 0], o: [0, 3, 0], c: '#c84a1a', face: 'glow_eyes', parent: 'body' },
    { n: 'hornL', s: [1, 3, 1], p: [-2, 21, 0], o: [0, 1, 0], c: '#2a1a10', parent: 'head' },
    { n: 'hornR', s: [1, 3, 1], p: [2, 21, 0], o: [0, 1, 0], c: '#2a1a10', parent: 'head' },
    { n: 'wingL', s: [9, 6, 1], p: [-3, 12, -3], o: [-4.5, 0, 0], c: '#5a1a10', parent: 'body' },
    { n: 'wingR', s: [9, 6, 1], p: [3, 12, -3], o: [4.5, 0, 0], c: '#5a1a10', parent: 'body' },
    { n: 'tail', s: [1, 1, 6], p: [0, 8, -3], o: [0, 0, -3], c: '#5a1a10', parent: 'body' },
  ] },
  ashen_knight: { parts: [
    { n: 'body', s: [10, 13, 6], p: [0, 14, 0], o: [0, 6, 0], c: '#3a3434', pat: 'cracks', c2: '#ff6a1a' },
    { n: 'head', s: [8, 8, 8], p: [0, 27, 0], o: [0, 4, 0], c: '#2a2424', face: 'glow_eyes', parent: 'body' },
    { n: 'armL', s: [4, 13, 4], p: [-7, 26, 0], o: [0, -6, 0], c: '#3a3434', parent: 'body' },
    { n: 'armR', s: [4, 13, 4], p: [7, 26, 0], o: [0, -6, 0], c: '#3a3434', parent: 'body' },
    { n: 'blade', s: [2, 16, 1], p: [7, 15, 4], o: [0, -2, 0], c: '#c8c8d0', parent: 'armR' },
    leg('legL', -2.5, 0, 14, 4, '#2a2424'), leg('legR', 2.5, 0, 14, 4, '#2a2424'),
  ] },
  emberling: { parts: [
    { n: 'body', s: [8, 7, 8], p: [0, 0, 0], o: [0, 3.5, 0], c: '#5a1a10', pat: 'cracks', c2: '#ffa030', face: 'glow_eyes' },
  ] },
  voidstalker: { parts: [
    { n: 'core', s: [6, 6, 6], p: [0, 18, 0], c: '#2a1040', face: 'eye', glow: true },
    { n: 's0', s: [3, 12, 3], p: [-6, 18, 0], c: '#7a4ac0', pat: 'crystal', c2: '#d0b0ff' },
    { n: 's1', s: [3, 9, 3], p: [6, 20, 1], c: '#7a4ac0', pat: 'crystal', c2: '#d0b0ff' },
    { n: 's2', s: [3, 10, 3], p: [0, 18, -6], c: '#7a4ac0', pat: 'crystal', c2: '#d0b0ff' },
    { n: 's3', s: [2, 8, 2], p: [1, 12, 5], c: '#9a6ae0', pat: 'crystal', c2: '#d0b0ff' },
  ] },
  stoneward: { parts: [
    { n: 'body', s: [14, 20, 10], p: [0, 14, 0], o: [0, 10, 0], c: '#7a7a72', pat: 'moss', c2: '#5a5a52' },
    { n: 'head', s: [8, 8, 8], p: [0, 34, 0], o: [0, 4, 0], c: '#e8c060', face: 'core', glow: true, parent: 'body' },
    { n: 'armL', s: [5, 22, 5], p: [-9.5, 32, 0], o: [0, -10, 0], c: '#6a6a62', pat: 'stone', c2: '#4a4a42', parent: 'body' },
    { n: 'armR', s: [5, 22, 5], p: [9.5, 32, 0], o: [0, -10, 0], c: '#6a6a62', pat: 'stone', c2: '#4a4a42', parent: 'body' },
    leg('legL', -3.5, 0, 14, 5, '#5a5a52'), leg('legR', 3.5, 0, 14, 5, '#5a5a52'),
  ] },
  wayfolk: { parts: [
    { n: 'body', s: [10, 12, 8], p: [0, 4, 0], o: [0, 6, 0], c: '#8a6a3a', pat: 'robe', c2: '#5a3a1a' },
    { n: 'head', s: [9, 9, 9], p: [0, 16, 0], o: [0, 4, 0], c: '#8a6a3a', face: 'hood', parent: 'body' },
    { n: 'armL', s: [3, 8, 3], p: [-6.5, 14, 0], o: [0, -3.5, 0], c: '#8a6a3a', parent: 'body' },
    { n: 'armR', s: [3, 8, 3], p: [6.5, 14, 0], o: [0, -3.5, 0], c: '#8a6a3a', parent: 'body' },
    leg('legL', -2.5, 0, 4, 3, '#4a3a2a'), leg('legR', 2.5, 0, 4, 3, '#4a3a2a'),
  ] },
  colossus: { scale: 2.2, parts: [
    { n: 'body', s: [18, 16, 12], p: [0, 14, 0], o: [0, 8, 0], c: '#3a2a26', pat: 'cracks', c2: '#ff7a1a', face: 'core' },
    { n: 'head', s: [10, 9, 9], p: [0, 30, 0], o: [0, 4, 1], c: '#2a1e1c', face: 'glow_eyes', parent: 'body' },
    { n: 'armL', s: [7, 20, 7], p: [-12.5, 28, 0], o: [0, -9, 0], c: '#4a3430', pat: 'cracks', c2: '#ff9a2a', parent: 'body' },
    { n: 'armR', s: [7, 20, 7], p: [12.5, 28, 0], o: [0, -9, 0], c: '#4a3430', pat: 'cracks', c2: '#ff9a2a', parent: 'body' },
    leg('legL', -5, 0, 14, 7, '#2a1e1c'), leg('legR', 5, 0, 14, 7, '#2a1e1c'),
  ] },
  sovereign: { scale: 2.6, parts: [
    { n: 'core', s: [10, 10, 10], p: [0, 10, 0], c: '#1a0a2a', face: 'eye', glow: true },
    ...[0, 1, 2, 3, 4, 5].map((i) => ({ n: `crown${i}`, s: [3, 10 + (i % 2) * 4, 3] as [number, number, number], p: [Math.cos(i / 6 * Math.PI * 2) * 9, 18, Math.sin(i / 6 * Math.PI * 2) * 9] as [number, number, number], c: '#8a5ad0', pat: 'crystal', c2: '#f0e0ff' })),
    ...[0, 1, 2, 3].map((i) => ({ n: `orb${i}`, s: [3, 3, 3] as [number, number, number], p: [0, 10, 0] as [number, number, number], o: [14, 0, 0] as [number, number, number], c: '#e0c8ff', glow: true })),
  ] },
};

export const MOB_TINTS: Record<string, string[]> = {
  fluffer: ['#f0f0f0', '#f0f0f0', '#f0f0f0', '#2a2a30', '#8a6a4a', '#c8c8c8'],
  steed: ['#7a4a2a', '#d8d0c0', '#3a2a20', '#a87a50'],
};
