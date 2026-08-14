import GameCanvas from '../GameCanvas';
import config from '../Config';
import MySocket from '../mysocket';
import MapleStandingCharacter from '../MapleStandingCharacter';
import { restoreCharacterAndEnterGame } from './UILogin';

/**
 * Mobile-native login → world → character select (touch devices).
 *
 * The desktop flow is the authentic 800x600 v83 login map — beautiful,
 * but a postage stamp with tiny targets on a phone. This flow is
 * MapleStory-M-shaped instead: a DOM login card (large fields, native
 * soft keyboard, world dropdown), then a full-screen canvas character
 * select with big tappable cards and real character previews.
 *
 * All the delicate parts are shared with desktop: the same MySocket
 * calls and the same restoreCharacterAndEnterGame() hydration path.
 */

// Same hardcoded world ids the desktop login uses
const WORLDS = [
  { id: 0, name: 'Scania' },
  { id: 16, name: 'Bera' },
  { id: 2, name: 'Broa' },
];

type Phase = 'login' | 'loading' | 'charselect' | 'entering';

const UIMobileLogin = {
  phase: 'login' as Phase,
  worldId: 0,
  characters: [] as MapleStandingCharacter[],
  selectedIndex: -1,
  statusText: '',
  _card: null as HTMLDivElement | null,
  _prevClicked: false,

  async initialize(_canvas: GameCanvas): Promise<void> {
    this.phase = 'login';
    this.characters = [];
    this.selectedIndex = -1;
    this.statusText = '';
    this.buildLoginCard();
  },

  // ------------------------------------------------------------- DOM card

  buildLoginCard() {
    this.destroyCard();
    const card = document.createElement('div');
    card.id = 'mobile-login-card';
    card.style.cssText =
      'position:fixed; left:50%; top:50%; transform:translate(-50%,-50%);' +
      'width:min(340px, 84vw); padding:22px 20px; z-index:900;' +
      'background:rgba(10,14,24,0.92); border:1px solid #3a4a6a; border-radius:14px;' +
      'font-family:Arial,sans-serif; color:#fff; box-shadow:0 8px 40px rgba(0,0,0,0.6);';

    const title = document.createElement('div');
    title.textContent = 'MapleOrigin';
    title.style.cssText = 'font-size:24px; font-weight:bold; text-align:center; margin-bottom:16px; color:#ffb83d;';
    card.appendChild(title);

    const mkInput = (type: string, placeholder: string, value = '') => {
      const el = document.createElement('input');
      el.type = type;
      el.placeholder = placeholder;
      el.value = value;
      el.autocapitalize = 'none';
      el.autocomplete = type === 'password' ? 'current-password' : 'username';
      el.style.cssText =
        'display:block; width:100%; box-sizing:border-box; margin-bottom:12px;' +
        'padding:14px 12px; font-size:16px; border-radius:8px; border:1px solid #3a4a6a;' +
        'background:#1a2233; color:#fff; outline:none;';
      return el;
    };

    const world = document.createElement('select');
    world.style.cssText =
      'display:block; width:100%; box-sizing:border-box; margin-bottom:12px;' +
      'padding:14px 12px; font-size:16px; border-radius:8px; border:1px solid #3a4a6a;' +
      'background:#1a2233; color:#fff;';
    for (const w of WORLDS) {
      const opt = document.createElement('option');
      opt.value = String(w.id);
      opt.textContent = `🌍 ${w.name}`;
      world.appendChild(opt);
    }

    const user = mkInput('text', 'Username', localStorage.getItem('maple:lastUser') || '');
    const pass = mkInput('password', 'Password');

    const err = document.createElement('div');
    err.style.cssText = 'color:#ff7777; font-size:13px; min-height:18px; margin-bottom:8px; text-align:center;';

    const btn = document.createElement('button');
    btn.textContent = 'LOG IN';
    btn.style.cssText =
      'display:block; width:100%; padding:15px; font-size:17px; font-weight:bold;' +
      'border:none; border-radius:8px; background:#ffb83d; color:#402800; cursor:pointer;';

    const doLogin = async () => {
      err.textContent = '';
      btn.disabled = true;
      btn.textContent = 'CONNECTING...';
      try {
        await (MySocket as any).connectForLogin?.();
        const result = await (MySocket as any).sendLogin(user.value.trim(), pass.value);
        if (!result?.success) {
          err.textContent = result?.error || 'Login failed';
          return;
        }
        localStorage.setItem('maple:lastUser', user.value.trim());
        (this as any)._username = user.value.trim();
        (this as any)._password = pass.value;
        this.worldId = Number(world.value) || 0;
        this.destroyCard();
        this.phase = 'loading';
        this.statusText = 'Loading characters...';
        await this.loadCharacters();
      } catch (e: any) {
        err.textContent = 'Could not reach the server';
        console.error('[MobileLogin]', e);
      } finally {
        btn.disabled = false;
        btn.textContent = 'LOG IN';
      }
    };
    btn.addEventListener('click', doLogin);
    pass.addEventListener('keydown', (e) => { if (e.key === 'Enter') void doLogin(); });

    card.appendChild(world);
    card.appendChild(user);
    card.appendChild(pass);
    card.appendChild(err);
    card.appendChild(btn);
    document.body.appendChild(card);
    this._card = card;
  },

  destroyCard() {
    this._card?.remove();
    this._card = null;
  },

  // ------------------------------------------------------------ characters

  async loadCharacters() {
    const result = await (MySocket as any).getCharacters(this.worldId);
    const charList = result?.characters || [];
    this.characters = [];
    for (const c of charList) {
      try {
        const equipIds = (c.equipped || []).map((eq: any) => eq.item_id);
        const ch = await MapleStandingCharacter.fromAppearance({
          name: c.name,
          skinColor: c.skin ?? 0,
          hairId: c.hair ?? 30030,
          faceId: c.face ?? 20000,
          flipped: true,
          equipIds,
        });
        (ch as any)._serverId = c.id;
        (ch as any)._info = { level: c.level ?? 1, jobId: c.job_id ?? 0 };
        this.characters.push(ch);
      } catch (e) {
        console.error('[MobileLogin] preview failed for', c.name, e);
      }
    }
    this.selectedIndex = this.characters.length ? 0 : -1;
    this.statusText = this.characters.length ? '' :
      'No characters in this world yet — create one on desktop first.';
    this.phase = 'charselect';
  },

  // ------------------------------------------------------------- geometry

  cardRect(i: number) {
    const cw = 168;
    const chh = 236;
    const gap = 26;
    const total = this.characters.length * cw + (this.characters.length - 1) * gap;
    const x0 = Math.max(20, (config.width - total) / 2);
    return { x: x0 + i * (cw + gap), y: config.height / 2 - chh / 2 - 14, w: cw, h: chh };
  },

  startRect() {
    return { x: config.width / 2 - 120, y: config.height - 78, w: 240, h: 54 };
  },

  // -------------------------------------------------------------- update

  doUpdate(msPerTick: number, _camera: any, canvas: GameCanvas) {
    if (this.phase === 'charselect') {
      for (const ch of this.characters) ch.update(msPerTick);

      // Rising-edge tap detection off the polled mouse state
      const clickedNow = canvas.clicked;
      if (clickedNow && !this._prevClicked) {
        const x = canvas.mouseX;
        const y = canvas.mouseY;
        for (let i = 0; i < this.characters.length; i++) {
          const r = this.cardRect(i);
          if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
            this.selectedIndex = i;
          }
        }
        const s = this.startRect();
        if (this.selectedIndex >= 0 &&
            x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h) {
          void this.enterWithSelected();
        }
      }
      this._prevClicked = clickedNow;
    }
  },

  async enterWithSelected() {
    if (this.phase === 'entering') return;
    const ch: any = this.characters[this.selectedIndex];
    if (!ch?._serverId) return;
    this.phase = 'entering';
    this.statusText = 'Entering the world...';
    try {
      const result = await (MySocket as any).selectCharacter(ch._serverId);
      if (!result?.success || !result.character) {
        this.statusText = result?.error || 'Failed to enter — try again';
        this.phase = 'charselect';
        return;
      }
      await restoreCharacterAndEnterGame(result.character, {
        username: (this as any)._username,
        password: (this as any)._password,
        worldId: this.worldId,
      });
    } catch (e) {
      console.error('[MobileLogin] enter failed', e);
      this.statusText = 'Failed to enter — try again';
      this.phase = 'charselect';
    }
  },

  // -------------------------------------------------------------- render

  doRender(canvas: GameCanvas, _camera: any, _lag: number, _ms: number, _td: number) {
    const ctx = canvas.context;
    const w = config.width;
    const h = config.height;

    // Night-sky gradient backdrop
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#0c1220');
    grad.addColorStop(1, '#1d2b45');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    if (this.phase === 'login') return; // the DOM card owns this screen

    canvas.drawText({
      text: 'SELECT YOUR CHARACTER',
      x: w / 2, y: 26, color: '#ffb83d', fontSize: 20, fontWeight: 'bold', align: 'center',
    });

    if (this.statusText) {
      canvas.drawText({
        text: this.statusText, x: w / 2, y: h / 2 - 8,
        color: '#ccccdd', fontSize: 15, align: 'center',
      });
    }

    if (this.phase !== 'charselect' && this.phase !== 'entering') return;

    for (let i = 0; i < this.characters.length; i++) {
      const ch: any = this.characters[i];
      const r = this.cardRect(i);
      const selected = i === this.selectedIndex;

      ctx.save();
      ctx.globalAlpha = selected ? 0.95 : 0.7;
      ctx.fillStyle = selected ? '#26344f' : '#161f31';
      ctx.beginPath();
      (ctx as any).roundRect ? (ctx as any).roundRect(r.x, r.y, r.w, r.h, 14) : ctx.rect(r.x, r.y, r.w, r.h);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = selected ? '#ffb83d' : '#3a4a6a';
      ctx.lineWidth = selected ? 3 : 1.5;
      ctx.stroke();
      ctx.restore();

      // Character preview stands near the card's lower third
      ch.pos.x = r.x + r.w / 2;
      ch.pos.y = r.y + r.h - 62;
      try {
        ch.draw(canvas, { x: 0, y: 0 } as any, 0, 16, 0);
      } catch { /* still loading */ }

      canvas.drawText({
        text: ch.name ?? '?', x: r.x + r.w / 2, y: r.y + r.h - 46,
        color: '#ffffff', fontSize: 15, fontWeight: 'bold', align: 'center',
      });
      const info = ch._info || {};
      canvas.drawText({
        text: `Lv.${info.level ?? 1}`, x: r.x + r.w / 2, y: r.y + r.h - 26,
        color: '#ffdd88', fontSize: 13, align: 'center',
      });
    }

    // START button
    if (this.selectedIndex >= 0 && this.phase === 'charselect') {
      const s = this.startRect();
      ctx.save();
      ctx.fillStyle = '#ffb83d';
      ctx.beginPath();
      (ctx as any).roundRect ? (ctx as any).roundRect(s.x, s.y, s.w, s.h, 12) : ctx.rect(s.x, s.y, s.w, s.h);
      ctx.fill();
      ctx.restore();
      canvas.drawText({
        text: 'START', x: s.x + s.w / 2, y: s.y + 16,
        color: '#402800', fontSize: 20, fontWeight: 'bold', align: 'center',
      });
    }
  },

  cleanup() {
    this.destroyCard();
    this.characters = [];
  },
};

export default UIMobileLogin;
