import GameCanvas from '../GameCanvas';
import SkillData, { SkillLevelEffect } from '../Skills/SkillData';
import Summon from './Summon';
import { SummonAttack, SummonWz, loadSummonData, summonDurationMs } from './SummonData';

// Owners re-announce live summons so a player who joins the map mid-flight
// still sees them (player_info carries no summon roster); cheap, self-healing
const REBROADCAST_MS = 5000;
// Position relay rate for moving summons (flyers, walkers). Remotes ease.
const MOVE_RELAY_MS = 250;

interface SpawnMsg {
  ownerId: string;
  skillId: number;
  level: number;
  x: number;
  y: number;
  flipped: boolean;
  hp?: number;
}

/**
 * Player summons for the local owner and every remote owner on the map.
 *
 * Invariants:
 *  - Cast routing: useSkill diverts any skill whose SkillInfo has
 *    `hasSummon` here before its attack/buff branches. SkillData classes
 *    such a skill as an attack so the hotkey bar charges MP only after
 *    `summon()` reports success (a missing Summoning Rock spends nothing).
 *  - v83 allows one creature summon at a time; the Puppet is the exception
 *    and stands alongside a hawk. Recasting replaces.
 *  - Summons die with the map and with their owner (no persistence).
 *  - Remote summons run no AI and deal no damage: they replay relayed
 *    spawn/move/attack/remove messages from `server/handlers/summon.js`,
 *    which stamps `ownerId` and scopes the relay to the sender's room.
 */
class SummonManagerClass {
  local: Summon[] = [];
  private remote = new Map<string, Summon>();
  private hooked = false;
  private mapId: any = null;
  private nextRebroadcastAt = 0;
  private nextMoveRelayAt = 0;
  private lastRelayed = new Map<number, string>();

  private sock(): any {
    return (window as any).__mySocket;
  }

  private map(): any {
    return (window as any).__MapleMap;
  }

  // -------------------------------------------------------------- casting

  /**
   * Cast a summon skill for the local owner. Returns false when nothing was
   * spawned (no summon data, no consumable) so the caller spends nothing.
   */
  async summon(owner: any, skillId: number, effect: SkillLevelEffect): Promise<boolean> {
    const wz = await loadSummonData(skillId);
    if (!wz) return false;

    // Consumable (Summoning Rock) — checked before anything is spent
    if ((effect.itemCon || 0) > 0) {
      const need = Math.max(1, effect.itemConNo || 1);
      const inv = owner.inventory;
      const have = this.countItem(inv, effect.itemCon);
      if (have < need) {
        console.log(`[Summon] ${skillId} needs ${need}x item ${effect.itemCon} — not in inventory`);
        return false;
      }
      inv.removeFromInventory(effect.itemCon, need);
    }

    const level = owner.skillManager?.getSkillLevel?.(skillId) ?? 1;

    // Replacement: same skill always; any other creature when this is one
    for (const s of [...this.local]) {
      if (s.skillId === skillId || (wz.kind !== 'puppet' && s.kind !== 'puppet')) this.removeLocal(s, true);
    }

    const facingLeft = !owner.flipped;
    let x = owner.pos.x;
    let y = owner.pos.y;
    if (wz.kind === 'puppet' || wz.kind === 'stationary') {
      // Drop onto the ground under the caster; a puppet thrown mid-jump
      // still lands on the platform below
      const ground = this.map()?.getFootholdBelow?.(x, y - 1);
      if (ground) y = ground.y;
    } else if (wz.kind === 'flying') {
      y -= 20;
      x += facingLeft ? 30 : -30;
    }

    const s = new Summon({
      skillId,
      level,
      owner,
      wz,
      effect,
      x,
      y,
      facingLeft,
      isRemote: false,
      durationMs: summonDurationMs(effect),
    });
    s.onAttackStarted = (sum, atk, target) => this.relayAttack(sum, atk, target);
    this.local.push(s);
    this.mapId = this.map()?.id ?? this.mapId;

    // Caster animation — the skill's own action stance, as a buff cast plays
    const info = SkillData.getSkillSync(skillId);
    const castStance = info?.action || 'alert2';
    if (owner.baseBody?.[castStance] && typeof owner.setStance === 'function') {
      owner.isInAttack = true;
      owner.setStance(castStance, 0, true, false, () => { owner.isInAttack = false; });
    }
    owner.beginSkillCooldown?.(skillId, effect);

    this.send('summon_spawn', this.spawnPayload(s));
    console.log(`[Summon] ${info?.name ?? skillId} summoned for ${Math.round(summonDurationMs(effect) / 1000)}s (${wz.kind})`);
    return true;
  }

  private countItem(inv: any, itemId: number): number {
    if (!inv) return 0;
    const tabs = [inv.equip, inv.use, inv.setup, inv.etc, inv.cash];
    let n = 0;
    for (const tab of tabs) {
      for (const it of tab || []) if (it?.itemId === itemId) n += it.quantity ?? 1;
    }
    return n;
  }

  /** Every local summon, with the option of the death clip */
  clearLocal(announce: boolean, instant = true) {
    for (const s of [...this.local]) this.removeLocal(s, announce, instant);
  }

  private removeLocal(s: Summon, announce: boolean, instant = true) {
    if (announce) this.send('summon_remove', { skillId: s.skillId, instant });
    s.die(instant);
    if (instant) this.local = this.local.filter(o => o !== s);
    this.lastRelayed.delete(s.skillId);
  }

  /**
   * The local Puppet's position and HP, for mob aggro (mobs favour the decoy
   * over the player in v83 — Monster.ts can read this when choosing a target)
   */
  puppetAt(mapId?: number | string): { x: number; y: number; hp: number; maxHp: number; summon: Summon } | null {
    if (mapId !== undefined && String(mapId) !== String(this.map()?.id)) return null;
    const p = this.local.find(s => s.kind === 'puppet' && s.phase === 'active');
    return p ? { x: p.x, y: p.y, hp: p.hp, maxHp: p.maxHp, summon: p } : null;
  }

  /** Local summons still alive (for UI / tests) */
  get activeLocal(): Summon[] {
    return this.local.filter(s => s.phase === 'active');
  }

  // -------------------------------------------------------------- update/draw

  update(ms: number) {
    this.ensureHooks();
    const map = this.map();
    const now = Date.now();

    // Summons do not survive a map change — local ones are dropped and
    // announced, remote ones are rebuilt by their owners' rebroadcasts
    const id = map?.id ?? null;
    if (id !== this.mapId) {
      if (this.local.length) this.clearLocal(true);
      for (const s of this.remote.values()) s.die(true);
      this.remote.clear();
      this.mapId = id;
    }

    const monsters: any[] = map?.monsters ?? [];

    for (const s of this.local) {
      if (s.phase === 'active' && (s.owner?.isDead || now >= s.expiresAt)) {
        this.send('summon_remove', { skillId: s.skillId, instant: false });
        s.die();
      }
      try {
        s.update(ms, monsters, now);
      } catch (e) {
        console.error('[Summon] update crash:', e);
        s.die(true);
      }
    }
    this.local = this.local.filter(s => s.phase !== 'done');

    const chars: any[] = map?.characters ?? [];
    for (const [key, s] of this.remote) {
      if (!chars.includes(s.owner)) {
        s.die(true);
        this.remote.delete(key);
        continue;
      }
      try {
        s.update(ms, [], now);
      } catch (e) {
        console.error('[Summon] remote update crash:', e);
        s.die(true);
      }
      if (s.phase === 'done') this.remote.delete(key);
    }

    if (now >= this.nextMoveRelayAt) {
      this.nextMoveRelayAt = now + MOVE_RELAY_MS;
      this.relayMoves();
    }
    if (now >= this.nextRebroadcastAt) {
      this.nextRebroadcastAt = now + REBROADCAST_MS;
      for (const s of this.local) if (s.phase === 'active') this.send('summon_spawn', this.spawnPayload(s));
    }
  }

  draw(canvas: GameCanvas, camera: any) {
    for (const s of this.remote.values()) {
      try { s.draw(canvas, camera); } catch (e) { /* one bad frame must not kill the pass */ }
    }
    for (const s of this.local) {
      try { s.draw(canvas, camera); } catch (e) { /* ditto */ }
    }
  }

  // -------------------------------------------------------------- network

  private send(type: string, data: any) {
    try {
      this.sock()?.sendMessage?.({ type, data });
    } catch (e) {
      /* offline play is fine */
    }
  }

  private spawnPayload(s: Summon): Omit<SpawnMsg, 'ownerId'> {
    return {
      skillId: s.skillId,
      level: s.level,
      x: Math.round(s.x),
      y: Math.round(s.y),
      flipped: !s.facingLeft,
      hp: s.kind === 'puppet' ? s.hp : undefined,
    };
  }

  private relayMoves() {
    for (const s of this.local) {
      if (s.phase !== 'active' || s.kind === 'puppet' || s.kind === 'stationary') continue;
      const key = `${Math.round(s.x)}:${Math.round(s.y)}:${s.facingLeft ? 0 : 1}`;
      if (this.lastRelayed.get(s.skillId) === key) continue;
      this.lastRelayed.set(s.skillId, key);
      this.send('summon_move', { skillId: s.skillId, x: Math.round(s.x), y: Math.round(s.y), flipped: !s.facingLeft });
    }
  }

  private relayAttack(s: Summon, atk: SummonAttack, target: any) {
    this.send('summon_attack', {
      skillId: s.skillId,
      stance: atk.stance,
      targetOId: target?.oId ?? -1,
      x: Math.round(s.x),
      y: Math.round(s.y),
      flipped: !s.facingLeft,
    });
  }

  private ensureHooks() {
    if (this.hooked) return;
    const sock = this.sock();
    if (!sock?.on) return;
    this.hooked = true;
    sock.on('summon_spawn', (msg: any) => { void this.onRemoteSpawn(msg?.data); });
    sock.on('summon_move', (msg: any) => this.onRemoteMove(msg?.data));
    sock.on('summon_attack', (msg: any) => this.onRemoteAttack(msg?.data));
    sock.on('summon_remove', (msg: any) => this.onRemoteRemove(msg?.data));
  }

  private remoteKey(d: any): string | null {
    const sock = this.sock();
    if (!d?.ownerId || !sock || d.ownerId === sock.playerId) return null;
    const skillId = Number(d.skillId);
    if (!Number.isFinite(skillId)) return null;
    return `${d.ownerId}:${skillId}`;
  }

  private remoteOwner(ownerId: string): any {
    return this.sock()?.otherPlayers?.get?.(ownerId) ?? null;
  }

  private async onRemoteSpawn(d: SpawnMsg) {
    const key = this.remoteKey(d);
    if (!key) return;
    const existing = this.remote.get(key);
    if (existing && existing.phase === 'active') {
      // Periodic re-announce: a position refresh, nothing else
      existing.setRemoteTarget(Number(d.x), Number(d.y), !d.flipped);
      if (existing.kind === 'puppet' && typeof d.hp === 'number') existing.hp = d.hp;
      return;
    }
    const owner = this.remoteOwner(d.ownerId);
    if (!owner) return; // owner unknown yet — the next rebroadcast will land
    const skillId = Number(d.skillId);
    const wz: SummonWz | null = await loadSummonData(skillId);
    if (!wz) return;
    if (this.remote.get(key)?.phase === 'active') return; // raced with another spawn
    const level = Math.max(1, Number(d.level) || 1);
    const effect = SkillData.getEffect(skillId, level) ?? SkillData.getEffect(skillId, 1);
    if (!effect) return;
    const s = new Summon({
      skillId,
      level,
      owner,
      wz,
      effect,
      x: Number(d.x),
      y: Number(d.y),
      facingLeft: !d.flipped,
      isRemote: true,
      durationMs: summonDurationMs(effect),
    });
    if (s.kind === 'puppet' && typeof d.hp === 'number') s.hp = d.hp;
    this.remote.set(key, s);
  }

  private onRemoteMove(d: any) {
    const key = this.remoteKey(d);
    const s = key ? this.remote.get(key) : null;
    if (!s) return;
    s.setRemoteTarget(Number(d.x), Number(d.y), !d.flipped);
  }

  private onRemoteAttack(d: any) {
    const key = this.remoteKey(d);
    const s = key ? this.remote.get(key) : null;
    if (!s) return;
    if (Number.isFinite(Number(d.x))) s.setRemoteTarget(Number(d.x), Number(d.y), !d.flipped);
    s.playRemoteAttack(String(d.stance || 'attack1'), !d.flipped);
  }

  private onRemoteRemove(d: any) {
    const key = this.remoteKey(d);
    const s = key ? this.remote.get(key) : null;
    if (!s) return;
    s.die(!!d.instant);
    if (d.instant) this.remote.delete(key!);
  }
}

const SummonManager = new SummonManagerClass();
export default SummonManager;
