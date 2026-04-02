import { npcNames, mobNames, QuestState } from './Quest/QuestData';
import { getItemName } from './Quest/QuestScriptEngine';
import { fadeToBlack } from './MapState';
import ShopUI from './UI/ShopUI';

export type ScriptDialogType = 'next' | 'nextPrev' | 'acceptDecline' | 'ok' | 'prev' | 'yesNo' | 'simple';

export interface SelectionOption {
  index: number;
  label: string;
  headerType?: 'available' | 'inProgress' | 'completable' | 'etc';  // Quest category header above this option
}

export interface PendingDialog {
  text: string;
  type: ScriptDialogType;
  selections?: SelectionOption[];
}

// Parse #L<index>#<text>#l selection options from script text
function parseSelections(text: string, mapNameResolver?: (id: number) => string): { body: string; selections: SelectionOption[] } {
  const selections: SelectionOption[] = [];
  // Match #L<index>#<content>#l patterns
  const selectionRegex = /#L(\d+)#((?:(?!#l).)*?)#l/g;
  let match;
  while ((match = selectionRegex.exec(text)) !== null) {
    let label = match[2];
    // Resolve format codes within selection labels
    label = stripFormatCodes(label, mapNameResolver);
    selections.push({ index: parseInt(match[1]), label });
  }
  // Remove selection markup from body text
  const body = text.replace(/#L\d+#(?:(?!#l).)*?#l/g, '');
  return { body, selections };
}

// Strip MapleStory format codes from text (no selection parsing)
function stripFormatCodes(text: string, mapNameResolver?: (id: number) => string): string {
  if (!text) return '';
  return text
    .replace(/#b/g, '').replace(/#r/g, '').replace(/#k/g, '')
    .replace(/#n/g, '').replace(/#e/g, '').replace(/#d/g, '').replace(/#g/g, '')
    .replace(/#h0#/g, 'Player')
    .replace(/#p(\d+)#/g, (_, id) => npcNames.get(parseInt(id)) || 'NPC')
    .replace(/#o(\d+)#/g, (_, id) => mobNames.get(parseInt(id)) || 'monster')
    .replace(/#m(\d+)#/g, (_, id) => mapNameResolver?.(parseInt(id)) || `Map ${id}`)
    .replace(/#a\d+#/g, '')
    .replace(/#t(\d+)#/g, (_, id) => getItemName(parseInt(id)))
    .replace(/#i\d+#/g, '').replace(/#c\d+#/g, '')
    .replace(/#v(\d+)#/g, '\x01ITEM:$1\x02')
    .replace(/#fUI\/UIWindow\.img\/QuestIcon\/(\d+)\/\d+#/g, '\x01QICON:$1\x02')
    .replace(/#f[^#]*#/g, '')
    .replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\\r/g, '\n')
    .replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

// Strip all format codes including selections
function stripScriptCodes(text: string, mapNameResolver?: (id: number) => string): string {
  if (!text) return '';
  let result = stripFormatCodes(text, mapNameResolver);
  result = result.replace(/#L\d+#/g, '').replace(/#l/g, '');
  return result;
}

export default class NpcScriptEngine {
  private scriptCache: Map<number, string> = new Map();
  private status: number = -1;
  private npcId: number = 0;
  pendingDialog: PendingDialog | null = null;
  private disposed: boolean = false;
  private character: any = null;
  private mapNameCache: Map<number, string> = new Map();

  // Callbacks set by caller
  private onShowDialog: ((dialog: PendingDialog) => void) | null = null;
  private onDispose: (() => void) | null = null;
  private changeMapFn: ((mapId: number, portalName?: string) => Promise<void>) | null = null;

  async loadScript(npcId: number): Promise<string | null> {
    if (this.scriptCache.has(npcId)) return this.scriptCache.get(npcId)!;
    try {
      const resp = await fetch(`/scripts/npc/${npcId}.js`);
      if (!resp.ok) return null;
      const text = await resp.text();
      this.scriptCache.set(npcId, text);
      return text;
    } catch {
      return null;
    }
  }

  async hasScript(npcId: number): Promise<boolean> {
    return (await this.loadScript(npcId)) !== null;
  }

  async begin(opts: {
    npcId: number;
    character: any;
    onShowDialog: (dialog: PendingDialog) => void;
    onDispose: () => void;
    changeMap?: (mapId: number, portalName?: string) => Promise<void>;
  }) {
    this.npcId = opts.npcId;
    this.character = opts.character;
    this.onShowDialog = opts.onShowDialog;
    this.onDispose = opts.onDispose;
    this.changeMapFn = opts.changeMap || null;
    this.status = -1;
    this.disposed = false;

    // Preload map names used by this NPC's script
    await this.preloadMapNames();

    // NPC scripts call start() first, then action() on subsequent interactions
    await this.runScript('start', 0, 0, -1);
  }

  async advance(mode: number, type: number, selection: number) {
    if (this.disposed) {
      this.onDispose?.();
      return;
    }
    await this.runScript('action', mode, type, selection);
  }

  private async preloadMapNames() {
    const scriptCode = await this.loadScript(this.npcId);
    if (!scriptCode) return;
    // Find all #m<digits># patterns in script text
    const mapIds = new Set<number>();
    const regex = /#m(\d+)#/g;
    let match;
    while ((match = regex.exec(scriptCode)) !== null) {
      mapIds.add(parseInt(match[1]));
    }
    // Also find warp() calls with map IDs
    if (mapIds.size === 0) return;
    const mapState = (window as any).MapStateInstance;
    if (!mapState?.getMapName) return;
    for (const id of mapIds) {
      if (!this.mapNameCache.has(id)) {
        try {
          const { mapName } = await mapState.getMapName(id);
          this.mapNameCache.set(id, mapName);
        } catch {
          this.mapNameCache.set(id, `Map ${id}`);
        }
      }
    }
  }

  private async runScript(funcName: string, mode: number, type: number, selection: number) {
    const scriptCode = await this.loadScript(this.npcId);
    if (!scriptCode) {
      this.onDispose?.();
      return;
    }

    this.pendingDialog = null;
    this.disposed = false;

    const cm = this.createCM();

    try {
      const modifiedScript = scriptCode.replace(
        /var\s+status\s*=\s*-?\d+\s*;?/,
        `var status = ${this.status};`
      );

      const fn = new Function('cm', `
        // Stub Java.type() and ShopFactory for backend scripts that use them
        var Java = { type: function(cls) {
          if (cls === 'server.ShopFactory') {
            return { getInstance: function() { return { getShop: function(id) {
              return { sendShop: function() { cm.openShopNPC(id); } };
            }}; }};
          }
          return {};
        }};
        ${modifiedScript}
        if (typeof ${funcName} === 'function') {
          ${funcName}(${mode}, ${type}, ${selection});
        }
        return status;
      `);

      const newStatus = fn(cm);
      if (typeof newStatus === 'number') {
        this.status = newStatus;
      }
    } catch (e) {
      console.error(`[NpcScript] Error in NPC ${this.npcId} (${funcName}):`, e);
      this.onDispose?.();
      return;
    }

    if (this.pendingDialog && this.disposed) {
      this.pendingDialog.type = 'ok';
      this.onShowDialog?.(this.pendingDialog);
    } else if (this.disposed) {
      this.onDispose?.();
    } else if (this.pendingDialog) {
      this.onShowDialog?.(this.pendingDialog);
    }
  }

  private createCM(): any {
    const engine = this;
    const character = this.character;
    const questManager = character?.questManager;
    const mapNameResolver = (id: number) => engine.mapNameCache.get(id) || `Map ${id}`;

    const playerObj = {
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
      getMapId() { return character?.map?.mapId ?? 0; },
      getClient() { return { getPlayer() { return playerObj; } }; },
      getBuddylist() { return { getCapacity() { return 20; } }; },
      setBuddyCapacity(n: number) { /* stub */ },
      getInventory(type: any) {
        return { getNumFreeSlot() { return 10; } };
      },
      isQuestStarted(questId: number) { return questManager?.getQuestState(questId) === QuestState.STARTED; },
      isQuestCompleted(questId: number) { return questManager?.getQuestState(questId) === QuestState.COMPLETED; },
    };

    const cm: any = {
      // Dialog methods
      sendNext(text: string) { engine.pendingDialog = { text: stripScriptCodes(text, mapNameResolver), type: 'next' }; },
      sendNextPrev(text: string) { engine.pendingDialog = { text: stripScriptCodes(text, mapNameResolver), type: 'nextPrev' }; },
      sendPrev(text: string) { engine.pendingDialog = { text: stripScriptCodes(text, mapNameResolver), type: 'prev' }; },
      sendAcceptDecline(text: string) { engine.pendingDialog = { text: stripScriptCodes(text, mapNameResolver), type: 'acceptDecline' }; },
      sendOk(text: string) { engine.pendingDialog = { text: stripScriptCodes(text, mapNameResolver), type: 'ok' }; },
      sendYesNo(text: string) { engine.pendingDialog = { text: stripScriptCodes(text, mapNameResolver), type: 'yesNo' }; },
      sendSimple(text: string) {
        const { body, selections } = parseSelections(text, mapNameResolver);
        engine.pendingDialog = {
          text: stripFormatCodes(body, mapNameResolver),
          type: 'simple',
          selections,
        };
      },
      sendImage(text: string) { engine.pendingDialog = { text: stripScriptCodes(text, mapNameResolver), type: 'ok' }; },
      sendStyle(text: string, options: any) { engine.pendingDialog = { text: stripScriptCodes(text, mapNameResolver), type: 'ok' }; },

      dispose() { engine.disposed = true; },

      // Player info shortcuts
      getPlayer() { return playerObj; },
      getChar() { return playerObj; },
      getClient() { return { getPlayer() { return playerObj; } }; },
      c: { getPlayer() { return playerObj; } },
      getJobId() { return character?.stats?.jobId ?? 0; },
      getLevel() { return character?.stats?.level ?? 1; },
      getMeso() { return character?.inventory?.mesos ?? 0; },
      getMapId() { return character?.map?.mapId ?? 0; },
      getNpc() { return engine.npcId; },
      getMap() { return { getId() { return character?.map?.mapId ?? 0; } }; },

      // Items
      gainItem(itemId: number, count?: number) {
        const qty = count ?? 1;
        if (qty > 0) {
          character?.inventory?.addToInventory(itemId, qty);
        } else if (qty < 0) {
          questManager?.removeItems(itemId, -qty);
        }
      },
      haveItem(itemId: number, count?: number) {
        const has = questManager?.getItemCount(itemId) ?? 0;
        return has >= (count ?? 1);
      },
      canHold(itemId: number, count?: number) { return true; },
      canHoldAll() { return true; },
      removeItem(itemId: number) { questManager?.removeItems(itemId, 1); },

      // Rewards
      gainExp(amount: number) { character?.addExp(amount, true); },
      gainMeso(amount: number) {
        if (character?.inventory) character.inventory.mesos += amount;
      },
      gainFame(amount: number) {
        if (character) character.fame = (character.fame || 0) + amount;
      },

      // Map
      warp(mapId: number, portalId?: number) {
        engine.disposed = true;
        if (engine.changeMapFn) {
          fadeToBlack();
          engine.changeMapFn(mapId);
        }
      },

      // Quest
      startQuest(questId: number) { questManager?.forceStartQuest(questId); },
      completeQuest(questId: number) { questManager?.forceCompleteQuest(questId); },
      forceStartQuest(questId: number) { questManager?.forceStartQuest(questId); },
      forceCompleteQuest(questId: number) { questManager?.forceCompleteQuest(questId); },
      isQuestStarted(questId: number) { return questManager?.getQuestState(questId) === QuestState.STARTED; },
      isQuestCompleted(questId: number) { return questManager?.getQuestState(questId) === QuestState.COMPLETED; },
      setQuestProgress(questId: number, progress: string) { /* stub */ },
      getQuestProgress(questId: number) { return ''; },
      getQuestProgressInt(questId: number) { return 0; },

      // Cosmetics (stubs)
      isCosmeticEquipped(id: number) { return false; },
      getCosmeticItem(slot: number) { return 0; },
      setHair(id: number) { /* stub */ },
      setFace(id: number) { /* stub */ },
      setSkin(id: number) { /* stub */ },

      // Skills/jobs
      teachSkill(skillId: number, level: number, masterLevel: number) { /* stub */ },
      changeJob(job: any) { character?.changeJob(typeof job === 'number' ? job : job?.getId?.() ?? 0); },
      changeJobById(jobId: number) { character?.changeJob(jobId); },

      // Party/events (stubs)
      getParty() { return null; },
      isLeader() { return true; },
      isEventLeader() { return false; },
      getEventInstance() { return null; },
      getEventManager(name: string) { return null; },
      getExpedition() { return null; },

      // Misc
      dropMessage(type: number, text: string) { console.log(`[NpcScript] ${text}`); },
      message(text: string) { console.log(`[NpcScript] ${text}`); },
      showInfo(path: string) { /* stub */ },
      guideHint(hint: number) { /* stub */ },
      openNpc(npcId: number) { /* stub — open another NPC's dialog */ },
      openShopNPC(shopId: number) { ShopUI.show(shopId); },
      openShop(shopId: number) { ShopUI.show(shopId); },
      getGuild() { return null; },
    };

    return cm;
  }
}
