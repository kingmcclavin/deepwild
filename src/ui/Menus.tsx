import { useEffect, useRef, useState } from 'react';
import { useUI } from './store';
import { gameRef } from './gameRef';
import { listWorlds, putWorld, deleteWorld, duplicateWorld, exportWorld, importWorld, newId, DEFAULT_RULES, type WorldMeta, type GameRules } from '../game/save/db';
import { DEFAULT_KEYS, KEY_LABELS, keyName, type Settings } from '../game/settings';
import { tileCanvas } from '../game/gfx/textures';
import { tileId } from '../game/registry/blocks';
import { hash32, Simplex } from '../game/world/noise';
import { audio } from '../game/audio/audio';

/* ---------------- animated voxel backdrop (title + world screens) ---------------- */
export function Backdrop() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const g = c.getContext('2d')!;
    const T = 16;
    const tiles: Record<string, HTMLCanvasElement> = {};
    for (const n of ['grass_side', 'dirt', 'stone', 'coal_ore', 'iron_ore', 'log_oak', 'leaves_oak', 'water', 'sand', 'darkstone', 'diamond_ore', 'lava', 'gold_ore', 'pulsite_ore']) tiles[n] = tileCanvas(tileId(n));
    const noise = new Simplex(7);
    let raf = 0, t = 0;
    const draw = () => {
      const scale = Math.max(3, Math.ceil(window.innerHeight / 180));
      const W = Math.ceil(window.innerWidth / scale), H = Math.ceil(window.innerHeight / scale);
      if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
      g.imageSmoothingEnabled = false;
      const sky = g.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, '#2b4f84'); sky.addColorStop(0.55, '#e59a62'); sky.addColorStop(1, '#3a2418');
      g.fillStyle = sky; g.fillRect(0, 0, W, H);
      // sun
      g.fillStyle = '#ffe4a8'; g.fillRect(W * 0.72, H * 0.18, 18, 18);
      const off = t * 6;
      const cols = Math.ceil(W / T) + 2;
      const rows = Math.ceil(H / T) + 1;
      const startCol = Math.floor(off / T);
      for (let i = 0; i < cols; i++) {
        const wx = startCol + i;
        const h = Math.floor(rows * 0.42 + noise.n2(wx / 18, 0.5) * 4 + noise.n2(wx / 6, 3.1) * 1.5);
        const x = i * T - (off % T);
        for (let r = 0; r < rows; r++) {
          const y = r * T;
          let tile: string | null = null;
          const depth = r - h;
          if (depth === 0) tile = 'grass_side';
          else if (depth > 0 && depth < 3) tile = 'dirt';
          else if (depth >= 3) {
            const hh = hash32(wx, r, 5) % 100;
            tile = depth > 9 && hh < 4 ? 'diamond_ore' : hh < 7 ? 'coal_ore' : hh < 10 ? 'iron_ore' : depth > 7 && hh < 12 ? 'gold_ore' : depth > 8 && hh < 14 ? 'pulsite_ore' : depth > 6 ? 'darkstone' : 'stone';
            // a cave pocket
            if (noise.n2(wx / 7, r / 5) > 0.55) tile = depth > 8 && noise.n2(wx / 7, r / 5) > 0.7 ? 'lava' : null;
          } else if (depth < 0 && depth > -6 && hash32(wx, 99) % 9 === 0) tile = depth > -4 ? 'log_oak' : 'leaves_oak';
          else if (depth < 0 && depth >= -7 && hash32(wx - 1, 99) % 9 === 0 && depth <= -4) tile = 'leaves_oak';
          else if (depth < 0 && depth >= -7 && hash32(wx + 1, 99) % 9 === 0 && depth <= -4) tile = 'leaves_oak';
          if (tile) {
            g.drawImage(tiles[tile], x, y, T, T);
            if (depth > 0) { g.fillStyle = `rgba(0,0,0,${Math.min(0.75, depth * 0.06)})`; g.fillRect(x, y, T, T); }
          } else if (depth > 0) { g.fillStyle = 'rgba(8,8,12,0.92)'; g.fillRect(x, y, T, T); }
        }
      }
      g.fillStyle = 'rgba(10,10,16,0.25)'; g.fillRect(0, 0, W, H);
      t += 1 / 60;
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, []);
  return <canvas ref={ref} className="backdrop" />;
}

export function TitleScreen({ onPlay }: { onPlay: () => void }) {
  const set = useUI((s) => s.set);
  return (
    <div className="screen">
      <Backdrop />
      <div className="title-wrap">
        <h1 className="logo">DEEP<b>WILD</b></h1>
        <div className="tagline">Dig deep. Build wild.</div>
        <div className="menu-col">
          <button className="btn primary" onClick={() => { audio.init(); audio.ui(); onPlay(); }}>Play</button>
          <div className="menu-row">
            <button className="btn" onClick={() => { audio.init(); audio.ui(); set({ screen: 'settings', prevScreen: 'title' }); }}>Settings</button>
            <button className="btn" onClick={() => { audio.init(); set({ screen: 'credits', prevScreen: 'title' }); }}>About</button>
          </div>
        </div>
      </div>
      <div className="footer"><span>Single-player · keyboard and mouse</span><span>Worlds are saved in this browser</span></div>
    </div>
  );
}

const DIFF = ['Peaceful', 'Easy', 'Normal', 'Hard'];
export function WorldsScreen({ onLaunch }: { onLaunch: (m: WorldMeta) => void }) {
  const set = useUI((s) => s.set);
  const toast = useUI((s) => s.toast);
  const [worlds, setWorlds] = useState<WorldMeta[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const [importing, setImporting] = useState(false);
  const [pasted, setPasted] = useState('');
  const [busy, setBusy] = useState(false);
  const refresh = () => listWorlds().then((w) => { setWorlds(w); if (!sel && w[0]) setSel(w[0].id); }).catch((e) => { setWorlds([]); toast('Could not open saved worlds: ' + (e as Error).message, 'warn'); });
  useEffect(() => { refresh(); }, []);
  const cur = worlds?.find((w) => w.id === sel) ?? null;
  const doImport = async (text: string) => {
    setBusy(true);
    try { const m = await importWorld(text); toast(`Imported "${m.name}".`, 'good'); setImporting(false); setPasted(''); setSel(m.id); await refresh(); }
    catch (e) { toast((e as Error).message, 'warn'); }
    setBusy(false);
  };
  return (
    <div className="screen">
      <Backdrop />
      <div className="panel sheet" style={{ position: 'relative', zIndex: 2 }}>
        <h2 className="h">Select a world</h2>
        <div className="scroll inset world-list">
          {worlds === null && <div className="note">Opening saves…</div>}
          {worlds?.length === 0 && <div className="note" style={{ padding: 20 }}>No worlds yet. Create one to begin; it will be saved in this browser.</div>}
          {worlds?.map((w) => (
            <div key={w.id} className={`world${w.id === sel ? ' sel' : ''}`} onClick={() => { setSel(w.id); setConfirmDel(false); }} onDoubleClick={() => onLaunch(w)}>
              <WorldThumb seed={w.seed} />
              <div>
                <div className="nm">{w.name}</div>
                <div className="meta">Last played {new Date(w.lastPlayed).toLocaleString()} · seed {w.seed}</div>
              </div>
              <div className="row" style={{ gap: 6 }}>
                <span className={`chip ${w.mode === 'creative' ? 'c' : 's'}`}>{w.mode}</span>
                <span className={`chip${w.difficulty === 3 ? ' h' : ''}`}>{DIFF[w.difficulty]}</span>
              </div>
            </div>
          ))}
        </div>
        {importing && (
          <div className="inset" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="label">Import a world</div>
            <input type="file" accept=".json,application/json" onChange={(e) => { const f = e.target.files?.[0]; if (f) f.text().then(doImport); }} />
            <textarea className="text-in" style={{ minHeight: 80 }} placeholder="…or paste exported world text here" value={pasted} onChange={(e) => setPasted(e.target.value)} />
            <div className="btn-bar"><button className="btn small" onClick={() => setImporting(false)}>Cancel</button><button className="btn small primary" disabled={!pasted || busy} onClick={() => doImport(pasted)}>Import pasted text</button></div>
          </div>
        )}
        <div className="btn-bar" style={{ justifyContent: 'space-between' }}>
          <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
            <button className="btn small" disabled={!cur || busy} onClick={async () => { if (!cur) return; setBusy(true); const m = await duplicateWorld(cur.id, `${cur.name} (copy)`).catch((e) => { toast((e as Error).message, 'warn'); return null; }); setBusy(false); if (m) { toast(`Backup "${m.name}" created.`, 'good'); refresh(); } }}>Duplicate</button>
            <button className="btn small" disabled={!cur || busy} onClick={async () => {
              if (!cur) return;
              setBusy(true);
              try {
                const txt = await exportWorld(cur.id);
                const blob = new Blob([txt], { type: 'application/json' });
                const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${cur.name.replace(/[^\w-]+/g, '_')}.deepwild.json`; a.click();
                try { await navigator.clipboard.writeText(txt); toast('The export text is on your clipboard. Your browser may also have saved it as a file.', 'good'); } catch { toast('Export offered as a file download. If nothing was saved, your browser or host blocked it.', 'warn'); }
              } catch (e) { toast((e as Error).message, 'warn'); }
              setBusy(false);
            }}>Export</button>
            <button className="btn small" onClick={() => setImporting(true)}>Import</button>
            {!confirmDel ? <button className="btn small danger" disabled={!cur} onClick={() => setConfirmDel(true)}>Delete</button>
              : <button className="btn small danger" onClick={async () => { if (!cur) return; await deleteWorld(cur.id); toast(`"${cur.name}" was deleted.`); setConfirmDel(false); setSel(null); refresh(); }}>Delete "{cur?.name}" forever</button>}
          </div>
          <div className="row" style={{ gap: 10 }}>
            <button className="btn" onClick={() => set({ screen: 'title' })}>Back</button>
            <button className="btn" onClick={() => set({ screen: 'create' })}>Create new world</button>
            <button className="btn primary" disabled={!cur} onClick={() => cur && onLaunch(cur)}>Play selected</button>
          </div>
        </div>
      </div>
    </div>
  );
}
function WorldThumb({ seed }: { seed: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const g = ref.current!.getContext('2d')!;
    const n = new Simplex(seed);
    for (let y = 0; y < 13; y++) for (let x = 0; x < 13; x++) {
      const v = n.fbm2(x / 6, y / 6, 2);
      g.fillStyle = v < -0.15 ? '#2f5fa8' : v < -0.05 ? '#d8c890' : v < 0.3 ? '#5f9a4a' : v < 0.45 ? '#3f6a32' : '#8a8c92';
      g.fillRect(x * 4, y * 4, 4, 4);
    }
  }, [seed]);
  return <canvas ref={ref} width={52} height={52} className="thumb inset" />;
}

const RULE_LABELS: Record<keyof GameRules, string> = {
  keepInventory: 'Keep inventory on death', daylightCycle: 'Day and night cycle', weatherCycle: 'Weather changes', mobSpawning: 'Creatures spawn',
  mobGriefing: 'Creature blasts break blocks', fireSpread: 'Fire spreads', naturalRegen: 'Natural health regeneration', allowModeSwitch: 'Allow switching game mode (F4)',
};
export function CreateScreen({ onLaunch }: { onLaunch: (m: WorldMeta) => void }) {
  const set = useUI((s) => s.set);
  const [name, setName] = useState('New World');
  const [seed, setSeed] = useState('');
  const [mode, setMode] = useState<'survival' | 'creative'>('survival');
  const [diff, setDiff] = useState<0 | 1 | 2 | 3>(2);
  const [kit, setKit] = useState<'none' | 'basic' | 'bonus'>('none');
  const [rules, setRules] = useState<GameRules>({ ...DEFAULT_RULES });
  const create = async () => {
    const s = seed.trim();
    const num = s === '' ? Math.floor(Math.random() * 2 ** 31) : /^-?\d+$/.test(s) ? Number(s) | 0 : [...s].reduce((h, c) => hash32(h, c.charCodeAt(0)), 0x9e37) | 0;
    const meta: WorldMeta & { kit?: string } = {
      id: newId(), name: name.trim() || 'New World', seed: num, mode, difficulty: diff, created: Date.now(), lastPlayed: Date.now(),
      rules: { ...rules, allowModeSwitch: rules.allowModeSwitch || mode === 'creative' }, version: 1, playTime: 0, bonusChest: kit === 'bonus', kit,
    };
    await putWorld(meta);
    onLaunch(meta);
  };
  return (
    <div className="screen">
      <Backdrop />
      <div className="panel sheet" style={{ position: 'relative', zIndex: 2 }}>
        <h2 className="h">Create a new world</h2>
        <div className="scroll" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="form-grid">
            <div className="field"><label htmlFor="wn">World name</label><input id="wn" className="text-in" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} /></div>
            <div className="field"><label htmlFor="ws">Seed (blank for random)</label><input id="ws" className="text-in" value={seed} placeholder="e.g. 4242 or 'lantern'" onChange={(e) => setSeed(e.target.value)} /></div>
            <div className="field"><span className="label">Game mode</span><div className="seg"><button className={mode === 'survival' ? 'on' : ''} onClick={() => setMode('survival')}>Survival</button><button className={mode === 'creative' ? 'on' : ''} onClick={() => setMode('creative')}>Creative</button></div>
              <div className="note">{mode === 'survival' ? 'Gather, craft and survive. Health and hunger matter.' : 'Unlimited blocks, flight, instant breaking, no damage.'}</div></div>
            <div className="field"><span className="label">Difficulty</span><div className="seg">{DIFF.map((d, i) => <button key={d} className={diff === i ? 'on' : ''} onClick={() => setDiff(i as 0)}>{d}</button>)}</div>
              <div className="note">{['No hostile creatures; hunger never runs out.', 'Fewer, weaker enemies.', 'The intended challenge.', 'Stronger, faster enemies; starvation can kill.'][diff]}</div></div>
            <div className="field"><span className="label">Starting items</span><div className="seg"><button className={kit === 'none' ? 'on' : ''} onClick={() => setKit('none')}>Nothing</button><button className={kit === 'basic' ? 'on' : ''} onClick={() => setKit('basic')}>Basic kit</button><button className={kit === 'bonus' ? 'on' : ''} onClick={() => setKit('bonus')}>Bonus chest</button></div></div>
          </div>
          <div>
            <div className="label" style={{ marginBottom: 6 }}>World rules</div>
            <div className="form-grid inset" style={{ padding: 12, gap: '2px 22px' }}>
              {(Object.keys(RULE_LABELS) as (keyof GameRules)[]).map((k) => (
                <label key={k} className="toggle"><span>{RULE_LABELS[k]}</span><input type="checkbox" checked={rules[k]} onChange={(e) => setRules({ ...rules, [k]: e.target.checked })} /></label>
              ))}
            </div>
          </div>
        </div>
        <div className="btn-bar"><button className="btn" onClick={() => set({ screen: 'worlds' })}>Cancel</button><button className="btn primary" onClick={create}>Create world</button></div>
      </div>
    </div>
  );
}

export function SettingsScreen() {
  const s = useUI((st) => st.settings);
  const update = useUI((st) => st.updateSettings);
  const set = useUI((st) => st.set);
  const prev = useUI((st) => st.prevScreen);
  const [tab, setTab] = useState<'video' | 'controls' | 'audio'>('video');
  const [listen, setListen] = useState<string | null>(null);
  const apply = (p: Partial<Settings>) => { update(p); const g = gameRef.current; if (g) g.applySettings(useUI.getState().settings); };
  useEffect(() => {
    if (!listen) return;
    const h = (e: KeyboardEvent) => { e.preventDefault(); e.stopPropagation(); if (e.code !== 'Escape') apply({ keys: { ...s.keys, [listen]: e.code } }); setListen(null); };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [listen, s.keys]);
  const R = ({ k, label, min, max, step = 1, fmt }: { k: keyof Settings; label: string; min: number; max: number; step?: number; fmt?: (v: number) => string }) => (
    <div className="range"><label htmlFor={`r-${k}`}>{label}</label><output>{fmt ? fmt(s[k] as number) : String(s[k])}</output><input id={`r-${k}`} type="range" min={min} max={max} step={step} value={s[k] as number} onChange={(e) => apply({ [k]: Number(e.target.value) } as Partial<Settings>)} /></div>
  );
  const T = ({ k, label }: { k: keyof Settings; label: string }) => (<label className="toggle"><span>{label}</span><input type="checkbox" checked={!!s[k]} onChange={(e) => apply({ [k]: e.target.checked } as Partial<Settings>)} /></label>);
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  return (
    <div className="screen dim">
      {prev === 'title' && <Backdrop />}
      <div className="panel sheet" style={{ position: 'relative', zIndex: 2 }}>
        <h2 className="h">Settings</h2>
        <div className="tabs">{(['video', 'controls', 'audio'] as const).map((t) => <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t === 'video' ? 'Graphics' : t === 'controls' ? 'Controls' : 'Sound'}</button>)}</div>
        <div className="scroll inset" style={{ padding: 14 }}>
          {tab === 'video' && (
            <div className="form-grid">
              <R k="renderDistance" label="Render distance (chunks)" min={2} max={16} />
              <R k="simDistance" label="Simulation distance (chunks)" min={2} max={10} />
              <R k="fov" label="Field of view" min={50} max={110} />
              <R k="pixelRatio" label="Render scale" min={0.5} max={1} step={0.05} fmt={pct} />
              <R k="entityDistance" label="Creature render distance" min={30} max={100} step={5} fmt={(v) => `${v}%`} />
              <R k="guiScale" label="Interface scale" min={0.7} max={1.5} step={0.05} fmt={pct} />
              <div className="field"><span className="label">Frame rate limit</span><div className="seg">{[0, 30, 60, 120, 144].map((f) => <button key={f} className={s.fpsCap === f ? 'on' : ''} onClick={() => apply({ fpsCap: f })}>{f ? f : 'VSync'}</button>)}</div></div>
              <div className="field"><span className="label">Particles</span><div className="seg">{['All', 'Decreased', 'Minimal'].map((n, i) => <button key={n} className={s.particles === i ? 'on' : ''} onClick={() => apply({ particles: i as 0 })}>{n}</button>)}</div></div>
              <div>
                <T k="ao" label="Smooth shading (ambient occlusion)" />
                <T k="mipmaps" label="Texture filtering (mipmaps)" />
                <T k="antialias" label="Anti-aliasing (applies on next world load)" />
                <T k="clouds" label="Clouds" />
                <T k="shadows" label="Creature shadows" />
              </div>
              <div>
                <T k="headBob" label="View bobbing" />
                <T k="showFps" label="Show frame rate" />
                <div className="field" style={{ marginTop: 8 }}><span className="label">Display</span><button className="btn small" onClick={() => { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().catch(() => useUI.getState().toast('Fullscreen is not available here.', 'warn')); }}>Toggle fullscreen (F11)</button></div>
              </div>
            </div>
          )}
          {tab === 'controls' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="form-grid">
                <R k="sensitivity" label="Mouse sensitivity" min={0.2} max={3} step={0.05} fmt={pct} />
                <div><T k="invertY" label="Invert mouse Y axis" /></div>
              </div>
              <div>
                {Object.keys(DEFAULT_KEYS).map((k) => (
                  <div key={k} className="keyrow"><span>{KEY_LABELS[k]}</span><button className={`btn${listen === k ? ' listen' : ''}`} onClick={() => setListen(k)}>{listen === k ? 'Press a key…' : keyName(s.keys[k])}</button></div>
                ))}
                <div className="note" style={{ marginTop: 8 }}>Mouse: left click breaks and attacks, right click places and uses, middle click picks a block, the wheel and 1–9 choose hotbar slots. Esc pauses.</div>
                <div className="btn-bar" style={{ marginTop: 8 }}><button className="btn small" onClick={() => apply({ keys: { ...DEFAULT_KEYS } })}>Reset key bindings</button></div>
              </div>
            </div>
          )}
          {tab === 'audio' && (
            <div className="form-grid">
              <R k="master" label="Master volume" min={0} max={1} step={0.05} fmt={pct} />
              <R k="music" label="Music" min={0} max={1} step={0.05} fmt={pct} />
              <R k="sfx" label="Sound effects" min={0} max={1} step={0.05} fmt={pct} />
              <R k="ambient" label="Ambience (rain, wind, lava)" min={0} max={1} step={0.05} fmt={pct} />
              <div><T k="muted" label="Mute all sound" /><div className="note">Every sound is synthesized live in your browser.</div></div>
            </div>
          )}
        </div>
        <div className="btn-bar"><button className="btn primary" onClick={() => set({ screen: prev === 'title' ? 'title' : 'paused' })}>Done</button></div>
      </div>
    </div>
  );
}

export function PauseScreen({ onResume, onQuit }: { onResume: () => void; onQuit: () => void }) {
  const set = useUI((s) => s.set);
  const g = gameRef.current!;
  const [tools, setTools] = useState(false);
  const canTools = g.player.creative || g.meta.rules.allowModeSwitch;
  const [, bump] = useState(0);
  const st = g.state.stats;
  return (
    <div className="screen dim">
      <div className="panel" style={{ width: 'min(480px, 94vw)', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2 className="h">Game paused</h2>
        <div className="note">{g.meta.name} · Day {g.state.day + 1}, {g.clock()} · {g.player.creative ? 'Creative' : 'Survival'} · {DIFF[g.difficulty]}</div>
        <button className="btn primary" onClick={onResume}>Back to the game</button>
        <div className="menu-row">
          <button className="btn" onClick={() => set({ screen: 'settings', prevScreen: 'paused' })}>Settings</button>
          <button className="btn" disabled={!canTools} title={canTools ? '' : 'Enable mode switching in the world rules or play in creative'} onClick={() => setTools(!tools)}>World tools</button>
        </div>
        {tools && canTools && (
          <div className="inset" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="field"><span className="label">Time</span><div className="seg">{[['Dawn', 0], ['Noon', 0.25], ['Dusk', 0.48], ['Midnight', 0.75]].map(([n, t]) => <button key={n} onClick={() => { g.setTime(t as number); bump((x) => x + 1); }}>{n}</button>)}</div></div>
            <div className="field"><span className="label">Weather</span><div className="seg">{(['clear', 'rain', 'storm'] as const).map((w) => <button key={w} onClick={() => g.setWeather(w)}>{w}</button>)}</div></div>
            <label className="toggle"><span>Creatures spawn</span><input type="checkbox" checked={g.meta.rules.mobSpawning} onChange={(e) => { g.meta.rules.mobSpawning = e.target.checked; bump((x) => x + 1); }} /></label>
            <label className="toggle"><span>Day and night cycle</span><input type="checkbox" checked={g.meta.rules.daylightCycle} onChange={(e) => { g.meta.rules.daylightCycle = e.target.checked; bump((x) => x + 1); }} /></label>
            <label className="toggle"><span>Weather changes</span><input type="checkbox" checked={g.meta.rules.weatherCycle} onChange={(e) => { g.meta.rules.weatherCycle = e.target.checked; bump((x) => x + 1); }} /></label>
            <div className="field"><span className="label">Game mode</span><div className="seg">{(['survival', 'creative'] as const).map((m) => <button key={m} className={g.meta.mode === m ? 'on' : ''} disabled={!g.meta.rules.allowModeSwitch && g.meta.mode !== m} onClick={() => { g.setMode(m); bump((x) => x + 1); }}>{m}</button>)}</div></div>
            <button className="btn small" onClick={() => { g.entities.list.forEach((e) => { if ((e as { def?: { hostile: boolean; boss?: boolean } }).def?.hostile && !(e as { def?: { boss?: boolean } }).def?.boss) e.dead = true; }); g.message('Hostile creatures nearby were cleared.'); }}>Clear hostile creatures</button>
          </div>
        )}
        <div className="note">Blocks mined {st.mined} · placed {st.placed} · creatures defeated {st.kills} · deaths {st.deaths}</div>
        <button className="btn" onClick={onQuit}>Save and quit to title</button>
      </div>
    </div>
  );
}

export function DeathScreen({ onRespawn, onQuit }: { onRespawn: () => void; onQuit: () => void }) {
  const msg = useUI((s) => s.deathMsg);
  const g = gameRef.current!;
  const [ready, setReady] = useState(false);
  useEffect(() => { const t = setTimeout(() => setReady(true), 1200); return () => clearTimeout(t); }, []);
  return (
    <div className="screen death">
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, textAlign: 'center' }}>
        <h1>You died</h1>
        <div style={{ fontSize: 26, textShadow: '2px 2px 0 #000' }}>{msg}</div>
        <div className="note" style={{ color: '#ffd9d4' }}>{g.meta.rules.keepInventory ? 'Your inventory is kept.' : 'Your belongings were dropped where you fell. Hurry back for them.'}</div>
        <div className="menu-col" style={{ width: 320 }}>
          <button className="btn primary" disabled={!ready} onClick={onRespawn}>Respawn</button>
          <button className="btn" disabled={!ready} onClick={onQuit}>Save and quit to title</button>
        </div>
      </div>
    </div>
  );
}

export function LoadingScreen() {
  const text = useUI((s) => s.loadingText);
  return (
    <div className="screen" style={{ background: '#0b0c0f', flexDirection: 'column', gap: 18 }}>
      <div className="logo" style={{ fontSize: 42 }}>DEEP<b>WILD</b></div>
      <div style={{ fontSize: 24 }}>{text}</div>
      <div className="loading-bar inset"><i /></div>
    </div>
  );
}

export function CreditsScreen({ onDone }: { onDone: () => void }) {
  const prev = useUI((s) => s.prevScreen);
  return (
    <div className="screen credits" onClick={onDone}>
      <div className="roll">
        <div className="logo" style={{ fontSize: 56 }}>DEEP<b>WILD</b></div>
        {prev !== 'title' && (<><h3>The Hollow is quiet</h3><p>The crown of shards lies broken across the pale stone. Its heart still glows in your pack, warm as a hearth.</p><p>Somewhere far below, the Wayfolk light their lanterns and tell a new story: about a stranger who dug deeper than anyone, and came back up.</p><p>The world is yours. Keep building.</p></>)}
        <h3>How to play</h3>
        <p>Punch a tree for logs and turn them into planks. Build a Workbench, then wooden tools, then stone ones.</p>
        <p>Smelt ore in a Furnace. Copper and iron need a stone pickaxe; gold, diamond, pulsite and verdite need iron.</p>
        <p>Nights bring Shamblers, Rattlers, Fuseblooms and worse. Light keeps them away, and a bed skips the dark.</p>
        <p>Trade with the Wayfolk using Verdite. Defend their villages when sieges come.</p>
        <h3>The road to the end</h3>
        <p>Craft an Ember Rift Core from obsidian, gold blocks and a diamond. Set it in the middle of a ring of eight obsidian and strike it with a Flint Striker.</p>
        <p>In Emberdeep, find an Ember Bastion and defeat the Magma Colossus on its throne. Take its Ember Core.</p>
        <p>Combine Ember Cores, Starmetal Shards and a Rift Core into a Hollow Rift Core. In The Hollow, break the four Ward Pylons and face the Shard Sovereign.</p>
        <h3>Made with</h3>
        <p>Three.js, React and Zustand. Every texture, creature and sound in Deepwild is generated by its own code.</p>
        <p style={{ marginTop: 40, color: '#8a8c84' }}>Click to continue</p>
      </div>
    </div>
  );
}

export function SignEditor({ onDone }: { onDone: () => void }) {
  const pos = useUI((s) => s.panelPos);
  const g = gameRef.current!;
  const be = pos ? g.world.blockEntity(pos[0], pos[1], pos[2], 'sign') : null;
  const [lines, setLines] = useState<string[]>(((be?.text as string[]) ?? ['', '', '', '']).slice(0, 4));
  const save = () => { if (be && pos) { be.text = lines; g.world.touchBE(pos[0], pos[2]); g.signsDirty = true; } onDone(); };
  return (
    <div className="screen dim">
      <div className="panel sign-ed">
        <h2 className="h">Write on the sign</h2>
        {lines.map((l, i) => <input key={i} className="text-in" value={l} maxLength={18} autoFocus={i === 0} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') save(); }} onChange={(e) => { const n = [...lines]; n[i] = e.target.value; setLines(n); }} />)}
        <div className="btn-bar"><button className="btn primary" onClick={save}>Done</button></div>
      </div>
    </div>
  );
}
