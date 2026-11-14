import { create } from 'zustand';
import type { ItemStack } from '../game/registry/items';
import type { WorldMeta } from '../game/save/db';
import { loadSettings, saveSettings, type Settings } from '../game/settings';

export type Screen = 'title' | 'worlds' | 'create' | 'settings' | 'loading' | 'playing' | 'paused' | 'dead' | 'inventory' | 'sign' | 'credits';
export type Panel = 'player' | 'crafting' | 'furnace' | 'chest' | 'dispenser' | 'hopper' | 'brewing' | 'enchant' | 'anvil' | 'trade' | 'creative';

export interface HudState {
  hp: number; maxHp: number; absorption: number; hunger: number; armor: number; air: number; underwater: boolean;
  level: number; xpFrac: number; selected: number; hotbar: (ItemStack | null)[]; offhand: ItemStack | null;
  effects: { key: string; t: number; amp: number }[];
  boss: { name: string; frac: number; shield: boolean } | null;
  creative: boolean; hurtFlash: number; fire: boolean; portal: number;
  debug: string; fps: number; targetName: string; riding: string; sleeping: boolean;
  biome: string; dim: number; useProgress: number;
}
export interface Toast { id: number; text: string; tone: 'info' | 'warn' | 'good'; at: number }

interface UIState {
  screen: Screen;
  prevScreen: Screen;
  panel: Panel;
  panelPos: [number, number, number] | null;
  tradeMob: number | null;
  hud: HudState;
  toasts: Toast[];
  invVersion: number;
  worldMeta: WorldMeta | null;
  loadingText: string;
  deathMsg: string;
  settings: Settings;
  error: string | null;
  set: (p: Partial<UIState>) => void;
  setHud: (h: Partial<HudState>) => void;
  toast: (text: string, tone?: Toast['tone']) => void;
  updateSettings: (p: Partial<Settings>) => void;
}
let tid = 1;
export const useUI = create<UIState>((set, get) => ({
  screen: 'title', prevScreen: 'title', panel: 'player', panelPos: null, tradeMob: null,
  hud: { hp: 20, maxHp: 20, absorption: 0, hunger: 20, armor: 0, air: 15, underwater: false, level: 0, xpFrac: 0, selected: 0, hotbar: [], offhand: null, effects: [], boss: null, creative: false, hurtFlash: 0, fire: false, portal: 0, debug: '', fps: 0, targetName: '', riding: '', sleeping: false, biome: '', dim: 0, useProgress: 0 },
  toasts: [], invVersion: 0, worldMeta: null, loadingText: '', deathMsg: '', settings: loadSettings(), error: null,
  set: (p) => set(p),
  setHud: (h) => set({ hud: { ...get().hud, ...h } }),
  toast: (text, tone = 'info') => {
    const t = { id: tid++, text, tone, at: Date.now() };
    set({ toasts: [...get().toasts.slice(-4), t] });
    setTimeout(() => set({ toasts: get().toasts.filter((x) => x.id !== t.id) }), 5000);
  },
  updateSettings: (p) => { const s = { ...get().settings, ...p }; saveSettings(s); set({ settings: s }); },
}));
