/**
 * v83 equip tooltip rendered from UI.wz/UIToolTip.img/Item sprites:
 * Frame top/line/bottom/cover/dotline, ItemIcon/base backplate, Equip
 * requirement labels + pixel digit glyphs (Can = met/yellow, Cannot =
 * unmet/grey) and the job-class bar (Job/normal + Job/enable overlays).
 *
 * Equip WZ info (reqLevel, incPAD, tuc, ...) is loaded lazily per item and
 * cached — draw() renders nothing on the first hover frames until ready.
 */
import GameCanvas from '../GameCanvas';
import WZManager from '../wz-utils/WZManager';
import { getEquipWzPath, EquipData } from '../Inventory/Item';
import { getItemNameSync } from '../Quest/QuestData';
import MyCharacter from '../MyCharacter';

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
  top: HTMLImageElement;
  line: HTMLImageElement;
  bottom: HTMLImageElement;
  cover: HTMLImageElement;
  dotline: HTMLImageElement;
  iconBase: HTMLImageElement;
  can: GlyphSet;
  cannot: GlyphSet;
  jobNormal: HTMLImageElement;
  jobEnable: { img: HTMLImageElement; ox: number; oy: number }[];
}

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
const JOB_BITS = [0, 1, 2, 4, 8, 16]; // beginner, warrior, magician, bowman, thief, pirate

const W = 261;            // Frame piece width
const FRAME_CAP = 13;     // top/bottom piece heights
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
    const tt: any = await WZManager.get('UI.wz/UIToolTip.img');
    const item = tt.nGet('Item');
    const frame = item.nGet('Frame');
    const equip = item.nGet('Equip');

    const loadGlyphs = (dir: any): GlyphSet => {
      const set: GlyphSet = {};
      for (const child of dir.nChildren) {
        if (child.nName === 'none') continue;
        set[GLYPH_ALIASES[child.nName] ?? child.nName] = child.nGetImage();
      }
      return set;
    };

    const jobEnable: TooltipAssets['jobEnable'] = [];
    const enableDir = equip.nGet('Job').nGet('enable');
    for (let i = 0; i < 6; i++) {
      const n = enableDir.nGet(String(i));
      jobEnable.push({
        img: n.nGetImage(),
        ox: n.origin?.nX ?? 0,
        oy: n.origin?.nY ?? 0,
      });
    }

    assets = {
      top: frame.nGet('top').nGetImage(),
      line: frame.nGet('line').nGetImage(),
      bottom: frame.nGet('bottom').nGetImage(),
      cover: frame.nGet('cover').nGetImage(),
      dotline: frame.nGet('dotline').nGetImage(),
      iconBase: item.nGet('ItemIcon').nGet('base').nGetImage(),
      can: loadGlyphs(equip.nGet('Can')),
      cannot: loadGlyphs(equip.nGet('Cannot')),
      jobNormal: equip.nGet('Job').nGet('normal').nGetImage(),
      jobEnable,
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
    const category = CATEGORY_NAMES[Math.floor(itemId / 10000)] ?? 'EQUIP';

    // ---- Layout ----
    const baseH = A.iconBase.height || 82;
    const jobY = BLOCK_Y + baseH + 6;
    const jobH = A.jobNormal.height || 24;
    const divY = jobY + jobH + 5;
    const textY = divY + 7;
    const lineH = 14;
    const bottomLines = 1 + statLines.length + 1; // CATEGORY + stats + upgrades
    const H = textY + bottomLines * lineH + 4 + FRAME_CAP;

    const canvasW = canvas.game?.width || 800;
    const canvasH = canvas.game?.height || 600;
    let tx = x, ty = y;
    if (tx + W > canvasW) tx = Math.max(0, canvasW - W);
    if (ty + H > canvasH) ty = Math.max(0, canvasH - H);

    const ctx = canvas.context;

    // ---- Frame (top cap + stretched 1px line body + bottom cap + shine) ----
    ctx.drawImage(A.top, tx, ty);
    ctx.drawImage(A.line, tx, ty + FRAME_CAP, W, H - FRAME_CAP * 2);
    ctx.drawImage(A.bottom, tx, ty + H - FRAME_CAP);
    ctx.drawImage(A.cover, tx + 3, ty + 3);

    // ---- Name ----
    canvas.drawText({
      text: name,
      x: tx + W / 2, y: ty + 8,
      color: '#FFFFFF', fontSize: 13, fontWeight: 'bold',
      align: 'center',
    });

    // ---- Icon on its backplate, drawn 2x pixel-scaled ----
    const blockY = ty + BLOCK_Y;
    ctx.drawImage(A.iconBase, tx + ICON_X, blockY);
    if (info.icon && info.icon.complete && info.icon.width > 0) {
      const prev = ctx.imageSmoothingEnabled;
      ctx.imageSmoothingEnabled = false;
      const iw = Math.min(72, info.icon.width * 2);
      const ih = Math.min(72, info.icon.height * 2);
      ctx.drawImage(
        info.icon,
        tx + ICON_X + ((A.iconBase.width || 82) - iw) / 2,
        blockY + (baseH - ih) / 2,
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
    const reqX = tx + ICON_X + (A.iconBase.width || 82) + 9;
    reqs.forEach((req, i) => {
      const set = req.met ? A.can : A.cannot;
      const label = set[req.key];
      const ry = blockY + 4 + i * REQ_ROW_H;
      if (label && label.width) ctx.drawImage(label, reqX, ry);
      drawGlyphs(ctx, req.dash ? '-' : String(req.value), reqX + VALUE_COL, ry, set);
    });

    // ---- Job class bar (grey bar + yellow overlays for usable classes) ----
    const jx = tx + Math.floor((W - (A.jobNormal.width || 237)) / 2);
    const jy = ty + jobY;
    ctx.drawImage(A.jobNormal, jx, jy);
    A.jobEnable.forEach((job, i) => {
      const usable = info.reqJob === 0 || (i > 0 && (info.reqJob & JOB_BITS[i]) !== 0);
      if (usable && job.img.width) {
        ctx.drawImage(job.img, jx - job.ox, jy - job.oy);
      }
    });

    // ---- Dotted separator ----
    ctx.drawImage(A.dotline, tx, ty + divY);

    // ---- Category, stats, upgrades (game-font text like the original) ----
    let ly = ty + textY;
    const drawStat = (label: string, value: string) => {
      canvas.drawText({
        text: `${label} : ${value}`, x: tx + ICON_X, y: ly,
        color: '#FFFFFF', fontSize: 11, fontWeight: 'bold',
      });
      ly += lineH;
    };
    drawStat('CATEGORY', category);
    for (const [key, label] of statLines) {
      drawStat(label, `${totals[key]}`);
    }
    drawStat('NUMBER OF UPGRADES AVAILABLE', `${upgrades}`);

    return true;
  },
};

export default UIEquipTooltip;
