/**
 * GMS v83-style equip tooltip: item name with scroll count, enlarged icon,
 * REQ stat block, job-class bar, category and stat lines with remaining
 * upgrade slots. Drawn on canvas in the same dark-navy style as the other
 * item tooltips (UIToolTip.img is not among the converted WZ assets).
 *
 * Equip WZ info (reqLevel, incPAD, tuc, ...) is loaded lazily per item and
 * cached — draw() renders nothing on the first hover frames until ready.
 */
import GameCanvas from '../GameCanvas';
import WZManager from '../wz-utils/WZManager';
import { getEquipWzPath, EquipData } from '../Inventory/Item';
import { getItemNameSync } from '../Quest/QuestData';

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

// v83 reqJob bitmask → job bar entries. reqJob 0 = usable by every class.
const JOB_BAR: { label: string; bit: number }[] = [
  { label: 'BEGINNER', bit: 0 },
  { label: 'WARRIOR', bit: 1 },
  { label: 'MAGICIAN', bit: 2 },
  { label: 'BOWMAN', bit: 4 },
  { label: 'THIEF', bit: 8 },
  { label: 'PIRATE', bit: 16 },
];

const infoCache = new Map<number, EquipInfo | null>();
const loading = new Set<number>();

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

const UIEquipTooltip = {
  /**
   * Draw the tooltip anchored at (x, y), clamped to the canvas.
   * Returns false while the equip info is still loading (draw nothing) or
   * the item is not an equip — callers can fall back to a simple tooltip.
   */
  draw(canvas: GameCanvas, itemId: number, equipData: EquipData | null | undefined, x: number, y: number): boolean {
    if (Math.floor(itemId / 1000000) !== 1) return false;

    if (!infoCache.has(itemId)) {
      if (!loading.has(itemId)) loadInfo(itemId);
      return true; // loading — draw nothing this frame, but claim the tooltip
    }
    const info = infoCache.get(itemId);
    if (!info) return false;

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
    const W = 240;
    const pad = 9;
    const lineH = 14;
    const nameH = 20;
    const iconArea = 68;                    // 64px icon + breathing room
    const reqRows = 8;                      // REQ LEV..FAM + ITEM LEV/EXP
    const reqBlockH = reqRows * lineH;
    const topBlockH = Math.max(iconArea, reqBlockH) + 4;
    const jobBarH = 16;
    const bottomLines = 1 + statLines.length + 1; // CATEGORY + stats + upgrades
    const H = pad + nameH + topBlockH + jobBarH + 6 + bottomLines * lineH + pad;

    const canvasW = canvas.game?.width || 1024;
    const canvasH = canvas.game?.height || 768;
    let tx = x, ty = y;
    if (tx + W > canvasW) tx = Math.max(0, canvasW - W);
    if (ty + H > canvasH) ty = Math.max(0, canvasH - H);

    // ---- Frame ----
    canvas.drawRect({
      x: tx, y: ty, width: W, height: H,
      color: '#1a1230', alpha: 0.94,
      stroke: '#6666AA', strokeWidth: 1,
    });

    // ---- Name ----
    canvas.drawText({
      text: name,
      x: tx + W / 2, y: ty + pad,
      color: '#FFFFFF', fontSize: 13, fontWeight: 'bold',
      align: 'center',
    });

    // ---- Icon (drawn 2x, pixel-scaled like the original client) ----
    const blockY = ty + pad + nameH;
    if (info.icon && info.icon.complete && info.icon.width > 0) {
      const iw = Math.min(64, info.icon.width * 2);
      const ih = Math.min(64, info.icon.height * 2);
      canvas.context.drawImage(
        info.icon,
        tx + pad + (iconArea - 8 - iw) / 2,
        blockY + (topBlockH - ih) / 2 - 4,
        iw, ih,
      );
    }

    // ---- REQ block ----
    const reqX = tx + pad + iconArea + 6;
    const reqs: { label: string; value: string; dim?: boolean }[] = [
      { label: 'REQ LEV', value: `${info.reqLevel}` },
      { label: 'REQ STR', value: `${info.reqSTR}` },
      { label: 'REQ DEX', value: `${info.reqDEX}` },
      { label: 'REQ INT', value: `${info.reqINT}` },
      { label: 'REQ LUK', value: `${info.reqLUK}` },
      { label: 'REQ FAM', value: info.reqPOP ? `${info.reqPOP}` : '-' },
      { label: 'ITEM LEV', value: '-', dim: true },
      { label: 'ITEM EXP', value: '-', dim: true },
    ];
    reqs.forEach((req, i) => {
      const ry = blockY + i * lineH;
      canvas.drawText({
        text: req.label, x: reqX, y: ry,
        color: req.dim ? '#555577' : '#BBBBCC', fontSize: 11, fontWeight: 'bold',
      });
      canvas.drawText({
        text: `: ${req.value}`, x: reqX + 66, y: ry,
        color: req.dim ? '#555577' : '#FFFFFF', fontSize: 11, fontWeight: 'bold',
      });
    });

    // ---- Job class bar ----
    const jobY = blockY + topBlockH;
    let jx = tx + pad;
    for (const job of JOB_BAR) {
      const usable = info.reqJob === 0 || (job.bit !== 0 && (info.reqJob & job.bit) !== 0);
      canvas.drawText({
        text: job.label, x: jx, y: jobY,
        color: usable ? '#FFDD55' : '#555577', fontSize: 9, fontWeight: 'bold',
      });
      jx += (canvas.measureText({ text: job.label, fontSize: 9, fontWeight: 'bold' })?.width || 40) + 7;
    }

    // ---- Divider ----
    const divY = jobY + jobBarH;
    canvas.drawLine({
      x1: tx + 4, y1: divY, x2: tx + W - 4, y2: divY,
      color: '#44446A', width: 1,
    });

    // ---- Category, stats, upgrades ----
    let ly = divY + 6;
    const drawStat = (label: string, value: string) => {
      canvas.drawText({
        text: `${label} : `, x: tx + pad, y: ly,
        color: '#BBBBCC', fontSize: 11, fontWeight: 'bold',
      });
      const lw = canvas.measureText({ text: `${label} : `, fontSize: 11, fontWeight: 'bold' })?.width || 0;
      canvas.drawText({
        text: value, x: tx + pad + lw, y: ly,
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
