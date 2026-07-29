import QuestData, { npcNames, mobNames } from './QuestData';
import { QuestState } from './QuestData';
import WZManager from '../wz-utils/WZManager';
import { fadeToBlack } from '../MapState';
import { makeSafeScriptApi } from '../NpcScriptEngine';

export type ScriptDialogType =
  | 'next' | 'nextPrev' | 'acceptDecline' | 'ok' | 'prev' | 'yesNo' | 'simple'
  | 'getText' | 'getNumber';

export interface InlineImage {
  wzPath: string;   // WZ path for #f codes, or item icon path for #v codes
  type: 'wz' | 'item';
  itemId?: number;
}

export interface PendingDialog {
  text: string;
  type: ScriptDialogType;
  inlineImages?: InlineImage[];
}

// Global item name cache — loaded on demand
const itemNameCache: Map<number, string> = new Map();

export async function loadItemNames() {
  if (itemNameCache.size > 0) return;
  const files = ['Consume', 'Eqp', 'Etc', 'Ins', 'Cash'];
  for (const file of files) {
    try {
      const node: any = await WZManager.get(`String.wz/${file}.img`);
      if (!node?.nChildren) continue;
      for (const child of node.nChildren) {
        const id = parseInt(child.nName);
        if (isNaN(id)) continue;
        const nameNode = child.nGet?.('name');
        if (nameNode?.nValue) itemNameCache.set(id, nameNode.nValue);
      }
    } catch {}
  }
}

export function getItemName(itemId: number): string {
  return itemNameCache.get(itemId) || `item`;
}

// Strip MapleStory format codes from script dialog text
function stripScriptCodes(text: string): string {
  if (!text) return '';
  return text
    .replace(/#b/g, '').replace(/#r/g, '').replace(/#k/g, '')
    .replace(/#n/g, '').replace(/#e/g, '').replace(/#d/g, '').replace(/#g/g, '')
    .replace(/#h\s*0?\s*#/g, () => (window as any).charecter?.name || 'Player')
    .replace(/#p(\d+)#/g, (_, id) => npcNames.get(parseInt(id)) || 'NPC')
    .replace(/#o(\d+)#/g, (_, id) => mobNames.get(parseInt(id)) || 'monster')
    .replace(/#a\d+#/g, '')
    .replace(/#t(\d+)#/g, (_, id) => itemNameCache.get(parseInt(id)) || 'item')
    .replace(/#m\d+#/g, 'map')
    .replace(/#i\d+#/g, '').replace(/#c\d+#/g, '')
    .replace(/#v(\d+)#/g, '\x01ITEM:$1\x02')  // item icon placeholder
    .replace(/#fUI\/UIWindow\.img\/QuestIcon\/(\d+)\/\d+#/g, '\x01QICON:$1\x02')  // quest icon placeholder
    .replace(/#f[^#]*#/g, '') // other image paths — strip
    .replace(/#L\d+#/g, '').replace(/#l/g, '')
    .replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\\r/g, '\n')
    .replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

export default class QuestScriptEngine {
  private scriptCache: Map<number, string> = new Map();
  private status: number = -1;
  private currentQuestId: number = 0;
  private currentPhase: 'start' | 'end' = 'start';
  pendingDialog: PendingDialog | null = null;
  private disposed: boolean = false;
  private character: any = null;

  // Callbacks set by caller
  private onShowDialog: ((dialog: PendingDialog) => void) | null = null;
  private onDispose: (() => void) | null = null;
  private changeMapFn: ((mapId: number, portalName?: string) => Promise<void>) | null = null;

  async loadScript(questId: number): Promise<string | null> {
    if (this.scriptCache.has(questId)) return this.scriptCache.get(questId)!;
    try {
      const resp = await fetch(`/scripts/quest/${questId}.js`);
      if (!resp.ok) return null;
      const text = await resp.text();
      this.scriptCache.set(questId, text);
      return text;
    } catch {
      return null;
    }
  }

  async hasScript(questId: number): Promise<boolean> {
    return (await this.loadScript(questId)) !== null;
  }

  async begin(opts: {
    questId: number;
    phase: 'start' | 'end';
    character: any;
    onShowDialog: (dialog: PendingDialog) => void;
    onDispose: () => void;
    changeMap?: (mapId: number, portalName?: string) => Promise<void>;
  }) {
    await loadItemNames();
    this.currentQuestId = opts.questId;
    this.currentPhase = opts.phase;
    this.character = opts.character;
    this.onShowDialog = opts.onShowDialog;
    this.onDispose = opts.onDispose;
    this.changeMapFn = opts.changeMap || null;
    this.status = -1;
    this.disposed = false;

    await this.advance(1, 0, -1);
  }

  async advance(mode: number, type: number, selection: number) {
    if (this.disposed) {
      // Already disposed (e.g. one-shot message) — just close
      this.onDispose?.();
      return;
    }

    const scriptCode = await this.loadScript(this.currentQuestId);
    if (!scriptCode) {
      this.onDispose?.();
      return;
    }

    this.pendingDialog = null;
    this.disposed = false;

    const qm = this.createQM();

    try {
      // Replace the initial status declaration with our persisted value
      const modifiedScript = scriptCode.replace(
        /var\s+status\s*=\s*-?\d+\s*;?/,
        `var status = ${this.status};`
      );

      const fn = new Function('qm', `
        ${modifiedScript}
        if (typeof ${this.currentPhase} === 'function') {
          ${this.currentPhase}(${mode}, ${type}, ${selection});
        }
        return status;
      `);

      const newStatus = fn(qm);
      if (typeof newStatus === 'number') {
        this.status = newStatus;
      }
    } catch (e) {
      console.error(`[QuestScript] Error in quest ${this.currentQuestId} (${this.currentPhase}):`, e);
      this.onDispose?.();
      return;
    }

    if (this.pendingDialog && this.disposed) {
      // Script sent a final message AND disposed — show as one-shot OK dialog
      // Next advance() call will see disposed=true and call onDispose to close
      this.pendingDialog.type = 'ok';
      this.onShowDialog?.(this.pendingDialog);
    } else if (this.disposed) {
      this.onDispose?.();
    } else if (this.pendingDialog) {
      this.onShowDialog?.(this.pendingDialog);
    }
  }

  private createQM(): any {
    const engine = this;
    const character = this.character;
    const questManager = character?.questManager;

    const playerObj = {
      getGender() { return character?.gender || 0; },
      getHp() { return character?.hp ?? 100; },
      getMp() { return character?.mp ?? 100; },
      getMaxHp() { return character?.stats?.maxHp ?? 100; },
      getMaxMp() { return character?.stats?.maxMp ?? 100; },
      getLevel() { return character?.stats?.level ?? 1; },
      getName() { return character?.name || 'Player'; },
      updateHp(amount: number) { if (character) character.hp = amount; },
      setHp(amount: number) { if (character) character.hp = amount; },
      getJob() {
        const jobId = character?.stats?.jobId ?? 0;
        return { getId() { return jobId; } };
      },
      getJobStyle() { return 0; },
      getInventory(type: any) {
        return { getNumFreeSlot() { return 10; } };
      },
    };

    const qm: any = {
      // Dialog methods — capture text and type
      sendNext(text: string) { engine.pendingDialog = { text: stripScriptCodes(text), type: 'next' }; },
      sendNextPrev(text: string) { engine.pendingDialog = { text: stripScriptCodes(text), type: 'nextPrev' }; },
      sendPrev(text: string) { engine.pendingDialog = { text: stripScriptCodes(text), type: 'prev' }; },
      sendAcceptDecline(text: string) { engine.pendingDialog = { text: stripScriptCodes(text), type: 'acceptDecline' }; },
      sendOk(text: string) { engine.pendingDialog = { text: stripScriptCodes(text), type: 'ok' }; },
      sendYesNo(text: string) { engine.pendingDialog = { text: stripScriptCodes(text), type: 'yesNo' }; },
      sendSimple(text: string) { engine.pendingDialog = { text: stripScriptCodes(text), type: 'simple' }; },
      sendImage(text: string) { engine.pendingDialog = { text: stripScriptCodes(text), type: 'ok' }; },

      dispose() { engine.disposed = true; },

      // Quest state
      forceStartQuest() { questManager?.forceStartQuest(engine.currentQuestId); },
      forceCompleteQuest() { questManager?.forceCompleteQuest(engine.currentQuestId); },
      startQuest(questId?: number) { questManager?.forceStartQuest(questId ?? engine.currentQuestId); },
      completeQuest(questId?: number) { questManager?.forceCompleteQuest(questId ?? engine.currentQuestId); },
      isQuestStarted(questId: number) { return questManager?.getQuestState(questId) === QuestState.STARTED; },
      isQuestCompleted(questId: number) { return questManager?.getQuestState(questId) === QuestState.COMPLETED; },

      // Items
      gainItem(itemId: number, count: number) {
        if (count > 0) {
          character?.inventory?.addToInventory(itemId, count);
          console.log(`[QuestScript] +${count}x item #${itemId}`);
        } else if (count < 0) {
          questManager?.removeItems(itemId, -count);
          console.log(`[QuestScript] -${-count}x item #${itemId}`);
        }
      },
      haveItem(itemId: number, count?: number) {
        const has = questManager?.getItemCount(itemId) ?? 0;
        return has >= (count ?? 1);
      },
      canHold(itemId: number, count?: number) {
        return character?.inventory?.canHold?.(itemId, count ?? 1) ?? true;
      },
      canHoldAll() { return true; },
      removeItem(itemId: number) { questManager?.removeItems(itemId, 1); },

      // Rewards
      gainExp(amount: number) {
        character?.addExp(amount, true);
        console.log(`[QuestScript] +${amount} EXP`);
      },
      gainMeso(amount: number) {
        if (character?.inventory) character.inventory.gainMesos(amount);
        console.log(`[QuestScript] +${amount} mesos`);
      },
      gainFame(amount: number) {
        if (character) character.fame = (character.fame || 0) + amount;
      },

      // Player access
      getPlayer() { return playerObj; },
      c: { getPlayer() { return playerObj; } },

      // Misc (stubs)
      dropMessage(type: number, text: string) { console.log(`[QuestScript] ${text}`); },
      showInfo(path: string) { /* tutorial images — TODO */ },
      warp(mapId: number, portalId?: number) {
        engine.disposed = true;
        if (engine.changeMapFn) {
          fadeToBlack();
          engine.changeMapFn(mapId);
        }
      },
      teachSkill(skillId: number, level?: number, masterLevel?: number) {
        if (character?.skillManager) {
          character.skillManager.changeSkillLevel(skillId, level ?? 1, masterLevel ?? 0);
        }
      },
      changeSkillLevel(skillId: number, level: number, masterLevel: number) {
        if (character?.skillManager) {
          character.skillManager.changeSkillLevel(skillId, level, masterLevel);
        }
      },
      getSkillLevel(skillId: number) {
        return character?.skillManager?.getSkillLevel(skillId) ?? 0;
      },
      changeJobById(jobId: number) { character?.changeJob(jobId); },
      guideHint(hint: number) { /* TODO */ },
      setQuestProgress(questId: number, progress: string) { /* TODO */ },
      getQuestProgress(questId: number) { return ''; },
      getEventManager(name: string) { return null; },
      getQuestStatus(questId: number) {
        return character?.questManager?.getQuestState(questId) ?? 0;
      },
      removeAll(itemId: number) {
        const qmgr = character?.questManager;
        const count = qmgr?.getItemCount(itemId) ?? 0;
        if (count > 0) qmgr?.removeItems(itemId, count);
      },
      itemQuantity(itemId: number) {
        return character?.questManager?.getItemCount(itemId) ?? 0;
      },
      getItemQuantity(itemId: number) {
        return character?.questManager?.getItemCount(itemId) ?? 0;
      },
    };

    // Safety net: unimplemented qm.* calls warn instead of killing the dialog
    return makeSafeScriptApi(qm, `QuestScript ${(this as any).currentQuestId ?? ''} qm`);
  }
}
