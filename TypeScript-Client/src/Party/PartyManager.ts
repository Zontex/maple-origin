/**
 * Client party state — mirror of the server's authoritative party record.
 * Every mutation goes through the socket; the server answers with a full
 * party_update that replaces local state wholesale, so nothing here drifts.
 *
 * v83 rules live on the server (max 6, leader-only invite/expel/transfer,
 * leader leaving disbands); this side is bookkeeping, the party window UI,
 * exp splitting on kills, and the leader's team warp for PQs.
 */

export interface PartyMember {
  id: string;
  name: string;
  level: number;
  job: number;
  mapId: number;
}

export interface PartyState {
  id: number;
  leaderId: string;
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

class PartyManagerClass {
  party: PartyState | null = null;
  pendingInvite: PendingInvite | null = null;
  /** Party-window "click a player to invite" mode */
  inviteMode = false;

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
    return !!this.party && this.party.leaderId === this.myId();
  }
  getMembers(): PartyMember[] {
    return this.party?.members ?? [];
  }
  /** Fellow members (not self) currently on the given map */
  getOtherMembersOnMap(mapId: number): PartyMember[] {
    const me = this.myId();
    return this.getMembers().filter(
      (m) => m.id !== me && Number(m.mapId) === Number(mapId)
    );
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
  expel(targetId: string): void {
    this.socket?.sendMessage?.({ type: 'party_expel', data: { targetId } });
  }
  changeLeader(targetId: string): void {
    this.socket?.sendMessage?.({ type: 'party_change_leader', data: { targetId } });
  }
  /** Leader-only: warp the rest of the team (PQ entry/clear/exile) */
  warpTeam(mapId: number): void {
    if (!this.isLeader()) return;
    this.socket?.sendMessage?.({ type: 'party_warp', data: { mapId } });
  }

  // ---- socket events ---------------------------------------------------
  onPartyUpdate(party: PartyState | null): void {
    this.party = party;
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
      ...others.map((m) => ({ id: m.id, level: m.level || 1, mvp: false })),
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
}

const PartyManager = new PartyManagerClass();
export default PartyManager;
