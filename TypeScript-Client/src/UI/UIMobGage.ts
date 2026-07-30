/**
 * v83 mob HP gauge — the bar at the top-center of the screen showing the
 * name and remaining HP of the mob you last hit. Built entirely from
 * UI.wz/UIWindow.img/MobGage pieces: backgrnd2/3/4 are the bar frame
 * (left cap / 1px tile / right cap), Gage/<n> holds two 1x10 animated
 * fill frames.
 */
import WZManager from '../wz-utils/WZManager';
import GameCanvas from '../GameCanvas';
import config from '../Config';

const SHOW_MS = 5000;

interface GageAssets {
  left: HTMLImageElement;
  mid: HTMLImageElement;
  right: HTMLImageElement;
  fill: HTMLImageElement[];
}

const UIMobGage = {
  target: null as any,
  hideAt: 0,
  assets: null as GageAssets | null,
  _loading: false,

  async ensureAssets() {
    if (this.assets || this._loading) return;
    this._loading = true;
    try {
      const n: any = await WZManager.get('UI.wz/UIWindow.img/MobGage');
      this.assets = {
        left: n.nGet('backgrnd2').nGetImage(),
        mid: n.nGet('backgrnd3').nGetImage(),
        right: n.nGet('backgrnd4').nGetImage(),
        fill: [
          n.nGet('Gage').nGet('1').nGet('0').nGetImage(),
          n.nGet('Gage').nGet('1').nGet('1').nGetImage(),
        ],
      };
    } catch (e) {
      console.error('[MobGage] Failed to load assets:', e);
    } finally {
      this._loading = false;
    }
  },

  /** Called when the local player damages a mob */
  show(monster: any) {
    if (!monster) return;
    this.target = monster;
    this.hideAt = Date.now() + SHOW_MS;
    this.ensureAssets();
  },

  draw(canvas: GameCanvas) {
    if (!this.target) return;
    if (Date.now() > this.hideAt || this.target.dying || (this.target.hp ?? 0) <= 0) {
      this.target = null;
      return;
    }
    if (!this.assets) return;

    const mob = this.target;
    const maxHp = mob.maxHp || 1;
    const ratio = Math.max(0, Math.min(1, (mob.hp ?? 0) / maxHp));

    const innerW = 250;
    const { left, mid, right, fill } = this.assets;
    const barW = left.width + innerW + right.width;
    const x = Math.floor((config.width - barW) / 2);
    const y = 0; // flush to the top edge like the original client

    const ctx = canvas.context;
    canvas.drawImage({ img: left, dx: x, dy: y });
    ctx.drawImage(mid, x + left.width, y, innerW, mid.height);
    canvas.drawImage({ img: right, dx: x + left.width + innerW, dy: y });

    // Animated fill (two shimmer frames)
    const frame = Math.floor(Date.now() / 300) % 2;
    const fw = Math.floor(innerW * ratio);
    if (fw > 0) {
      ctx.drawImage(fill[frame], x + left.width, y + 5, fw, fill[frame].height);
    }

    // Mob name over the bar
    canvas.drawText({
      text: mob.name || 'Monster',
      x: x + barW / 2,
      y: y + 4,
      color: '#ffffff',
      fontSize: 11,
      fontWeight: 'bold',
      align: 'center',
    });
  },
};

export default UIMobGage;
