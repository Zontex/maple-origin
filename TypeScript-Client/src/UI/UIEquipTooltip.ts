/**
 * v83 equip tooltip: the shared translucent navy plate (UIToolTipPlate),
 * UI.wz/UIWindow.img/ToolTip/Equip requirement labels + pixel digit glyphs
 * (Can = met/yellow, Cannot = unmet/grey), the per-class job words, and the
 * UIToolTip.img/Item/ItemIcon/base backplate under the 2x icon.
 *
 * Equip WZ info (reqLevel, incPAD, tuc, ...) is loaded lazily per item and
 * cached — draw() renders nothing on the first hover frames until ready.
 */
import GameCanvas from '../GameCanvas';
import { getItemFlagsSync } from '../Inventory/ItemRestrictions';
import WZManager from '../wz-utils/WZManager';
import { getEquipWzPath, EquipData } from '../Inventory/Item';
import { getItemNameSync } from '../Quest/QuestData';
import { formatRemaining } from '../Shop/CashShopData';
import MyCharacter from '../MyCharacter';
import { JOB_REQ_BITS } from '../Constants/Jobs';
import { drawPlate } from './UIToolTipPlate';

interface EquipInfo {
  reqLevel: number;
  reqSTR: number;
  reqDEX: number;
  reqINT: number;
  reqLUK: number;
  reqPOP: number;
  reqJob: number;
  tuc: number;
  stats: Record<string, number>;
  icon: HTMLImageElement | null;
}

interface GlyphSet {
  [char: string]: HTMLImageElement; // '0'-'9', '-', '+', '%' and reqLEV/reqSTR/... labels
}

interface TooltipAssets {
  jobsAble: HTMLImageElement[];
  jobsUnable: HTMLImageElement[];
  itemCategory: Record<number, HTMLImageElement>;
  weaponCategory: Record<number, HTMLImageElement>;
  property: Record<number, HTMLImageElement>;
  dot: HTMLImageElement | null;
  can: GlyphSet;
  cannot: GlyphSet;
  /** ItemIcon/base — the bevelled grey square the 2x icon sits on */
  iconBase: HTMLImageElement | null;
}

// Job bar order, matching the WZ sprite names under Can/Cannot
const JOB_SPRITES = ['beginner', 'warrior', 'magician', 'bowman', 'thief', 'pirate'];

// Equip prefix (itemId/10000) -> ItemCategory key. Not arithmetic: these are
// MapleStory's own enum values, which is why LONGCOAT is 21 rather than 6.
const ITEM_CATEGORY_KEY: Record<number, number> = {
  100: 1, 101: 2, 102: 3, 103: 4, 104: 5, 105: 21,
  106: 6, 107: 7, 108: 8, 109: 10, 110: 9, 111: 12,
};

// Display order and labels for equip stats (GMS wording)
const STAT_LABELS: [string, string][] = [
  ['incPAD', 'WEAPON ATTACK'],
  ['incMAD', 'MAGIC ATTACK'],
  ['incPDD', 'WEAPON DEF.'],
  ['incMDD', 'MAGIC DEF.'],
  ['incSTR', 'STR'],
  ['incDEX', 'DEX'],
  ['incINT', 'INT'],
  ['incLUK', 'LUK'],
  ['incMHP', 'MAX HP'],
  ['incMMP', 'MAX MP'],
  ['incACC', 'ACCURACY'],
  ['incEVA', 'AVOIDABILITY'],
  ['incSpeed', 'SPEED'],
  ['incJump', 'JUMP'],
];

// Stat key -> UIWindow.img/ToolTip/Equip/Property index. These are Nexon's own
// label images ("WEAPON ATTACK:", "NUMBER OF UPGRADES AVAILABLE:"), which is
// what the tooltip is supposed to render — the browser-font text we drew
// instead was the one part of the panel that was invented. STR/DEX/INT/LUK and
// the HP/MP lines have no sprite in v83 and stay as text, as in the original.
const PROPERTY_INDEX: Record<string, number> = {
  incPAD: 6, incMAD: 7, incPDD: 8, incMDD: 9,
  incACC: 10, incEVA: 11, incSpeed: 13, incJump: 14,
};
const PROP_CATEGORY_WEAPON = 3;
const PROP_CATEGORY_ITEM = 5;
const PROP_UPGRADES = 16;

// CATEGORY names by item prefix (Math.floor(id / 10000))
const CATEGORY_NAMES: Record<number, string> = {
  100: 'HAT', 101: 'FACE ACCESSORY', 102: 'EYE ACCESSORY', 103: 'EARRING',
  104: 'TOP', 105: 'OVERALL', 106: 'BOTTOM', 107: 'SHOES', 108: 'GLOVE',
  109: 'SHIELD', 110: 'CAPE', 111: 'RING', 112: 'PENDANT', 113: 'BELT',
  114: 'MEDAL',
  130: 'ONE-HANDED SWORD', 131: 'ONE-HANDED AXE', 132: 'ONE-HANDED MACE',
  133: 'DAGGER', 137: 'WAND', 138: 'STAFF',
  140: 'TWO-HANDED SWORD', 141: 'TWO-HANDED AXE', 142: 'TWO-HANDED MACE',
  143: 'SPEAR', 144: 'POLE ARM', 145: 'BOW', 146: 'CROSSBOW', 147: 'CLAW',
  148: 'KNUCKLE', 149: 'GUN',
  190: 'TAMING MOB', 191: 'SADDLE',
};

// v83 reqJob bitmask, indices match Job/enable|disable 0..5
// (beginner, warrior, magician, bowman, thief, pirate) — the same mask
// MapleCharacter.canEquip enforces, so a greyed word here means a refused equip
const JOB_BITS = JOB_REQ_BITS;

const W = 261;            // Frame piece width
const FRAME_CAP = 8;      // panel padding at top and bottom
const ICON_PLATE = 82;    // lightened square the item icon sits on
const ICON_X = 10;
const BLOCK_Y = 26;       // icon base + REQ block top
const REQ_ROW_H = 12;
const VALUE_COL = 56;     // digits column offset within the REQ block

const infoCache = new Map<number, EquipInfo | null>();
const loading = new Set<number>();

let assets: TooltipAssets | null = null;
let assetsLoading = false;

// Cannot/Disabled glyph dirs use word names where Can uses symbols
const GLYPH_ALIASES: Record<string, string> = { minus: '-', plus: '+', percent: '%' };

async function loadAssets() {
  assetsLoading = true;
  try {
    // v83 keeps these under UIWindow.img/ToolTip/Equip. UIToolTip.img does
    // not exist in this version — the copy we were reading was fetched from a
    // much later client, which is why the panel came out as that later
    // version's black rounded frame instead of the translucent navy one.
    const equip: any = await WZManager.get('UI.wz/UIWindow.img/ToolTip/Equip');

    const loadGlyphs = (dir: any): GlyphSet => {
      const set: GlyphSet = {};
      for (const child of dir.nChildren) {
        if (child.nName === 'none') continue;
        set[GLYPH_ALIASES[child.nName] ?? child.nName] = child.nGetImage();
      }
      return set;
    };

    // The job bar is per-class sprites in Can/Cannot, not a strip plus
    // overlays: BEGINNER lit means "usable by beginners", and the Cannot copy
    // of the same word is the greyed version.
    const jobsAble: HTMLImageElement[] = [];
    const jobsUnable: HTMLImageElement[] = [];
    for (const jn of JOB_SPRITES) {
      const a1 = equip.nGet('Can')?.nGet(jn);
      const a2 = equip.nGet('Cannot')?.nGet(jn);
      if (a1?.nGetImage) jobsAble.push(a1.nGetImage());
      if (a2?.nGetImage) jobsUnable.push(a2.nGetImage());
    }

    // Class labels, so the CATEGORY line is Nexon's own wording rather than
    // ours: ItemCategory keys are MapleStory's equip enum, WeaponCategory
    // keys are simply the item's 3-digit prefix minus 100.
    const loadCats = (dir: any): Record<number, HTMLImageElement> => {
      const out: Record<number, HTMLImageElement> = {};
      for (const c of dir?.nChildren || []) {
        if (c.nGetImage) out[Number(c.nName)] = c.nGetImage();
      }
      return out;
    };

    // The icon backplate is the one piece v83's own ToolTip/Equip lacks (the
    // pre-BB client carried it in the EXE). UIToolTip.img/Item/ItemIcon/base
    // from the later dump is the same 82x82 bevelled grey square, which is
    // what ICON_PLATE was already sized to.
    let iconBase: HTMLImageElement | null = null;
    try {
      const base: any = await WZManager.get('UI.wz/UIToolTip.img/Item/ItemIcon/base');
      iconBase = base?.nGetImage?.() || null;
    } catch { /* optional — the icon still draws on the plate */ }

    assets = {
      can: loadGlyphs(equip.nGet('Can')),
      cannot: loadGlyphs(equip.nGet('Cannot')),
      jobsAble,
      jobsUnable,
      itemCategory: loadCats(equip.nGet('ItemCategory')),
      weaponCategory: loadCats(equip.nGet('WeaponCategory')),
      property: loadCats(equip.nGet('Property')),
      dot: equip.nGet('Dot')?.nGet('0')?.nGetImage?.() || null,
      iconBase,
    };
  } catch (e) {
    console.error('[UIEquipTooltip] Failed to load UIToolTip.img assets:', e);
  } finally {
    assetsLoading = false;
  }
}

function wzNum(info: any, key: string): number {
  const v = info?.nGet?.(key)?.nValue;
  const n = typeof v === 'number' ? v : parseInt(v, 10);
  return Number.isFinite(n) ? n : 0;
}

async function loadInfo(itemId: number) {
  loading.add(itemId);
  try {
    const path = getEquipWzPath(itemId);
    if (!path) {
      infoCache.set(itemId, null);
      return;
    }
    const node: any = await WZManager.get(path);
    const info = node?.nGet?.('info');
    let icon: HTMLImageElement | null = null;
    try {
      const iconNode = info?.nGet?.('iconRaw');
      if (iconNode?.nGetImage) icon = iconNode.nGetImage();
    } catch { /* keep null */ }

    const stats: Record<string, number> = {};
    for (const [key] of STAT_LABELS) {
      const v = wzNum(info, key);
      if (v) stats[key] = v;
    }

    infoCache.set(itemId, {
      reqLevel: wzNum(info, 'reqLevel'),
      reqSTR: wzNum(info, 'reqSTR'),
      reqDEX: wzNum(info, 'reqDEX'),
      reqINT: wzNum(info, 'reqINT'),
      reqLUK: wzNum(info, 'reqLUK'),
      reqPOP: wzNum(info, 'reqPOP'),
      reqJob: wzNum(info, 'reqJob'),
      tuc: wzNum(info, 'tuc'),
      stats,
      icon,
    });
  } catch (e) {
    infoCache.set(itemId, null);
  } finally {
    loading.delete(itemId);
  }
}

/** Draw a string using the pixel digit glyphs; returns the advanced width */
function drawGlyphs(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, set: GlyphSet) {
  let gx = x;
  for (const ch of text) {
    const img = set[ch];
    if (!img || !img.width) { gx += 6; continue; }
    // '-' is a 5x1 dash — center it on the digit row
    const gy = ch === '-' ? y + 2 : y;
    ctx.drawImage(img, gx, gy);
    gx += img.width + 1;
  }
  return gx - x;
}

const UIEquipTooltip = {
  /**
   * Draw the tooltip anchored at (x, y), clamped to the canvas.
   * Returns false while the equip info is still loading (draw nothing) or
   * the item is not an equip — callers can fall back to a simple tooltip.
   */
  draw(canvas: GameCanvas, itemId: number, equipData: EquipData | null | undefined, x: number, y: number): boolean {
    if (Math.floor(itemId / 1000000) !== 1) return false;

    if (!assets) {
      if (!assetsLoading) loadAssets();
      return true; // loading — draw nothing this frame, but claim the tooltip
    }
    if (!infoCache.has(itemId)) {
      if (!loading.has(itemId)) loadInfo(itemId);
      return true;
    }
    const info = infoCache.get(itemId);
    if (!info) return false;

    const A = assets;
    const scrolls = equipData?.level ?? 0;
    const name = (getItemNameSync(itemId) || `Item ${itemId}`) + (scrolls > 0 ? ` (+${scrolls})` : '');

    // Total stats = WZ base + scroll bonuses
    const totals: Record<string, number> = { ...info.stats };
    if (equipData?.bonus) {
      for (const [key, v] of Object.entries(equipData.bonus)) {
        if (v) totals[key] = (totals[key] ?? 0) + v;
      }
    }
    const statLines = STAT_LABELS.filter(([key]) => totals[key]);
    const upgrades = equipData?.tuc ?? info.tuc;
    const prefix = Math.floor(itemId / 10000);
    // Weapons index straight off the prefix; everything else goes through the
    // enum. Falls back to our own wording only if the sprite is missing.
    const categoryImg =
      A.weaponCategory[prefix - 100] || A.itemCategory[ITEM_CATEGORY_KEY[prefix]] || null;
    const category = CATEGORY_NAMES[prefix] ?? 'EQUIP';

    // ---- Layout ----
    // Untradeable equips carry an "Untradeable" line under the name, which
    // pushes the icon/REQ block down a row
    const flags = getItemFlagsSync(itemId);
    const untradeable = !!(flags.tradeBlock || flags.quest);
    const headerExtra = untradeable ? 14 : 0;
    const blockTop = BLOCK_Y + headerExtra;
    const jobY = blockTop + ICON_PLATE + 6;
    const jobH = A.jobsAble[0]?.height || 13;  // Can/<class> sprites are 13px
    const divY = jobY + jobH + 5;
    const textY = divY + 7;
    const lineH = 14;
    const bottomLines =
      1 + statLines.length + 1 + (equipData?.expireAt ? 1 : 0); // CATEGORY + stats + upgrades + rental
    const H = textY + bottomLines * lineH + 4 + FRAME_CAP;

    const canvasW = canvas.game?.width || 800;
    const canvasH = canvas.game?.height || 600;
    let tx = x, ty = y;
    if (tx + W > canvasW) tx = Math.max(0, canvasW - W);
    if (ty + H > canvasH) ty = Math.max(0, canvasH - H);

    const ctx = canvas.context;

    // ---- Panel ---- (the shared v83 translucent navy plate; see UIToolTipPlate)
    drawPlate(ctx, tx, ty, W, H);

    // ---- Name ----
    canvas.drawText({
      text: name,
      x: tx + W / 2, y: ty + 8,
      color: '#FFFFFF', fontSize: 13, fontWeight: 'bold',
      align: 'center',
    });

    if (untradeable) {
      canvas.drawText({
        text: 'Untradeable',
        x: tx + W / 2, y: ty + 8 + 15,
        color: '#FF9955', fontSize: 11,
        align: 'center',
      });
    }

    // ---- Icon on its backplate, drawn 2x pixel-scaled ----
    const blockY = ty + blockTop;
    if (A.iconBase && A.iconBase.complete && A.iconBase.width > 0) {
      ctx.drawImage(A.iconBase, tx + ICON_X, blockY, ICON_PLATE, ICON_PLATE);
    }
    if (info.icon && info.icon.complete && info.icon.width > 0) {
      const prev = ctx.imageSmoothingEnabled;
      ctx.imageSmoothingEnabled = false;
      const iw = Math.min(ICON_PLATE - 8, info.icon.width * 2);
      const ih = Math.min(ICON_PLATE - 8, info.icon.height * 2);
      ctx.drawImage(
        info.icon,
        tx + ICON_X + (ICON_PLATE - iw) / 2,
        blockY + (ICON_PLATE - ih) / 2,
        iw, ih,
      );
      ctx.imageSmoothingEnabled = prev;
    }

    // ---- REQ block (sprite labels + pixel digits, Can = met / Cannot = unmet) ----
    const s: any = MyCharacter.stats || {};
    const reqs: { key: string; value: number; met: boolean; dash?: boolean }[] = [
      { key: 'reqLEV', value: info.reqLevel, met: (s.level ?? 1) >= info.reqLevel },
      { key: 'reqSTR', value: info.reqSTR, met: (s.str ?? 0) >= info.reqSTR },
      { key: 'reqDEX', value: info.reqDEX, met: (s.dex ?? 0) >= info.reqDEX },
      { key: 'reqINT', value: info.reqINT, met: (s.int ?? 0) >= info.reqINT },
      { key: 'reqLUK', value: info.reqLUK, met: (s.luk ?? 0) >= info.reqLUK },
      { key: 'reqPOP', value: info.reqPOP, met: true, dash: info.reqPOP === 0 },
    ];
    const reqX = tx + ICON_X + ICON_PLATE + 9;
    reqs.forEach((req, i) => {
      const set = req.met ? A.can : A.cannot;
      const label = set[req.key];
      const ry = blockY + 4 + i * REQ_ROW_H;
      if (label && label.width) ctx.drawImage(label, reqX, ry);
      drawGlyphs(ctx, req.dash ? '-' : String(req.value), reqX + VALUE_COL, ry, set);
    });

    // ---- Job class bar: lit word per usable class, greyed otherwise ----
    const jobImgs = A.jobsAble.map((able, i) => {
      const usable = info.reqJob === 0 || (i > 0 && (info.reqJob & JOB_BITS[i]) !== 0);
      return usable ? able : (A.jobsUnable[i] || able);
    });
    const jobGap = 2;
    const jobTotal = jobImgs.reduce((w, im) => w + (im?.width || 0) + jobGap, -jobGap);
    let jx = tx + Math.floor((W - jobTotal) / 2);
    const jy = ty + jobY;
    for (const im of jobImgs) {
      if (im?.width) { ctx.drawImage(im, jx, jy); jx += im.width + jobGap; }
    }

    // ---- Separator ----
    ctx.save();
    ctx.strokeStyle = 'rgba(220, 226, 245, 0.9)';
    ctx.beginPath();
    ctx.moveTo(tx + 6, ty + divY + 0.5);
    ctx.lineTo(tx + W - 6, ty + divY + 0.5);
    ctx.stroke();
    ctx.restore();

    // ---- Category, stats, upgrades (game-font text like the original) ----
    let ly = ty + textY;
    // A line is: orange dot, Nexon's label sprite, then the value as text.
    // Only the number is text — every label that exists as a sprite uses it.
    const drawSpriteLine = (labelImg: HTMLImageElement | null, value: string, fallback?: string) => {
      let lx = tx + ICON_X;
      if (A.dot?.width) { ctx.drawImage(A.dot, lx, ly + 3); lx += A.dot.width + 3; }
      if (labelImg?.width) {
        ctx.drawImage(labelImg, lx, ly + 2);
        lx += labelImg.width + 4;
      } else if (fallback) {
        canvas.drawText({
          text: `${fallback} :`, x: lx, y: ly,
          color: '#FFFFFF', fontSize: 11, fontWeight: 'bold',
        });
        lx += fallback.length * 7 + 8;
      }
      if (value) {
        // Values use the Can digit glyphs, the same bitmap font the REQ block
        // draws with. Can/0-9 exist alongside Cannot/0-9 — the "met" set — and
        // ignoring them was what left 42 and 7 in a browser font beside
        // Nexon's own labels. Anything the glyph set cannot express (a sign,
        // say) still falls back to text rather than silently dropping out.
        const renderable = /^[0-9]+$/.test(value);
        if (renderable) {
          drawGlyphs(ctx, value, lx, ly + 3, A.can);
        } else {
          canvas.drawText({
            text: value, x: lx, y: ly,
            color: '#FFFFFF', fontSize: 11, fontWeight: 'bold',
          });
        }
      }
      ly += lineH;
    };
    const drawStat = (label: string, value: string) => drawSpriteLine(null, value, label);
    // CATEGORY — Property has two variants; weapons use 3, everything else 5
    const isWeapon = prefix >= 130 && prefix <= 170;
    const catLabel = A.property[isWeapon ? PROP_CATEGORY_WEAPON : PROP_CATEGORY_ITEM] || null;
    if (categoryImg?.width) {
      let lx = tx + ICON_X;
      if (A.dot?.width) { ctx.drawImage(A.dot, lx, ly + 3); lx += A.dot.width + 3; }
      if (catLabel?.width) { ctx.drawImage(catLabel, lx, ly + 2); lx += catLabel.width + 4; }
      ctx.drawImage(categoryImg, lx, ly + 2);
      ly += lineH;
    } else {
      drawStat('CATEGORY', category);
    }
    for (const [key, label] of statLines) {
      drawSpriteLine(A.property[PROPERTY_INDEX[key]] || null, `${totals[key]}`, label);
    }
    drawSpriteLine(A.property[PROP_UPGRADES] || null, `${upgrades}`, 'NUMBER OF UPGRADES AVAILABLE');

    // Cash Shop rental countdown — orange, like other cash-restriction text
    if (equipData?.expireAt) {
      canvas.drawText({
        text: `Remaining: ${formatRemaining(equipData.expireAt)}`,
        x: tx + ICON_X, y: ly,
        color: '#FFAA00', fontSize: 11, fontWeight: 'bold',
      });
      ly += lineH;
    }

    return true;
  },
};

export default UIEquipTooltip;
