import { QuestState } from './Quest/QuestData';
import { createScriptJavaShim, makeSafeScriptApi } from './NpcScriptEngine';
import { fadeToBlack } from './MapState';
import TransportationManager from './Transport/TransportationManager';
import WZManager from './wz-utils/WZManager';
import PLAY_AUDIO from './Audio/PlayAudio';

export default class PortalScriptEngine {
  private scriptCache: Map<string, string> = new Map();

  async loadScript(scriptName: string): Promise<string | null> {
    if (this.scriptCache.has(scriptName)) return this.scriptCache.get(scriptName)!;
    try {
      const resp = await fetch(`/scripts/portal/${scriptName}.js`);
      if (!resp.ok) return null;
      const text = await resp.text();
      this.scriptCache.set(scriptName, text);
      return text;
    } catch {
      return null;
    }
  }

  lastMessage: string = '';

  /** Surface a portal script's message as a system line in the chat log */
  private showMessage(text: string) {
    if (!text) return;
    this.lastMessage = text;
    console.log(`[PortalScript] ${text}`);
    import('./UI/UIChatLog')
      .then(({ default: UIChatLog }) => UIChatLog.system(text))
      .catch(() => {});
  }

  async execute(
    scriptName: string,
    character: any,
    portal: any,
    changeMapFn: (mapId: number, portalNameOrIndex?: string | number) => Promise<void>
  ): Promise<boolean> {
    this.lastMessage = '';
    const scriptCode = await this.loadScript(scriptName);
    if (!scriptCode) {
      console.warn(`[PortalScript] Script not found: ${scriptName}`);
      return true; // allow entry if no script
    }

    let warpTarget: { mapId: number; portal?: any } | null = null;
    let blocked = false;

    const pi = this.createPI(character, portal, (mapId, portalNameOrId) => {
      warpTarget = { mapId, portal: portalNameOrId };
    }, () => { blocked = true; });

    let result: any;
    try {
      const shim = createScriptJavaShim();
      const fn = new Function('pi', 'Java', 'java', 'Packages', `
        ${scriptCode}
        if (typeof enter === 'function') return enter(pi);
        return true;
      `);
      result = fn(pi, shim.Java, shim.java, shim.Packages);
    } catch (e) {
      console.error(`[PortalScript] Error in ${scriptName}:`, e);
      return false;
    }

    console.log(`[PortalScript] ${scriptName}: result=${result}, warpTarget=${JSON.stringify(warpTarget)}, blocked=${blocked}`);

    // Handle warp if script called pi.warp()
    if (warpTarget !== null) {
      const wt = warpTarget as { mapId: number; portal?: any };
      // The second argument is either a portal NAME or a portal INDEX, and
      // both have to survive. Dropping the numeric form put every scripted
      // return at the destination's spawn point instead of the door it came
      // out of — leaving the Wounded Soldier's Camp landed you in the middle
      // of the ark camp rather than at its entrance.
      const target =
        typeof wt.portal === 'string' || typeof wt.portal === 'number' ? wt.portal : undefined;
      console.log(`[PortalScript] Warping to map ${wt.mapId}, portal=${JSON.stringify(target)}`);
      fadeToBlack();
      await changeMapFn(wt.mapId, target);
      return true;
    }

    return result !== false && !blocked;
  }

  private createPI(
    character: any,
    portal: any,
    onWarp: (mapId: number, portalNameOrId?: any) => void,
    onBlock: () => void
  ): any {
    const questManager = character?.questManager;

    const playerObjBase: any = {
      getGender() { return character?.gender || 0; },
      getHp() { return character?.hp ?? 100; },
      getMp() { return character?.mp ?? 100; },
      getMaxHp() { return character?.maxHp ?? 100; },
      getMaxMp() { return character?.maxMp ?? 100; },
      getLevel() { return character?.stats?.level ?? 1; },
      getName() { return character?.name || 'Player'; },
      getStr() { return character?.stats?.str ?? 4; },
      getDex() { return character?.stats?.dex ?? 4; },
      getInt() { return character?.stats?.int ?? 4; },
      getLuk() { return character?.stats?.luk ?? 4; },
      getJob() {
        const jobId = character?.stats?.jobId ?? 0;
        return { getId() { return jobId; }, id: jobId };
      },
      getJobId() { return character?.stats?.jobId ?? 0; },
      getMapId() { return character?.map?.mapId ?? 0; },
      getMap() { return { getId() { return character?.map?.mapId ?? 0; } }; },
      getClient() { return { getPlayer() { return playerObj; } }; },
      // Saved locations live on the character, shared with NpcScriptEngine —
      // the engines are recreated per map, the store must not be. This used to
      // be a hardcoded `return -1` with no saveLocation at all, which broke the
      // Free Market at both ends: the town-side scripts' saveLocation("FREE_
      // MARKET") degraded to a no-op through the safe shim, and market00 asked
      // for it on the way out, got -1, and warped there. Nothing threw, so the
      // script's own catch-fallback to Henesys never fired and you landed in an
      // unloadable map with no portals. Same failure shape as Pison's Florina
      // return: a -1 sentinel treated as a map id.
      saveLocation(type: string) {
        const c: any = character;
        if (!c) return;
        c.savedLocations = c.savedLocations || {};
        c.savedLocations[type] = c.map?.mapId ?? 0;
        // Also remember WHICH door was used, not just the map. The Free
        // Market's exit script asks for a portal to come back out of, and the
        // only exact answer is the one walked into — towns have several
        // portals and the map's spawn point is usually none of them, which
        // dropped you somewhere else in Perion entirely.
        c.savedLocationPortals = c.savedLocationPortals || {};
        c.savedLocationPortals[type] = portal?.name || 0;
      },
      peekSavedLocation(type: string) {
        const v = (character as any)?.savedLocations?.[type];
        return typeof v === 'number' && v > 0 ? v : -1;
      },
      getSavedLocation(type: string) {
        const c: any = character;
        const v = c?.savedLocations?.[type];
        if (c?.savedLocations) delete c.savedLocations[type];
        return typeof v === 'number' && v > 0 ? v : -1;
      },
      clearSavedLocation(type: string) {
        const c: any = character;
        if (c?.savedLocations) delete c.savedLocations[type];
      },
      getInventory(type: any) { return { getNumFreeSlot() { return 10; } }; },
      dropMessage: (type: number, text: string) => { this.showMessage(text); },
      isQuestStarted(questId: number) { return questManager?.getQuestState(questId) === QuestState.STARTED; },
      isQuestCompleted(questId: number) { return questManager?.getQuestState(questId) === QuestState.COMPLETED; },
    };
    // Unimplemented player methods degrade to chainable no-ops
    const playerObj = makeSafeScriptApi(playerObjBase, 'PortalScript player');

    return makeSafeScriptApi({
      playPortalSound() {
        WZManager.get('Sound.wz/Game.img/Portal').then((node: any) => {
          PLAY_AUDIO(node.nGetAudio());
        });
      },

      warp(mapId: number, portalNameOrId?: any) {
        // A script that computes a bad destination must not be able to strand
        // the player. Map ids are always positive, so anything else is a
        // sentinel that leaked through (-1 = "nothing saved") or a bad
        // calculation; loading it leaves a black screen with no portals out.
        // Henesys is where these scripts send you when their own error path
        // fires, so it is the fallback they already expect.
        const id = Number(mapId);
        if (!Number.isFinite(id) || id <= 0) {
          console.warn(`[PortalScript] refusing to warp to invalid map ${mapId} — sending to Henesys`);
          onWarp(100000000, 0);
          return;
        }
        onWarp(id, portalNameOrId);
      },

      // Which portal you step out of once back in town: the one you walked in
      // through, recorded by saveLocation. Falls back to the map's spawn point
      // (0) when there is nothing remembered — every map has one, so the
      // player always lands somewhere valid.
      //
      // Read after getSavedLocation has already consumed the map id, so this
      // does its own cleanup rather than relying on that call.
      getMarketPortalId(_mapId: number) {
        const c: any = character;
        const p = c?.savedLocationPortals?.['FREE_MARKET'];
        if (c?.savedLocationPortals) delete c.savedLocationPortals['FREE_MARKET'];
        return p || 0;
      },

      getPlayer() { return playerObj; },
      getMapId() { return character?.map?.mapId ?? 0; },
      getMap() { return { getId() { return character?.map?.mapId ?? 0; } }; },
      getPortal() { return { getName() { return portal?.name || ''; } }; },

      // Quest state
      isQuestStarted(questId: number) { return questManager?.getQuestState(questId) === QuestState.STARTED; },
      isQuestCompleted(questId: number) { return questManager?.getQuestState(questId) === QuestState.COMPLETED; },
      isQuestActive(questId: number) { return questManager?.getQuestState(questId) === QuestState.STARTED; },
      startQuest(questId: number) { questManager?.forceStartQuest(questId); },
      completeQuest(questId: number) { questManager?.forceCompleteQuest(questId); },
      getQuestProgress(questId: number) { return ''; },
      getQuestProgressInt(questId: number) { return 0; },
      setQuestProgress(questId: number, progress: string) { /* stub */ },

      // Area info — how the tutorials remember which one-shot hint already
      // fired. Without a real implementation the safe-shim's chainable no-op
      // reads as truthy, every `if (containsAreaInfo(...)) return false` fires
      // on the first visit, and none of the guidance ever shows.
      containsAreaInfo(questId: number, data: string) {
        return questManager?.containsAreaInfo?.(questId, data) ?? false;
      },
      updateAreaInfo(questId: number, data: string) {
        questManager?.updateAreaInfo?.(questId, data);
      },

      // Items
      haveItem(itemId: number, count?: number) {
        return (questManager?.getItemCount(itemId) ?? 0) >= (count ?? 1);
      },
      gainItem(itemId: number, count?: number) {
        const qty = count ?? 1;
        if (qty > 0) character?.inventory?.addToInventory(itemId, qty);
        else if (qty < 0) questManager?.removeItems(itemId, -qty);
      },
      removeItem(itemId: number) { questManager?.removeItems(itemId, 1); },
      canHold(itemId: number) { return true; },

      // Portal control
      blockPortal(name?: string) { onBlock(); },
      unblockPortal(name?: string) { /* stub */ },

      // Messages — shown in the chat log, the way the original client does.
      // These are not decoration: a blocked portal explains itself only
      // through them ("You can only exit after you accept the quest from
      // Athena Pierce"), and the Aran tutorial teaches the attack key this
      // way. Swallowing them to the console leaves the player facing a
      // portal that silently refuses and no idea why.
      message: (text: string) => { this.showMessage(text); },
      playerMessage: (type: number, text: string) => { this.showMessage(text); },
      dropMessage: (type: number, text: string) => { this.showMessage(text); },
      mapMessage: (type: number, text: string) => { this.showMessage(text); },

      // Stubs for unimplemented systems
      getParty() { return null; },
      isLeader() { return true; },
      getEventManager(name?: string) {
        // Real for transportation events (elevator gate checks, KerningTrain
        // startInstance); null for anything else — elevator.js treats null as
        // "under maintenance", which is the correct degraded behavior
        const transport = name ? TransportationManager.getEventManagerApi(name) : null;
        return transport ? makeSafeScriptApi(transport, `EventManager:${name}`) : null;
      },
      getEventInstance() { return null; },
      startDungeonInstance(id: number) { return false; },
      warpParty(mapId: number, portalNameOrId?: any) { onWarp(mapId, portalNameOrId); },
      getLevel() { return character?.stats?.level ?? 1; },
      getJobId() { return character?.stats?.jobId ?? 0; },
      openNpc(npcId: number) { /* stub */ },
      showInfo(path: string) { /* stub */ },
      guideHint(hint: number) { /* stub */ },
    }, 'PortalScript pi');
  }
}
