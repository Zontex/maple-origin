import QuestData, { npcNames, mobNames, ensureItemNames, getItemNameSync } from './QuestData';
import { cachedFetch } from '../AssetDownloader';
import { QuestState } from './QuestData';
import { fadeToBlack } from '../MapState';
import { makeSafeScriptApi, createScriptJavaShim } from '../NpcScriptEngine';

export type ScriptDialogType =
  | 'next' | 'nextPrev' | 'acceptDecline' | 'ok' | 'prev' | 'yesNo' | 'simple'
  | 'getText' | 'getNumber' | 'style';

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

// Item names come from QuestData's shared cache, which recursively walks
// nested String.wz structures (Eqp.img is Eqp/Accessory/<id> etc. — a flat
// scan misses every equip/medal name)
export async function loadItemNames() {
  await ensureItemNames();
}

export function getItemName(itemId: number): string {
  return getItemNameSync(itemId);
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
    .replace(/#t(\d+):?#/g, (_, id) => getItemNameSync(parseInt(id)).trim())
    .replace(/#m\d+#/g, 'map')
    .replace(/#i\d+:?#/g, '').replace(/#c\d+:?#/g, '')
    .replace(/#v(\d+):?#/g, '\x01ITEM:$1\x02')  // item icon placeholder (some GMS texts use #v<id>:#)
    .replace(/#fUI\/UIWindow\.img\/QuestIcon\/(\d+)\/\d+#/g, '\x01QICON:$1\x02')  // quest icon placeholder
    .replace(/#f[^#]*#/g, '') // other image paths — strip
    .replace(/#L\d+#/g, '').replace(/#l/g, '')
    .replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\\r/g, '\n')
    .replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

export default class QuestScriptEngine {
  private scriptCache: Map<number, string> = new Map();
  // Per-conversation script closure — see advance() for why this persists
  private scriptFuncs: { start: Function | null; end: Function | null } | null = null;
  private scriptQm: any = null;
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
      const resp = await cachedFetch(`/scripts/quest/${questId}.js`);
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
    this.disposed = false;
    // Fresh conversation — new script closure with fresh top-level vars
    this.scriptFuncs = null;
    this.scriptQm = null;

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

    try {
      // Build the script closure once per conversation — start/end capture
      // ALL the script's top-level vars (status, selections, flags), so they
      // persist across interactions like the original server's per-
      // conversation script instance. Re-running the source each time reset
      // helper vars (only `status` was patched back in), which broke every
      // script that remembers a selection between pages.
      if (!this.scriptFuncs) {
        this.scriptQm = this.createQM();
        const shim = createScriptJavaShim(this.scriptQm);
        const factory = new Function('qm', 'Java', 'java', 'Packages', `
          ${scriptCode}
          return {
            start: typeof start === 'function' ? start : null,
            end: typeof end === 'function' ? end : null,
          };
        `);
        this.scriptFuncs = factory(this.scriptQm, shim.Java, shim.java, shim.Packages);
      }

      const fn = (this.scriptFuncs as any)?.[this.currentPhase];
      if (typeof fn === 'function') {
        fn(mode, type, selection);
      }
    } catch (e) {
      console.error(`[QuestScript] Error in quest ${this.currentQuestId} (${this.currentPhase}):`, e);
      this.onDispose?.();
      return;
    }

    const dialog = this.pendingDialog as PendingDialog | null;
    if (dialog && this.disposed) {
      // Script sent a final message AND disposed — show as one-shot OK dialog
      // Next advance() call will see disposed=true and call onDispose to close
      dialog.type = 'ok';
      this.onShowDialog?.(dialog);
    } else if (this.disposed) {
      this.onDispose?.();
    } else if (dialog) {
      this.onShowDialog?.(dialog);
    }
  }

  private createQM(): any {
    const engine = this;
    const character = this.character;
    const questManager = character?.questManager;

    const playerObjBase = {
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
        return { getId() { return jobId; }, id: jobId };
      },
      getJobStyle() { return 0; },
      getInventory(type: any) {
        return { getNumFreeSlot() { return 10; } };
      },
      getParty() { return null; },
      getGuild() { return null; },
      getEventInstance() { return null; },
      getSkillLevel(skillId: any) {
        const id = typeof skillId === 'number' ? skillId : skillId?.getId?.() ?? 0;
        return character?.skillManager?.getSkillLevel?.(id) ?? 0;
      },
    };
    // Unimplemented player methods degrade to chainable no-ops
    const playerObj = makeSafeScriptApi(playerObjBase, 'QuestScript player');

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
        import('../UI/UIChatLog').then(({ default: UIChatLog }) => UIChatLog.logItemChange(itemId, count)).catch(() => {});
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
      c: makeSafeScriptApi({ getPlayer() { return playerObj; } }, 'QuestScript c'),

      // Misc (stubs)
      dropMessage(type: number, text: string) { console.log(`[QuestScript] ${text}`); },
      showInfo(path: string) { /* tutorial images — TODO */ },
      warp(mapId: number, portalId?: number) {
        engine.disposed = true;
        const id = Number(mapId);
        // A broken script must never warp via changeMap's defaultMap fallback
        if (!Number.isFinite(id) || id <= 0) {
          console.error(`[QuestScript] Quest ${engine.currentQuestId} warp with invalid mapId:`, mapId);
          return;
        }
        if (engine.changeMapFn) {
          fadeToBlack();
          engine.changeMapFn(id);
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
