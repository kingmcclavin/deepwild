import { useEffect, useRef, useState, memo } from 'react';
import { useUI } from './store';
import { ITEMS, maxDurability, itemName, type ItemStack } from '../game/registry/items';
import { itemIconURL } from '../game/gfx/textures';
import { EFFECTS } from '../game/registry/enchant';

/* ---------- tiny original pixel icons, drawn once ---------- */
const pix = (rows: string[], pal: Record<string, string>) => {
  const c = document.createElement('canvas'); c.width = c.height = 9;
  const g = c.getContext('2d')!;
  rows.forEach((r, y) => [...r].forEach((ch, x) => { if (pal[ch]) { g.fillStyle = pal[ch]; g.fillRect(x, y, 1, 1); } }));
  return c.toDataURL();
};
const HEART = ['.kk...kk.', 'krrk.krrk', 'krwrkrrrk', 'krrrrrrrk', '.krrrrrk.', '..krrrk..', '...krk...', '....k....', '.........'];
const HALF = ['.kk...kk.', 'krrk.k..k', 'krwrk...k', 'krrrr...k', '.krrr..k.', '..krr.k..', '...kkk...', '....k....', '.........'];
const EMPTY = ['.kk...kk.', 'k..k.k..k', 'k...k...k', 'k.......k', '.k.....k.', '..k...k..', '...k.k...', '....k....', '.........'];
const FOOD = ['......kk.', '.....kwwk', '..kkkkwk.', '.kbbbbk..', 'kbbybbk..', 'kbbbbbk..', 'kbbbbk...', '.kkkk....', '.........'];
const FOOD_H = ['......kk.', '.....kwwk', '..kkkkwk.', '.k...bk..', 'k...bbk..', 'k...bbk..', 'k...bk...', '.kkkk....', '.........'];
const FOOD_E = ['......kk.', '.....k..k', '..kkkk.k.', '.k....k..', 'k.....k..', 'k.....k..', 'k....k...', '.kkkk....', '.........'];
const ARM = ['.kkk.kkk.', 'kssskssk', 'ksswsssk', 'ksssssk.', '.kssssk.', '.kssssk.', '..ksssk..', '...kkk...', '.........'];
const ARM_E = ['.kkk.kkk.', 'k...k..k', 'k.......k', 'k......k.', '.k....k..', '.k....k..', '..k..k...', '...kk....', '.........'];
const BUB = ['.........', '...kkk...', '..kbbbk..', '.kbwbbbk.', '.kbbbbbk.', '.kbbbbbk.', '..kbbbk..', '...kkk...', '.........'];
const P = { k: '#0d0e11', r: '#d8423a', w: '#ffd8d0', y: '#e8c070', b: '#c07a3a', s: '#c8ccd4' };
const IC = {
  heart: pix(HEART, P), half: pix(HALF, P), empty: pix(EMPTY, P),
  gheart: pix(HEART, { ...P, r: '#e8c040', w: '#fff4c0' }), ghalf: pix(HALF, { ...P, r: '#e8c040', w: '#fff4c0' }),
  pheart: pix(HEART, { ...P, r: '#6a9a2a', w: '#c8f0a0' }),
  food: pix(FOOD, P), foodH: pix(FOOD_H, P), foodE: pix(FOOD_E, P),
  arm: pix(ARM, P), armH: pix(ARM.map((r) => r.slice(0, 5) + r.slice(5).replace(/[sw]/g, '.')), P), armE: pix(ARM_E, P),
  bub: pix(BUB, { ...P, b: '#5d9cf0', w: '#d8f0ff' }),
};

export const ItemIcon = memo(function ItemIcon({ s, size = 32 }: { s: ItemStack | null; size?: number }) {
  if (!s) return null;
  const d = ITEMS[s.id];
  if (!d) return null;
  const max = maxDurability(s);
  const frac = max ? 1 - (s.dmg ?? 0) / max : 1;
  return (
    <>
      <img className="ico" src={itemIconURL(s)} style={{ width: size, height: size }} alt="" draggable={false} />
      {s.ench && <span className="ench-glint" />}
      {s.count > 1 && <span className="cnt">{s.count}</span>}
      {max > 0 && (s.dmg ?? 0) > 0 && <span className="dura"><i style={{ width: `${frac * 100}%`, background: `hsl(${frac * 120},80%,50%)` }} /></span>}
    </>
  );
});

function Row({ n, full, half, empty, value, right, max = 10 }: { n: number; full: string; half: string; empty: string; value: number; right?: boolean; max?: number }) {
  const out = [];
  for (let i = 0; i < Math.min(n, max); i++) {
    const v = value - i * 2;
    out.push(<img key={i} src={v >= 2 ? full : v >= 1 ? half : empty} alt="" />);
  }
  return <div className={`icons${right ? ' right' : ''}`}>{out}</div>;
}

export function Hud({ playing }: { playing: boolean }) {
  const h = useUI((s) => s.hud);
  const toasts = useUI((s) => s.toasts);
  const settings = useUI((s) => s.settings);
  const [nameShown, setNameShown] = useState('');
  const lastSel = useRef(-1);
  const lastId = useRef(-1);
  useEffect(() => {
    const cur = h.hotbar[h.selected];
    if (h.selected !== lastSel.current || (cur?.id ?? -1) !== lastId.current) {
      lastSel.current = h.selected; lastId.current = cur?.id ?? -1;
      setNameShown(cur ? itemName(cur) : '');
      const t = setTimeout(() => setNameShown(''), 1800);
      return () => clearTimeout(t);
    }
  }, [h.selected, h.hotbar]);
  const poisoned = h.effects.some((e) => e.key === 'poison');
  return (
    <div className="hud" style={{ ['--gui' as string]: settings.guiScale }}>
      {h.hurtFlash > 0 && <div className="vignette" style={{ opacity: h.hurtFlash * 2 }} />}
      {h.fire && !h.creative && <div className="fire-ov" />}
      {h.portal > 0.05 && <div className="portal-ov" style={{ opacity: h.portal }} />}
      {h.sleeping && <div className="sleep-ov" />}
      {playing && <div className="crosshair" />}
      {h.useProgress > 0 && <div className="use-bar"><i style={{ width: `${h.useProgress * 100}%` }} /></div>}
      {h.boss && (
        <div className="boss">
          <div className="nm">{h.boss.name}{h.boss.shield ? ' · warded' : ''}</div>
          <div className={`bar${h.boss.shield ? ' sh' : ''}`}><i style={{ width: `${Math.max(0, h.boss.frac) * 100}%` }} /></div>
        </div>
      )}
      <div className="effects">
        {h.effects.map((e) => (
          <div className="effect" key={e.key}>
            <i style={{ background: EFFECTS[e.key]?.color ?? '#fff' }} />
            {EFFECTS[e.key]?.name ?? e.key}{e.amp ? ` ${['', 'II', 'III', 'IV'][e.amp] ?? e.amp + 1}` : ''} · {Math.floor(e.t / 60)}:{String(Math.floor(e.t % 60)).padStart(2, '0')}
          </div>
        ))}
      </div>
      <div className="toasts">{toasts.map((t) => <div key={t.id} className={`toast ${t.tone}`}>{t.text}</div>)}</div>
      {h.debug && <div className="debug">{h.debug}</div>}
      {settings.showFps && !h.debug && <div className="fps">{h.fps} fps</div>}
      <div className="hud-bottom">
        <div className="held-name" style={{ opacity: nameShown ? 1 : 0 }}>{nameShown || ' '}</div>
        {!h.creative && (
          <>
            <div className="stats">
              <div>
                {h.armor > 0 && <Row n={10} full={IC.arm} half={IC.armH} empty={IC.armE} value={h.armor} />}
                {h.absorption > 0 && <Row n={Math.ceil(h.absorption / 2)} full={IC.gheart} half={IC.ghalf} empty={IC.empty} value={h.absorption} />}
                <Row n={10} full={poisoned ? IC.pheart : IC.heart} half={IC.half} empty={IC.empty} value={Math.ceil(h.hp)} />
              </div>
              <div>
                {h.underwater && <Row n={10} full={IC.bub} half={IC.bub} empty={'data:image/gif;base64,R0lGODlhAQABAAAAACw='} value={Math.ceil(h.air / 1.5) * 2} right />}
                <Row n={10} full={IC.food} half={IC.foodH} empty={IC.foodE} value={h.hunger} right />
              </div>
            </div>
            <div className="xp"><i style={{ width: `${Math.min(1, h.xpFrac) * 100}%` }} />{h.level > 0 && <b>{h.level}</b>}</div>
          </>
        )}
        <div className="hotbar">
          {h.offhand && <div className="hs offhand inset"><ItemIcon s={h.offhand} /></div>}
          {Array.from({ length: 9 }, (_, i) => (
            <div key={i} className={`hs${i === h.selected ? ' on' : ''}`}><ItemIcon s={h.hotbar[i] ?? null} /></div>
          ))}
        </div>
      </div>
    </div>
  );
}
