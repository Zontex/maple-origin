/**
 * Client party state — mirror of the server's authoritative party record.
 * Every mutation goes through the socket; the server answers with a full
 * party_update that replaces local state wholesale, so nothing here drifts.
 *
 * v83 rules live on the server (max 6, leader-only invite/expel/transfer,
 * leader leaving disbands); this side is bookkeeping, the party window UI,
 * exp splitting on kills, the leader's team warp for PQs, party chat, the
 * HP roster feed, and receiving party buffs cast by other members.
 *
 * Membership is keyed by character id on the server, so a member survives a
 * reload or a server restart: it shows under PARTY MEMBER OFFLINE with
 * `online: false` and no connection `id` until it re-links. `party_sync` is
 * how this client re-links itself — sent from the tick whenever the
 * connection id changes, until the server answers with a party_update.
 */

import { KPQ_RELAY_PREFIX } from '../Events/KerningPQ';
import SkillData, { SkillLevelEffect } from '../Skills/SkillData';
import { PARTY_BUFF_SKILLS } from '../Constants/CombatSkills';
import { playSkillAffectedEffect } from '../Skills/SkillCastEffect';

export interface PartyMember {
  /** Connection id while online, null while the member is offline */
  id: string | null;
  charId: number;
  name: string;
  level: number;
  job: number;
  mapId: number;
  channel: number;
  online: boolean;
  hp: number;
  maxHp: number;
}

export interface PartyState {
  id: number;
  /** The leader's connection id, null while the leader is offline */
  leaderId: string | null;
  leaderCharId: number;
  members: PartyMember[];
}

export interface PendingInvite {
  partyId: number;
  fromName: string;
}

// Cosmic defaults for the v83 split: 80% of the exp is divided by level
// weight, the killer keeps a 20% MVP cut, and a party of n on the map adds
// a 5%*n bonus to each share.
const EXP_SPLIT_COMMON_MOD = 0.8;
const EXP_SPLIT_MVP_MOD = 0.2;

// party_hp pacing: at most one a second, sooner on a big swing
const HP_SEND_INTERVAL_MS = 1000;
const HP_SEND_SWING_FRAC = 0.1;
// party_sync retry while the server has not answered (it stays silent until
// select_character has given the connection a character)
const SYNC_RETRY_MS = 3000;

// A party buff with no authored box (none of the v83 ones, but be safe)
const DEFAULT_BUFF_RANGE_X = 300;
const DEFAULT_BUFF_RANGE_Y = 150;

// The buddy system (whisper / find) is another module that may or may not be
// in the tree. import.meta.glob resolves to an empty map when it is absent,
// so the party window can tell without a failing import.
const buddyModules = import.meta.glob('../Buddy/BuddyManager.ts') as Record<string, () => Promise<any>>;
const BUDDY_MODULE_KEY = '../Buddy/BuddyManager.ts';

class PartyManagerClass {
  party: PartyState | null = null;
  pendingInvite: PendingInvite | null = null;
  /** Party-window "click a player to invite" mode */
  inviteMode = false;
  /** HP MARK toggle — the floating party HP gauges on the map */
  showHpBars = false;

  private _syncedFor = '';
  private _lastSyncAt = 0;
  private _lastHpSentAt = 0;
  private _lastHpSent = -1;
  private _lastMaxHpSent = -1;

  private get socket(): any {
    return (window as any).__mySocket;
  }
  private get character(): any {
    return (window as any).charecter;
  }
  private myId(): string {
    return this.socket?.playerId ?? '';
  }

  isInParty(): boolean {
    return !!this.party;
  }
  isLeader(): boolean {
    return !!this.party && this.party.leaderId !== null && this.party.leaderId === this.myId();
  }
  getMembers(): PartyMember[] {
    return this.party?.members ?? [];
  }
  getOnlineMembers(): PartyMember[] {
    return this.getMembers().filter((m) => m.online && !!m.id);
  }
  getOfflineMembers(): PartyMember[] {
    return this.getMembers().filter((m) => !m.online);
  }
  getMemberByPlayerId(playerId: string): PartyMember | null {
    if (!playerId) return null;
    return this.getMembers().find((m) => m.id === playerId) ?? null;
  }
  /** Fellow members (not self) currently online on the given map */
  getOtherMembersOnMap(mapId: number): PartyMember[] {
    const me = this.myId();
    return this.getOnlineMembers().filter(
      (m) => m.id !== me && Number(m.mapId) === Number(mapId)
    );
  }
  /** Every online member on the given map, self included (the HP panel) */
  getMembersOnMap(mapId: number): PartyMember[] {
    return this.getOnlineMembers().filter((m) => Number(m.mapId) === Number(mapId));
  }

  // ---- actions ---------------------------------------------------------
  create(): void {
    this.socket?.sendMessage?.({ type: 'party_create' });
  }
  invite(targetId: string): void {
    this.socket?.sendMessage?.({ type: 'party_invite', data: { targetId } });
  }
  respondInvite(accept: boolean): void {
    const invite = this.pendingInvite;
    this.pendingInvite = null;
    if (!invite) return;
    this.socket?.sendMessage?.({
      type: 'party_invite_response',
      data: { partyId: invite.partyId, accept },
    });
  }
  leave(): void {
    this.socket?.sendMessage?.({ type: 'party_leave' });
  }
  expel(charId: number): void {
    this.socket?.sendMessage?.({ type: 'party_expel', data: { charId } });
  }
  changeLeader(charId: number): void {
    this.socket?.sendMessage?.({ type: 'party_change_leader', data: { charId } });
  }
  /** Leader-only: warp the rest of the team (PQ entry/clear/exile) */
  warpTeam(mapId: number): void {
    if (!this.isLeader()) return;
    this.socket?.sendMessage?.({ type: 'party_warp', data: { mapId } });
  }
  /** Party chat ("/p text" or "{text" in the chat box, or the TALK button) */
  sendChat(message: string): void {
    const text = String(message ?? '').trim();
    if (!text) return;
    if (!this.party) {
      this.onNotice('You are not in a party.');
      return;
    }
    this.socket?.sendMessage?.({ type: 'party_chat', data: { message: text } });
  }
  toggleHpBars(): void {
    this.showHpBars = !this.showHpBars;
  }

  // ---- buddy-system bridges (whisper / find) -----------------------------
  hasBuddyFeature(): boolean {
    return typeof buddyModules[BUDDY_MODULE_KEY] === 'function';
  }
  private async buddyManager(): Promise<any | null> {
    const loader = buddyModules[BUDDY_MODULE_KEY];
    if (typeof loader !== 'function') return null;
    try {
      const mod = await loader();
      return mod?.default ?? mod?.BuddyManager ?? null;
    } catch {
      return null;
    }
  }
  async whisperTo(name: string): Promise<void> {
    const bm = await this.buddyManager();
    if (typeof bm?.startWhisper === 'function') bm.startWhisper(name);
    else this.onNotice('Whispering is not available.');
  }
  async findPlayer(name: string): Promise<void> {
    const bm = await this.buddyManager();
    if (typeof bm?.findPlayer === 'function') bm.findPlayer(name);
    else this.onNotice('Search is not available.');
  }

  // ---- per-frame tick (driven by the party window's update) --------------
  update(_msPerTick: number): void {
    const socket = this.socket;
    const pid: string = socket?.playerId ?? '';
    if (!pid || !socket?.isConnected) return;
    const now = Date.now();

    // Re-link after (re)connect: ask until the server answers. On a fresh
    // connection it cannot answer before select_character, hence the retry.
    if (pid !== this._syncedFor && now - this._lastSyncAt >= SYNC_RETRY_MS) {
      this._lastSyncAt = now;
      socket.sendMessage?.({ type: 'party_sync' });
    }

    // HP feed for the roster gauges
    const me = this.character;
    if (!this.party || !me) return;
    const hp = Math.max(0, Math.floor(Number(me.hp) || 0));
    const maxHp = Math.max(1, Math.floor(Number(me.maxHp) || 1));
    if (hp === this._lastHpSent && maxHp === this._lastMaxHpSent) return;
    const swing = Math.abs(hp - this._lastHpSent) >= maxHp * HP_SEND_SWING_FRAC;
    const due = now - this._lastHpSentAt >= HP_SEND_INTERVAL_MS;
    if (!due && !swing && maxHp === this._lastMaxHpSent) return;
    this._lastHpSentAt = now;
    this._lastHpSent = hp;
    this._lastMaxHpSent = maxHp;
    socket.sendMessage?.({ type: 'party_hp', data: { hp, maxHp } });
  }

  // ---- socket events ---------------------------------------------------
  onPartyUpdate(party: PartyState | null): void {
    this._syncedFor = this.myId();
    if (!party) {
      this.party = null;
      return;
    }
    // Keep the freshest gauge reading for members the new roster also lists
    const prev = new Map<number, PartyMember>();
    for (const m of this.party?.members ?? []) prev.set(m.charId, m);
    this.party = {
      id: Number(party.id),
      leaderId: party.leaderId ?? null,
      leaderCharId: Number(party.leaderCharId) || 0,
      members: (party.members ?? []).map((raw: any) => {
        const m: PartyMember = {
          id: raw.id ?? null,
          charId: Number(raw.charId) || 0,
          name: String(raw.name ?? '???'),
          level: Number(raw.level) || 0,
          job: Number(raw.job) || 0,
          mapId: Number(raw.mapId) || 0,
          channel: Number.isFinite(Number(raw.channel)) ? Number(raw.channel) : -1,
          online: !!raw.online,
          hp: Number(raw.hp) || 0,
          maxHp: Number(raw.maxHp) || 0,
        };
        const old = prev.get(m.charId);
        if (old && m.online && m.maxHp <= 0 && old.maxHp > 0) {
          m.hp = old.hp;
          m.maxHp = old.maxHp;
        }
        return m;
      }),
    };
    // My own row reads straight off my character
    const me = this.character;
    const mine = this.party.members.find((m) => m.id === this.myId());
    if (mine && me) {
      mine.hp = Math.max(0, Math.floor(Number(me.hp) || 0));
      mine.maxHp = Math.max(1, Math.floor(Number(me.maxHp) || 1));
    }
  }

  onPartyHpUpdate(data: any): void {
    if (!this.party || !data) return;
    const m = this.party.members.find(
      (x) => (data.charId && x.charId === Number(data.charId)) || (data.id && x.id === data.id)
    );
    if (!m) return;
    const maxHp = Number(data.maxHp);
    const hp = Number(data.hp);
    if (!Number.isFinite(maxHp) || !Number.isFinite(hp) || maxHp <= 0) return;
    m.maxHp = maxHp;
    m.hp = Math.max(0, Math.min(hp, maxHp));
  }

  onPartyChat(data: any): void {
    const from = String(data?.from ?? '???');
    const message = String(data?.message ?? '').trim();
    if (!message) return;
    // Event control lines (Kerning PQ stage clears) ride party chat unseen
    if (message.startsWith(KPQ_RELAY_PREFIX)) {
      import('../Events/KerningPQ').then(({ default: KerningPQ }) => KerningPQ.onPartyChat(message)).catch(() => {});
      return;
    }
    import('../UI/UIChatLog')
      .then(({ default: UIChatLog }) => UIChatLog.addMessage(`${from} : ${message}`, 'party'))
      .catch(() => {});
  }

  onInvite(partyId: number, fromName: string): void {
    // A fresh invite replaces a stale one — GMS only shows one at a time
    this.pendingInvite = { partyId, fromName };
  }

  onNotice(text: string): void {
    import('../UI/UIChatLog')
      .then(({ default: UIChatLog }) => UIChatLog.notice(text))
      .catch(() => {});
  }

  onPartyExp(exp: number): void {
    const amount = Math.floor(Number(exp));
    if (!Number.isFinite(amount) || amount <= 0) return;
    this.character?.addExp?.(amount);
  }

  onPartyWarp(mapId: number): void {
    const id = Number(mapId);
    if (!Number.isFinite(id) || id <= 0) return;
    if (!this.party) return; // only a current party's leader may move us
    const mapState = (window as any).MapStateInstance;
    if (Number(this.character?.map?.mapId) === id) return;
    void mapState?.changeMap?.(id);
  }

  /**
   * Another player's buff went up (mysocket.handlePlayerBuff). If it is a
   * party buff from a member of my party standing on my map within the
   * skill's box, it lands on me too: applied through my own BuffManager
   * (which relays it as MY buff, so others see my icon) with the skill's
   * `affected` art.
   *
   * That relay is also what would echo forever — every member re-announces
   * the buff, so every other member hears it again with the re-announcer as
   * "caster". Two guards stop it: the caster's job must actually own the
   * skill (a Fighter re-announcing Haste is not a source), and a buff I
   * already hold with the same remaining time is not re-applied (so the
   * original caster never downgrades to a receiver's level-1 echo).
   */
  async onMemberBuff(
    casterPlayerId: string,
    skillId: number,
    level: number,
    durationMs: number,
    caster: any
  ): Promise<void> {
    if (!PARTY_BUFF_SKILLS.has(skillId)) return;
    if (!this.party || !casterPlayerId || casterPlayerId === this.myId()) return;
    const member = this.getMemberByPlayerId(casterPlayerId);
    if (!member) return;
    const me = this.character;
    if (!me || me.isDead || !me.buffManager || !caster?.pos) return;
    if (Number(member.mapId) !== Number(me.map?.mapId ?? NaN)) return;

    // Only the job line that owns the skill is a source of it
    const skillJobFile = Math.floor(skillId / 10000);
    if (!SkillData.getJobTierFileIds(member.job || 0).includes(skillJobFile)) return;

    // Same buff already on me with (about) the same time left: an echo
    const now = Date.now();
    const held = me.buffManager.activeBuffs?.get?.(skillId);
    if (held && Math.abs(held.expiresAt - (now + durationMs)) < 1500) return;

    let effect: SkillLevelEffect | null = null;
    try {
      await SkillData.getSkill(skillId);
      const lvl = Math.max(1, Math.min(30, Math.floor(Number(level) || 1)));
      effect = SkillData.getEffect(skillId, lvl);
    } catch {
      effect = null;
    }
    if (!effect || !(effect.time > 0)) return;

    // Range: the skill's lt/rb box around the caster (authored facing
    // right, so the larger side counts both ways), else a default reach
    const box = effect.hitBox;
    const reachX = box ? Math.max(Math.abs(box.left), Math.abs(box.right)) : DEFAULT_BUFF_RANGE_X;
    const reachY = box ? Math.max(Math.abs(box.top), Math.abs(box.bottom)) : DEFAULT_BUFF_RANGE_Y;
    const dx = Math.abs(Number(me.pos?.x) - Number(caster.pos.x));
    const dy = Math.abs(Number(me.pos?.y) - Number(caster.pos.y));
    if (!(dx <= reachX && dy <= reachY)) return;

    me.buffManager.applyBuff(skillId, effect);
    void playSkillAffectedEffect(me, skillId);
  }

  /**
   * v83 kill exp split. Returns the killer's own share and sends the other
   * same-map members theirs through the server. With no party (or no
   * members present) the killer keeps the full amount.
   */
  shareKillExp(exp: number): number {
    if (!Number.isFinite(exp) || exp <= 0) return exp;
    const mapId = Number(this.character?.map?.mapId ?? 0);
    const others = this.getOtherMembersOnMap(mapId);
    if (others.length === 0) return exp;

    const myLevel = this.character?.stats?.level ?? 1;
    const sharers = [
      { id: this.myId(), level: myLevel, mvp: true },
      ...others.map((m) => ({ id: m.id as string, level: m.level || 1, mvp: false })),
    ];
    const totalLevel = sharers.reduce((s, m) => s + m.level, 0);
    const bonusMod = 0.05 * sharers.length;

    let myShare = exp;
    const grants: { id: string; exp: number }[] = [];
    for (const m of sharers) {
      let ratio = (EXP_SPLIT_COMMON_MOD * m.level) / totalLevel;
      if (m.mvp) ratio += EXP_SPLIT_MVP_MOD;
      const share = Math.max(1, Math.floor(exp * ratio * (1 + bonusMod)));
      if (m.mvp) myShare = share;
      else grants.push({ id: m.id, exp: share });
    }
    if (grants.length > 0) {
      this.socket?.sendMessage?.({ type: 'party_exp', data: { grants } });
    }
    return myShare;
  }

  /** Subscribe to the party message types the socket's switch does not know */
  installSocketHandlers(): void {
    const socket = this.socket;
    if (!socket?.on || (socket as any).__partyHandlersInstalled) return;
    (socket as any).__partyHandlersInstalled = true;
    socket.on('party_chat', (msg: any) => this.onPartyChat(msg?.data ?? msg));
    socket.on('party_hp_update', (msg: any) => this.onPartyHpUpdate(msg?.data ?? msg));
  }
}

const PartyManager = new PartyManagerClass();
export default PartyManager;
