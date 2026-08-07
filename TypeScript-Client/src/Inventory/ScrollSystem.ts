import { EquipData } from './Item';

// WZ stat keys a scroll can add (scroll info inc* -> equip bonus inc*)
const SCROLL_STAT_KEYS = [
  'incSTR', 'incDEX', 'incINT', 'incLUK',
  'incPAD', 'incMAD', 'incPDD', 'incMDD',
  'incACC', 'incEVA', 'incSpeed', 'incJump',
  'incMHP', 'incMMP',
];

export interface ScrollResult {
  applied: boolean;      // scroll consumed
  success: boolean;      // stats added
  destroyed: boolean;    // cursed roll destroyed the equip
  message: string;
}

/** Scroll category digits must match the equip prefix (2040002 -> 100 = Cap) */
export function isScrollCompatible(scrollId: number, equipId: number): boolean {
  const scrollTarget = Math.floor(scrollId / 100) % 1000;
  const equipPrefix = Math.floor(equipId / 10000);
  return scrollTarget === equipPrefix;
}

/**
 * v83 scroll application (Cosmic scrollEquipWithId): roll info/success percent;
 * on success add the scroll's inc* stats and use a slot; on fail use a slot and
 * roll info/cursed percent to destroy the equip. The scroll is always consumed.
 */
export function applyScroll(
  scrollNode: any,
  scrollId: number,
  equipId: number,
  equipData: EquipData
): ScrollResult {
  if (!isScrollCompatible(scrollId, equipId)) {
    return { applied: false, success: false, destroyed: false, message: 'This scroll cannot be applied to that item.' };
  }
  if (equipData.tuc <= 0) {
    return { applied: false, success: false, destroyed: false, message: 'This item has no upgrades available.' };
  }

  const info = scrollNode?.info;
  const successPct = info?.success?.nValue ?? 100;
  const cursedPct = info?.cursed?.nValue ?? 0;

  equipData.tuc--;

  if (Math.random() * 100 < successPct) {
    for (const key of SCROLL_STAT_KEYS) {
      const inc = info?.[key]?.nValue ?? 0;
      if (inc) equipData.bonus[key] = (equipData.bonus[key] || 0) + inc;
    }
    equipData.level++;
    return { applied: true, success: true, destroyed: false, message: 'The scroll lit up, and the item was upgraded.' };
  }

  if (cursedPct > 0 && Math.random() * 100 < cursedPct) {
    return { applied: true, success: false, destroyed: true, message: 'The scroll was cursed and the item was destroyed...' };
  }

  return { applied: true, success: false, destroyed: false, message: 'The scroll failed and the upgrade was lost.' };
}
