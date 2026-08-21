import { CameraInterface } from "../Camera";
import GameCanvas from "../GameCanvas";
import WZManager from "../wz-utils/WZManager";
import PartyManager from "../Party/PartyManager";

/**
 * Mystic Door (Priest skill 2311002, portal type 6).
 *
 * The priest casts on a field map and a door stands at the cast spot; a
 * second door stands in the field's return town at one of the town's `tp`
 * portals (type 6 — Henesys has six of them along the main street). The
 * caster and their party press Up on either door to cross: field door ->
 * the town door, town door -> the cast spot. It lasts the skill level's
 * `time` seconds, costs a Magic Rock (`itemCon` 4006000) on top of MP, and
 * recasting moves it.
 *
 * Doors live in TWO rooms at once (field + town), so the server keeps the
 * active list and broadcasts door_open/door_close to both maps; a client
 * entering either map later asks for them with door_sync. Only the record
 * is synced — both sides draw from the same WZ art:
 *   Skill.wz/231.img/skill/2311002/cDoor   field door: frames 0-7 open it,
 *                                          8-16 are the open door (looped)
 *   Skill.wz/231.img/skill/2311002/mDoor   town door: two frames pulsing
 *                                          between alpha 255 and 128
 */

export const MYSTIC_DOOR_SKILL_ID = 2311002;
// v83 FieldLimit bit: maps where Mystic Door cannot be cast
const FIELD_LIMIT_DOOR = 0x08;
// Cosmic's Character.canDoor(): one door every 5 seconds
const RECAST_INTERVAL_MS = 5000;
// The door's usable box, from the open-door frame (94x116, origin 44,112)
// with the same few px of slack below the authored y that portals get
const USE_LEFT = 44;
const USE_RIGHT = 50;
const USE_UP = 112;
const USE_DOWN = 10;
// Land just above the floor, like every other spawn (see MapState.spawnAt)
const GROUND_CLEARANCE = 3;
const FIELD_OPEN_LOOP_FROM = 8;

export interface DoorRecord {
  doorId: string;
  ownerId: string;
  ownerName: string;
  partyId: number | null;
  /** The field map the door was cast on, and where it stands there */
  mapId: number;
  x: number;
  y: number;
  /** The return town, and which of its `tp` portals (in WZ order) hosts the town door */
  townMapId: number;
  townSlot: number;
  expiresAt: number;
  /** The skill level's `time` in ms — only used to tell a just-cast door from one found standing */
  durationMs: number;
}

/** One drawn door: a frame sequence with an optional loop start */
class DoorSprite {
  frames: any[];
  frame = 0;
  delay = 0;
  nextDelay = 100;
  loopFrom: number;
  x: number;
  y: number;

  constructor(frames: any[], loopFrom: number, x: number, y: number) {
    this.frames = frames;
    this.loopFrom = loopFrom;
    this.x = x;
    this.y = y;
    for (const f of frames) void f?.nPreloadImage?.();
    this.setFrame(0);
  }

  setFrame(i: number, carry = 0) {
    this.frame = this.frames[i] ? i : this.loopFrom;
    this.delay = carry;
    this.nextDelay = this.frames[this.frame]?.nGet("delay").nGet("nValue", 100) ?? 100;
  }

  update(msPerTick: number) {
    this.delay += msPerTick;
    if (this.delay > this.nextDelay) {
      const next = this.frame + 1;
      this.setFrame(this.frames[next] ? next : this.loopFrom, this.delay - this.nextDelay);
    }
  }

  draw(canvas: GameCanvas, camera: CameraInterface) {
    const f = this.frames[this.frame];
    if (!f) return;
    const img = f.nGetImage?.();
    if (!img) return;
    const ox = f.nGet("origin").nGet("nX", 0);
    const oy = f.nGet("origin").nGet("nY", 0);
    let alpha = 1;
    if ("a0" in f || "a1" in f) {
      const a0 = f.nGet("a0").nGet("nValue", 255) / 255;
      const a1 = f.nGet("a1").nGet("nValue", a0 * 255) / 255;
      const pct = this.nextDelay > 0 ? Math.min(1, this.delay / this.nextDelay) : 1;
      alpha = pct * a1 + (1 - pct) * a0;
    }
    canvas.drawImage({
      img,
      dx: Math.round(this.x - ox - camera.x),
      dy: Math.round(this.y - oy - camera.y),
      alpha,
    });
  }
}

class MysticDoorManagerClass {
  private doors: Map<string, DoorRecord> = new Map();
  private sprites: Map<string, DoorSprite> = new Map();
  private map: any = null;
  private mapId = 0;
  private handlersInstalled = false;
  private lastCastAt = 0;
  private fieldFrames: any[] | null = null;
  private townFrames: any[] | null = null;
  private artLoading: Promise<void> | null = null;

  private get socket(): any {
    return (window as any).__mySocket;
  }

  private get myId(): string {
    return String(this.socket?.playerId || "");
  }

  isDoorSkill(skillId: number): boolean {
    return skillId === MYSTIC_DOOR_SKILL_ID;
  }

  /** Every active door (for UI such as the minimap) */
  getDoors(): DoorRecord[] {
    return [...this.doors.values()];
  }

  // ---------------------------------------------------------------------
  // Map lifecycle

  /** Called by MapleMap.load once the map is up: forget the old room's sprites and ask for this room's doors */
  onMapLoaded(map: any) {
    this.map = map;
    const id = Number(map?.id);
    this.mapId = Number.isFinite(id) ? id : 0;
    this.sprites.clear();
    this.installSocketHandlers();
    // Doors we already know about that touch this map get their sprite now;
    // the sync answer replaces the whole set anyway
    for (const door of this.doors.values()) this.ensureSprite(door);
    if (this.mapId > 0 && this.socket?.isConnected) {
      this.socket.sendMessage({ type: "door_sync", data: { mapId: this.mapId } });
    }
  }

  private installSocketHandlers() {
    if (this.handlersInstalled) return;
    const socket = this.socket;
    if (!socket?.on) return;
    this.handlersInstalled = true;
    socket.on("door_open", (msg: any) => this.onDoorOpen(msg.data));
    socket.on("door_close", (msg: any) => this.onDoorClose(msg.data));
    socket.on("door_list", (msg: any) => this.onDoorList(msg.data));
  }

  private onDoorOpen(data: any) {
    const door = this.parseDoor(data);
    if (!door) return;
    // One door per owner: a recast replaces the previous one
    for (const [id, d] of this.doors) {
      if (d.ownerId === door.ownerId && id !== door.doorId) this.removeDoor(id);
    }
    this.doors.set(door.doorId, door);
    this.ensureSprite(door);
  }

  private onDoorClose(data: any) {
    const id = String(data?.doorId ?? "");
    if (id) this.removeDoor(id);
  }

  private onDoorList(data: any) {
    const list: any[] = Array.isArray(data?.doors) ? data.doors : [];
    this.doors.clear();
    this.sprites.clear();
    for (const raw of list) {
      const door = this.parseDoor(raw);
      if (door) this.doors.set(door.doorId, door);
    }
    for (const door of this.doors.values()) this.ensureSprite(door);
  }

  private parseDoor(raw: any): DoorRecord | null {
    if (!raw || !raw.doorId) return null;
    const door: DoorRecord = {
      doorId: String(raw.doorId),
      ownerId: String(raw.ownerId ?? ""),
      ownerName: String(raw.ownerName ?? ""),
      partyId: raw.partyId == null ? null : Number(raw.partyId) || null,
      mapId: Number(raw.mapId),
      x: Number(raw.x),
      y: Number(raw.y),
      townMapId: Number(raw.townMapId),
      townSlot: Math.max(0, Number(raw.townSlot) || 0),
      expiresAt: Number(raw.expiresAt) || 0,
      durationMs: Number(raw.durationMs) || 0,
    };
    if (![door.mapId, door.x, door.y, door.townMapId].every(Number.isFinite)) return null;
    return door;
  }

  private removeDoor(doorId: string) {
    this.doors.delete(doorId);
    this.sprites.delete(doorId);
  }

  // ---------------------------------------------------------------------
  // Art

  private loadArt(): Promise<void> {
    if (this.fieldFrames && this.townFrames) return Promise.resolve();
    if (this.artLoading) return this.artLoading;
    this.artLoading = (async () => {
      try {
        const skillFile: any = await WZManager.get("Skill.wz/231.img");
        const node = skillFile?.nGet?.("skill")?.nGet?.(String(MYSTIC_DOOR_SKILL_ID));
        const cDoor = node?.nGet?.("cDoor")?.nChildren;
        const mDoor = node?.nGet?.("mDoor")?.nChildren;
        if (cDoor?.length) this.fieldFrames = cDoor;
        if (mDoor?.length) this.townFrames = mDoor;
        else if (cDoor?.length) this.townFrames = cDoor.slice(FIELD_OPEN_LOOP_FROM);
      } catch (e) {
        console.error("[MysticDoor] failed to load door art:", e);
      } finally {
        this.artLoading = null;
      }
    })();
    return this.artLoading;
  }

  /** Where this door stands on the CURRENT map, or null if it is not on it */
  private positionOnCurrentMap(door: DoorRecord): { x: number; y: number; side: "field" | "town" } | null {
    if (!this.mapId) return null;
    if (door.mapId === this.mapId) return { x: door.x, y: door.y, side: "field" };
    if (door.townMapId === this.mapId) {
      const portal = this.townPortalForSlot(door.townSlot);
      if (portal) return { x: portal.x, y: portal.y, side: "town" };
    }
    return null;
  }

  /** The town's `tp` portals in WZ order; the server hands out slots as indices into it */
  private townPortalForSlot(slot: number): { x: number; y: number } | null {
    const tps = (this.map?.portals || []).filter((p: any) => p.type === 6);
    if (tps.length === 0) return null;
    return tps[Math.min(slot, tps.length - 1)];
  }

  private ensureSprite(door: DoorRecord) {
    if (this.sprites.has(door.doorId)) return;
    const where = this.positionOnCurrentMap(door);
    if (!where) return;
    void this.loadArt().then(() => {
      if (!this.doors.has(door.doorId) || this.sprites.has(door.doorId)) return;
      const again = this.positionOnCurrentMap(door);
      if (!again) return;
      if (again.side === "field" && this.fieldFrames) {
        // The opening animation plays only for a door that is actually new;
        // one found already standing when we arrived is simply open
        const fresh = door.durationMs > 0 && Date.now() - (door.expiresAt - door.durationMs) < 2000;
        const sprite = new DoorSprite(this.fieldFrames, FIELD_OPEN_LOOP_FROM, again.x, again.y);
        if (!fresh) sprite.setFrame(FIELD_OPEN_LOOP_FROM);
        this.sprites.set(door.doorId, sprite);
      } else if (again.side === "town" && this.townFrames) {
        this.sprites.set(door.doorId, new DoorSprite(this.townFrames, 0, again.x, again.y));
      }
    });
  }

  // ---------------------------------------------------------------------
  // Per-frame

  update(msPerTick: number) {
    if (this.doors.size === 0) return;
    const now = Date.now();
    for (const [id, door] of this.doors) {
      // Client-side backstop — the server's sweep sends door_close too
      if (door.expiresAt && now >= door.expiresAt) this.removeDoor(id);
    }
    for (const sprite of this.sprites.values()) sprite.update(msPerTick);
  }

  draw(canvas: GameCanvas, camera: CameraInterface) {
    for (const sprite of this.sprites.values()) sprite.draw(canvas, camera);
  }

  // ---------------------------------------------------------------------
  // Casting

  private fieldLimitOf(map: any): number {
    const direct = Number(map?.fieldLimit);
    if (Number.isFinite(direct)) return direct;
    return Number(map?.wzNode?.info?.nGet?.("fieldLimit")?.nGet?.("nValue", 0)) || 0;
  }

  /**
   * Cast Mystic Door for the local character. Resolves true when a door was
   * requested (MP and the Magic Rock are then the caller's to charge), false
   * when the map or the inventory refuses it. `effect` is the skill level's
   * effect (its `time` is the door's life in seconds).
   */
  async cast(character: any, effect: any): Promise<boolean> {
    const map = character?.map || this.map;
    if (!map || character?.isRemote) return false;
    const say = (text: string) => {
      import("../UI/UIChatLog").then(({ default: UIChatLog }) => UIChatLog.system(text)).catch(() => {});
    };

    const now = Date.now();
    if (now - this.lastCastAt < RECAST_INTERVAL_MS) {
      say("Please wait 5 seconds before casting Mystic Door again.");
      return false;
    }
    if (map.isTown || (this.fieldLimitOf(map) & FIELD_LIMIT_DOOR)) {
      say("You can't use it here in this map.");
      return false;
    }
    const townMapId = Number(map.wzNode?.info?.nGet?.("returnMap")?.nGet?.("nValue", 999999999));
    if (!Number.isFinite(townMapId) || townMapId >= 999999999 || townMapId === Number(map.id)) {
      say("You can't use it here in this map.");
      return false;
    }

    // The Magic Rock: itemCon/itemConNo on the skill level (4006000 x1)
    const level = Number(character.skillManager?.getSkillLevel?.(MYSTIC_DOOR_SKILL_ID)) || 1;
    let itemCon = 0;
    let itemConNo = 1;
    try {
      const skillFile: any = await WZManager.get("Skill.wz/231.img");
      const lv = skillFile?.nGet?.("skill")?.nGet?.(String(MYSTIC_DOOR_SKILL_ID))?.nGet?.("level")?.nGet?.(String(level));
      itemCon = Number(lv?.nGet?.("itemCon")?.nGet?.("nValue", 0)) || 0;
      itemConNo = Number(lv?.nGet?.("itemConNo")?.nGet?.("nValue", 1)) || 1;
    } catch (e) {
      /* no level node — no rock required */
    }
    if (itemCon > 0) {
      const inv = character.inventory;
      const held = (inv?.etc || []).reduce(
        (n: number, it: any) => (it?.itemId === itemCon ? n + (Number(it.quantity) || 0) : n),
        0
      );
      if (held < itemConNo) {
        say("You don't have enough Magic Rocks.");
        return false;
      }
    }

    // How many `tp` slots the town offers, so the server can hand out a
    // free one. The town map is not loaded here, so read its WZ directly.
    let townPortalCount = 1;
    try {
      const prefix = Math.floor(townMapId / 100000000);
      const town: any = await WZManager.get(`Map.wz/Map/Map${prefix}/${String(townMapId).padStart(9, "0")}.img`);
      const count = (town?.nGet?.("portal")?.nChildren || []).filter(
        (p: any) => Number(p.nGet("pt").nGet("nValue", -1)) === 6
      ).length;
      if (count === 0) {
        say("You can't use it here in this map.");
        return false;
      }
      townPortalCount = count;
    } catch (e) {
      console.warn(`[MysticDoor] could not read town ${townMapId} for its tp portals:`, e);
    }

    if (itemCon > 0) character.inventory?.removeFromInventory?.(itemCon, itemConNo);
    this.lastCastAt = now;

    const durationMs = Math.max(1, Number(effect?.time) || 30) * 1000;
    const payload = {
      mapId: Number(map.id),
      x: Math.round(character.pos.x),
      y: Math.round(character.pos.y),
      townMapId,
      townPortalCount,
      partyId: PartyManager.party?.id ?? null,
      durationMs,
    };

    if (this.socket?.isConnected && this.myId) {
      this.socket.sendMessage({ type: "door_open", data: payload });
    } else {
      // Offline: the door exists for this client alone
      this.onDoorOpen({
        doorId: `local:${now}`,
        ownerId: this.myId || "local",
        ownerName: character.name || "",
        townSlot: 0,
        expiresAt: now + durationMs,
        ...payload,
      });
    }
    return true;
  }

  // ---------------------------------------------------------------------
  // Using a door

  canUse(door: DoorRecord): boolean {
    if (door.ownerId && door.ownerId === this.myId) return true;
    const myParty = PartyManager.party?.id ?? null;
    return door.partyId != null && myParty != null && door.partyId === myParty;
  }

  private standsAt(character: any, x: number, y: number): boolean {
    const dx = character.pos.x - x;
    const dy = character.pos.y - y;
    return dx >= -USE_LEFT && dx <= USE_RIGHT && dy >= -USE_UP && dy <= USE_DOWN;
  }

  /**
   * Up pressed: if the character stands in a usable door on this map, cross
   * it. Returns true when a warp was started so the caller skips portals.
   */
  async tryUse(character: any): Promise<boolean> {
    if (this.doors.size === 0 || !character?.pos?.fh || character.isRemote) return false;
    for (const door of this.doors.values()) {
      const where = this.positionOnCurrentMap(door);
      if (!where || !this.standsAt(character, where.x, where.y)) continue;
      if (!this.canUse(door)) continue;
      if (where.side === "field") {
        await this.warpTo(door.townMapId, null, door.townSlot);
      } else {
        await this.warpTo(door.mapId, { x: door.x, y: door.y }, null);
      }
      return true;
    }
    return false;
  }

  /**
   * Change map and land either at a world position (back through the town
   * door, onto the cast spot) or at the town's `tp` slot.
   */
  private async warpTo(mapId: number, at: { x: number; y: number } | null, townSlot: number | null) {
    const MapStateInstance = (window as any).MapStateInstance;
    if (!MapStateInstance?.changeMap) return;
    try {
      const { fadeToBlack } = await import("../MapState");
      fadeToBlack();
    } catch (e) {
      /* fade is cosmetic */
    }
    try {
      const portalNode: any = await WZManager.get("Sound.wz/Game.img/Portal");
      const { default: PLAY_AUDIO } = await import("../Audio/PlayAudio");
      PLAY_AUDIO(portalNode.nGetAudio());
    } catch (e) {
      /* sound is cosmetic */
    }
    await MapStateInstance.changeMap(mapId);
    const player = this.map?.PlayerCharacter;
    if (!player?.pos || Number(this.map?.id) !== mapId) return;
    let target = at;
    if (!target && townSlot != null) target = this.townPortalForSlot(townSlot);
    if (!target) return;
    player.pos.x = target.x;
    player.pos.y = target.y - GROUND_CLEARANCE;
    player.pos.vx = 0;
    player.pos.vy = 0;
    player.pos.fh = null;
    player.pos.lf = null;
    player.pos.isClimbing = false;
    player.pos.fallStartY = player.pos.y;
    player.pos.fallDistance = 0;
  }
}

const MysticDoorManager = new MysticDoorManagerClass();
export default MysticDoorManager;
