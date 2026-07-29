import { QuestState } from './Quest/QuestData';
import { createScriptJavaShim, makeSafeScriptApi } from './NpcScriptEngine';
import { fadeToBlack } from './MapState';
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

  async execute(
    scriptName: string,
    character: any,
    portal: any,
    changeMapFn: (mapId: number, portalName?: string) => Promise<void>
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
      const portalName = typeof wt.portal === 'string' ? wt.portal : undefined;
      console.log(`[PortalScript] Warping to map ${wt.mapId}, portal=${portalName}`);
      fadeToBlack();
      await changeMapFn(wt.mapId, portalName);
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
      getSavedLocation(type: string) { return -1; },
      getInventory(type: any) { return { getNumFreeSlot() { return 10; } }; },
      dropMessage(type: number, text: string) { console.log(`[PortalScript] ${text}`); },
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

      warp(mapId: number, portalNameOrId?: any) { onWarp(mapId, portalNameOrId); },

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

      // Messages — stored so caller can display them
      message: (text: string) => { console.log(`[PortalScript] ${text}`); this.lastMessage = text; },
      playerMessage: (type: number, text: string) => { console.log(`[PortalScript] ${text}`); this.lastMessage = text; },
      dropMessage: (type: number, text: string) => { console.log(`[PortalScript] ${text}`); this.lastMessage = text; },
      mapMessage: (type: number, text: string) => { console.log(`[PortalScript] ${text}`); this.lastMessage = text; },

      // Stubs for unimplemented systems
      getParty() { return null; },
      isLeader() { return true; },
      getEventManager(name?: string) { return null; },
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
