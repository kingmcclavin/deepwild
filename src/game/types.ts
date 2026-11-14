import type * as THREE from 'three';
import type { World } from './world/World';
import type { ItemStack } from './registry/items';
import type { Dim } from './constants';
import type { GameRules } from './save/db';

/** The subset of the game that entities and systems are allowed to touch. */
export interface GameCtx {
  world: World;
  dim: Dim;
  scene: THREE.Scene;
  difficulty: number;
  rules: GameRules;
  creative: boolean;
  time: number; // 0..1 day fraction
  daylight: number;
  tickCount: number;
  player: PlayerLike;
  spawnItem(x: number, y: number, z: number, s: ItemStack, vx?: number, vy?: number, vz?: number, delay?: number): void;
  spawnXP(x: number, y: number, z: number, amount: number): void;
  explode(x: number, y: number, z: number, power: number, fire: boolean, sourceIsPlayer?: boolean): void;
  particles(x: number, y: number, z: number, color: [number, number, number], n: number, speed?: number, gravity?: number, size?: number): void;
  blockParticles(x: number, y: number, z: number, id: number, n?: number): void;
  message(text: string, tone?: 'info' | 'warn' | 'good'): void;
  setBoss(name: string | null, frac?: number, shield?: boolean): void;
  onBossDefeated(key: string, x: number, y: number, z: number): void;
  lightAt(x: number, y: number, z: number): number;
  breakBlock(x: number, y: number, z: number, dropItems: boolean, tool?: ItemStack | null): void;
}
export interface PlayerLike {
  x: number; y: number; z: number; yaw: number; pitch: number;
  hw: number; h: number;
  dead: boolean;
  creative: boolean;
  eyeY(): number;
  hurt(amount: number, source: { kind: string; x?: number; y?: number; z?: number; attacker?: unknown }): boolean;
  knock(dx: number, dz: number, strength: number): void;
  addEffect(key: string, seconds: number, amp: number): void;
  setFire(seconds: number): void;
  sleeping: boolean;
}
