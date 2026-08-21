/**
 * Client buddy-list state + whisper/find chat commands.
 *
 * The server (server/handlers/buddy.js) is authoritative: every mutation is a
 * message, and it answers with a full buddy_list that replaces local state
 * wholesale, so nothing here drifts. Presence changes (a buddy logging in,
 * changing map or channel) arrive the same way, pushed by the server's
 * presence poll.
 *
 * Chat commands handled here (hooked from UIMap's chat submit):
 *   /w <name> <message>   whisper  (also /whisper, and "@<name> <message>")
 *   /find <name>          where a player is (map + channel)
 * Incoming whispers render as "Name>> message", outgoing as "To Name: message",
 * both in the chat log's whisper colour like v83.
 *
 * Public hooks for other windows: startWhisper(name) pre-fills "/w Name " in
 * the chat box; findPlayer(name) runs a /find.
 */

export interface BuddyEntry {
  characterId: number;
  name: string;
  level: number;
  job: number;
  online: boolean;
  mapId: number;
  /** 0-based channel, -1 when offline */
  channel: number;
  group: string;
}

export interface BuddyRequest {
  characterId: number;
  name: string;
  level: number;
  job: number;
}

const BUDDY_MESSAGE_TYPES = [
  'buddy_list', 'buddy_request', 'buddy_notice', 'buddy_find_result',
  'whisper', 'whisper_sent', 'whisper_fail',
];

class BuddyManagerClass {
  buddies: BuddyEntry[] = [];
  capacity = 20;
  /** Incoming requests, oldest first — the window shows one at a time */
  pendingRequests: BuddyRequest[] = [];
  /** Last name whispered to / from, for a quick reply */
  lastWhisperName: string | null = null;

  private subscribed = false;
  private subscribedSocket: any = null;

  private get socket(): any {
    return (window as any).__mySocket;
  }

  get pendingRequest(): BuddyRequest | null {
    return this.pendingRequests[0] ?? null;
  }

  // ---- lifecycle -----------------------------------------------------------

  /** Subscribe to the socket once (re-done if the socket object is replaced). */
  init(): void {
    const socket = this.socket;
    if (!socket?.on) return;
    if (this.subscribed && this.subscribedSocket === socket) return;
    this.subscribed = true;
    this.subscribedSocket = socket;

    socket.on('buddy_list', (msg: any) => this.onList(msg?.data));
    socket.on('buddy_request', (msg: any) => this.onRequest(msg?.data));
    socket.on('buddy_notice', (msg: any) => this.notice(String(msg?.data?.text ?? '')));
    socket.on('buddy_find_result', (msg: any) => this.onFindResult(msg?.data));
    socket.on('whisper', (msg: any) => this.onWhisper(msg?.data));
    socket.on('whisper_sent', (msg: any) => this.onWhisperSent(msg?.data));
    socket.on('whisper_fail', (msg: any) => {
      this.notice(`'${msg?.data?.to ?? '???'}' is not online.`);
    });
  }

  /** Ask the server for the list + any requests that arrived while offline. */
  sync(): void {
    this.init();
    this.socket?.sendMessage?.({ type: 'buddy_sync' });
  }

  /** Drop our socket subscriptions (not normally needed — kept for symmetry). */
  dispose(): void {
    const socket = this.subscribedSocket;
    if (socket?.off) for (const t of BUDDY_MESSAGE_TYPES) socket.off(t);
    this.subscribed = false;
    this.subscribedSocket = null;
  }

  // ---- queries -------------------------------------------------------------

  getBuddy(characterId: number): BuddyEntry | null {
    return this.buddies.find((b) => b.characterId === characterId) ?? null;
  }
  getBuddyByName(name: string): BuddyEntry | null {
    const wanted = name.toLowerCase();
    return this.buddies.find((b) => b.name.toLowerCase() === wanted) ?? null;
  }
  onlineBuddies(): BuddyEntry[] {
    return this.buddies.filter((b) => b.online);
  }
  offlineBuddies(): BuddyEntry[] {
    return this.buddies.filter((b) => !b.online);
  }
  myChannel(): number {
    return Number(this.socket?.channel) || 0;
  }

  // ---- actions -------------------------------------------------------------

  add(name: string): void {
    const trimmed = name.trim();
    if (!trimmed) return;
    this.socket?.sendMessage?.({ type: 'buddy_add', data: { name: trimmed } });
  }

  respondRequest(accept: boolean): void {
    const req = this.pendingRequests.shift();
    if (!req) return;
    this.socket?.sendMessage?.({
      type: accept ? 'buddy_accept' : 'buddy_decline',
      data: { characterId: req.characterId },
    });
  }

  remove(characterId: number): void {
    this.socket?.sendMessage?.({ type: 'buddy_delete', data: { characterId } });
  }

  /** /find — the server answers with buddy_find_result */
  findPlayer(name: string): void {
    const trimmed = name.trim();
    if (!trimmed) return;
    this.socket?.sendMessage?.({ type: 'buddy_find', data: { name: trimmed } });
  }

  whisper(to: string, message: string): void {
    const name = to.trim();
    const text = message.trim();
    if (!name || !text) return;
    this.lastWhisperName = name;
    this.socket?.sendMessage?.({ type: 'whisper', data: { to: name, message: text } });
  }

  /** BtWhere / MAP: say where a buddy on the list is, from the cached entry. */
  where(characterId: number): void {
    const b = this.getBuddy(characterId);
    if (!b) return;
    if (!b.online) {
      this.notice(`'${b.name}' is not online.`);
      return;
    }
    void this.announceLocation(b.name, b.mapId, b.channel, b.level, b.job);
  }

  /**
   * Pre-fill "/w Name " in the chat box and focus it — the WHISPER button of
   * the buddy (and party) window.
   */
  startWhisper(name: string): void {
    const trimmed = name.trim();
    if (!trimmed) return;
    Promise.all([import('../UI/UIMap'), import('../UI/UIChatLog')])
      .then(([{ default: UIMap }, { default: UIChatLog }]) => {
        const chat = (UIMap as any).chat;
        if (!chat?.input) return;
        if (!UIChatLog.expanded) UIChatLog.typing = true;
        chat.input.style.display = '';
        chat.input.value = `/w ${trimmed} `;
        chat.input.focus();
        const end = chat.input.value.length;
        try { chat.input.setSelectionRange(end, end); } catch { /* not all inputs */ }
      })
      .catch(() => {});
  }

  // ---- chat command hook ---------------------------------------------------

  /**
   * Intercept whisper/find syntax typed into the chat box. Returns true when
   * the text was a command and has been consumed (nothing should be said
   * aloud); false leaves it to the normal chat path.
   */
  handleChatCommand(raw: string): boolean {
    const msg = raw.trim();
    if (!msg) return false;

    if (msg[0] === '@') {
      const m = /^@(\S+)\s+([\s\S]+)$/.exec(msg);
      if (!m) return false; // "@" alone is just chat
      this.whisper(m[1], m[2]);
      return true;
    }
    if (msg[0] !== '/') return false;

    const space = msg.indexOf(' ');
    const cmd = (space < 0 ? msg.slice(1) : msg.slice(1, space)).toLowerCase();
    const rest = space < 0 ? '' : msg.slice(space + 1).trim();

    switch (cmd) {
      case 'w':
      case 'whisper': {
        const m = /^(\S+)\s+([\s\S]+)$/.exec(rest);
        if (!m) {
          this.notice('Usage: /w <name> <message>');
          return true;
        }
        this.whisper(m[1], m[2]);
        return true;
      }
      case 'r':
      case 'reply': {
        if (!this.lastWhisperName) {
          this.notice('There is no one to reply to.');
          return true;
        }
        if (!rest) {
          this.notice('Usage: /r <message>');
          return true;
        }
        this.whisper(this.lastWhisperName, rest);
        return true;
      }
      case 'find':
      case 'f': {
        if (!rest) {
          this.notice('Usage: /find <name>');
          return true;
        }
        this.findPlayer(rest.split(/\s+/)[0]);
        return true;
      }
      default:
        return false; // not ours — other systems may claim other slash commands
    }
  }

  // ---- socket events -------------------------------------------------------

  private onList(data: any): void {
    if (!data) return;
    this.capacity = Number(data.capacity) || 20;
    const list: BuddyEntry[] = Array.isArray(data.buddies) ? data.buddies.map((b: any) => ({
      characterId: Number(b.characterId),
      name: String(b.name ?? '???'),
      level: Number(b.level) || 0,
      job: Number(b.job) || 0,
      online: !!b.online,
      mapId: Number(b.mapId) || 0,
      channel: Number.isFinite(Number(b.channel)) ? Number(b.channel) : -1,
      group: String(b.group ?? 'Default Group'),
    })) : [];
    this.buddies = list;
  }

  private onRequest(data: any): void {
    if (!data) return;
    const characterId = Number(data.characterId);
    if (!characterId) return;
    if (this.pendingRequests.some((r) => r.characterId === characterId)) return;
    this.pendingRequests.push({
      characterId,
      name: String(data.name ?? '???'),
      level: Number(data.level) || 0,
      job: Number(data.job) || 0,
    });
  }

  private onFindResult(data: any): void {
    if (!data) return;
    const name = String(data.name ?? '???');
    if (!data.online) {
      this.notice(`'${name}' is not online.`);
      return;
    }
    void this.announceLocation(name, Number(data.mapId) || 0, Number(data.channel) || 0);
  }

  private onWhisper(data: any): void {
    if (!data) return;
    const from = String(data.from ?? '???');
    this.lastWhisperName = from;
    this.chat(`${from}>> ${String(data.message ?? '')}`, 'whisper');
  }

  private onWhisperSent(data: any): void {
    if (!data) return;
    this.chat(`To ${String(data.to ?? '???')}: ${String(data.message ?? '')}`, 'whisper');
  }

  // ---- output helpers ------------------------------------------------------

  private async announceLocation(name: string, mapId: number, channel: number, level?: number, job?: number): Promise<void> {
    let mapName = `Map ${mapId}`;
    try {
      const { ensureMapNames, getMapNameSync } = await import('../Quest/QuestData');
      await ensureMapNames();
      mapName = getMapNameSync(mapId);
    } catch { /* keep the id */ }
    let who = name;
    if (level) {
      try {
        const { getJobNameById } = await import('../Constants/Jobs');
        who = `${name} (Lv. ${level} ${getJobNameById(job ?? 0) || 'Beginner'})`;
      } catch { /* cosmetic */ }
    }
    // v83 phrases same-channel finds by map and cross-channel ones by channel;
    // we have both, so say both
    const sameCh = channel === this.myChannel();
    this.notice(sameCh
      ? `${who} is at ${mapName}.`
      : `${who} is at ${mapName} in Channel ${channel + 1}.`);
  }

  notice(text: string): void {
    if (!text) return;
    this.chat(text, 'system');
  }

  private chat(text: string, type: 'system' | 'whisper'): void {
    import('../UI/UIChatLog')
      .then(({ default: UIChatLog }) => UIChatLog.addMessage(text, type))
      .catch(() => {});
  }
}

const BuddyManager = new BuddyManagerClass();
export default BuddyManager;
