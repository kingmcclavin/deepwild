import * as THREE from 'three';
import { TILE_NAMES, tileId } from '../registry/blocks';
import { buildTileArray, TS } from './textures';

export interface TerrainUniforms {
  atlas: { value: THREE.DataArrayTexture };
  daylight: { value: number };
  ambient: { value: number };
  skyTint: { value: THREE.Color };
  torchColor: { value: THREE.Color };
  fogColor: { value: THREE.Color };
  fogNear: { value: number };
  fogFar: { value: number };
  time: { value: number };
  flash: { value: number };
  aoStrength: { value: number };
}

const vert = /* glsl */ `
in vec4 attr;
out vec2 vUv;
flat out float vTile;
out vec3 vLight;
out float vFog;
uniform float daylight;
uniform float ambient;
uniform vec3 skyTint;
uniform vec3 torchColor;
uniform float flash;
uniform float aoStrength;
float curve(float l) { return pow(0.82, (1.0 - l) * 15.0); }
void main() {
  vUv = uv;
  vTile = attr.x;
  float sky = curve(attr.y) * daylight;
  float blk = curve(attr.z);
  vec3 c = max(skyTint * sky, torchColor * blk);
  c = max(c, vec3(ambient));
  c += vec3(flash) * attr.y;
  float shade = mix(1.0, attr.w, aoStrength);
  vLight = c * shade;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vFog = length(mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

const frag = /* glsl */ `
precision highp sampler2DArray;
uniform sampler2DArray atlas;
uniform vec3 fogColor;
uniform float fogNear;
uniform float fogFar;
uniform float time;
uniform float alphaCut;
uniform float opacity;
uniform float waterTile;
uniform float waterFlow;
uniform float lavaTile;
uniform float lavaFlow;
in vec2 vUv;
flat in float vTile;
in vec3 vLight;
in float vFog;
out vec4 outColor;
void main() {
  vec2 uv = vUv;
  if (vTile == waterTile || vTile == waterFlow) uv += vec2(time * 0.04, time * 0.11 * (vTile == waterFlow ? 4.0 : 1.0));
  if (vTile == lavaTile || vTile == lavaFlow) uv += vec2(sin(time * 0.3) * 0.15, time * 0.05);
  vec2 f = fract(uv);
  vec4 tex = textureGrad(atlas, vec3(f, vTile), dFdx(uv), dFdy(uv));
  if (tex.a < alphaCut) discard;
  vec3 col = tex.rgb * vLight;
  if (vTile == lavaTile || vTile == lavaFlow) col = tex.rgb;
  float fog = smoothstep(fogNear, fogFar, vFog);
  outColor = vec4(mix(col, fogColor, fog), tex.a * opacity);
}`;

export function createTerrainMaterials(mipmaps: boolean) {
  const data = buildTileArray();
  const tex = new THREE.DataArrayTexture(data, TS, TS, TILE_NAMES.length);
  tex.format = THREE.RGBAFormat;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = mipmaps ? THREE.NearestMipmapLinearFilter : THREE.NearestFilter;
  tex.generateMipmaps = mipmaps;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  const uniforms: TerrainUniforms = {
    atlas: { value: tex },
    daylight: { value: 1 },
    ambient: { value: 0.04 },
    skyTint: { value: new THREE.Color(1, 1, 1) },
    torchColor: { value: new THREE.Color(1.0, 0.86, 0.66) },
    fogColor: { value: new THREE.Color(0.7, 0.8, 0.95) },
    fogNear: { value: 60 },
    fogFar: { value: 120 },
    time: { value: 0 },
    flash: { value: 0 },
    aoStrength: { value: 1 },
  };
  const mk = (alphaCut: number, opacity: number, transparent: boolean, side: THREE.Side = THREE.FrontSide) => new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: vert,
    fragmentShader: frag,
    uniforms: {
      ...uniforms,
      alphaCut: { value: alphaCut },
      opacity: { value: opacity },
      waterTile: { value: tileId('water') },
      waterFlow: { value: tileId('water_flow') },
      lavaTile: { value: tileId('lava') },
      lavaFlow: { value: tileId('lava_flow') },
    },
    transparent,
    depthWrite: !transparent,
    side,
  });
  const opaque = mk(0.5, 1, false);
  const cutout = mk(0.5, 1, false, THREE.DoubleSide);
  const translucent = mk(0.02, 0.78, true, THREE.DoubleSide);
  // break-progress overlay
  const crack = mk(0.05, 0.85, true);
  crack.polygonOffset = true; crack.polygonOffsetFactor = -1; crack.polygonOffsetUnits = -1;
  return { opaque, cutout, translucent, crack, uniforms, texture: tex };
}

/** Light helper for entities on CPU (matches shader curve) */
export function lightLevel(sky: number, blk: number, daylight: number, ambient: number): number {
  const c = (l: number) => Math.pow(0.82, (15 - l));
  return Math.max(c(sky) * daylight, c(blk) * 0.95, ambient);
}
