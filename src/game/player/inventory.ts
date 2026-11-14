import { ITEMS, stackLimit, sameItem, maxDurability, type ItemStack } from '../registry/items';
import { enchLevel } from '../registry/enchant';

export const HOTBAR = 9;
export const MAIN = 36; // 0-8 hotbar, 9-35 main
export const ARMOR0 = 36; // 36 head, 37 chest, 38 legs, 39 feet
export const OFFHAND = 40;
export const INV_SIZE = 41;

export const cloneStack = (s: ItemStack | null): ItemStack | null => (s ? structuredClone(s) : null);
export function mkStack(id: number, count = 1, extra: Partial<ItemStack> = {}): ItemStack { return { id, count, ...extra }; }

export class Inventory {
  slots: (ItemStack | null)[] = new Array(INV_SIZE).fill(null);
  selected = 0;
  version = 0;
  get held(): ItemStack | null { return this.slots[this.selected]; }
  set held(s: ItemStack | null) { this.slots[this.selected] = s; this.version++; }
  get offhand() { return this.slots[OFFHAND]; }
  changed() { this.version++; }

  /** add a stack; returns leftover (or null) */
  add(s: ItemStack): ItemStack | null {
    const left = { ...s };
    const lim = stackLimit(s.id);
    // merge into existing stacks (hotbar first, then main)
    for (let i = 0; i < MAIN && left.count > 0; i++) {
      const t = this.slots[i];
      if (t && sameItem(t, left) && t.count < lim) {
        const n = Math.min(lim - t.count, left.count);
        t.count += n; left.count -= n;
      }
    }
    for (let i = 0; i < MAIN && left.count > 0; i++) {
      if (!this.slots[i]) {
        const n = Math.min(lim, left.count);
        this.slots[i] = { ...left, count: n };
        left.count -= n;
      }
    }
    this.version++;
    return left.count > 0 ? left : null;
  }
  count(pred: (s: ItemStack) => boolean): number {
    let n = 0;
    for (let i = 0; i < INV_SIZE; i++) { const s = this.slots[i]; if (s && pred(s)) n += s.count; }
    return n;
  }
  countId(id: number) { return this.count((s) => s.id === id); }
  /** remove n items matching predicate; returns how many were removed */
  remove(pred: (s: ItemStack) => boolean, n: number): number {
    let left = n;
    for (let i = 0; i < INV_SIZE && left > 0; i++) {
      const s = this.slots[i];
      if (!s || !pred(s)) continue;
      const k = Math.min(s.count, left);
      s.count -= k; left -= k;
      if (s.count <= 0) this.slots[i] = null;
    }
    this.version++;
    return n - left;
  }
  consumeHeld(n = 1) {
    const h = this.held;
    if (!h) return;
    h.count -= n;
    if (h.count <= 0) this.held = null;
    this.version++;
  }
  /** damage held tool; returns true if it broke */
  damageSlot(slot: number, amount = 1): boolean {
    const s = this.slots[slot];
    if (!s) return false;
    const max = maxDurability(s);
    if (!max) return false;
    const unb = enchLevel(s, 'endurance');
    for (let i = 0; i < amount; i++) {
      if (unb && Math.random() < unb / (unb + 1)) continue;
      s.dmg = (s.dmg ?? 0) + 1;
    }
    this.version++;
    if ((s.dmg ?? 0) >= max) { this.slots[slot] = null; return true; }
    return false;
  }
  armorPoints(): number {
    let p = 0;
    for (let i = ARMOR0; i < ARMOR0 + 4; i++) { const s = this.slots[i]; if (s) p += ITEMS[s.id].armor?.points ?? 0; }
    return p;
  }
  armorToughness(): number {
    let p = 0;
    for (let i = ARMOR0; i < ARMOR0 + 4; i++) { const s = this.slots[i]; if (s) p += ITEMS[s.id].armor?.toughness ?? 0; }
    return p;
  }
  enchantTotal(key: string, slots = [ARMOR0, ARMOR0 + 1, ARMOR0 + 2, ARMOR0 + 3]) {
    return slots.reduce((a, i) => a + enchLevel(this.slots[i], key), 0);
  }
  clear() { this.slots.fill(null); this.version++; }
  serialize() { return { slots: this.slots, selected: this.selected }; }
  load(d: { slots?: (ItemStack | null)[]; selected?: number } | undefined) {
    if (!d?.slots) return;
    this.slots = new Array(INV_SIZE).fill(null);
    d.slots.forEach((s, i) => { if (s && ITEMS[s.id] && i < INV_SIZE) this.slots[i] = s; });
    this.selected = Math.max(0, Math.min(8, d.selected ?? 0));
    this.version++;
  }
}

/** Generic container helpers used by chests, furnaces, hoppers */
export function insertInto(slots: (ItemStack | null)[], s: ItemStack, range: number[] = slots.map((_, i) => i)): ItemStack | null {
  const left = { ...s };
  const lim = stackLimit(s.id);
  for (const i of range) {
    const t = slots[i];
    if (t && sameItem(t, left) && t.count < lim) { const n = Math.min(lim - t.count, left.count); t.count += n; left.count -= n; if (!left.count) return null; }
  }
  for (const i of range) {
    if (!slots[i]) { const n = Math.min(lim, left.count); slots[i] = { ...left, count: n }; left.count -= n; if (!left.count) return null; }
  }
  return left;
}
