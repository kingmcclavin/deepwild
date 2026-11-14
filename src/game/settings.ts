export interface Settings {
  renderDistance: number;
  simDistance: number;
  fov: number;
  sensitivity: number;
  invertY: boolean;
  headBob: boolean;
  ao: boolean;
  mipmaps: boolean;
  antialias: boolean;
  particles: 0 | 1 | 2; // all, decreased, minimal
  entityDistance: number; // percent
  fpsCap: number; // 0 = unlimited (vsync)
  clouds: boolean;
  shadows: boolean; // entity drop shadows
  guiScale: number;
  pixelRatio: number; // render scale
  master: number; music: number; sfx: number; ambient: number; muted: boolean;
  keys: Record<string, string>;
  showFps: boolean;
}
export const DEFAULT_KEYS: Record<string, string> = {
  forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', jump: 'Space', sprint: 'ShiftLeft', sneak: 'ControlLeft',
  inventory: 'KeyE', drop: 'KeyQ', swap: 'KeyF', debug: 'F3', fullscreen: 'F11', wandFill: 'KeyG', wandClear: 'KeyH', mode: 'F4',
};
export const KEY_LABELS: Record<string, string> = {
  forward: 'Move forward', back: 'Move back', left: 'Strafe left', right: 'Strafe right', jump: 'Jump / swim up / fly up', sprint: 'Sprint', sneak: 'Crouch / fly down',
  inventory: 'Inventory', drop: 'Drop item', swap: 'Swap offhand', debug: 'Debug overlay', fullscreen: 'Fullscreen', wandFill: "Builder's Wand: fill", wandClear: "Builder's Wand: clear", mode: 'Switch game mode',
};
export const DEFAULT_SETTINGS: Settings = {
  renderDistance: 8, simDistance: 6, fov: 75, sensitivity: 1, invertY: false, headBob: true, ao: true, mipmaps: true, antialias: false,
  particles: 0, entityDistance: 100, fpsCap: 0, clouds: true, shadows: true, guiScale: 1, pixelRatio: 1,
  master: 0.8, music: 0.4, sfx: 0.8, ambient: 0.6, muted: false, keys: { ...DEFAULT_KEYS }, showFps: false,
};
const KEY = 'deepwild-settings';
export function loadSettings(): Settings {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (s && typeof s === 'object') return { ...DEFAULT_SETTINGS, ...s, keys: { ...DEFAULT_KEYS, ...(s.keys ?? {}) } };
  } catch { /* ignore */ }
  return { ...DEFAULT_SETTINGS, keys: { ...DEFAULT_KEYS } };
}
export function saveSettings(s: Settings) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ } }
export function keyName(code: string) {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return ({ Space: 'Space', ShiftLeft: 'Left Shift', ShiftRight: 'Right Shift', ControlLeft: 'Left Ctrl', ControlRight: 'Right Ctrl', AltLeft: 'Left Alt', Tab: 'Tab', Escape: 'Esc' } as Record<string, string>)[code] ?? code;
}
