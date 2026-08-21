/**
 * v83 boss HP gauge — the bar at the top-center of the screen showing the name
 * and remaining HP of the boss on this map. Built entirely from
 * UI.wz/UIWindow.img/MobGage pieces: backgrnd2/3/4 are the bar frame
 * (left cap / 1px tile / right cap), Gage/<n> holds two 1x10 animated
 * fill frames.
 *
 * The gauge belongs to the map, not to the last hit: in GMS it is up from the
 * moment you walk in on a live boss, tracks its HP as you fight, and only goes
 * away when the boss does. It used to be armed by Monster.hit() and expire on a
 * timer, so it appeared only while you were swinging and blinked out a few
 * seconds after you stopped.
 */
import WZManager from '../wz-utils/WZManager';
import GameCanvas from '../GameCanvas';
import config from '../Config';

// A boss that dies or despawns releases the bar; nothing else does, so the
// target only needs re-checking a few times a second.
const SCAN_MS = 250;

// The frame's hollow channel: backgrnd3 draws its white border rows at y=3 and
// y=16, leaving rows 4..15 for the fill. That is 12 rows, which is exactly the
// height of the Gage/<colour>/1 columns — the /0 columns are the 10px variant
// for a different gauge, not a second animation frame.
const CHANNEL_Y = 4;
const CHANNEL_H = 12;
const DEFAULT_TAG_COLOR = 1;

interface GageAssets {
  left: HTMLImageElement;
  mid: HTMLImageElement;
  right: HTMLImageElement;
  /** Fill columns by WZ hpTagColor (1-7) */
  fills: Record<number, HTMLImageElement>;
}

const UIMobGage = {
  target: null as any,
  assets: null as GageAssets | null,
  _loading: false,
  _lastScan: 0,

  async ensureAssets() {
    if (this.assets || this._loading) return;
    this._loading = true;
    try {
      const n: any = await WZManager.get('UI.wz/UIWindow.img/MobGage');
      const gage = n.nGet('Gage');
      const fills: Record<number, HTMLImageElement> = {};
      for (let c = 1; c <= 7; c++) {
        fills[c] = gage.nGet(String(c)).nGet('1').nGetImage();
      }
      this.assets = {
        left: n.nGet('backgrnd2').nGetImage(),
        mid: n.nGet('backgrnd3').nGetImage(),
        right: n.nGet('backgrnd4').nGetImage(),
        fills,
      };
    } catch (e) {
      console.error('[MobGage] Failed to load assets:', e);
    } finally {
      this._loading = false;
    }
  },

  /** Whether a mob can still hold the bar. */
  isShowable(mob: any, monsters: any[]): boolean {
    return (
      !!mob &&
      mob.isBoss && !mob.isFake &&
      !mob.dying &&
      !mob.destroyed &&
      (mob.hp ?? 0) > 0 &&
      monsters.includes(mob)
    );
  },

  /**
   * Point the bar at the boss on this map. Keeps the current one while it lives
   * so a second boss can't steal the bar mid-fight; a map change swaps the
   * monster list wholesale, which drops the old target on the next scan.
   */
  refreshTarget(monsters: any[]) {
    const now = Date.now();
    if (now - this._lastScan < SCAN_MS) return;
    this._lastScan = now;

    if (this.isShowable(this.target, monsters)) return;
    this.target = monsters.find((m) => this.isShowable(m, monsters)) ?? null;
    if (this.target) this.ensureAssets();
  },

  /**
   * The monster list is passed in rather than imported. UIMap owns MapleMap
   * already and is the only caller, so handing the list down keeps this module
   * a HUD leaf instead of wiring it into the map/monster graph.
   */
  draw(canvas: GameCanvas, monsters: any[] = []) {
    this.refreshTarget(monsters);
    if (!this.target || !this.assets) return;

    const mob = this.target;
    const maxHp = mob.maxHp || 1;
    const ratio = Math.max(0, Math.min(1, (mob.hp ?? 0) / maxHp));

    const innerW = 250;
    const { left, mid, right, fills } = this.assets;
    const barW = left.width + innerW + right.width;
    const x = Math.floor((config.width - barW) / 2);
    const y = 0; // flush to the top edge like the original client

    const ctx = canvas.context;
    canvas.drawImage({ img: left, dx: x, dy: y });
    ctx.drawImage(mid, x + left.width, y, innerW, mid.height);
    canvas.drawImage({ img: right, dx: x + left.width + innerW, dy: y });

    // Static fill in the mob's own gauge colour. This used to alternate the two
    // Gage children every 300ms as if they were shimmer frames; they are a 10px
    // and a 12px version of the same gradient, so the bar flickered between two
    // heights the whole time it was on screen. The empty part of the channel is
    // the frame's own interior, which is already drawn as a hollow gauge.
    const fill = fills[mob.hpTagColor] ?? fills[DEFAULT_TAG_COLOR];
    const fw = Math.floor(innerW * ratio);
    if (fw > 0 && fill) {
      ctx.drawImage(fill, x + left.width, y + CHANNEL_Y, fw, CHANNEL_H);
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
