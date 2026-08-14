/**
 * Dev Auto-Login — skips the login/world/character select flow on HMR reload.
 *
 * On successful login, saves session info to sessionStorage.
 * On page load, if session exists, replays the full login flow programmatically.
 *
 * This only activates in development mode (import.meta.env.DEV).
 */

import MySocket from './mysocket';
import MyCharacter, { reviveOfflineDeath } from './MyCharacter';
import LoginState from './LoginState';
import StateManager from './StateManager';
import GameCanvas from './GameCanvas';
import { serializeFullKeymap } from './KeyBindings';

const SESSION_KEY = 'maple_dev_session';

interface DevSession {
  username: string;
  password: string;
  worldId: number;
  characterId: number;
}

const SNAPSHOT_KEY = 'maple_dev_snapshot';

/** Save session after successful character selection */
export function saveDevSession(username: string, password: string, worldId: number, characterId: number) {
  if (!import.meta.env.DEV) return;
  const session: DevSession = { username, password, worldId, characterId };
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  console.log('[DevAutoLogin] Session saved — will auto-login on next reload');
}

/**
 * Save a full character snapshot to sessionStorage so auto-login
 * doesn't depend on the server having received the latest save
 * (beforeunload WebSocket sends are unreliable).
 */
export function saveDevSnapshot() {
  if (!import.meta.env.DEV) return;
  // Never snapshot a half-restored character — it would become the "fresh"
  // state on the next reload and overwrite the real data
  if (!(MyCharacter as any)._restoreComplete) {
    console.warn('[DevAutoLogin] Skipping snapshot — restore not complete');
    return;
  }
  try {
    const MapleMap = (window as any).__MapleMap;
    const inv = MyCharacter.inventory;
    // Must match mysocket's serializeTab: keep null holes (restore places by
    // index) and carry equipData — dropping it wiped cash expiry and pet
    // blobs on every dev reload
    const serializeTab = (items: any[]) =>
      (items || []).map((item: any) =>
        item
          ? {
              itemId: item.itemId,
              quantity: item.quantity ?? 1,
              equipData: item.equipData ?? undefined,
            }
          : null
      );

    const equipped: { slot: number; item_id: number }[] = [];
    if (MyCharacter.equippedItemIds) {
      for (const [slot, itemId] of Object.entries(MyCharacter.equippedItemIds)) {
        if (itemId) equipped.push({ slot: Number(slot), item_id: itemId as number });
      }
    }

    const quests: any[] = [];
    if (MyCharacter.questManager) {
      const qm = MyCharacter.questManager;
      if (qm.activeQuests) {
        for (const [qId, active] of qm.activeQuests) {
          const mp: Record<string, number> = {};
          if (active.mobProgress) {
            for (const [mobId, count] of active.mobProgress) mp[String(mobId)] = count;
          }
          quests.push({ quest_id: qId, state: 1, mob_progress: JSON.stringify(mp) });
        }
      }
      if (qm.completedQuests) {
        for (const [qId, completedAt] of qm.completedQuests) {
          quests.push({ quest_id: qId, state: 2, completed_at: completedAt } as any);
        }
      }
    }

    const snapshot = {
      id: (MyCharacter as any)._serverCharId,
      name: MyCharacter.name,
      skin: MyCharacter.skinColor,
      face: MyCharacter.face,
      hair: MyCharacter.hair,
      hp: MyCharacter.hp,
      maxHp: MyCharacter.maxHp,
      mp: MyCharacter.mp,
      maxMp: MyCharacter.maxMp,
      fame: MyCharacter.fame ?? 0,
      exp: MyCharacter.exp ?? 0,
      mesos: inv?.mesos ?? 0,
      nx: inv?.nx ?? 0,
      stats: {
        level: MyCharacter.stats?.level ?? 1,
        str: MyCharacter.stats?.str ?? 4,
        dex: MyCharacter.stats?.dex ?? 4,
        int: MyCharacter.stats?.int ?? 4,
        luk: MyCharacter.stats?.luk ?? 4,
        ap: MyCharacter.stats?.abilityPoints ?? 0,
        sp: MyCharacter.stats?.sp ?? 0,
        maxHp: MyCharacter.stats?.maxHp ?? 50,
        maxMp: MyCharacter.stats?.maxMp ?? 5,
        jobId: MyCharacter.stats?.jobId ?? 0,
      },
      mapId: MapleMap?.id ? Number(MapleMap.id) : 10000,
      posX: Math.round(MyCharacter.pos?.x ?? 0),
      posY: Math.round(MyCharacter.pos?.y ?? 0),
      equipped,
      inventory: {
        equip: serializeTab(inv?.equip),
        use: serializeTab(inv?.use),
        setup: serializeTab(inv?.setup),
        etc: serializeTab(inv?.etc),
        cash: serializeTab(inv?.cash),
      },
      quests,
      skills: MyCharacter.skillManager?.serialize() || [],
      // Without this, every refresh shadowed the DB's keymap with nothing —
      // and the post-login initial save then wiped the DB rows too
      keymap: serializeFullKeymap(),
    };
    sessionStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
  } catch (e) {
    console.warn('[DevAutoLogin] Failed to save snapshot:', e);
  }
}

/** Clear saved session */
export function clearDevSession() {
  sessionStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(SNAPSHOT_KEY);
}

/** Check if we have a saved dev session */
export function hasDevSession(): boolean {
  if (!import.meta.env.DEV) return false;
  return sessionStorage.getItem(SESSION_KEY) !== null;
}

/**
 * Attempt auto-login. Returns true if successful (skip normal login flow).
 * Returns false if no session or auto-login failed (proceed to normal login).
 */
export async function tryAutoLogin(canvas: GameCanvas): Promise<boolean> {
  if (!import.meta.env.DEV) return false;

  const raw = sessionStorage.getItem(SESSION_KEY);
  if (!raw) return false;

  let session: DevSession;
  try {
    session = JSON.parse(raw);
  } catch {
    clearDevSession();
    return false;
  }

  console.log('[DevAutoLogin] Found saved session, auto-logging in...');

  try {
    // 1. Connect to server
    await MySocket.connectForLogin();

    // 2. Login
    const loginResult = await MySocket.sendLogin(session.username, session.password);
    if (!loginResult.success) {
      console.warn('[DevAutoLogin] Login failed:', loginResult.error);
      clearDevSession();
      return false;
    }
    (MySocket as any)._loggedInUserId = loginResult.userId;
    console.log('[DevAutoLogin] Logged in as', session.username);

    // 3. Select character (registers with server for multiplayer)
    const result = await MySocket.selectCharacter(session.characterId);
    if (!result.success || !result.character) {
      console.warn('[DevAutoLogin] Character select failed:', result.error);
      clearDevSession();
      return false;
    }

    // 4. Apply character data — prefer sessionStorage snapshot (always fresh)
    //    over server DB data (may be stale if beforeunload save didn't arrive)
    let charData = result.character;
    const snapshotRaw = sessionStorage.getItem(SNAPSHOT_KEY);
    if (snapshotRaw) {
      try {
        const snapshot = JSON.parse(snapshotRaw);
        // A snapshot with no equips while the DB has some is a broken state
        // (e.g. captured mid-restore or after a wipe) — trusting it would
        // re-save the naked state and perpetuate the wipe forever
        const snapshotNaked = !snapshot.equipped || snapshot.equipped.length === 0;
        const dbHasEquips = (result.character.equipped?.length ?? 0) > 0;
        if (snapshot.id !== session.characterId) {
          // different character — ignore
        } else if (snapshotNaked && dbHasEquips) {
          console.warn('[DevAutoLogin] Snapshot has no equips but DB does — using DB data');
        } else {
          console.log('[DevAutoLogin] Using sessionStorage snapshot (fresher than DB)');
          charData = snapshot;
          // Older snapshots predate the keymap field — fall back to the
          // DB's bindings rather than restoring none and wiping them
          if (!charData.keymap?.length && result.character.keymap?.length) {
            charData.keymap = result.character.keymap;
          }
        }
      } catch { /* use server data */ }
    }
    // Died and closed the game before respawning → revive like the original
    // server does on load (50 HP at the death map's returnMap)
    await reviveOfflineDeath(charData);

    // 4. Apply character data — set properties only (no WZ loading here,
    //    MapState.initialize → MyCharacter.load() handles sprite loading)
    // Block saves until the restore below succeeds (prevents empty-state
    // saves from wiping DB inventory/equips)
    (MyCharacter as any)._restoreComplete = false;
    MyCharacter.name = charData.name || 'Player';
    MyCharacter.skinColor = charData.skin ?? 0;
    MyCharacter.face = charData.face ?? 20000;
    MyCharacter.hair = charData.hair ?? 30030;

    MyCharacter.hp = charData.hp;
    MyCharacter.maxHp = charData.maxHp;
    MyCharacter.mp = charData.mp;
    MyCharacter.maxMp = charData.maxMp;
    MyCharacter.fame = charData.fame ?? 0;

    if (MyCharacter.stats) {
      MyCharacter.stats.level = charData.stats.level;
      MyCharacter.stats.str = charData.stats.str;
      MyCharacter.stats.dex = charData.stats.dex;
      MyCharacter.stats.int = charData.stats.int;
      MyCharacter.stats.luk = charData.stats.luk;
      MyCharacter.stats.abilityPoints = charData.stats.ap;
      MyCharacter.stats.maxHp = charData.stats.maxHp;
      MyCharacter.stats.maxMp = charData.stats.maxMp;
      MyCharacter.stats.setJobId(charData.stats.jobId);
      if (charData.stats.spByTier) MyCharacter.stats.spByTier = { ...charData.stats.spByTier };
      else if (charData.stats.sp !== undefined) MyCharacter.stats.sp = charData.stats.sp;
    }
    MyCharacter.exp = charData.exp ?? 0;
    const { default: ExpTable } = await import('./Constants/ExpTable');
    MyCharacter.maxExp = ExpTable.getExpNeededForLevel(charData.stats.level);
    MyCharacter.recalcLocalStats();

    // Equipment — just store IDs, MyCharacter.load() will attachEquip from equippedItemIds
    MyCharacter.equips = [];
    MyCharacter.equippedItemIds = {};
    if (charData.equipped) {
      for (const eq of charData.equipped) {
        MyCharacter.equippedItemIds[eq.slot] = eq.item_id;
      }
    }

    // Inventory — load items in parallel instead of sequentially
    if (MyCharacter.inventory && charData.inventory) {
      const Item = (await import('./Inventory/Item')).default;
      for (const tab of ['equip', 'use', 'setup', 'etc', 'cash'] as const) {
        const items = charData.inventory[tab] || [];
        // Place items at their saved slot index; keep holes as null
        const loaded = await Promise.all(
          items.map((item: any) =>
            item?.itemId
              ? Item.fromOpts({
                  itemId: item.itemId,
                  quantity: item.quantity,
                  equipData: item.equipData ?? undefined,
                }).catch(() => null)
              : Promise.resolve(null)
          )
        );
        (MyCharacter.inventory as any)[tab] = loaded;
      }
      MyCharacter.inventory.mesos = charData.mesos ?? 0;
      MyCharacter.inventory.nx = charData.nx ?? 0;
    }

    // Quests. Quest data must be loaded first — see the same block in
    // UILogin: a mid-load replay lost mob progress and re-fired the
    // "Quest completed" balloon on every login.
    if (MyCharacter.questManager && charData.quests) {
      await MyCharacter.questManager.initialize();
      for (const q of charData.quests) {
        if (q.state === 2) {
          MyCharacter.questManager.forceCompleteQuest(q.quest_id, q.completed_at ?? 0);
        } else if (q.state === 1) {
          let mobProgress: Record<string, number> | undefined;
          try { if (q.mob_progress) mobProgress = JSON.parse(q.mob_progress); } catch {}
          MyCharacter.questManager.forceStartQuest(q.quest_id, mobProgress);
        }
      }
      // After every quest is back (prereq-quest ordering settled)
      MyCharacter.questManager.reseedFulfilled();
    }

    // Skills
    if (MyCharacter.skillManager && charData.skills) {
      MyCharacter.skillManager.deserialize(charData.skills);
    }

    // Hotkey bindings (skills + items). Unconditional: an empty keymap is a
    // fresh character, and deserialize must still run to wipe whatever
    // character was loaded before it this session.
    {
      const UIHotkeyBar = (await import('./UI/UIHotkeyBar')).default;
      await UIHotkeyBar.deserialize(charData.keymap || []);
    }

    // Server IDs and position
    (MyCharacter as any)._serverCharId = charData.id;
    (MyCharacter as any)._startMapId = charData.mapId;
    (MyCharacter as any)._startPosX = charData.posX;
    (MyCharacter as any)._startPosY = charData.posY;

    // Expired Cash Shop rentals go before the flip, same as the login path
    try {
      const { sweepExpiredCashItems } = await import('./Shop/CashShopData');
      await sweepExpiredCashItems(MyCharacter);
    } catch (e) {
      console.warn('[DevAutoLogin] expiry sweep failed', e);
    }

    // Restore finished — saves are safe from here on
    (MyCharacter as any)._restoreComplete = true;

    // 5. Enter game directly (skip login state entirely)
    const MapState = (await import('./MapState')).default;
    const startMapId = charData.mapId;
    if (startMapId) {
      (MapState as any)._startMapOverride = startMapId;
    }

    const MapleMap = (await import('./MapleMap')).default;
    await StateManager.setState(MapState);
    MapleMap.PlayerCharacter = MyCharacter;

    // Apply saved position
    if (charData.posX && charData.posY) {
      if (MapleMap.isPositionValid?.(charData.posX, charData.posY)) {
        MyCharacter.pos.x = charData.posX;
        MyCharacter.pos.y = charData.posY;
      }
    }

    // Initialize multiplayer, exactly as LoginState.enterGame does. This is
    // what registers with the game server (player_info → mob host), starts
    // the update/registration-retry/mob-batch loops, arms the 30s autosave
    // and the beforeunload save. Without it every HMR reload landed in a
    // half-dead session: mobs frozen in remote mode, attacks doing nothing,
    // and no save ever sent — fixable only by closing the tab, since a
    // refresh just re-ran this same path.
    await MySocket.initialize();

    console.log('[DevAutoLogin] Auto-login complete! Entered game.');
    return true;

  } catch (e) {
    console.error('[DevAutoLogin] Auto-login failed:', e);
    clearDevSession();
    return false;
  }
}
