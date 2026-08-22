import WZManager from '../wz-utils/WZManager';
import config from '../Config';
import PLAY_AUDIO from '../Audio/PlayAudio';
import GameCanvas from '../GameCanvas';
import PartyManager from '../Party/PartyManager';
import { drawEventClock } from './EventClock';

/**
 * Client-side port of Cosmic's KerningPQ event (scripts/event/KerningPQ.js) —
 * "1st Accompaniment", v83. The original NPC scripts run unmodified
 * (Lakelis 9020000, Nella 9020001, Cloto 9020002) and the stage portals are
 * gated the way the kpq0-3 portal scripts gate them.
 *
 * Flow (authentic):
 *  - Lakelis in Kerning City: the leader of a 3-4 member party (lv 21-30)
 *    starts the instance → 103000800, 30-minute timer.
 *  - Stage 1: Ligators drop Coupons (4001007); each non-leader answers
 *    Nella's question with the right number of coupons for a Pass (4001008);
 *    the leader hands Nella (party size − 1) passes.
 *  - Stages 2-4: ropes / platforms / barrels — exactly 3 members on the
 *    right 3 of N spots (`area` rects), the leader asks Nella to check.
 *  - Stage 5: kill the Jr. Neckis, Curse Eyes and King Slime for 10 passes.
 *  - Nella pays the reward and sends the party to the bonus map (103000805)
 *    for a short hunt; Cloto leads out through 103000890.
 *
 * SOLO TEST MODE (superuser only): a party of one is eligible at any level,
 * and on stages 2-4 two ghost members stand on correct spots so the
 * 3-body puzzle can be solved alone — you still have to pick a right spot.
 */

const RECRUIT_MAP = 103000000;
const STAGE1_MAP = 103000800;
const BONUS_MAP = 103000805;
const EXIT_MAP = 103000890;
const MIN_MAP = 103000800;
const MAX_MAP = 103000890;

const EVENT_TIME_MS = 30 * 60 * 1000;
const BONUS_TIME_MS = 60 * 1000;
const MIN_PLAYERS = 3;
const MAX_PLAYERS = 4;
const MIN_LEVEL = 21;
const MAX_LEVEL = 30;

const COUPON = 4001007;
const PASS = 4001008;
const EXCLUSIVE_ITEMS = [COUPON, PASS];
const STAGE_EXP = [100, 200, 300, 400, 500];
// Cosmic setEventRewards: one of these per member at the clear
const REWARDS = [
  1002026, 1002089, 1002090, 1032004, 1032005, 1032009, 1032010,
  2000001, 2000002, 2000003, 2000006, 2022000, 2022003,
  2040002, 2040502, 2040602, 2040802, 2041002, 2041016, 2041020,
  2043002, 2043102, 2043202, 2043302, 2043702, 2043802,
  2044002, 2044102, 2044202, 2044302, 2044402, 2044502, 2044602, 2044702,
  4003000, 4010000, 4010001, 4010002, 4010003, 4010004, 4010005, 4010006,
  4020000, 4020001, 4020002, 4020003, 4020004, 4020005, 4020006, 4020007, 4020008,
];

const REQUIREMENTS_TEXT =
  '\r\n    Number of players: 3 ~ 4' +
  '\r\n    Level range: 21 ~ 30' +
  '\r\n    Time limit: 30 minutes';

// The stage puzzles' spots, as Nella's script has them (java.awt.Rectangle)
type Rect = { x: number; y: number; width: number; height: number };
const STAGE_RECTS: Record<number, Rect[]> = {
  103000801: [
    { x: -755, y: -132, width: 4, height: 218 }, { x: -721, y: -340, width: 4, height: 166 },
    { x: -586, y: -326, width: 4, height: 150 }, { x: -483, y: -181, width: 4, height: 222 },
  ],
  103000802: [
    { x: 608, y: -180, width: 140, height: 50 }, { x: 791, y: -117, width: 140, height: 45 },
    { x: 958, y: -180, width: 140, height: 50 }, { x: 876, y: -238, width: 140, height: 45 },
    { x: 702, y: -238, width: 140, height: 45 },
  ],
  103000803: [
    { x: 910, y: -236, width: 35, height: 5 }, { x: 877, y: -184, width: 35, height: 5 },
    { x: 946, y: -184, width: 35, height: 5 }, { x: 845, y: -132, width: 35, height: 5 },
    { x: 910, y: -132, width: 35, height: 5 }, { x: 981, y: -132, width: 35, height: 5 },
  ],
};
const STAGE_COMBOS: Record<number, number[][]> = {
  103000801: [[0, 1, 1, 1], [1, 0, 1, 1], [1, 1, 0, 1], [1, 1, 1, 0]],
  103000802: [
    [0, 0, 1, 1, 1], [0, 1, 0, 1, 1], [0, 1, 1, 0, 1], [0, 1, 1, 1, 0], [1, 0, 0, 1, 1],
    [1, 0, 1, 0, 1], [1, 0, 1, 1, 0], [1, 1, 0, 0, 1], [1, 1, 0, 1, 0], [1, 1, 1, 0, 0],
  ],
  103000803: [
    [0, 0, 0, 1, 1, 1], [0, 0, 1, 0, 1, 1], [0, 0, 1, 1, 0, 1], [0, 0, 1, 1, 1, 0], [0, 1, 0, 0, 1, 1],
    [0, 1, 0, 1, 0, 1], [0, 1, 0, 1, 1, 0], [0, 1, 1, 0, 0, 1], [0, 1, 1, 0, 1, 0], [0, 1, 1, 1, 0, 0],
    [1, 0, 0, 0, 1, 1], [1, 0, 0, 1, 0, 1], [1, 0, 0, 1, 1, 0], [1, 0, 1, 0, 0, 1], [1, 0, 1, 0, 1, 0],
    [1, 0, 1, 1, 0, 0], [1, 1, 0, 0, 0, 1], [1, 1, 0, 0, 1, 0], [1, 1, 0, 1, 0, 0], [1, 1, 1, 0, 0, 0],
  ],
};
const STAGE_PROPERTY: Record<number, string> = {
  103000801: 'stg2Property', 103000802: 'stg3Property', 103000803: 'stg4Property',
};

// Party-chat control line the leader's client uses to relay stage clears
export const KPQ_RELAY_PREFIX = '::kpq::';

interface EffectFrame { img: HTMLImageElement; ox: number; oy: number; delay: number; }

class KerningPQEvent {
  readonly NPC_IDS = [9020000, 9020001, 9020002];

  active = false;
  private cleared = false;
  private rewarded = false;
  private props: Record<string, string> = {};
  private grid: Record<string, number> = {};
  private timerEndsAt = 0;
  private bonusStarted = false;
  /** Stage clears relayed to a party member riding the leader's instance */
  private passengerProps: Record<string, string> = {};

  changeMapFn: ((mapId: number, portal?: number | string) => void) | null = null;

  private effect: { frames: EffectFrame[]; idx: number; t: number } | null = null;

  private get character(): any { return (window as any).charecter; }
  private get map(): any { return this.character?.map; }
  private currentMapId(): number { return Number(this.map?.mapId ?? 0); }
  private isSuperuser(): boolean { return !!(window as any).__mySocket?.isSuperuser; }

  private warp(mapId: number, portal?: string): void {
    if (this.changeMapFn) this.changeMapFn(mapId, portal);
    else console.error('[KerningPQ] no changeMapFn registered');
  }
  private warpTeam(mapId: number): void {
    this.warp(mapId);
    PartyManager.warpTeam(mapId);
  }

  // =====================================================================
  // Script API — em (Lakelis' cm.getEventManager("KerningPQ"))
  // =====================================================================
  getManagerApi(): any {
    const self = this;
    return {
      getProperty(key: string) {
        if (key === 'party') return REQUIREMENTS_TEXT;
        return self.props[key] ?? null;
      },
      setProperty(key: string, value: any) { self.props[key] = String(value); },
      getIntProperty(key: string) { return parseInt(self.props[key] ?? '0') || 0; },
      // Cosmic getEligibleParty: 3-4 members on the recruit map within
      // 21-30, leader among them. The superuser may test alone at any level.
      getEligibleParty(_party: any) {
        const level = self.character?.stats?.level ?? 1;
        const here = self.currentMapId() === RECRUIT_MAP;
        const lvOk = (lv: number) => self.isSuperuser() || (lv >= MIN_LEVEL && lv <= MAX_LEVEL);
        if (!here || !lvOk(level)) return { size: () => 0 };
        if (!PartyManager.isInParty()) {
          return { size: () => (self.isSuperuser() ? 1 : 0) };
        }
        if (!PartyManager.isLeader()) return { size: () => 0 };
        const count = 1 + PartyManager.getOtherMembersOnMap(RECRUIT_MAP).filter((m) => lvOk(m.level)).length;
        const sizeOk = self.isSuperuser() || (count >= MIN_PLAYERS && count <= MAX_PLAYERS);
        return { size: () => (sizeOk ? count : 0) };
      },
      startInstance(_party?: any, _map?: any, _n?: number) {
        if (self.active) return false;
        self.begin();
        return true;
      },
      getEventInstance() { return self.isRegistered() ? self.getInstanceApi() : null; },
    };
  }

  // =====================================================================
  // Script API — eim (cm.getEventInstance())
  // =====================================================================
  getInstanceApi(): any {
    const self = this;
    const propsOf = () => (self.active ? self.props : self.passengerProps);
    return {
      getProperty(key: string) { return propsOf()[key] ?? null; },
      setProperty(key: string, value: any) { propsOf()[key] = String(value); },
      getIntProperty(key: string) { return parseInt(propsOf()[key] ?? '0') || 0; },
      setIntProperty(key: string, value: number) { propsOf()[key] = String(value); },
      isEventCleared() { return self.cleared; },
      setEventCleared() { self.cleared = true; },
      isEventLeader(_player?: any) { return self.isEventLeader(); },
      startEventTimer(ms: number) { self.timerEndsAt = Date.now() + ms; },
      stopEventTimer() { self.timerEndsAt = 0; },
      warpEventTeam(a: number, b?: number) { self.warpTeam(b ?? a); },

      // Per-player scratch (stage 1 questions): -1 until set
      gridInsert(player: any, value: number) { self.grid[self.keyOf(player)] = Number(value); },
      gridCheck(player: any) { const v = self.grid[self.keyOf(player)]; return v === undefined ? -1 : v; },
      gridClear() { self.grid = {}; },

      getPlayerCount() { return self.players().length; },
      getPlayers() {
        const list = self.players();
        return { size: () => list.length, get: (i: number) => list[i], toArray: () => list };
      },

      showClearEffect(_b?: boolean) { void self.showEffect('clear'); },
      showWrongEffect() { void self.showEffect('wrong'); },
      linkToNextStage(stage: number, _family: string, _mapId: number) {
        self.props[`${stage}stageclear`] = 'true';
        self.grantStageExp(stage);
        self.relay(`${stage}stageclear`);
      },
      giveEventReward(_player?: any) { return self.giveReward(); },
      clearPQ() {
        self.cleared = true;
        self.timerEndsAt = 0;
        self.relay('cleared');
      },
      getMapInstance(mapId: number) {
        return { getId() { return mapId; }, getPortal(name: string) { return name; } };
      },
      unregisterPlayer(_p?: any) { /* handled by onMapChanged */ },
      dispose() { self.endInstance(); },
    };
  }

  private keyOf(player: any): string {
    try { return String(player?.getName?.() ?? player?.name ?? 'me'); } catch { return 'me'; }
  }

  /** Everyone in the instance on this map: me, party members here, and the solo-test ghosts */
  private players(): any[] {
    const me = this.character;
    const list: any[] = [{
      getName: () => me?.name ?? 'me',
      getPosition: () => ({ x: me?.pos?.x ?? 0, y: me?.pos?.y ?? 0 }),
    }];
    const mapId = this.currentMapId();
    const others: Map<string, any> = (window as any).__mySocket?.otherPlayers ?? new Map();
    for (const m of PartyManager.getOtherMembersOnMap(mapId)) {
      const ch = m.id ? others.get(m.id) : null;
      list.push({
        getName: () => m.name,
        getPosition: () => ({ x: ch?.pos?.x ?? Number.NaN, y: ch?.pos?.y ?? Number.NaN }),
      });
    }
    // Solo test mode: two ghosts on correct spots for the 3-body stages
    if (list.length === 1 && this.isSuperuser() && STAGE_RECTS[mapId]) {
      for (const g of this.ghostSpots(mapId)) {
        list.push({ getName: () => 'ghost', getPosition: () => g });
      }
    }
    return list;
  }

  /** Centres of two correct spots the tester is NOT standing on */
  private ghostSpots(mapId: number): { x: number; y: number }[] {
    const rects = STAGE_RECTS[mapId];
    const combos = STAGE_COMBOS[mapId];
    const c = parseInt(this.props[STAGE_PROPERTY[mapId]] ?? '');
    if (!rects || !combos || !Number.isFinite(c) || !combos[c]) return [];
    const me = this.character?.pos;
    const inside = (r: Rect) => !!me && me.x >= r.x && me.x <= r.x + r.width && me.y >= r.y && me.y <= r.y + r.height;
    const correct = combos[c].map((v, i) => (v ? i : -1)).filter((i) => i >= 0 && !inside(rects[i]));
    return correct.slice(0, 2).map((i) => ({ x: rects[i].x + rects[i].width / 2, y: rects[i].y + rects[i].height / 2 }));
  }

  isRegistered(): boolean {
    const mapId = this.currentMapId();
    if (mapId < MIN_MAP || mapId > MAX_MAP) return false;
    return this.active || this.isPassengerFor(mapId);
  }
  isEventLeader(): boolean { return this.active && this.isRegistered(); }
  private isPassengerFor(mapId: number): boolean {
    return !this.active && PartyManager.isInParty() && Number(mapId) >= MIN_MAP && Number(mapId) <= MAX_MAP;
  }

  /** The stage exit (`next00`) stays shut until Nella clears the stage — the kpq0-3 portal scripts */
  blocksPortal(portalName: string): boolean {
    if (!this.isRegistered()) return false;
    if (portalName !== 'next00') return false;
    const stage = this.currentMapId() - STAGE1_MAP + 1;
    const props = this.active ? this.props : this.passengerProps;
    if (props[`${stage}stageclear`]) return false;
    import('../UI/UIChatLog').then(({ default: UIChatLog }) => UIChatLog.system('The portal is not opened yet.')).catch(() => {});
    return true;
  }

  // ---- relay to party members riding the instance ----------------------
  private relay(key: string): void {
    if (!PartyManager.isInParty()) return;
    PartyManager.sendChat(`${KPQ_RELAY_PREFIX}${key}`);
  }
  /** A party_chat line starting with the control prefix; true when consumed */
  onPartyChat(message: string): boolean {
    if (!message.startsWith(KPQ_RELAY_PREFIX)) return false;
    const key = message.slice(KPQ_RELAY_PREFIX.length).trim();
    if (!this.active) {
      if (key === 'cleared') this.cleared = true;
      else this.passengerProps[key] = 'true';
    }
    return true;
  }

  // =====================================================================
  // Lifecycle
  // =====================================================================
  private begin(): void {
    this.active = true;
    this.cleared = false;
    this.rewarded = false;
    this.bonusStarted = false;
    this.props = {};
    this.grid = {};
    this.effect = null;
    this.timerEndsAt = Date.now() + EVENT_TIME_MS;
    import('../MapStateCache').then(({ default: MapStateCache }) => {
      for (let m = MIN_MAP; m <= BONUS_MAP; m++) MapStateCache.forget?.(m);
    }).catch(() => {});
    this.warpTeam(STAGE1_MAP);
  }

  onMapChanged(mapId: number): void {
    const id = Number(mapId);
    if (!this.active) {
      if (id >= MIN_MAP && id <= MAX_MAP && id !== EXIT_MAP) {
        if (this.isPassengerFor(id)) return;
        // PQ map without an instance (reload mid-run): out through the exit
        setTimeout(() => {
          if (!this.active && this.currentMapId() === id && !this.isPassengerFor(id)) this.warp(EXIT_MAP);
        }, 300);
      } else {
        this.removeExclusiveItems();
        this.passengerProps = {};
      }
      return;
    }
    if (id === BONUS_MAP && !this.bonusStarted) {
      this.bonusStarted = true;
      this.timerEndsAt = Date.now() + BONUS_TIME_MS;
      return;
    }
    if (id < MIN_MAP || id > MAX_MAP || id === EXIT_MAP) this.endInstance();
  }

  private endInstance(): void {
    if (!this.active) return;
    this.active = false;
    this.timerEndsAt = 0;
    this.removeExclusiveItems();
  }

  private removeExclusiveItems(): void {
    const qm = this.character?.questManager;
    if (!qm) return;
    for (const itemId of EXCLUSIVE_ITEMS) {
      const count = qm.getItemCount?.(itemId) ?? 0;
      if (count > 0) qm.removeItems?.(itemId, count);
    }
  }

  private grantStageExp(stage: number): void {
    const exp = STAGE_EXP[stage - 1] ?? 0;
    if (exp <= 0) return;
    this.character?.addExp?.(exp, true);
    const grants = PartyManager.getOtherMembersOnMap(this.currentMapId()).map((m) => ({ id: m.id, exp }));
    if (grants.length) (window as any).__mySocket?.sendMessage?.({ type: 'party_exp', data: { grants } });
  }

  private giveReward(): boolean {
    if (this.rewarded) return true;
    const inv = this.character?.inventory;
    const itemId = REWARDS[Math.floor(Math.random() * REWARDS.length)];
    if (inv?.canHold && !inv.canHold(itemId, 1)) return false;
    inv?.addToInventory?.(itemId, 1);
    import('../UI/UIChatLog').then(({ default: UIChatLog }) => UIChatLog.logItemChange(itemId, 1)).catch(() => {});
    this.rewarded = true;
    return true;
  }

  // =====================================================================
  // Per-frame drive
  // =====================================================================
  update(msPerTick: number): void {
    if (this.effect) {
      const eff = this.effect;
      eff.t += msPerTick;
      const delay = eff.frames[eff.idx]?.delay ?? 120;
      if (eff.t >= delay) {
        eff.t -= delay;
        eff.idx++;
        if (eff.idx >= eff.frames.length) this.effect = null;
      }
    }
    if (!this.active) return;
    if (this.timerEndsAt && Date.now() >= this.timerEndsAt) {
      this.timerEndsAt = 0;
      // Time's up: out through the exit map (the bonus round ends there too)
      this.warpTeam(EXIT_MAP);
    }
  }

  // =====================================================================
  // Rendering — clear/wrong effect and the event clock
  // =====================================================================
  private async showEffect(kind: 'clear' | 'wrong'): Promise<void> {
    try {
      // v83 ships the wrong-answer art under its Korean name
      const node: any = await WZManager.get(`Map.wz/Effect.img/quest/party/${kind === 'clear' ? 'clear' : 'wrong_kor'}`);
      const frames: EffectFrame[] = [];
      for (let i = 0; i < 30; i++) {
        const f = node?.[String(i)];
        if (!f?.nGetImage) break;
        frames.push({ img: f.nGetImage(), ox: f.origin?.nX ?? 0, oy: f.origin?.nY ?? 0, delay: f.delay?.nValue || 120 });
      }
      if (frames.length > 0) this.effect = { frames, idx: 0, t: 0 };
    } catch { /* optional art */ }
    if (kind === 'clear') {
      try {
        const snd: any = await WZManager.get('Sound.wz/Game.img/QuestClear');
        if (snd?.nGetAudio) PLAY_AUDIO(snd.nGetAudio());
      } catch { /* optional */ }
    }
  }

  render(canvas: GameCanvas): void {
    if (this.effect) {
      const f = this.effect.frames[this.effect.idx];
      if (f?.img?.width) {
        canvas.drawImage({ img: f.img, dx: Math.floor(config.width / 2 - f.ox), dy: Math.floor(config.height / 3 - f.oy) });
      }
    }
    if (!this.active || !this.timerEndsAt || !this.isRegistered()) return;
    drawEventClock(canvas, this.timerEndsAt - Date.now());
  }
}

const KerningPQ = new KerningPQEvent();
export default KerningPQ;
