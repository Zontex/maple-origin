import GameCanvas from '../GameCanvas';
import GUIUtil from '../GuiUtils';
import { BalloonArt } from './PetWzData';

/**
 * Pet name tag + chat balloon renderers, drawn in the map's overlay pass
 * (above all layers). The tag is the WZ 3-slice (w|c|e); the balloon is the
 * same 9-patch layout MapleCharacter.drawChatBalloon uses.
 */

export interface PetNameTagArt {
  w: HTMLImageElement;
  c: HTMLImageElement;
  e: HTMLImageElement;
  color: string;
}

export function drawPetNameTag(
  canvas: GameCanvas,
  art: PetNameTagArt | null,
  text: string,
  screenX: number, // pet position x on screen (feet anchor)
  screenY: number  // pet feet y on screen
) {
  if (!text) return;
  const nameOpts = {
    text,
    x: Math.floor(screenX),
    y: 0,
    color: art?.color ?? '#ffffff',
    align: 'center' as const,
  };
  const textW = Math.ceil(canvas.measureText(nameOpts).width);

  if (art && art.w.width) {
    const capW = art.w.width;
    const capE = art.e.width;
    const h = art.c.height || 21;
    const innerW = textW + 4;
    const bx = Math.round(screenX - (capW + innerW + capE) / 2);
    const by = Math.floor(screenY + 2);
    canvas.drawImage({ img: art.w, dx: bx, dy: by });
    const ctx = canvas.context;
    ctx.save();
    ctx.beginPath();
    ctx.rect(bx + capW, by, innerW, h);
    ctx.clip();
    GUIUtil.tileRange(bx + capW, bx + capW + innerW, art.c.width || 4, (tx: number) =>
      canvas.drawImage({ img: art.c, dx: tx, dy: by })
    );
    ctx.restore();
    canvas.drawImage({ img: art.e, dx: bx + capW + innerW, dy: by });
    nameOpts.y = by + Math.floor((h - 12) / 2) + 1;
    canvas.drawText(nameOpts);
  } else {
    // Plain fallback: player-style black box + white text
    const tagH = 16;
    const w = textW + 4;
    const bx = Math.round(screenX - w / 2);
    const by = Math.floor(screenY + 2);
    canvas.drawRect({ x: bx, y: by, width: w, height: tagH, color: '#000000', alpha: 0.7 });
    nameOpts.y = by + 3;
    canvas.drawText(nameOpts);
  }
}

/**
 * 9-patch balloon above the pet, tail anchored to the sprite top — same
 * layout math as MapleCharacter.drawChatBalloon, parameterized on the piece
 * set so it works for any ChatBalloon.img style.
 */
export function drawPetBalloon(
  canvas: GameCanvas,
  art: BalloonArt,
  text: string,
  screenX: number,   // pet center x on screen
  spriteTopY: number // top of the pet sprite on screen
) {
  if (!text) return;
  const fontSize = 12;
  const lineH = 14;
  const maxTextW = 140;
  const padX = 8, padY = 4;

  const words = text.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    if (canvas.measureText({ text: test, fontSize }).width > maxTextW && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = test;
    }
  }
  if (cur) lines.push(cur);

  let textW = 0;
  for (const l of lines) textW = Math.max(textW, canvas.measureText({ text: l, fontSize }).width);
  const textH = lines.length * lineH;

  const { nw, ne, sw, se, n, s, w, e, c, arrow } = art;
  const nwW = nw.width, nwH = nw.height;
  const innerW = Math.max(textW + padX * 2, 40);
  const innerH = Math.max(textH + padY * 2, 16);
  const totalW = nwW + innerW + ne.width;
  const totalH = nwH + innerH + sw.height;

  const bx = Math.round(screenX - totalW / 2);
  const arrowH = arrow.height || 7;
  const by = Math.round(spriteTopY - totalH - arrowH + 2);

  const ctx = canvas.context;
  ctx.save();

  canvas.drawImage({ img: nw, dx: bx, dy: by });
  canvas.drawImage({ img: ne, dx: bx + totalW - ne.width, dy: by });
  canvas.drawImage({ img: sw, dx: bx, dy: by + totalH - sw.height });
  canvas.drawImage({ img: se, dx: bx + totalW - se.width, dy: by + totalH - se.height });

  ctx.save(); ctx.beginPath(); ctx.rect(bx + nwW, by, innerW, nwH); ctx.clip();
  GUIUtil.tileRange(bx + nwW, bx + nwW + innerW, n.width, (tx: number) =>
    canvas.drawImage({ img: n, dx: tx, dy: by }));
  ctx.restore();

  ctx.save(); ctx.beginPath(); ctx.rect(bx + nwW, by + totalH - s.height, innerW, s.height); ctx.clip();
  GUIUtil.tileRange(bx + nwW, bx + nwW + innerW, s.width, (tx: number) =>
    canvas.drawImage({ img: s, dx: tx, dy: by + totalH - s.height }));
  ctx.restore();

  ctx.save(); ctx.beginPath(); ctx.rect(bx, by + nwH, w.width, innerH); ctx.clip();
  GUIUtil.tileRange(by + nwH, by + nwH + innerH, w.height, (ty: number) =>
    canvas.drawImage({ img: w, dx: bx, dy: ty }));
  ctx.restore();

  ctx.save(); ctx.beginPath(); ctx.rect(bx + totalW - e.width, by + nwH, e.width, innerH); ctx.clip();
  GUIUtil.tileRange(by + nwH, by + nwH + innerH, e.height, (ty: number) =>
    canvas.drawImage({ img: e, dx: bx + totalW - e.width, dy: ty }));
  ctx.restore();

  ctx.save(); ctx.beginPath(); ctx.rect(bx + nwW, by + nwH, innerW, innerH); ctx.clip();
  GUIUtil.tileRange(by + nwH, by + nwH + innerH, c.height, (fy: number) =>
    GUIUtil.tileRange(bx + nwW, bx + nwW + innerW, c.width, (fx: number) =>
      canvas.drawImage({ img: c, dx: fx, dy: fy })));
  ctx.restore();

  canvas.drawImage({ img: arrow, dx: Math.round(screenX - arrow.width / 2), dy: by + totalH - 1 });
  ctx.restore();

  const textStartY = by + nwH + padY;
  lines.forEach((line, i) => {
    canvas.drawText({
      text: line,
      x: bx + totalW / 2,
      y: textStartY + i * lineH,
      color: art.color,
      align: 'center',
      fontSize,
      fontWeight: 'normal',
    });
  });
}
