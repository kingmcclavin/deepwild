import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useUI } from './store';
import { gameRef } from './gameRef';
import { ItemIcon } from './Hud';
import { ITEMS, allItems, itemByKey, itemName, maxDurability, sameItem, stackLimit, POTIONS, type ItemStack } from '../game/registry/items';
import { RECIPES, matchGrid, matches, recipeNeedsTable, specExample, smeltResult, fuelValue, isBrewIngredient, type Recipe, type Category } from '../game/registry/recipes';
import { ENCHANT_BY_KEY, ROMAN, enchantOffers } from '../game/registry/enchant';
import { BLOCKS, B } from '../game/registry/blocks';
import { insertInto, ARMOR0, OFFHAND } from '../game/player/inventory';
import { Mob } from '../game/entity/entities';
import { PROFESSIONS } from '../game/entity/mobs';
import { audio } from '../game/audio/audio';

type Arr = (ItemStack | null)[];
interface SlotDef { arr: Arr; i: number; accept?: (s: ItemStack) => boolean; output?: boolean; section: string; ghost?: ItemStack }

let carried: ItemStack | null = null;
const PLAYER_MAIN = Array.from({ length: 27 }, (_, k) => k + 9);
const HOTBAR = Array.from({ length: 9 }, (_, k) => k);

export function InventoryScreen() {
  const game = gameRef.current!;
  const panel = useUI((s) => s.panel);
  const pos = useUI((s) => s.panelPos);
  const tradeMob = useUI((s) => s.tradeMob);
  const [, force] = useReducer((x: number) => x + 1, 0);
  const [mouse, setMouse] = useState<[number, number]>([0, 0]);
  const [tip, setTip] = useState<ItemStack | null>(null);
  const gridSize = panel === 'crafting' ? 3 : 2;
  const grid = useRef<Arr>(new Array(9).fill(null));
  const temp = useRef<Arr>([null, null]); // enchant / anvil inputs
  const rightDrag = useRef<Set<string>>(new Set());
  const p = game.player;
  const inv = p.inv;
  const be = pos ? game.world.blockEntity(pos[0], pos[1], pos[2]) : null;
  const creative = p.creative && panel === 'creative';

  // live refresh for furnaces / brewing / entity changes
  useEffect(() => { const t = setInterval(force, 150); return () => clearInterval(t); }, []);
  useEffect(() => {
    const mm = (e: MouseEvent) => setMouse([e.clientX, e.clientY]);
    const up = () => rightDrag.current.clear();
    window.addEventListener('mousemove', mm); window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', mm); window.removeEventListener('mouseup', up); };
  }, []);
  // return grid + carried items when the screen closes
  useEffect(() => () => {
    const give = (s: ItemStack | null) => { if (!s) return; const left = inv.add(s); if (left) game.spawnItem(p.x, p.y + 1, p.z, left); };
    grid.current.forEach(give); grid.current.fill(null);
    temp.current.forEach(give); temp.current = [null, null];
    give(carried); carried = null;
    inv.changed();
  }, []);

  const changed = () => { inv.changed(); if (pos) game.world.touchBE(pos[0], pos[2]); force(); };

  /* ---------------- slot clicking ---------------- */
  const sections: Record<string, number[] | null> = {};
  function quickMove(sd: SlotDef) {
    const s = sd.arr[sd.i];
    if (!s) return;
    let left: ItemStack | null = { ...s };
    if (sd.section === 'player' || sd.section === 'hotbar') {
      const d = ITEMS[s.id];
      // to container first
      if (be?.items && ['chest', 'dispenser', 'hopper'].includes(panel)) left = insertInto(be.items, left);
      else if (be?.items && (panel === 'furnace')) left = insertInto(be.items, left, smeltResult(s.id, be.type as 'furnace') ? [0] : fuelValue(s.id) ? [1] : []);
      else if (be?.items && panel === 'brewing') left = insertInto(be.items, left, d.key === 'potion' ? [0, 1, 2] : d.key === 'ember_dust' ? [4] : isBrewIngredient(s.id) ? [3] : []);
      else if (d.armor && !inv.slots[ARMOR0 + d.armor.slot] && panel === 'player') { inv.slots[ARMOR0 + d.armor.slot] = left; left = null; }
      else left = insertInto(inv.slots, left, sd.section === 'hotbar' ? PLAYER_MAIN : HOTBAR);
    } else {
      left = insertInto(inv.slots, left, [...HOTBAR, ...PLAYER_MAIN].reverse().reverse());
    }
    sd.arr[sd.i] = left;
    audio.click();
    changed();
  }
  function click(sd: SlotDef, btn: number, shift: boolean) {
    const s = sd.arr[sd.i];
    if (sd.output) { takeOutput(sd, shift); return; }
    if (shift && btn === 0) { quickMove(sd); return; }
    if (btn === 0) {
      if (!carried) { carried = s; sd.arr[sd.i] = null; }
      else if (!s) { if (!sd.accept || sd.accept(carried)) { sd.arr[sd.i] = carried; carried = null; } }
      else if (sameItem(s, carried)) { const n = Math.min(stackLimit(s.id) - s.count, carried.count); s.count += n; carried.count -= n; if (carried.count <= 0) carried = null; }
      else if (!sd.accept || sd.accept(carried)) { sd.arr[sd.i] = carried; carried = s; }
    } else if (btn === 2) {
      if (!carried && s) { const half = Math.ceil(s.count / 2); carried = { ...s, count: half }; s.count -= half; if (s.count <= 0) sd.arr[sd.i] = null; }
      else if (carried) placeOne(sd);
    }
    audio.click();
    changed();
  }
  function placeOne(sd: SlotDef) {
    if (!carried) return;
    const s = sd.arr[sd.i];
    if (sd.accept && !sd.accept(carried)) return;
    if (!s) { sd.arr[sd.i] = { ...carried, count: 1 }; carried.count--; }
    else if (sameItem(s, carried) && s.count < stackLimit(s.id)) { s.count++; carried.count--; }
    if (carried.count <= 0) carried = null;
  }
  function takeOutput(sd: SlotDef, shift: boolean) {
    if (sd.section === 'craft') { craftTake(shift); return; }
    if (sd.section === 'anvil') { anvilTake(); return; }
    const s = sd.arr[sd.i];
    if (!s) return;
    if (shift) { const left = insertInto(inv.slots, s, [...HOTBAR, ...PLAYER_MAIN]); sd.arr[sd.i] = left; }
    else if (!carried) { carried = s; sd.arr[sd.i] = null; }
    else if (sameItem(carried, s) && carried.count + s.count <= stackLimit(s.id)) { carried.count += s.count; sd.arr[sd.i] = null; }
    else return;
    if (be?.xp && sd.section === 'furnace') { game.spawnXP(p.x, p.y + 1, p.z, Math.floor(be.xp as number)); be.xp = 0; }
    audio.click();
    changed();
  }

  /* ---------------- crafting ---------------- */
  const gridArr = grid.current.slice(0, gridSize * gridSize);
  const recipe = matchGrid(gridArr, gridSize);
  const output: ItemStack | null = recipe ? { id: recipe.out, count: recipe.n } : null;
  function craftOnce(): ItemStack | null {
    const g = grid.current.slice(0, gridSize * gridSize);
    const r = matchGrid(g, gridSize);
    if (!r) return null;
    for (let i = 0; i < gridSize * gridSize; i++) { const s = grid.current[i]; if (s) { s.count--; if (s.count <= 0) grid.current[i] = null; } }
    game.state.stats.crafted++;
    return { id: r.out, count: r.n };
  }
  function craftTake(shift: boolean) {
    if (!output) return;
    if (shift) {
      for (let k = 0; k < 64; k++) {
        const r = matchGrid(grid.current.slice(0, gridSize * gridSize), gridSize);
        if (!r) break;
        const room = insertInto(inv.slots.map((s) => (s ? { ...s } : null)), { id: r.out, count: r.n }, [...HOTBAR, ...PLAYER_MAIN]);
        if (room) break;
        const made = craftOnce()!;
        insertInto(inv.slots, made, [...HOTBAR, ...PLAYER_MAIN]);
      }
    } else {
      if (carried && (!sameItem(carried, output) || carried.count + output.count > stackLimit(output.id))) return;
      const made = craftOnce();
      if (!made) return;
      if (carried) carried.count += made.count; else carried = made;
    }
    audio.craft();
    changed();
  }

  /* ---------------- enchanting ---------------- */
  const shelves = useMemo(() => {
    if (panel !== 'enchant' || !pos) return 0;
    let n = 0;
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) for (let dy = 0; dy <= 1; dy++) {
      if (Math.abs(dx) < 2 && Math.abs(dz) < 2) continue;
      if (game.world.id(pos[0] + dx, pos[1] + dy, pos[2] + dz) === B.bookshelf) n++;
    }
    return n;
  }, [panel, pos]);
  const enchItem = temp.current[0];
  const offers = panel === 'enchant' && enchItem ? enchantOffers(enchItem, shelves, (p.totalXp * 7919 + enchItem.id * 31 + (p.level << 8)) >>> 0) : [];
  function doEnchant(i: number) {
    const o = offers[i];
    const lap = temp.current[1];
    if (!enchItem || !o) return;
    if (!p.creative && (p.level < o.cost || !lap || lap.count < i + 1)) return;
    enchItem.ench = o.ench;
    if (!p.creative) { p.spendLevels(i + 1); lap!.count -= i + 1; if (lap!.count <= 0) temp.current[1] = null; }
    audio.enchant();
    changed();
  }

  /* ---------------- anvil ---------------- */
  function anvilResult(): { out: ItemStack; cost: number; use: number } | null {
    const [a, b] = temp.current;
    if (!a || !b) return null;
    const max = maxDurability(a);
    const da = ITEMS[a.id];
    const out: ItemStack = structuredClone(a);
    let cost = 1, use = 1;
    if (b.id === a.id) {
      if (max) out.dmg = Math.max(0, (a.dmg ?? 0) - (max - (b.dmg ?? 0)) - Math.floor(max * 0.12));
      const ench = { ...(a.ench ?? {}) };
      for (const [k, l] of Object.entries(b.ench ?? {})) { const cur = ench[k] ?? 0; ench[k] = Math.min(ENCHANT_BY_KEY[k]?.max ?? 5, cur === l ? l + 1 : Math.max(cur, l)); cost += ench[k]; }
      if (Object.keys(ench).length) out.ench = ench;
      cost += 2;
    } else {
      const mat = da.armor?.material ?? (da.tool ? ({ 0: '#planks', 1: 'cobblestone', 2: 'copper_ingot', 3: 'iron_ingot', 4: 'diamond', 5: 'cinderite_ingot', 6: 'starmetal_shard' } as Record<number, string>)[da.tool.tier] : undefined);
      const goldTool = da.key.startsWith('gold_');
      const matKey = goldTool ? 'gold_ingot' : mat;
      if (!max || !matKey || !(matKey.startsWith('#') ? matches(matKey, b) : ITEMS[b.id].key === matKey)) return null;
      if (!(a.dmg ?? 0)) return null;
      const per = Math.ceil(max / 4);
      use = Math.min(b.count, Math.ceil((a.dmg ?? 0) / per));
      out.dmg = Math.max(0, (a.dmg ?? 0) - per * use);
      cost = use + Object.values(a.ench ?? {}).reduce((x, y) => x + y, 0);
    }
    return { out, cost: Math.min(39, cost), use };
  }
  const anvil = panel === 'anvil' ? anvilResult() : null;
  function anvilTake() {
    if (!anvil || carried) return;
    if (!p.creative && p.level < anvil.cost) return;
    carried = anvil.out;
    const b = temp.current[1]!;
    temp.current[0] = null;
    b.count -= temp.current[1]!.id === anvil.out.id ? 1 : anvil.use;
    if (b.count <= 0) temp.current[1] = null;
    if (!p.creative) p.spendLevels(anvil.cost);
    audio.anvil();
    changed();
  }

  /* ---------------- rendering helpers ---------------- */
  const slotEl = (sd: SlotDef, cls = '', key?: string) => {
    const s = sd.arr[sd.i];
    const k = `${sd.section}:${sd.i}`;
    return (
      <div key={key ?? k} className={`slot ${cls}`} onMouseDown={(e) => { e.preventDefault(); if (e.button === 2 && carried && !sd.output) { rightDrag.current.add(k); placeOne(sd); audio.click(); changed(); return; } click(sd, e.button, e.shiftKey); }}
        onMouseEnter={(e) => { setTip(s ?? null); if (e.buttons === 2 && carried && !rightDrag.current.has(k) && rightDrag.current.size) { rightDrag.current.add(k); placeOne(sd); changed(); } }}
        onMouseLeave={() => setTip(null)} onContextMenu={(e) => e.preventDefault()}>
        {s ? <ItemIcon s={s} /> : sd.ghost ? <span className="ghost"><ItemIcon s={sd.ghost} /></span> : null}
      </div>
    );
  };
  const S = (arr: Arr, i: number, section: string, o: Partial<SlotDef> = {}, cls = '') => slotEl({ arr, i, section, ...o }, cls, `${section}${i}`);
  const playerGrid = () => (
    <>
      <div className="sect-title">Inventory</div>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(9,44px)' }}>{PLAYER_MAIN.map((i) => S(inv.slots, i, 'player'))}</div>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(9,44px)', marginTop: 8 }}>{HOTBAR.map((i) => S(inv.slots, i, 'hotbar'))}</div>
    </>
  );
  const craftGrid = () => (
    <div className="row">
      <div className="grid" style={{ gridTemplateColumns: `repeat(${gridSize},44px)` }}>{Array.from({ length: gridSize * gridSize }, (_, i) => S(grid.current, i, 'grid'))}</div>
      <div className="arrow" />
      {slotEl({ arr: [output], i: 0, output: true, section: 'craft' }, 'out')}
    </div>
  );
  const armorAccept = (slot: number) => (s: ItemStack) => ITEMS[s.id].armor?.slot === slot;

  /* ---------------- panels ---------------- */
  let main: JSX.Element | null = null;
  let side: JSX.Element | null = null;
  if (panel === 'player' || panel === 'crafting') {
    main = (
      <div className="panel">
        <div className="row" style={{ alignItems: 'flex-start', gap: 22 }}>
          {panel === 'player' && (
            <div>
              <div className="sect-title">Armor</div>
              <div className="grid">{[0, 1, 2, 3].map((k) => S(inv.slots, ARMOR0 + k, 'armor', { accept: armorAccept(k), ghost: { id: itemByKey(['leather_helmet', 'leather_chest', 'leather_legs', 'leather_boots'][k]).id, count: 1 } }))}</div>
              <div className="sect-title">Offhand</div>
              {S(inv.slots, OFFHAND, 'offhand', { ghost: { id: itemByKey('shield').id, count: 1 } })}
            </div>
          )}
          <div>
            <div className="sect-title">{panel === 'crafting' ? 'Workbench' : 'Crafting'}</div>
            {craftGrid()}
            <div className="note" style={{ marginTop: 8, maxWidth: 260 }}>Level {p.level} · Armor {inv.armorPoints()} · {game.clock()}</div>
          </div>
        </div>
        {playerGrid()}
      </div>
    );
    side = <RecipeBook table={panel === 'crafting'} grid={grid.current} size={gridSize} onChange={changed} />;
  } else if (panel === 'chest' || panel === 'dispenser' || panel === 'hopper') {
    const items = be?.items ?? [];
    const cols = panel === 'chest' ? 9 : panel === 'dispenser' ? 3 : 5;
    main = (
      <div className="panel">
        <div className="sect-title">{panel === 'chest' ? 'Chest' : panel === 'dispenser' ? 'Dispenser' : 'Hopper'}</div>
        <div className="grid" style={{ gridTemplateColumns: `repeat(${cols},44px)`, justifyContent: 'center' }}>{items.map((_, i) => S(items, i, 'cont'))}</div>
        {playerGrid()}
      </div>
    );
  } else if (panel === 'furnace' && be) {
    const it = (be.items ??= [null, null, null]);
    const burn = (be.burn as number) ?? 0, bmax = (be.burnMax as number) || 1, cook = (be.cook as number) ?? 0;
    const name = be.type === 'smoker' ? 'Smokehouse' : be.type === 'blast' ? 'Blast Furnace' : 'Furnace';
    main = (
      <div className="panel">
        <div className="sect-title">{name}</div>
        <div className="row" style={{ justifyContent: 'center', gap: 20 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center' }}>
            {S(it, 0, 'furnace-in', { accept: (s) => !!smeltResult(s.id, be.type as 'furnace') })}
            <div className="flame"><i style={{ height: `${(burn / bmax) * 100}%` }} /></div>
            {S(it, 1, 'furnace-fuel', { accept: (s) => fuelValue(s.id) > 0 })}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}><div className="arrow" /><div className="progress"><i style={{ width: `${(cook / 200) * 100}%` }} /></div></div>
          {slotEl({ arr: it, i: 2, output: true, section: 'furnace' }, 'out')}
        </div>
        <div className="note" style={{ textAlign: 'center', marginTop: 6 }}>{be.type === 'smoker' ? 'Cooks food twice as fast.' : be.type === 'blast' ? 'Smelts ores twice as fast.' : 'Smelts ores, cooks food and bakes clay.'}</div>
        {playerGrid()}
      </div>
    );
  } else if (panel === 'brewing' && be) {
    const it = (be.items ??= [null, null, null, null, null]);
    const t = (be.brew as number) ?? 0;
    main = (
      <div className="panel">
        <div className="sect-title">Brewing Stand · fuel {(be.fuel as number) ?? 0}</div>
        <div className="row" style={{ justifyContent: 'center', gap: 18 }}>
          {S(it, 4, 'brew-fuel', { accept: (s) => ITEMS[s.id].key === 'ember_dust', ghost: { id: itemByKey('ember_dust').id, count: 1 } })}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            {S(it, 3, 'brew-ing', { accept: (s) => isBrewIngredient(s.id) })}
            <div className="progress"><i style={{ width: `${(t / 400) * 100}%` }} /></div>
            <div className="row" style={{ gap: 6 }}>{[0, 1, 2].map((i) => S(it, i, 'brew-b', { accept: (s) => ITEMS[s.id].key === 'potion', ghost: { id: itemByKey('potion').id, count: 1, data: 'water' } }))}</div>
          </div>
        </div>
        <div className="note" style={{ textAlign: 'center' }}>Start with a Flask of Water and Ashroot, then add a reagent.</div>
        {playerGrid()}
      </div>
    );
  } else if (panel === 'enchant') {
    main = (
      <div className="panel">
        <div className="sect-title">Runic Altar · {shelves} bookshelves</div>
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {S(temp.current, 0, 'ench-item', { accept: (s) => s.count === 1 && !!maxDurability(s) })}
            {S(temp.current, 1, 'ench-lap', { accept: (s) => ITEMS[s.id].key === 'azurite', ghost: { id: itemByKey('azurite').id, count: 1 } })}
          </div>
          <div className="offers">
            {[0, 1, 2].map((i) => {
              const o = offers[i];
              const can = !!o && (p.creative || (p.level >= o.cost && (temp.current[1]?.count ?? 0) > i));
              return (
                <button key={i} className="offer" disabled={!can} onClick={() => doEnchant(i)}>
                  <span>{o ? Object.entries(o.ench).map(([k, l]) => `${ENCHANT_BY_KEY[k].name} ${ROMAN[l]}`).join(', ') + '…' : '—'}</span>
                  <span className="lv">{o ? `${o.cost} · ${i + 1} az` : ''}</span>
                </button>
              );
            })}
            <div className="note">Costs levels and Azurite. Surround the altar with bookshelves, one block apart, for stronger runes.</div>
          </div>
        </div>
        {playerGrid()}
      </div>
    );
  } else if (panel === 'anvil') {
    main = (
      <div className="panel">
        <div className="sect-title">Anvil</div>
        <div className="row" style={{ justifyContent: 'center' }}>
          {S(temp.current, 0, 'anv-a', { accept: (s) => !!maxDurability(s) })}
          <span style={{ fontFamily: 'var(--pixel)' }}>+</span>
          {S(temp.current, 1, 'anv-b')}
          <div className="arrow" />
          {slotEl({ arr: [anvil?.out ?? null], i: 0, output: true, section: 'anvil' }, 'out')}
        </div>
        <div className="note" style={{ textAlign: 'center', color: anvil && !p.creative && p.level < anvil.cost ? '#ff9a8a' : undefined }}>{anvil ? `Cost: ${anvil.cost} levels` : 'Combine two of the same item, or repair with its material.'}</div>
        {playerGrid()}
      </div>
    );
  } else if (panel === 'trade') {
    const mob = game.entities.list.find((e) => e.id === tradeMob) as Mob | undefined;
    const village = mob?.villageId ? game.state.villages[mob.villageId] : undefined;
    const discount = Math.min(0.5, ((village?.rep ?? 0) + (mob?.rep ?? 0)) / 200 + (village?.hero ? 0.3 : 0));
    const price = (n: number) => Math.max(1, Math.round(n * (1 - Math.max(-0.5, discount))));
    main = (
      <div className="panel">
        <div className="sect-title">{mob ? `${PROFESSIONS[mob.prof]?.name ?? 'Wayfolk'} · trades` : 'They have wandered off'}</div>
        <div className="trades">
          {mob?.trades.map((t, i) => {
            const cost = t.give[0] === itemByKey('verdite').id ? price(t.give[1]) : t.give[1];
            const have = inv.countId(t.give[0]);
            const ok = t.uses < t.max && have >= cost;
            return (
              <div key={i} className={`trade inset${t.uses >= t.max ? ' out' : ''}`}>
                <div className="slot" onMouseEnter={() => setTip({ id: t.give[0], count: cost })} onMouseLeave={() => setTip(null)}><ItemIcon s={{ id: t.give[0], count: cost }} /></div>
                <span>›</span>
                <div className="slot" onMouseEnter={() => setTip({ id: t.get[0], count: t.get[1] })} onMouseLeave={() => setTip(null)}><ItemIcon s={{ id: t.get[0], count: t.get[1] }} /></div>
                <button className="btn small" disabled={!ok} onClick={() => {
                  inv.remove((s) => s.id === t.give[0] && !s.ench, cost);
                  const left = inv.add({ id: t.get[0], count: t.get[1] });
                  if (left) game.spawnItem(p.x, p.y + 1, p.z, left);
                  t.uses++; mob.rep += 1; if (village) village.rep += 0.5;
                  game.spawnXP(mob.x, mob.y + 1, mob.z, 2);
                  audio.craft(); changed();
                }}>{t.uses >= t.max ? 'Sold out' : 'Trade'}</button>
              </div>
            );
          })}
        </div>
        {village?.hero && <div className="note">Hero of the village: prices are lower for you.</div>}
        {playerGrid()}
      </div>
    );
  } else if (panel === 'creative') {
    main = <CreativePanel onPick={(s, btn, shift) => {
      if (carried) { carried = null; changed(); return; }
      if (shift) { inv.add({ ...s, count: stackLimit(s.id) }); changed(); return; }
      carried = { ...s, count: btn === 2 ? 1 : stackLimit(s.id) };
      changed();
    }} hover={setTip} hotbar={<><div className="sect-title">Hotbar · click the catalogue with an item to discard it</div><div className="grid" style={{ gridTemplateColumns: 'repeat(9,44px)' }}>{HOTBAR.map((i) => S(inv.slots, i, 'hotbar'))}</div><div className="row" style={{ marginTop: 8 }}><span className="note">Offhand</span>{S(inv.slots, OFFHAND, 'offhand')}<span className="note">Armor</span>{[0, 1, 2, 3].map((k) => S(inv.slots, ARMOR0 + k, 'armor', { accept: armorAccept(k) }))}</div></>} />;
  }
  void sections; void creative;

  return (
    <div className="screen inv-screen" onContextMenu={(e) => e.preventDefault()} onMouseDown={(e) => {
      // clicking outside panels drops the carried stack
      if ((e.target as HTMLElement).classList.contains('inv-screen') && carried) {
        const n = e.button === 2 ? 1 : carried.count;
        const [lx, , lz] = p.look();
        game.spawnItem(p.x + lx, p.eyeY() - 0.3, p.z + lz, { ...carried, count: n }, lx * 4, 2, lz * 4, 1.5);
        carried.count -= n; if (carried.count <= 0) carried = null;
        changed();
      }
    }}>
      <div className="inv">{side}{main}</div>
      {carried && <div className="carried" style={{ left: mouse[0] - 22, top: mouse[1] - 22 }}><ItemIcon s={carried} /></div>}
      {tip && !carried && <Tooltip s={tip} x={mouse[0]} y={mouse[1]} />}
    </div>
  );
}

function Tooltip({ s, x, y }: { s: ItemStack; x: number; y: number }) {
  const d = ITEMS[s.id];
  const max = maxDurability(s);
  const pot = d.key === 'potion' ? POTIONS[s.data ?? 'water'] : null;
  return (
    <div className="tip" style={{ left: Math.min(x + 16, window.innerWidth - 330), top: y + 12 }}>
      <div className={`t r${d.rarity ?? 0}`}>{itemName(s)}</div>
      {s.ench && Object.entries(s.ench).map(([k, l]) => <div key={k} className="e">{ENCHANT_BY_KEY[k]?.name ?? k} {ROMAN[l] ?? l}</div>)}
      {pot?.effect && <div className="e">{pot.effect[0].replace('_', ' ')}{pot.effect[1] ? ` (${Math.floor(pot.effect[1] / 60)}:${String(pot.effect[1] % 60).padStart(2, '0')})` : ''}</div>}
      {d.tool && d.tool.kind !== 'shears' && <div className="d">{d.tool.damage} attack damage · {(1 / d.tool.cooldown).toFixed(1)} swings/s</div>}
      {d.armor && <div className="d">+{d.armor.points} armor{d.armor.toughness ? ` · +${d.armor.toughness} toughness` : ''}</div>}
      {d.food && <div className="d">Restores {d.food.hunger / 2} hunger</div>}
      {max > 0 && <div className="d">Durability {max - (s.dmg ?? 0)} / {max}</div>}
      {d.desc && <div className="d">{d.desc}</div>}
      {d.id < 256 && BLOCKS[d.id].tool && BLOCKS[d.id].tier >= 0 && <div className="d">Needs a {['wooden', 'stone', 'copper', 'iron', 'diamond', 'cinderite'][BLOCKS[d.id].tier] ?? ''} {BLOCKS[d.id].tool} or better</div>}
    </div>
  );
}

const CATS: [Category | 'all', string][] = [['all', 'All'], ['building', 'Build'], ['tools', 'Tools'], ['combat', 'Combat'], ['food', 'Food'], ['pulse', 'Pulse'], ['transport', 'Travel'], ['decor', 'Decor'], ['misc', 'Misc']];
function RecipeBook({ table, grid, size, onChange }: { table: boolean; grid: Arr; size: number; onChange: () => void }) {
  const game = gameRef.current!;
  const inv = game.player.inv;
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<Category | 'all'>('all');
  const [only, setOnly] = useState(false);
  const [tip, setTip] = useState<Recipe | null>(null);
  const counts = useMemo(() => {
    const m = new Map<number, number>();
    for (const s of inv.slots) if (s) m.set(s.id, (m.get(s.id) ?? 0) + s.count);
    for (const s of grid) if (s) m.set(s.id, (m.get(s.id) ?? 0) + s.count);
    return m;
  }, [inv.version, grid.map((s) => s?.id ?? 0).join()]);
  const canCraft = (r: Recipe) => {
    const need = new Map<string, number>();
    for (const sp of r.pattern ? r.pattern.join('').split('').filter((c) => c !== ' ').map((c) => r.keys![c]) : r.ing!) need.set(sp, (need.get(sp) ?? 0) + 1);
    for (const [sp, n] of need) {
      let have = 0;
      for (const [id, c] of counts) if (matches(sp, { id, count: c })) have += c;
      if (have < n) return false;
    }
    return true;
  };
  const list = RECIPES.filter((r) => (cat === 'all' || r.cat === cat) && (!q || ITEMS[r.out].name.toLowerCase().includes(q.toLowerCase())));
  const shown = list.filter((r) => !only || canCraft(r));
  const seen = new Set<number>();
  const uniq = shown.filter((r) => (seen.has(r.out * 1000 + (r.pattern ? 1 : 0)) ? false : (seen.add(r.out * 1000 + (r.pattern ? 1 : 0)), true)));
  function fill(r: Recipe) {
    if (recipeNeedsTable(r) && !table) { useUI.getState().toast('That recipe needs a Workbench (3×3 grid).', 'warn'); return; }
    if (!canCraft(r)) { useUI.getState().toast(`Missing ingredients for ${ITEMS[r.out].name}.`, 'warn'); return; }
    // return grid contents
    for (let i = 0; i < grid.length; i++) if (grid[i]) { const left = inv.add(grid[i]!); if (left) game.spawnItem(game.player.x, game.player.y + 1, game.player.z, left); grid[i] = null; }
    const cells: [number, string][] = [];
    if (r.pattern) r.pattern.forEach((row, y) => [...row].forEach((ch, x) => { if (ch !== ' ') cells.push([y * size + x, r.keys![ch]]); }));
    else r.ing!.forEach((sp, i) => cells.push([i, sp]));
    for (const [cell, sp] of cells) {
      const slot = inv.slots.findIndex((s, i) => i < 36 && s && matches(sp, s));
      if (slot < 0) continue;
      const s = inv.slots[slot]!;
      grid[cell] = { ...s, count: 1 };
      s.count--; if (s.count <= 0) inv.slots[slot] = null;
    }
    audio.click();
    onChange();
  }
  return (
    <div className="panel book">
      <div className="sect-title">Recipe book</div>
      <input className="text-in" placeholder="Search recipes" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
      <div className="cats">{CATS.map(([k, n]) => <button key={k} className={cat === k ? 'on' : ''} onClick={() => setCat(k)}>{n}</button>)}</div>
      <label className="toggle note"><span>Only show craftable</span><input type="checkbox" checked={only} onChange={(e) => setOnly(e.target.checked)} /></label>
      <div className="list inset">
        {uniq.map((r) => (
          <div key={r.id} className={`slot${canCraft(r) ? '' : ' no'}${recipeNeedsTable(r) ? ' lock' : ''}`} onClick={() => fill(r)} onMouseEnter={() => setTip(r)} onMouseLeave={() => setTip(null)}>
            <ItemIcon s={{ id: r.out, count: r.n }} />
          </div>
        ))}
      </div>
      <div className="note" style={{ minHeight: 70 }}>
        {tip ? (
          <>
            <div style={{ color: 'var(--text)' }}>{ITEMS[tip.out].name}{tip.n > 1 ? ` ×${tip.n}` : ''}</div>
            {tip.pattern ? (
              <div className="grid" style={{ gridTemplateColumns: `repeat(${tip.w},24px)`, marginTop: 4 }}>
                {tip.pattern.flatMap((row, y) => [...row].map((ch, x) => <div key={`${x}${y}`} className="inset" style={{ width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{ch !== ' ' && <img className="ico" style={{ width: 20, height: 20 }} src={iconFor(specExample(tip.keys![ch]))} alt="" />}</div>))}
              </div>
            ) : <div>Any arrangement: {tip.ing!.map((s) => (s.startsWith('#') ? `any ${s.slice(1)}` : ITEMS[specExample(s)].name)).join(', ')}</div>}
          </>
        ) : 'Click a recipe to place its ingredients.'}
      </div>
    </div>
  );
}
import { itemIconURL } from '../game/gfx/textures';
const iconFor = (id: number) => itemIconURL({ id, count: 1 });

const CTABS: [string, string, (k: string, id: number) => boolean][] = [
  ['all', 'All', () => true],
  ['build', 'Building', (k, id) => id < 256 && (k.includes('planks') || k.includes('brick') || k.includes('stone') || k.includes('concrete') || k.includes('wool') || k.includes('glass') || k.includes('slab') || k.includes('stairs') || k.includes('fence') || k.includes('wall') || k.includes('door') || k.includes('terracotta') || k.includes('log') || k.includes('block'))],
  ['nature', 'Nature', (k, id) => id < 256 && (BLOCKS[id].plant || ['grass', 'dirt', 'sand', 'gravel', 'clay', 'mud', 'snow_block', 'ice', 'packed_ice', 'cactus', 'pumpkin', 'melon', 'sporeturf', 'obsidian', 'emberstone', 'ashsand', 'basalt', 'magma_block', 'pale_stone'].includes(k) || k.endsWith('_ore') || k.endsWith('_leaves'))],
  ['func', 'Functional', (_k, id) => id < 256 && (!!BLOCKS[id].container || !!BLOCKS[id].ui || ['torch', 'lantern', 'bed', 'ladder', 'bookshelf', 'lumen_block', 'rift_core', 'void_core', 'mob_cage', 'rail', 'wood_sign'].includes(BLOCKS[id].key))],
  ['pulse', 'Pulse', (k, id) => (id < 256 && !!BLOCKS[id].pulse) || k === 'pulsite'],
  ['tools', 'Tools & combat', (_k, id) => id >= 256 && (!!ITEMS[id].tool || !!ITEMS[id].armor || ['bow', 'arrow', 'shield', 'fishing_rod', 'igniter', 'bucket', 'water_bucket', 'lava_bucket', 'shears', 'saddle', 'lead', 'boat', 'minecart', 'builder_wand'].includes(ITEMS[id].key))],
  ['food', 'Food & brews', (k, id) => id >= 256 && (!!ITEMS[id].food || k === 'potion' || k.includes('seeds') || k === 'glass_bottle' || k === 'milk_bucket')],
  ['mats', 'Materials', (_k, id) => id >= 256 && !ITEMS[id].tool && !ITEMS[id].armor && !ITEMS[id].food],
];
function CreativePanel({ onPick, hover, hotbar }: { onPick: (s: ItemStack, btn: number, shift: boolean) => void; hover: (s: ItemStack | null) => void; hotbar: JSX.Element }) {
  const [q, setQ] = useState('');
  const [tab, setTab] = useState('all');
  const all = useMemo(() => {
    const base = allItems().filter((d) => d.key !== 'potion');
    const pots = Object.keys(POTIONS).map((k) => ({ ...itemByKey('potion'), _data: k }));
    return [...base.map((d) => ({ d, data: undefined as string | undefined })), ...pots.map((d) => ({ d, data: d._data }))];
  }, []);
  const t = CTABS.find((x) => x[0] === tab)!;
  const list = all.filter(({ d, data }) => (q ? itemName({ id: d.id, count: 1, data }).toLowerCase().includes(q.toLowerCase()) : t[2](d.key, d.id)));
  return (
    <div className="panel creative">
      <div className="sect-title">Creative catalogue · {list.length} items</div>
      <input className="text-in" placeholder="Search every block and item" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} autoFocus />
      <div className="cats">{CTABS.map(([k, n]) => <button key={k} className={tab === k && !q ? 'on' : ''} onClick={() => { setTab(k); setQ(''); }}>{n}</button>)}</div>
      <div className="list inset">
        {list.map(({ d, data }) => {
          const s = { id: d.id, count: 1, data };
          return <div key={`${d.id}${data ?? ''}`} className="slot" onMouseDown={(e) => { e.preventDefault(); onPick(s, e.button, e.shiftKey); }} onMouseEnter={() => hover(s)} onMouseLeave={() => hover(null)} onContextMenu={(e) => e.preventDefault()}><ItemIcon s={s} /></div>;
        })}
      </div>
      {hotbar}
    </div>
  );
}
