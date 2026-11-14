import * as THREE from 'three';
import { Dim } from '../constants';
import { mulberry } from '../world/noise';

/** Sky dome, sun/moon, stars, block clouds and precipitation. */
export class Sky {
  group = new THREE.Group();
  private dome: THREE.Mesh;
  private domeMat: THREE.ShaderMaterial;
  private sun: THREE.Mesh;
  private moon: THREE.Mesh;
  private stars: THREE.Points;
  private clouds: THREE.Mesh;
  private cloudTex: THREE.CanvasTexture;
  private rain: THREE.LineSegments;
  private snow: THREE.Points;
  private rainPos: Float32Array;
  private snowPos: Float32Array;
  readonly skyColor = new THREE.Color();
  readonly fogColor = new THREE.Color();

  constructor() {
    this.domeMat = new THREE.ShaderMaterial({
      uniforms: { top: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, glow: { value: new THREE.Color() }, sunDir: { value: new THREE.Vector3() } },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 glow; uniform vec3 sunDir; varying vec3 vDir;
        void main(){ float h = clamp(vDir.y * 1.6 + 0.15, 0.0, 1.0); vec3 c = mix(horizon, top, h);
        float s = max(0.0, dot(normalize(vDir), normalize(sunDir))); c += glow * pow(s, 6.0) * (1.0 - h) * 0.9;
        gl_FragColor = vec4(c, 1.0); }`,
      side: THREE.BackSide, depthWrite: false, fog: false, depthTest: false,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(170, 24, 12), this.domeMat);
    this.dome.renderOrder = -10;
    this.group.add(this.dome);

    const disc = (inner: string, outer: string, size: number, craters: boolean) => {
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const g = c.getContext('2d')!;
      const gr = g.createRadialGradient(32, 32, 6, 32, 32, 32);
      gr.addColorStop(0, inner); gr.addColorStop(0.42, inner); gr.addColorStop(0.5, outer); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
      if (craters) { g.fillStyle = 'rgba(120,130,160,0.5)'; for (const [x, y, r] of [[26, 26, 4], [38, 34, 3], [30, 40, 2]]) { g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); } }
      const t = new THREE.CanvasTexture(c);
      return new THREE.Mesh(new THREE.PlaneGeometry(size * 0.5, size * 0.5), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
    };
    this.sun = disc('#fff6da', 'rgba(255,190,110,0.45)', 70, false);
    this.moon = disc('#e4ebf6', 'rgba(150,170,220,0.25)', 44, true);
    this.group.add(this.sun, this.moon);

    const sp = new Float32Array(1500 * 3);
    const r = mulberry(5);
    for (let i = 0; i < 1500; i++) {
      const u = r() * 2 - 1, th = r() * Math.PI * 2, s = Math.sqrt(1 - u * u);
      sp[i * 3] = s * Math.cos(th) * 160; sp[i * 3 + 1] = Math.abs(u) * 160; sp[i * 3 + 2] = s * Math.sin(th) * 160;
    }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    this.group.add(this.stars);

    // clouds: blocky pattern on a big plane, drifting
    const cc = document.createElement('canvas'); cc.width = cc.height = 128;
    const cg = cc.getContext('2d')!;
    const cr = mulberry(11);
    for (let i = 0; i < 60; i++) {
      const x = Math.floor(cr() * 128), y = Math.floor(cr() * 128), w = 4 + Math.floor(cr() * 14), h = 3 + Math.floor(cr() * 8);
      cg.fillStyle = 'rgba(255,255,255,0.92)';
      for (let dx = 0; dx < w; dx++) for (let dy = 0; dy < h; dy++) cg.fillRect((x + dx) % 128, (y + dy) % 128, 1, 1);
    }
    this.cloudTex = new THREE.CanvasTexture(cc);
    this.cloudTex.magFilter = THREE.NearestFilter; this.cloudTex.wrapS = this.cloudTex.wrapT = THREE.RepeatWrapping;
    this.cloudTex.repeat.set(6, 6);
    this.clouds = new THREE.Mesh(new THREE.PlaneGeometry(1536, 1536), new THREE.MeshBasicMaterial({ map: this.cloudTex, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide, fog: true }));
    this.clouds.rotation.x = -Math.PI / 2;
    this.group.add(this.clouds);

    // precipitation
    const N = 2400;
    this.rainPos = new Float32Array(N * 6);
    const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3));
    this.rain = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0x9fb4d8, transparent: true, opacity: 0.55, fog: true }));
    this.rain.frustumCulled = false;
    this.snowPos = new Float32Array(N * 3);
    const sng = new THREE.BufferGeometry(); sng.setAttribute('position', new THREE.BufferAttribute(this.snowPos, 3));
    this.snow = new THREE.Points(sng, new THREE.PointsMaterial({ color: 0xffffff, size: 0.18, transparent: true, opacity: 0.9 }));
    this.snow.frustumCulled = false;
    for (let i = 0; i < N; i++) { this.snowPos[i * 3] = (r() - 0.5) * 40; this.snowPos[i * 3 + 1] = r() * 30; this.snowPos[i * 3 + 2] = (r() - 0.5) * 40; }
    for (let i = 0; i < N; i++) { const x = (r() - 0.5) * 40, y = r() * 30, z = (r() - 0.5) * 40; this.rainPos.set([x, y, z, x, y - 0.7, z], i * 6); }
    this.group.add(this.rain, this.snow);
  }

  /**
   * time: 0..1 (0 = sunrise, 0.25 noon, 0.5 sunset, 0.75 midnight)
   * returns daylight factor 0..1
   */
  update(cam: THREE.Camera, time: number, dim: Dim, rain: number, thunder: boolean, snowy: boolean, groundY: (x: number, z: number) => number, dt: number, biomeSky: [number, number, number], biomeFog: [number, number, number]): number {
    const p = cam.position;
    this.group.position.set(0, 0, 0);
    this.dome.position.copy(p);
    this.stars.position.copy(p);
    const ang = time * Math.PI * 2;
    const sunDir = new THREE.Vector3(Math.cos(ang), Math.sin(ang), 0.18).normalize();
    let daylight = THREE.MathUtils.smoothstep(sunDir.y, -0.18, 0.22);
    daylight *= 1 - rain * 0.45;
    const top = new THREE.Color(), horizon = new THREE.Color(), glow = new THREE.Color();
    if (dim === Dim.Ember) {
      top.setRGB(0.18, 0.04, 0.03); horizon.setRGB(0.38, 0.09, 0.05); glow.setRGB(0, 0, 0);
      this.fogColor.setRGB(0.32, 0.08, 0.05);
      daylight = 0;
    } else if (dim === Dim.Void) {
      top.setRGB(0.03, 0.01, 0.06); horizon.setRGB(0.14, 0.06, 0.2); glow.setRGB(0.2, 0.1, 0.3);
      this.fogColor.setRGB(0.1, 0.05, 0.15);
      daylight = 0.35;
    } else {
      const dayTop = new THREE.Color(...biomeSky), dayHor = new THREE.Color(...biomeFog);
      const nightTop = new THREE.Color(0.01, 0.015, 0.05), nightHor = new THREE.Color(0.04, 0.05, 0.1);
      top.copy(nightTop).lerp(dayTop, daylight);
      horizon.copy(nightHor).lerp(dayHor, daylight);
      const dusk = Math.max(0, 1 - Math.abs(sunDir.y) / 0.3);
      glow.setRGB(1.0, 0.45, 0.2).multiplyScalar(dusk);
      horizon.lerp(new THREE.Color(0.95, 0.55, 0.35), dusk * 0.45);
      const grey = new THREE.Color(0.45, 0.48, 0.52).multiplyScalar(0.25 + daylight * 0.75);
      top.lerp(grey, rain * 0.8); horizon.lerp(grey, rain * 0.8);
      this.fogColor.copy(horizon);
    }
    (this.domeMat.uniforms.top.value as THREE.Color).copy(top);
    (this.domeMat.uniforms.horizon.value as THREE.Color).copy(horizon);
    (this.domeMat.uniforms.glow.value as THREE.Color).copy(glow);
    (this.domeMat.uniforms.sunDir.value as THREE.Vector3).copy(sunDir);
    this.skyColor.copy(horizon);
    const showCelestial = dim === Dim.Overworld;
    this.sun.visible = this.moon.visible = showCelestial;
    this.sun.position.copy(p).addScaledVector(sunDir, 150); this.sun.lookAt(p);
    this.moon.position.copy(p).addScaledVector(sunDir, -150); this.moon.lookAt(p);
    (this.sun.material as THREE.MeshBasicMaterial).opacity = 1 - rain * 0.8;
    (this.moon.material as THREE.MeshBasicMaterial).opacity = 1 - rain * 0.8;
    const starOp = dim === Dim.Void ? 0.9 : showCelestial ? Math.max(0, 1 - daylight * 2.5) * (1 - rain) : 0;
    (this.stars.material as THREE.PointsMaterial).opacity = starOp;
    this.stars.visible = starOp > 0.01;
    this.stars.rotation.z = ang;
    // clouds
    this.clouds.visible = dim === Dim.Overworld;
    this.clouds.position.set(Math.round(p.x / 256) * 256, 150, Math.round(p.z / 256) * 256);
    this.cloudTex.offset.x += dt * 0.0006;
    const cm = this.clouds.material as THREE.MeshBasicMaterial;
    cm.color.setScalar(0.35 + daylight * 0.65).lerp(new THREE.Color(0.55, 0.55, 0.6), rain * 0.6);
    cm.opacity = 0.6 + rain * 0.25;
    // precipitation
    const precip = dim === Dim.Overworld ? rain : 0;
    this.rain.visible = precip > 0.05 && !snowy;
    this.snow.visible = precip > 0.05 && snowy;
    if (this.rain.visible) {
      const n = Math.floor((this.rainPos.length / 6) * precip);
      for (let i = 0; i < n; i++) {
        const o = i * 6;
        let x = this.rainPos[o], y = this.rainPos[o + 1], z = this.rainPos[o + 2];
        y -= dt * 22;
        const wx = p.x + x, wz = p.z + z;
        if (y + p.y < groundY(Math.floor(wx), Math.floor(wz)) || y < -12) { y = 18 + Math.random() * 8; x = (Math.random() - 0.5) * 40; z = (Math.random() - 0.5) * 40; }
        this.rainPos[o] = x; this.rainPos[o + 1] = y; this.rainPos[o + 2] = z;
        this.rainPos[o + 3] = x; this.rainPos[o + 4] = y - 0.7; this.rainPos[o + 5] = z;
      }
      this.rain.geometry.setDrawRange(0, n * 2);
      this.rain.position.set(p.x, p.y, p.z);
      this.rain.geometry.attributes.position.needsUpdate = true;
    }
    if (this.snow.visible) {
      const n = Math.floor((this.snowPos.length / 3) * precip);
      for (let i = 0; i < n; i++) {
        const o = i * 3;
        this.snowPos[o + 1] -= dt * 2.2;
        this.snowPos[o] += Math.sin(this.snowPos[o + 1] + i) * dt * 0.4;
        const wx = p.x + this.snowPos[o], wz = p.z + this.snowPos[o + 2];
        if (this.snowPos[o + 1] + p.y < groundY(Math.floor(wx), Math.floor(wz)) || this.snowPos[o + 1] < -12) { this.snowPos[o + 1] = 18; this.snowPos[o] = (Math.random() - 0.5) * 40; this.snowPos[o + 2] = (Math.random() - 0.5) * 40; }
      }
      this.snow.geometry.setDrawRange(0, n);
      this.snow.position.set(p.x, p.y, p.z);
      this.snow.geometry.attributes.position.needsUpdate = true;
    }
    void thunder;
    return daylight;
  }
}
