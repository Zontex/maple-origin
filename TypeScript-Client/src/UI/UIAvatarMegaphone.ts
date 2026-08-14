import WZManager from '../wz-utils/WZManager';
import GameCanvas from '../GameCanvas';
import { CameraInterface } from '../Camera';
import ClickManager from './ClickManager';
import { MapleStanceButton } from './MapleStanceButton';
import MapleInput from './MapleInput';
import Config from '../Config';
import MapleStandingCharacter from '../MapleStandingCharacter';
import UIChatLog from './UIChatLog';
import { getItemNameSync } from '../Quest/QuestData';

/**
 * Cash Shop megaphones. Avatar messengers (539xxxx) shout world-wide with an
 * animated banner at the top of every player's screen — art straight from
 * Map.wz/MapHelper.img/AvatarMegaphone/<style>, referenced by each item's
 * own info/path. Plain megaphones (5071000/5072000) go to the chat log.
 */

// itemId -> AvatarMegaphone style dir (from each item's WZ info/path)
const AVATAR_STYLES: Record<number, string> = {
  5390000: 'Burning',
  5390001: 'Bright',
  5390002: 'Heart',
  5390005: 'Tiger1',
  5390006: 'Tiger2',
};

/** Every cash item the inventory double-click should treat as a megaphone */
export function isMegaphoneItem(itemId: number): boolean {
  return itemId === 5071000 || itemId === 5072000 || AVATAR_STYLES[itemId] !== undefined;
}

// Per-style banner layout, measured off the decoded frames: where the
// sender's avatar stands (absent on the Tiger banners — the art fills that
// side) and the dotted message panel the text sits on.
const LAYOUTS: Record<string, {
  avatar: { x: number; feetY: number };
  text: { x: number; y: number; w: number; lines: number };
}> = {
  Bright: { avatar: { x: 58, feetY: 88 }, text: { x: 116, y: 18, w: 100, lines: 4 } },
  Burning: { avatar: { x: 55, feetY: 88 }, text: { x: 112, y: 18, w: 100, lines: 4 } },
  Heart: { avatar: { x: 55, feetY: 88 }, text: { x: 112, y: 18, w: 100, lines: 4 } },
  // The sender stands on the baked shadow ellipse just left of the text
  // panel (located by pixel-hunting the frame art: centre ~(145, 84))
  Tiger1: { avatar: { x: 140, feetY: 85 }, text: { x: 172, y: 18, w: 100, lines: 3 } },
  Tiger2: { avatar: { x: 145, feetY: 85 }, text: { x: 172, y: 18, w: 100, lines: 3 } },
};

const BANNER_MS = 8000;
const FRAME_MS = 150;
const MAX_MESSAGE = 120;

interface BannerFrame {
  img: HTMLImageElement;
  ox: number;
  oy: number;
}

interface ActiveBanner {
  frames: BannerFrame[];
  layout: (typeof LAYOUTS)[string];
  lines: { text: string; bold: boolean }[];
  name: string;
  avatar: MapleStandingCharacter | null;
  namePlate: HTMLImageElement | null;
  age: number;
  frameIdx: number;
  frameAge: number;
}

const UIAvatarMegaphone: any = {
  _active: null as ActiveBanner | null,
  _queue: [] as any[],

  // --- Message input dialog -------------------------------------------------
  _dialogOpen: false,
  _dialogItem: null as any,
  _dialogInput: null as MapleInput | null,
  _dialogButtons: [] as MapleStanceButton[],
  _dialogBg: null as HTMLImageElement | null,

  get isDialogOpen(): boolean {
    return this._dialogOpen;
  },

  /** Double-clicked megaphone in the Cash tab: ask for the message, then send. */
  async promptAndSend(item: any, character: any) {
    if (this._dialogOpen) return;
    const canvas: GameCanvas | null = (ClickManager as any).GameCanvas ?? null;
    if (!canvas) return;
    this._dialogOpen = true;
    this._dialogItem = item;

    try {
      const cs: any = await WZManager.get('UI.wz/CashShop.img');
      this._dialogBg = cs.nGet('CSNotice').nGet('2')?.nGet?.('backgrnd')?.nGetImage?.() || null;
      const basic: any = await WZManager.get('UI.wz/Basic.img');

      const dw = this._dialogBg?.width ?? 266;
      const dh = this._dialogBg?.height ?? 142;
      const dx = Math.floor((Config.width - dw) / 2);
      const dy = Math.floor((Config.height - dh) / 2);

      // Sits exactly on the art's baked message box — (17,43)-(254,95) in the
      // 266x142 dialog — covering its placeholder text with the live input
      this._dialogInput = new MapleInput(canvas, {
        x: dx + 18,
        y: dy + 44,
        width: dw - 38,
        height: 50,
        color: '#000000',
        background: '#ffffff',
        border: 'none',
        fontSize: 12,
        submitListeners: [() => this._submitDialog(character)],
      });
      this._dialogInput.input.maxLength = MAX_MESSAGE;
      this._dialogInput.input.focus();

      const ok = new MapleStanceButton(canvas, {
        x: dx + Math.floor(dw / 2) - 70, y: dy + dh - 32,
        img: basic.nGet('BtOK').nChildren,
        isRelativeToCamera: true, isPartOfUI: true,
        onClick: () => this._submitDialog(character),
      });
      const cancel = new MapleStanceButton(canvas, {
        x: dx + Math.floor(dw / 2) + 8, y: dy + dh - 32,
        img: basic.nGet('BtCancel').nChildren,
        isRelativeToCamera: true, isPartOfUI: true,
        onClick: () => this.closeDialog(),
      });
      this._dialogButtons = [ok, cancel];
      ClickManager.addButton(ok);
      ClickManager.addButton(cancel);
    } catch (e) {
      console.error('[Megaphone] dialog failed to open:', e);
      this.closeDialog();
    }
  },

  _submitDialog(character: any) {
    const message = (this._dialogInput?.input?.value ?? '').trim();
    const item = this._dialogItem;
    if (!message || !item) {
      this.closeDialog();
      return;
    }

    // One shout, one megaphone — consume before broadcasting
    character.inventory.removeFromInventory(item.itemId, 1);

    // The visible look, covers over base gear, so the banner avatar matches
    // what the world sees
    const ids = character.equippedItemIds || {};
    const equipIds: number[] = [];
    for (let s = 0; s <= 22; s++) {
      const id = ids[100 + s] ?? ids[s];
      if (id) equipIds.push(id);
    }
    const look = {
      skin: character.skinColor ?? 0,
      face: character.face ?? 20000,
      hair: character.hair ?? 30030,
      equipIds,
    };
    (window as any).__mySocket?.sendMegaphone?.(item.itemId, message, look);
    this.closeDialog();
  },

  closeDialog() {
    for (const btn of this._dialogButtons) ClickManager.removeButton(btn);
    this._dialogButtons = [];
    this._dialogInput?.remove();
    this._dialogInput = null;
    this._dialogItem = null;
    this._dialogOpen = false;
  },

  // --- Banner ----------------------------------------------------------------

  /** Network entry — every megaphone message, own shouts included. */
  async showBanner(data: any) {
    const style = AVATAR_STYLES[data.itemId];
    // Plain megaphones (and unknown ids) are a colored chat line, no banner
    if (!style) {
      UIChatLog.notice(`[Megaphone] ${data.name} : ${data.message}`);
      return;
    }
    // Avatar shouts land in the chat log too, like GMS
    UIChatLog.notice(`[${getItemNameSync(data.itemId) || 'Avatar Megaphone'}] ${data.name} : ${data.message}`);

    try {
      const styleNode: any = await WZManager.get(`Map.wz/MapHelper.img/AvatarMegaphone/${style}`);
      // The roar shake is authored INTO the frames: they differ in size and
      // carry origin vectors that realign the stable parts (text panel).
      // Honoring the origins makes only the tiger shake — not the text.
      const frames: BannerFrame[] = [];
      for (const child of styleNode.nChildren) {
        const img = child?.nGetImage?.();
        if (img) {
          frames.push({
            img,
            ox: child.nGet?.('origin')?.nGet?.('nX', 0) ?? 0,
            oy: child.nGet?.('origin')?.nGet?.('nY', 0) ?? 0,
          });
        }
      }
      if (!frames.length) return;
      const nameNode: any = await WZManager.get('Map.wz/MapHelper.img/AvatarMegaphone/name');
      const namePlate = nameNode?.nGet?.('0')?.nGetImage?.() || null;

      const layout = LAYOUTS[style];
      let avatar: MapleStandingCharacter | null = null;
      if (data.look) {
        try {
          avatar = await MapleStandingCharacter.fromAppearance({
            skinColor: data.look.skin ?? 0,
            faceId: data.look.face ?? 20000,
            hairId: data.look.hair ?? 30030,
            equipIds: data.look.equipIds || [],
            flipped: false,
          });
        } catch { /* banner still shows without the avatar */ }
      }

      const banner: ActiveBanner = {
        frames,
        layout,
        // Name rides the plate under the avatar; it only leads the text when
        // the avatar could not be composed
        lines: this._wrap(data.message, data.name, layout, !avatar),
        name: data.name,
        avatar,
        namePlate,
        age: 0,
        frameIdx: 0,
        frameAge: 0,
      };
      if (this._active) this._queue.push(banner);
      else this._active = banner;
    } catch (e) {
      console.error('[Megaphone] banner failed:', e);
    }
  },

  _wrap(message: string, name: string, layout: any, nameAsFirstLine: boolean) {
    const canvas: GameCanvas | null = (ClickManager as any).GameCanvas ?? null;
    const ctx = canvas?.context;
    const lines: { text: string; bold: boolean }[] = [];
    if (nameAsFirstLine) lines.push({ text: `${name} :`, bold: true });

    if (ctx) {
      ctx.save();
      ctx.font = '11px Arial';
      let current = '';
      for (const word of message.split(' ')) {
        const attempt = current ? `${current} ${word}` : word;
        if (ctx.measureText(attempt).width > layout.text.w && current) {
          lines.push({ text: current, bold: false });
          current = word;
        } else {
          current = attempt;
        }
      }
      if (current) lines.push({ text: current, bold: false });
      ctx.restore();
    } else {
      lines.push({ text: message, bold: false });
    }
    return lines.slice(0, layout.text.lines);
  },

  update(msPerTick: number) {
    const b = this._active;
    if (!b) return;
    b.age += msPerTick;
    b.frameAge += msPerTick;
    if (b.frameAge > FRAME_MS) {
      b.frameAge = 0;
      b.frameIdx = (b.frameIdx + 1) % b.frames.length;
    }
    b.avatar?.update(msPerTick);
    if (b.age >= BANNER_MS) {
      this._active = this._queue.shift() ?? null;
    }
  },

  render(canvas: GameCanvas) {
    // The message dialog backdrop + prompt text (buttons draw themselves)
    if (this._dialogOpen && this._dialogBg) {
      const dw = this._dialogBg.width;
      const dh = this._dialogBg.height;
      const dx = Math.floor((Config.width - dw) / 2);
      const dy = Math.floor((Config.height - dh) / 2);
      canvas.drawImage({ img: this._dialogBg, dx, dy });
      // The art bakes "To :" with a white recipient field — a world shout
      // goes to everyone
      canvas.drawText({
        text: 'Everyone', x: dx + 68, y: dy + 21,
        fontSize: 12, color: '#000000',
      });
      for (const btn of this._dialogButtons) {
        btn.draw(canvas, { x: 0, y: 0 } as CameraInterface, 0, 16, 0);
      }
    }

    const b = this._active;
    if (!b) return;
    const f0 = b.frames[0];
    const fi = b.frames[b.frameIdx];
    if (!fi?.img?.complete) return;
    // GMS anchors the avatar shout to the top-RIGHT corner of the screen.
    // The layout is keyed to frame 0's box; each frame is offset by its
    // origin so only the authored shake moves — avatar and text stay put.
    const bx = Config.width - f0.img.width - 10;
    const by = 10;
    const frame = f0.img;

    canvas.drawImage({
      img: fi.img,
      dx: bx + f0.ox - fi.ox,
      dy: by + f0.oy - fi.oy,
    });

    if (b.avatar) {
      b.avatar.setPosition(bx + b.layout.avatar.x, by + b.layout.avatar.feetY);
      b.avatar.draw(canvas, { x: 0, y: 0 } as CameraInterface, 0, 16, 0);
      if (b.namePlate) {
        const px = bx + b.layout.avatar.x - Math.floor(b.namePlate.width / 2);
        // Clamped so the plate never hangs off the banner's bottom edge
        const py = Math.min(by + b.layout.avatar.feetY + 6, by + frame.height - b.namePlate.height - 2);
        canvas.drawImage({ img: b.namePlate, dx: px, dy: py });
        canvas.drawText({
          text: b.name, x: bx + b.layout.avatar.x, y: py + 2,
          fontSize: 10, color: '#FFFFFF', align: 'center',
        });
      }
    }

    let ty = by + b.layout.text.y;
    for (const line of b.lines) {
      canvas.drawText({
        text: line.text, x: bx + b.layout.text.x, y: ty,
        fontSize: 11, color: '#000000',
        fontWeight: line.bold ? 'bold' : 'normal',
      });
      ty += 15;
    }
  },
};

export default UIAvatarMegaphone;
