import GameCanvas from '../GameCanvas';
import { getItemNameSync, getItemDescSync } from '../Quest/QuestData';
import UIEquipTooltip from './UIEquipTooltip';
import { drawPlate } from './UIToolTipPlate';

/**
 * Hover tooltip for a list row (shop, storage): equips get the full
 * UIEquipTooltip, everything else name + String.wz description on the shared
 * plate with `#c..#` rendered orange. Anchored beside the window rather than
 * on the row, so the list being browsed stays visible.
 *
 * @param windowX/windowW  the window the list belongs to — the panel goes to
 *                         its right, or its left when there is no room
 * @param hoverY           the hovered row's top; the panel opens a little above it
 */
export function drawItemHoverTooltip(
  canvas: GameCanvas,
  item: { itemId?: number; id?: number; name?: string; equipData?: any } | null,
  windowX: number,
  windowW: number,
  hoverY: number,
): void {
  if (!item) return;
  const itemId = item.itemId ?? item.id;
  if (!itemId) return;

  const NOMINAL_W = 260;
  let ax = windowX + windowW + 6;
  if (ax + NOMINAL_W > canvas.game.width) ax = Math.max(2, windowX - NOMINAL_W - 6);
  const ay = Math.max(2, hoverY - 20);

  if (Math.floor(itemId / 1000000) === 1) {
    if (UIEquipTooltip.draw(canvas, itemId, item.equipData, ax, ay)) return;
  }

  const name = getItemNameSync(itemId) || item.name || '';
  const desc = (getItemDescSync(itemId) || '').replace(/\\n/g, '\n');
  if (!name && !desc) return;

  const ctx = canvas.context;
  const W = 210, PAD = 8, LINE = 13;
  ctx.save();
  ctx.font = '11px Arial';

  const lines: { text: string; color: string }[] = [];
  lines.push({ text: name, color: '#ffcc00' });
  for (const para of desc.split('\n')) {
    // #c..# is the orange highlight; other codes are chrome and get dropped
    const cleaned = para.replace(/#c(.*?)#/g, '$1').replace(/#[a-z]/g, '');
    let line = '';
    for (const word of cleaned.split(' ')) {
      const test = line ? line + ' ' + word : word;
      if (ctx.measureText(test).width > W - PAD * 2 && line) {
        lines.push({ text: line, color: '#ffffff' });
        line = word;
      } else {
        line = test;
      }
    }
    if (line) lines.push({ text: line, color: '#ffffff' });
  }

  const H = PAD * 2 + lines.length * LINE;
  let tx = ax;
  let ty = ay;
  if (tx + W > canvas.game.width) tx = canvas.game.width - W - 2;
  if (ty + H > canvas.game.height) ty = canvas.game.height - H - 2;
  if (ty < 0) ty = 0;

  drawPlate(ctx, tx, ty, W, H);

  ctx.textAlign = 'left';
  let y = ty + PAD + 10;
  for (const l of lines) {
    ctx.fillStyle = l.color;
    ctx.font = l.color === '#ffcc00' ? 'bold 11px Arial' : '11px Arial';
    ctx.fillText(l.text, tx + PAD, y);
    y += LINE;
  }
  ctx.restore();
}
