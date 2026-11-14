import { useEffect, useRef } from 'react';
import { useUI } from './store';
import { gameRef } from './gameRef';
import { Game } from '../game/Game';
import { Hud } from './Hud';
import { InventoryScreen } from './Inventory';
import { TitleScreen, WorldsScreen, CreateScreen, SettingsScreen, PauseScreen, DeathScreen, LoadingScreen, CreditsScreen, SignEditor } from './Menus';
import { audio } from '../game/audio/audio';
import { getWorld, type WorldMeta } from '../game/save/db';

export function App() {
  const screen = useUI((s) => s.screen);
  const set = useUI((s) => s.set);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const settings = useUI((s) => s.settings);
  const err = useUI((s) => s.error);

  const lock = () => {
    const c = canvasRef.current;
    if (!c || document.pointerLockElement === c) return;
    try {
      const r = c.requestPointerLock() as unknown as Promise<void> | undefined;
      r?.catch?.(() => {});
    } catch { /* not available: click again */ }
  };

  const launch = async (meta: WorldMeta) => {
    audio.init();
    try {
      const fresh = (await getWorld(meta.id)) ?? meta;
      Object.assign(fresh, { kit: (meta as WorldMeta & { kit?: string }).kit });
      let g = gameRef.current;
      if (!g || g.settings.antialias !== settings.antialias) {
        g?.dispose();
        g = new Game(canvasRef.current!, useUI.getState().settings);
        gameRef.current = g;
      } else g.applySettings(useUI.getState().settings);
      await g.start(fresh);
      lock();
    } catch (e) {
      console.error(e);
      set({ screen: 'worlds', error: `This world could not be opened: ${(e as Error).message}` });
    }
  };
  const quit = async () => {
    const g = gameRef.current;
    set({ screen: 'loading', loadingText: 'Saving world…' });
    if (g) await g.exit();
    set({ screen: 'worlds' });
  };
  const resume = () => { set({ screen: 'playing' }); lock(); };

  // keep the game informed about pause state
  useEffect(() => {
    const g = gameRef.current;
    if (!g) return;
    g.paused = !(screen === 'playing' || screen === 'inventory' || screen === 'dead' || screen === 'sign');
    if (screen !== 'playing') { g.keys.clear(); g.mouse = [false, false, false]; g.interact?.mouseUp(0); g.interact?.mouseUp(2); }
  }, [screen]);

  // input
  useEffect(() => {
    const keyDown = (e: KeyboardEvent) => {
      const g = gameRef.current;
      const st = useUI.getState();
      const k = st.settings.keys;
      if (e.code === k.fullscreen) { e.preventDefault(); if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().then(lock).catch(() => {}); return; }
      if (!g || !g.running) return;
      if (st.screen === 'inventory') {
        if (e.code === k.inventory || e.code === 'Escape') { e.preventDefault(); set({ screen: 'playing' }); lock(); }
        return;
      }
      if (st.screen === 'paused' && e.code === 'Escape') { resume(); return; }
      if (st.screen !== 'playing') return;
      if (['Space', 'Tab', 'F3', 'F4', 'F11', 'Quote', 'Slash'].includes(e.code) || e.ctrlKey) e.preventDefault();
      if (e.repeat && e.code !== k.drop) { g.keys.add(e.code); return; }
      g.keys.add(e.code);
      const p = g.player;
      if (e.code === k.jump) g.interact.jumpPressed();
      if (/^Digit[1-9]$/.test(e.code)) { p.inv.selected = Number(e.code.slice(5)) - 1; p.inv.changed(); }
      if (e.code === k.inventory) { if (p.dead) return; g.openPanel(p.creative ? 'creative' : 'player', null); }
      if (e.code === k.drop) g.interact.dropHeld(e.ctrlKey);
      if (e.code === k.swap) g.interact.swapOffhand();
      if (e.code === k.debug) g.debug = !g.debug;
      if (e.code === k.wandFill) g.interact.wand(true);
      if (e.code === k.wandClear) g.interact.wand(false);
      if (e.code === k.mode && g.meta.rules.allowModeSwitch) g.setMode(p.creative ? 'survival' : 'creative');
      if (e.code === 'Escape') { if (document.pointerLockElement) document.exitPointerLock(); set({ screen: 'paused' }); }
    };
    const keyUp = (e: KeyboardEvent) => { gameRef.current?.keys.delete(e.code); };
    const mouseMove = (e: MouseEvent) => {
      const g = gameRef.current;
      if (!g || useUI.getState().screen !== 'playing' || document.pointerLockElement !== canvasRef.current) return;
      const s = useUI.getState().settings;
      const sens = 0.0024 * s.sensitivity;
      const p = g.player;
      p.yaw -= e.movementX * sens;
      p.pitch -= e.movementY * sens * (s.invertY ? -1 : 1);
      p.pitch = Math.max(-1.57, Math.min(1.57, p.pitch));
    };
    const mouseDown = (e: MouseEvent) => {
      const g = gameRef.current;
      if (!g || useUI.getState().screen !== 'playing') return;
      if (document.pointerLockElement !== canvasRef.current) { lock(); return; }
      e.preventDefault();
      g.mouse[e.button] = true;
      g.interact.mouseDown(e.button);
    };
    const mouseUp = (e: MouseEvent) => { const g = gameRef.current; if (!g) return; g.mouse[e.button] = false; g.interact?.mouseUp(e.button); };
    const wheel = (e: WheelEvent) => {
      const g = gameRef.current;
      if (!g || useUI.getState().screen !== 'playing') return;
      const inv = g.player.inv;
      inv.selected = (inv.selected + (e.deltaY > 0 ? 1 : -1) + 9) % 9;
      inv.changed();
    };
    const plc = () => {
      const st = useUI.getState();
      if (!document.pointerLockElement && st.screen === 'playing' && gameRef.current?.running) set({ screen: 'paused' });
    };
    const blur = () => { const g = gameRef.current; if (g) { g.keys.clear(); g.mouse = [false, false, false]; } };
    const unload = () => { gameRef.current?.saveAll(); };
    window.addEventListener('keydown', keyDown);
    window.addEventListener('keyup', keyUp);
    window.addEventListener('mousemove', mouseMove);
    window.addEventListener('mousedown', mouseDown);
    window.addEventListener('mouseup', mouseUp);
    window.addEventListener('wheel', wheel, { passive: true });
    window.addEventListener('blur', blur);
    window.addEventListener('pagehide', unload);
    document.addEventListener('pointerlockchange', plc);
    const ctx = (e: Event) => e.preventDefault();
    window.addEventListener('contextmenu', ctx);
    return () => {
      window.removeEventListener('keydown', keyDown); window.removeEventListener('keyup', keyUp); window.removeEventListener('mousemove', mouseMove);
      window.removeEventListener('mousedown', mouseDown); window.removeEventListener('mouseup', mouseUp); window.removeEventListener('wheel', wheel);
      window.removeEventListener('blur', blur); window.removeEventListener('pagehide', unload); document.removeEventListener('pointerlockchange', plc); window.removeEventListener('contextmenu', ctx);
    };
  }, []);

  useEffect(() => { if (err) { useUI.getState().toast(err, 'warn'); set({ error: null }); } }, [err]);

  const inGame = gameRef.current?.running && ['playing', 'paused', 'inventory', 'dead', 'sign', 'settings', 'credits', 'loading'].includes(screen) && useUI.getState().prevScreen !== 'title';
  const showGameUi = gameRef.current?.running && ['playing', 'paused', 'inventory', 'dead', 'sign'].includes(screen);
  return (
    <>
      <canvas ref={canvasRef} className="game" tabIndex={0} style={{ visibility: inGame || showGameUi ? 'visible' : 'hidden' }} />
      {showGameUi && <Hud playing={screen === 'playing'} />}
      {screen === 'playing' && showGameUi && !document.pointerLockElement && <div className="hud"><div className="click-hint">Click to look around</div></div>}
      {screen === 'title' && <TitleScreen onPlay={() => set({ screen: 'worlds' })} />}
      {screen === 'worlds' && <WorldsScreen onLaunch={launch} />}
      {screen === 'create' && <CreateScreen onLaunch={launch} />}
      {screen === 'settings' && <SettingsScreen />}
      {screen === 'loading' && <LoadingScreen />}
      {screen === 'paused' && <PauseScreen onResume={resume} onQuit={quit} />}
      {screen === 'dead' && <DeathScreen onRespawn={async () => { await gameRef.current?.respawn(); lock(); }} onQuit={quit} />}
      {screen === 'inventory' && <InventoryScreen />}
      {screen === 'sign' && <SignEditor onDone={() => { set({ screen: 'playing' }); lock(); }} />}
      {screen === 'credits' && <CreditsScreen onDone={() => { const prev = useUI.getState().prevScreen; if (gameRef.current?.running && prev !== 'title') resume(); else set({ screen: 'title' }); }} />}
    </>
  );
}
