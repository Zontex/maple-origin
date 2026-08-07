import GameCanvas from '../GameCanvas';
import WZManager from '../wz-utils/WZManager';
import config from '../Config';

/**
 * GMS v83-style chat log.
 *
 * Collapsed: recent messages float over the game for a few seconds and fade.
 * Expanded: persistent translucent log with scroll arrows (mouse wheel works
 * too). All rendering uses WZ assets (chatTarget chip, VScr4 arrows,
 * BtMin/BtMax) — text colors follow the original client:
 * yellow notices, white player chat, gray system lines, pink warnings.
 */

export type ChatMessageType = 'player' | 'system' | 'notice' | 'warning';

interface ChatRow {
  text: string;        // one wrapped line
  type: ChatMessageType;
  time: number;        // ms timestamp when added
}

const COLORS: Record<ChatMessageType, string> = {
  player: '#ffffff',
  system: '#dcdcdc',
  notice: '#ffff00',
  warning: '#ff8484',
};

const LINE_H = 13;
const FONT = '12px Arial';
const LOG_W = 560;            // log overlay width
const TEXT_W = 530;           // wrap width for message text
const VISIBLE_ROWS = 5;       // rows shown when expanded
const MAX_ROWS = 400;         // history cap

const UIChatLog = {
  rows: [] as ChatRow[],
  expanded: false,
  typing: false,              // collapsed, but the input is open for typing
  scrollOffset: 0,            // rows scrolled up from the newest

  // WZ assets
  _chipImg: null as HTMLImageElement | null,
  _upImg: null as HTMLImageElement | null,
  _downImg: null as HTMLImageElement | null,
  _minImg: null as HTMLImageElement | null,
  _maxImg: null as HTMLImageElement | null,
  _assetsLoaded: false,

  // Offscreen context used only to measure text for wrapping
  _measureCtx: null as CanvasRenderingContext2D | null,

  async loadAssets() {
    if (this._assetsLoaded) return;
    this._assetsLoaded = true;
    try {
      const statusBar: any = await WZManager.get('UI.wz/StatusBar.img');
      this._chipImg = statusBar?.nGet('base')?.nGet('chatTarget')?.nGetImage?.() || null;

      const basic: any = await WZManager.get('UI.wz/Basic.img');
      const vscr = basic?.nGet?.('VScr4')?.nGet?.('enabled');
      this._upImg = vscr?.nGet?.('prev0')?.nGetImage?.() || null;
      this._downImg = vscr?.nGet?.('next0')?.nGetImage?.() || null;
      this._minImg = basic?.nGet?.('BtMin')?.nGet?.('normal')?.nGet?.('0')?.nGetImage?.() || null;
      this._maxImg = basic?.nGet?.('BtMax')?.nGet?.('normal')?.nGet?.('0')?.nGetImage?.() || null;
    } catch (e) {
      console.warn('[ChatLog] Failed to load WZ assets:', e);
    }
  },

  addMessage(text: string, type: ChatMessageType = 'player') {
    if (!text) return;
    for (const line of this.wrapText(text)) {
      this.rows.push({ text: line, type, time: Date.now() });
    }
    if (this.rows.length > MAX_ROWS) {
      this.rows.splice(0, this.rows.length - MAX_ROWS);
    }
    this.scrollOffset = 0; // snap to newest
  },

  system(text: string) { this.addMessage(text, 'system'); },
  notice(text: string) { this.addMessage(text, 'notice'); },
  warning(text: string) { this.addMessage(text, 'warning'); },

  // GMS-style gained/lost line with the item name resolved from String.wz
  async logItemChange(itemId: number, count: number) {
    if (!count) return;
    try {
      const { ensureItemNames, getItemNameSync } = await import('../Quest/QuestData');
      await ensureItemNames();
      const name = getItemNameSync(itemId) || `Item #${itemId}`;
      this.system(count > 0
        ? `You have gained an item (${name})`
        : `You have lost an item (${name})`);
    } catch { /* cosmetic */ }
  },

  wrapText(text: string): string[] {
    if (!this._measureCtx) {
      this._measureCtx = document.createElement('canvas').getContext('2d');
    }
    const ctx = this._measureCtx;
    if (!ctx) return [text];
    ctx.font = FONT;
    if (ctx.measureText(text).width <= TEXT_W) return [text];

    const words = text.split(' ');
    const lines: string[] = [];
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (ctx.measureText(candidate).width > TEXT_W && line) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) lines.push(line);
    return lines;
  },

  toggle() {
    this.expanded = !this.expanded;
    this.typing = false;
    this.scrollOffset = 0;
  },

  render(canvas: GameCanvas) {
    this.loadAssets();
    const ctx = canvas.context;
    // The chat row lives inside the 800-wide status bar, which is centered
    // as one island on wider screens
    const uiX = Math.floor((config.width - 800) / 2);
    const uiY = config.height - 600; // offset for taller resolutions

    const rowY = uiY + 536;        // input row / minimized strip top
    const btnX = uiX + 546;
    const btnY = uiY + 540;
    const logBottom = uiY + 531;   // just above the input row

    const inputOpen = this.expanded || this.typing;
    if (inputOpen) {
      // Input row furniture — "To All" chip on the white groove
      if (this._chipImg?.complete && this._chipImg.width > 0) {
        ctx.drawImage(this._chipImg, uiX + 3, rowY);
        this.drawShadowText(ctx, 'To All', uiX + 11, rowY + 4, '#ffffff');
      }
    } else {
      // Minimized — dark strip over the input row showing the newest message
      ctx.save();
      ctx.fillStyle = 'rgba(6, 15, 28, 0.8)';
      ctx.fillRect(uiX, rowY, LOG_W, 20);
      ctx.restore();
      const last = this.rows[this.rows.length - 1];
      if (last) {
        this.drawShadowText(ctx, last.text, uiX + 6, rowY + 4, COLORS[last.type]);
      }
    }

    const toggleImg = this.expanded ? this._minImg : this._maxImg;
    if (toggleImg?.complete && toggleImg.width > 0) {
      ctx.drawImage(toggleImg, btnX, btnY);
    }

    // Expanded history box above the input row
    if (this.expanded) {
      const logTop = logBottom - VISIBLE_ROWS * LINE_H - 4;
      ctx.save();
      ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
      ctx.fillRect(uiX, logTop, LOG_W, logBottom - logTop);
      ctx.restore();

      const maxOffset = Math.max(0, this.rows.length - VISIBLE_ROWS);
      this.scrollOffset = Math.max(0, Math.min(maxOffset, this.scrollOffset));
      const end = this.rows.length - this.scrollOffset;
      const start = Math.max(0, end - VISIBLE_ROWS);
      for (let i = start; i < end; i++) {
        const row = this.rows[i];
        const y = logTop + 3 + (i - start) * LINE_H;
        this.drawShadowText(ctx, row.text, uiX + 4, y, COLORS[row.type]);
      }

      // Scroll arrows on the right edge of the log
      if (this._upImg?.complete) ctx.drawImage(this._upImg, uiX + LOG_W - 17, logTop + 2);
      if (this._downImg?.complete) ctx.drawImage(this._downImg, uiX + LOG_W - 17, logBottom - 15);
    }

    this.handleInput(canvas, btnX, btnY, logBottom, uiX);
  },

  drawShadowText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string) {
    ctx.save();
    ctx.font = FONT;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
    ctx.fillText(text, x + 1, y + 1);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
    ctx.restore();
  },

  handleInput(canvas: GameCanvas, btnX: number, btnY: number, logBottom: number, uiX: number = 0) {
    const mx = (canvas as any).mouseX || 0;
    const my = (canvas as any).mouseY || 0;
    const logTop = logBottom - VISIBLE_ROWS * LINE_H - 4;

    if ((canvas as any).wasClicked) {
      // Expand/collapse button (12x12)
      if (mx >= btnX && mx < btnX + 12 && my >= btnY && my < btnY + 12) {
        this.toggle();
        return;
      }
      if (this.expanded && mx >= uiX + LOG_W - 17 && mx < uiX + LOG_W - 2) {
        if (my >= logTop + 2 && my < logTop + 15) { this.scrollOffset++; return; }
        if (my >= logBottom - 15 && my < logBottom - 2) { this.scrollOffset--; return; }
      }
    }

    // Mouse wheel over the expanded log
    if (this.expanded && mx >= uiX && mx < uiX + LOG_W && my >= logTop && my < logBottom) {
      if ((canvas as any).scrolledUp) this.scrollOffset++;
      if ((canvas as any).scrolledDown) this.scrollOffset--;
      if (this.scrollOffset < 0) this.scrollOffset = 0;
    }
  },
};

export default UIChatLog;
