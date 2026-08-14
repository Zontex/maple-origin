import GameCanvas from '../GameCanvas';
import config from '../Config';
import MyCharacter from '../MyCharacter';

/**
 * MapleStory-M-style HUD for touch devices, replacing the desktop status
 * bar (which is hidden while touch controls are active):
 *
 * - Top-left: LV badge + name + slim HP/MP/EXP bars (tap opens Stats)
 * - Top-right: round menu icons — Menu, Inventory, Equip, Skills, Quest,
 *   World Map, Chat
 *
 * Window toggles route through the same MapState menu objects the
 * keyboard shortcuts use.
 */

interface HudIcon {
  id: string;
  glyph: string;
  label: string;
}

const ICONS: HudIcon[] = [
  { id: 'inventory', glyph: '🎒', label: 'Items' },
  { id: 'equipment', glyph: '🧢', label: 'Equip' },
  { id: 'skills', glyph: '📖', label: 'Skill' },
  { id: 'stats', glyph: '💪', label: 'Stats' },
  { id: 'quest', glyph: '📜', label: 'Quest' },
  { id: 'map', glyph: '🗺️', label: 'Map' },
  { id: 'chat', glyph: '💬', label: 'Chat' },
  { id: 'menu', glyph: '☰', label: 'Menu' },
];

const ICON_R = 21;
const ICON_GAP = 52;

const MobileHUD = {
  active: false,

  iconPos(i: number) {
    return {
      x: config.width - 30 - (ICONS.length - 1 - i) * ICON_GAP,
      y: 30,
    };
  },

  /** Tap dispatch — returns true when consumed. mapState is
   *  MapStateInstance (owns the window objects). */
  handleTap(x: number, y: number, mapState: any): boolean {
    if (!this.active) return false;

    for (let i = 0; i < ICONS.length; i++) {
      const p = this.iconPos(i);
      if (Math.hypot(x - p.x, y - p.y) <= ICON_R * 1.35) {
        this.trigger(ICONS[i].id, mapState);
        return true;
      }
    }

    // Stats block top-left → Stats window
    if (x < 190 && y < 64) {
      this.trigger('stats', mapState);
      return true;
    }
    return false;
  },

  trigger(id: string, mapState: any) {
    const toggle = (menu: any) => menu?.setIsHidden?.(!menu.isHidden);
    switch (id) {
      case 'inventory': toggle(mapState?.inventoryMenu); break;
      case 'equipment': toggle(mapState?.equipMenu); break;
      case 'skills': toggle(mapState?.skillMenu); break;
      case 'stats': toggle(mapState?.statsMenu); break;
      case 'quest': toggle(mapState?.questLog); break;
      case 'map':
        import('./UIWorldMap').then(({ default: UIWorldMap }) => {
          import('../MapleMap').then(({ default: MapleMap }) => {
            UIWorldMap.toggle(Number((MapleMap as any).mapId ?? (MapleMap as any).id ?? 0));
          });
        });
        break;
      case 'chat': {
        // The chat field is a DOM <input> — focusing it summons the
        // phone's soft keyboard (it's hidden while the HUD is; unhide)
        const input = document.querySelector('.game-wrapper input') as HTMLInputElement | null;
        if (input) {
          input.style.visibility = 'visible';
          input.focus();
        }
        break;
      }
      case 'menu':
        import('./UIGameMenu').then(({ default: UIGameMenu }) => {
          (UIGameMenu as any).toggle?.() ?? (UIGameMenu as any).open?.();
        });
        break;
    }
  },

  draw(canvas: GameCanvas) {
    if (!this.active) return;
    const ctx = canvas.context;
    ctx.save();

    // --- Top-left: LV + name + HP/MP/EXP ---
    const stats: any = (MyCharacter as any).stats ?? {};
    const level = stats.level ?? 1;
    const name = (MyCharacter as any).name ?? '';
    const hp = (MyCharacter as any).hp ?? 0;
    const maxHp = Math.max(1, (MyCharacter as any).maxHp ?? 1);
    const mp = (MyCharacter as any).mp ?? 0;
    const maxMp = Math.max(1, (MyCharacter as any).maxMp ?? 1);
    const exp = (MyCharacter as any).exp ?? 0;
    const maxExp = Math.max(1, (MyCharacter as any).maxExp ?? 1);

    ctx.globalAlpha = 0.45;
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    (ctx as any).roundRect ? (ctx as any).roundRect(8, 8, 182, 56, 10) : ctx.rect(8, 8, 182, 56);
    ctx.fill();

    ctx.globalAlpha = 1;
    canvas.drawText({
      text: `Lv.${level}`, x: 18, y: 14, color: '#ffdd55', fontSize: 14, fontWeight: 'bold',
    });
    canvas.drawText({
      text: name, x: 62, y: 15, color: '#ffffff', fontSize: 12, fontWeight: 'bold',
    });

    const bar = (y: number, frac: number, color: string) => {
      const w = 128;
      ctx.globalAlpha = 0.6;
      ctx.fillStyle = '#222222';
      ctx.fillRect(52, y, w, 6);
      ctx.globalAlpha = 1;
      ctx.fillStyle = color;
      ctx.fillRect(52, y, Math.max(0, Math.min(1, frac)) * w, 6);
    };
    bar(34, hp / maxHp, '#e83f3f');
    bar(44, mp / maxMp, '#3f6fe8');
    bar(54, exp / maxExp, '#c9e83f');
    canvas.drawText({ text: 'HP', x: 32, y: 30, color: '#ff9999', fontSize: 9 });
    canvas.drawText({ text: 'MP', x: 32, y: 40, color: '#99aaff', fontSize: 9 });
    canvas.drawText({ text: 'EXP', x: 28, y: 50, color: '#ddee99', fontSize: 9 });

    // --- Top-right: menu icons ---
    for (let i = 0; i < ICONS.length; i++) {
      const p = this.iconPos(i);
      ctx.globalAlpha = 0.4;
      ctx.fillStyle = '#000000';
      ctx.beginPath();
      ctx.arc(p.x, p.y, ICON_R, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.6;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, ICON_R, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      canvas.drawText({
        text: ICONS[i].glyph, x: p.x, y: p.y - 9,
        color: '#ffffff', fontSize: 16, align: 'center',
      });
    }

    ctx.restore();
    ctx.globalAlpha = 1;
  },
};

export default MobileHUD;
