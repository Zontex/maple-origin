import { GuildEmblemSpec } from './GuildEmblem';

/**
 * Client guild state — a mirror of the server's authoritative guild record
 * (server/handlers/guild.js). Every mutation goes through the socket and the
 * server answers with a full `guild_update` that replaces local state
 * wholesale, so nothing here drifts. v83 rules (costs, ranks, capacity) live
 * on the server; this side is bookkeeping, the meso deductions the server
 * acknowledges (mesos are client-authoritative in this project), the guild
 * window, guild chat, and the name-tag looks of other players.
 *
 * Name-tag looks: remote characters are created by mysocket from player
 * data this module cannot hook, so MapleCharacter.drawName asks
 * `lookForCharacter()` every frame. A miss queues the player id; ids are
 * requested in one `guild_look_request` batch per second and the answer
 * (`guild_looks`, null = no guild) is cached for LOOK_TTL_MS. The server also
 * pushes `guild_looks` to a room whenever a member's guild changes, and
 * mirrors the look onto player.info so joins carry it for free.
 *
 * No static imports of the game/UI layers — MapleCharacter imports this, so
 * anything heavier would close a dependency cycle. UI reach-outs are dynamic.
 */

export interface GuildMember {
  characterId: number;
  playerId: string | null;
  name: string;
  level: number;
  job: number;
  rank: number; // 1 = Master .. 5
  online: boolean;
  mapId: number;
  channel: number;
}

export interface GuildState {
  id: number;
  worldId: number;
  name: string;
  leaderId: number; // characterId
  notice: string;
  ranks: string[]; // 5 titles, index = rank - 1
  emblem: GuildEmblemSpec;
  capacity: number;
  gp: number;
  members: GuildMember[];
}

export interface GuildInvite {
  guildId: number;
  guildName: string;
  fromName: string;
}

export interface GuildLook {
  guildName: string;
  guildMark: GuildEmblemSpec | null;
}

export const GUILD_CREATE_COST = 1500000;
export const GUILD_EMBLEM_COST = 5000000;
const LOOK_TTL_MS = 60000;
const LOOK_REQUEST_INTERVAL_MS = 1000;

/** Cosmic's Guild.getIncreaseGuildCost(capacity) — mirrored for the NPC script */
export function getIncreaseGuildCost(size: number): number {
  const cost = 500000 + Math.max(0, Math.floor((size - 15) / 5)) * 1000000;
  if (size > 30) return Math.min(5000000, Math.max(cost, 5000000));
  return cost;
}

class GuildManagerClass {
  guild: GuildState | null = null;
  myCharacterId = 0;
  pendingInvite: GuildInvite | null = null;
  /** Set by the guild window when the emblem designer should be shown */
  emblemDesignerRequested = false;
  /** Set by the window when it wants the notice editor open (pencil button) */
  noticeEditRequested = false;

  private subscribed = false;
  private syncedForPlayerId = '';
  private looks = new Map<string, { look: GuildLook | null; at: number }>();
  private lookQueue = new Set<string>();
  private lastLookRequest = 0;

  private get socket(): any {
    return (window as any).__mySocket;
  }
  private get character(): any {
    return (window as any).charecter;
  }

  // ---- queries -----------------------------------------------------------
  isInGuild(): boolean {
    return !!this.guild;
  }
  me(): GuildMember | null {
    if (!this.guild) return null;
    const byId = this.myCharacterId
      ? this.guild.members.find((m) => m.characterId === this.myCharacterId)
      : null;
    if (byId) return byId;
    const name = this.character?.name;
    return this.guild.members.find((m) => m.name === name) ?? null;
  }
  myRank(): number {
    return this.me()?.rank ?? 0;
  }
  isMaster(): boolean {
    return this.myRank() === 1;
  }
  canInvite(): boolean {
    const r = this.myRank();
    return r === 1 || r === 2;
  }
  rankTitle(rank: number): string {
    return this.guild?.ranks?.[rank - 1] ?? '';
  }
  getMembers(): GuildMember[] {
    return this.guild?.members ?? [];
  }

  /** The look to draw under a character's name tag (self or remote) */
  lookForCharacter(ch: any): GuildLook | null {
    if (!ch) return null;
    if (ch === this.character) {
      return this.guild ? { guildName: this.guild.name, guildMark: this.guild.emblem } : null;
    }
    if (!ch.isRemote) return null;
    return this.lookFor(String(ch.id));
  }

  lookFor(playerId: string): GuildLook | null {
    if (!playerId) return null;
    const hit = this.looks.get(playerId);
    const now = Date.now();
    if (hit && now - hit.at < LOOK_TTL_MS) return hit.look;
    this.lookQueue.add(playerId);
    this.flushLookRequests(now);
    return hit?.look ?? null;
  }

  private flushLookRequests(now: number) {
    if (this.lookQueue.size === 0) return;
    if (now - this.lastLookRequest < LOOK_REQUEST_INTERVAL_MS) return;
    if (!this.socket?.isConnected) return;
    this.lastLookRequest = now;
    const ids = [...this.lookQueue].slice(0, 64);
    this.lookQueue.clear();
    // Stamp the entries now so a slow answer doesn't re-queue every frame
    for (const id of ids) {
      const prev = this.looks.get(id);
      this.looks.set(id, { look: prev?.look ?? null, at: now });
    }
    this.socket.sendMessage({ type: 'guild_look_request', data: { ids } });
  }

  // ---- lifecycle ---------------------------------------------------------
  /** Subscribe to the socket and ask for our guild. Idempotent; call from MapState. */
  init(): void {
    const s = this.socket;
    if (!s || this.subscribed) {
      this.sync();
      return;
    }
    this.subscribed = true;
    s.on('guild_update', (msg: any) => this.onGuildUpdate(msg?.data));
    s.on('guild_invite', (msg: any) => this.onInvite(msg?.data));
    s.on('guild_notice', (msg: any) => this.onNotice(String(msg?.data?.text ?? '')));
    s.on('guild_result', (msg: any) => this.onResult(msg?.data));
    s.on('guild_chat', (msg: any) => this.onChat(msg?.data));
    s.on('guild_looks', (msg: any) => this.onLooks(msg?.data?.looks));
    this.sync();
  }

  /** Per-frame housekeeping (called by the guild window's update) */
  update(): void {
    const pid = this.socket?.playerId ?? '';
    // A reconnect hands out a new player id — the server's per-connection
    // record starts blank, so ask again
    if (pid && pid !== this.syncedForPlayerId && this.socket?.isConnected) {
      this.sync();
    }
    this.flushLookRequests(Date.now());
  }

  sync(): void {
    const s = this.socket;
    if (!s?.isConnected) return;
    this.syncedForPlayerId = s.playerId ?? '';
    s.sendMessage({ type: 'guild_sync' });
  }

  // ---- actions -----------------------------------------------------------
  create(name: string): void {
    const mesos = this.character?.inventory?.mesos ?? 0;
    if (mesos < GUILD_CREATE_COST) {
      this.onNotice('You do not have enough mesos to create a Guild.');
      return;
    }
    this.socket?.sendMessage?.({ type: 'guild_create', data: { name: name.trim() } });
  }
  disband(): void {
    this.socket?.sendMessage?.({ type: 'guild_disband' });
  }
  expand(): void {
    if (!this.guild) return;
    const cost = getIncreaseGuildCost(this.guild.capacity);
    const mesos = this.character?.inventory?.mesos ?? 0;
    if (mesos < cost) {
      this.onNotice('You do not have enough mesos to increase the Guild capacity.');
      return;
    }
    this.socket?.sendMessage?.({ type: 'guild_expand' });
  }
  setEmblem(e: GuildEmblemSpec): void {
    const mesos = this.character?.inventory?.mesos ?? 0;
    if (mesos < GUILD_EMBLEM_COST) {
      this.onNotice('You do not have enough mesos to change the Guild Emblem.');
      return;
    }
    this.socket?.sendMessage?.({ type: 'guild_emblem', data: { ...e } });
  }
  invite(targetName: string): void {
    const name = targetName.trim();
    if (!name) return;
    this.socket?.sendMessage?.({ type: 'guild_invite', data: { targetName: name } });
  }
  respondInvite(accept: boolean): void {
    const invite = this.pendingInvite;
    this.pendingInvite = null;
    if (!invite) return;
    this.socket?.sendMessage?.({
      type: 'guild_invite_response',
      data: { guildId: invite.guildId, fromName: invite.fromName, accept },
    });
  }
  leave(): void {
    this.socket?.sendMessage?.({ type: 'guild_leave' });
  }
  expel(characterId: number): void {
    this.socket?.sendMessage?.({ type: 'guild_expel', data: { characterId } });
  }
  changeRank(characterId: number, rank: number): void {
    this.socket?.sendMessage?.({ type: 'guild_rank', data: { characterId, rank } });
  }
  changeLeader(characterId: number): void {
    this.socket?.sendMessage?.({ type: 'guild_change_leader', data: { characterId } });
  }
  setNotice(notice: string): void {
    this.socket?.sendMessage?.({ type: 'guild_notice', data: { notice } });
  }
  setTitles(titles: string[]): void {
    this.socket?.sendMessage?.({ type: 'guild_titles', data: { titles } });
  }
  chat(message: string): void {
    const text = message.trim();
    if (!text) return;
    if (!this.guild) {
      this.onNotice('You are not in a Guild.');
      return;
    }
    this.socket?.sendMessage?.({ type: 'guild_chat', data: { message: text } });
  }

  // ---- NPC entry points (Heracle 2010007 / Lea 2010008) ------------------
  /**
   * Cosmic's genericGuildMessage(1): the client opens the guild-name box.
   * Shown as Heracle's own getText dialog, deferred a tick because the script
   * disposes its dialog right after asking (which would otherwise close ours).
   */
  promptGuildName(): void {
    window.setTimeout(() => {
      void this.showNameDialog();
    }, 60);
  }

  private async showNameDialog(): Promise<void> {
    try {
      const { default: MapleMap } = await import('../MapleMap');
      const dialog: any = (MapleMap as any).questDialog;
      if (!dialog?.showScriptDialog) return;
      let typed = '';
      await dialog.showScriptDialog({
        npcId: 2010007,
        npcName: 'Heracle',
        questName: '',
        text: 'Please enter the name of your new Guild. (3 ~ 12 letters or numbers)',
        dialogType: 'getText',
        input: { def: '' },
        onInput: (v: string) => { typed = v; },
        onAction: (mode: number) => {
          dialog.hide?.();
          if (mode === 1 && typed.trim()) this.create(typed);
        },
      });
    } catch (e) {
      console.error('[Guild] name dialog failed', e);
    }
  }

  /** Cosmic's genericGuildMessage(17): open the emblem designer */
  promptEmblem(): void {
    window.setTimeout(() => {
      this.emblemDesignerRequested = true;
    }, 60);
  }

  // ---- socket events -----------------------------------------------------
  private onGuildUpdate(data: any): void {
    const guild = data?.guild ?? null;
    this.guild = guild;
    if (data?.myCharacterId) this.myCharacterId = Number(data.myCharacterId) || 0;
    if (guild) this.syncedForPlayerId = this.socket?.playerId ?? this.syncedForPlayerId;
  }

  private onInvite(data: any): void {
    if (!data?.guildId) return;
    if (this.guild) return; // server already refuses; don't pop a dialog we can't accept
    // A fresh invite replaces a stale one — GMS only shows one at a time
    this.pendingInvite = {
      guildId: Number(data.guildId),
      guildName: String(data.guildName ?? ''),
      fromName: String(data.fromName ?? '???'),
    };
  }

  private onResult(data: any): void {
    if (!data) return;
    const cost = Number(data.cost) || 0;
    if (data.ok && cost > 0 && this.character?.inventory) {
      this.character.inventory.gainMesos(-cost);
    }
    if (!data.ok && data.error) this.onNotice(String(data.error));
    if (data.ok && data.op === 'emblem') this.onNotice('The Guild Emblem has been registered.');
  }

  private onChat(data: any): void {
    if (!data) return;
    import('../UI/UIChatLog')
      .then(({ default: UIChatLog }) => UIChatLog.addMessage(`[Guild] ${data.name} : ${data.message}`, 'guild'))
      .catch(() => {});
  }

  private onLooks(looks: any): void {
    if (!looks || typeof looks !== 'object') return;
    const now = Date.now();
    for (const [pid, look] of Object.entries<any>(looks)) {
      this.looks.set(pid, {
        look: look && look.guildName
          ? { guildName: String(look.guildName), guildMark: look.guildMark ?? null }
          : null,
        at: now,
      });
    }
  }

  onNotice(text: string): void {
    if (!text) return;
    import('../UI/UIChatLog')
      .then(({ default: UIChatLog }) => UIChatLog.notice(text))
      .catch(() => {});
  }
}

const GuildManager = new GuildManagerClass();
export default GuildManager;
