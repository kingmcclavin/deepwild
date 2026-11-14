import * as THREE from 'three';

interface P { x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number; max: number; r: number; g: number; b: number; grav: number; size: number }

/** Pooled point particles (block debris, smoke, sparks, potion swirls). */
export class Particles {
  points: THREE.Points;
  private pool: P[] = [];
  private pos: Float32Array; private col: Float32Array; private size: Float32Array;
  constructor(public cap = 2500) {
    this.pos = new Float32Array(cap * 3); this.col = new Float32Array(cap * 3); this.size = new Float32Array(cap);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    g.setAttribute('psize', new THREE.BufferAttribute(this.size, 1));
    const m = new THREE.ShaderMaterial({
      uniforms: { scale: { value: 600 } },
      vertexShader: 'attribute float psize; attribute vec3 color; varying vec3 vC; uniform float scale; void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = psize * scale / max(0.1, -mv.z); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'varying vec3 vC; void main(){ gl_FragColor = vec4(vC, 1.0); }',
      depthWrite: true,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
  }
  limit = 1;
  setPixelScale(h: number) { (this.points.material as THREE.ShaderMaterial).uniforms.scale.value = h * 0.6; }
  spawn(x: number, y: number, z: number, c: [number, number, number], n: number, speed = 2, grav = 9, size = 0.1, life = 0.8) {
    n = Math.max(1, Math.round(n * this.limit));
    for (let i = 0; i < n; i++) {
      if (this.pool.length >= this.cap) this.pool.shift();
      const k = 0.85 + Math.random() * 0.3;
      this.pool.push({ x, y, z, vx: (Math.random() - 0.5) * speed, vy: Math.random() * speed * 0.8, vz: (Math.random() - 0.5) * speed, life: life * (0.6 + Math.random() * 0.6), max: life, r: c[0] * k, g: c[1] * k, b: c[2] * k, grav, size: size * (0.7 + Math.random() * 0.6) });
    }
  }
  update(dt: number, solid: (x: number, y: number, z: number) => boolean) {
    let j = 0;
    for (let i = 0; i < this.pool.length; i++) {
      const p = this.pool[i];
      p.life -= dt;
      if (p.life <= 0) continue;
      p.vy -= p.grav * dt;
      const nx = p.x + p.vx * dt, ny = p.y + p.vy * dt, nz = p.z + p.vz * dt;
      if (solid(Math.floor(nx), Math.floor(ny), Math.floor(nz))) { p.vx *= 0.3; p.vz *= 0.3; p.vy = 0; } else { p.x = nx; p.y = ny; p.z = nz; }
      this.pool[j++] = p;
      const o = (j - 1) * 3;
      this.pos[o] = p.x; this.pos[o + 1] = p.y; this.pos[o + 2] = p.z;
      this.col[o] = p.r; this.col[o + 1] = p.g; this.col[o + 2] = p.b;
      this.size[j - 1] = p.size * Math.min(1, p.life / p.max * 2);
    }
    this.pool.length = j;
    const g = this.points.geometry;
    g.setDrawRange(0, j);
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.psize as THREE.BufferAttribute).needsUpdate = true;
  }
  clear() { this.pool.length = 0; }
}
