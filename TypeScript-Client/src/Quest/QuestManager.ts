import QuestData, { QuestState, QuestRequirement } from './QuestData';
import type MapleCharacter from '../MapleCharacter';

export interface ActiveQuest {
  questId: number;
  mobProgress: Map<number, number>; // mobId -> current kill count
}

export default class QuestManager {
  activeQuests: Map<number, ActiveQuest> = new Map();
  completedQuests: Set<number> = new Set();
  private character: MapleCharacter;

  constructor(character: MapleCharacter) {
    this.character = character;
  }

  async initialize(): Promise<void> {
    await QuestData.initialize();
  }

  getQuestState(questId: number): QuestState {
    if (this.completedQuests.has(questId)) return QuestState.COMPLETED;
    if (this.activeQuests.has(questId)) return QuestState.STARTED;
    return QuestState.NOT_STARTED;
  }

  canStartQuest(questId: number): boolean {
    // Already started or completed
    if (this.activeQuests.has(questId) || this.completedQuests.has(questId)) return false;

    const reqs = QuestData.requirements.get(questId);
    if (!reqs) return false;

    // Script-based quests are handled by QuestScriptEngine, not canStartQuest
    if (reqs.start.startscript || reqs.complete.endscript) return false;

    const met = this.meetsRequirement(reqs.start);
    return met;
  }

  canCompleteQuest(questId: number): boolean {
    const active = this.activeQuests.get(questId);
    if (!active) return false;

    const reqs = QuestData.requirements.get(questId);
    if (!reqs) return false;

    // Script-based quests — check item requirements if any, otherwise show in-progress
    if (reqs.complete.endscript) {
      // If there are item requirements, check them (e.g. Roger's Apple consumed)
      if (reqs.complete.items && reqs.complete.items.length > 0) {
        // Quest items with count=0 mean "check existence" — completable when item is gone
        for (const item of reqs.complete.items) {
          if (item.count > 0 && this.getItemCount(item.id) < item.count) return false;
          if (item.count === 0 && this.getItemCount(item.id) > 0) return false;
        }
        return true;
      }
      // No item requirements — can't determine, show as in-progress
      return false;
    }

    // Check mob kill requirements
    if (reqs.complete.mobs) {
      for (const mob of reqs.complete.mobs) {
        const kills = active.mobProgress.get(mob.id) || 0;
        if (kills < mob.count) return false;
      }
    }

    // Check item requirements
    if (reqs.complete.items) {
      for (const item of reqs.complete.items) {
        const count = this.getItemCount(item.id);
        if (count < item.count) return false;
      }
    }

    return true;
  }

  startQuest(questId: number): boolean {
    if (!this.canStartQuest(questId)) return false;

    const reqs = QuestData.requirements.get(questId);
    const active: ActiveQuest = {
      questId,
      mobProgress: new Map(),
    };

    // Initialize mob kill tracking from completion requirements
    if (reqs?.complete.mobs) {
      for (const mob of reqs.complete.mobs) {
        active.mobProgress.set(mob.id, 0);
      }
    }

    this.activeQuests.set(questId, active);
    this.character.playQuestStart();

    // Apply start rewards (e.g. quest items given to player on accept)
    const rewards = QuestData.rewards.get(questId);
    if (rewards?.start) {
      const r = rewards.start;
      if (r.exp) {
        this.character.addExp(r.exp, true);
        console.log(`Quest start reward: +${r.exp} EXP`);
      }
      if (r.meso) {
        this.character.inventory.mesos += r.meso;
        console.log(`Quest start reward: +${r.meso} mesos`);
      }
      if (r.items) {
        for (const item of r.items) {
          if (item.count > 0) {
            this.character.inventory.addToInventory(item.id, item.count);
            console.log(`Quest start reward: +${item.count}x item #${item.id}`);
          }
        }
      }
    }

    console.log(`Quest started: ${QuestData.quests.get(questId)?.name} (#${questId})`);
    return true;
  }

  completeQuest(questId: number): boolean {
    if (!this.canCompleteQuest(questId)) return false;

    // Apply rewards
    const rewards = QuestData.rewards.get(questId);
    if (rewards?.complete) {
      const r = rewards.complete;
      if (r.exp) {
        this.character.addExp(r.exp, true);
        console.log(`Quest reward: +${r.exp} EXP`);
      }
      if (r.meso) {
        this.character.inventory.mesos += r.meso;
        console.log(`Quest reward: +${r.meso} mesos`);
      }
      if (r.fame) {
        this.character.fame += r.fame;
        console.log(`Quest reward: +${r.fame} fame`);
      }
      if (r.items) {
        // Separate prop items (random reward) from guaranteed items
        const propItems = r.items.filter(i => i.prop && i.prop > 0);
        const guaranteedItems = r.items.filter(i => !i.prop || i.prop <= 0);

        for (const item of guaranteedItems) {
          this.character.inventory.addToInventory(item.id, item.count);
          console.log(`Quest reward: +${item.count}x item #${item.id}`);
        }

        // Randomly pick one from prop items
        if (propItems.length > 0) {
          const picked = propItems[Math.floor(Math.random() * propItems.length)];
          this.character.inventory.addToInventory(picked.id, picked.count);
          console.log(`Quest reward (random): +${picked.count}x item #${picked.id} (from ${propItems.length} options)`);
        }
      }
    }

    // Remove consumed items from completion requirements
    const reqs = QuestData.requirements.get(questId);
    if (reqs?.complete.items) {
      for (const item of reqs.complete.items) {
        this.removeItems(item.id, item.count);
      }
    }

    // Move from active to completed
    this.activeQuests.delete(questId);
    this.completedQuests.add(questId);
    this.character.playQuestClear();

    const questName = QuestData.quests.get(questId)?.name || questId;
    console.log(`Quest completed: ${questName}`);

    // Auto-start next quest if specified
    if (rewards?.complete.nextQuest) {
      const nextId = rewards.complete.nextQuest;
      if (this.canStartQuest(nextId)) {
        this.startQuest(nextId);
      }
    }

    return true;
  }

  // Force start a quest (used by script engine — bypasses requirement checks)
  forceStartQuest(questId: number): void {
    if (this.activeQuests.has(questId) || this.completedQuests.has(questId)) return;

    const reqs = QuestData.requirements.get(questId);
    const active: ActiveQuest = { questId, mobProgress: new Map() };

    if (reqs?.complete.mobs) {
      for (const mob of reqs.complete.mobs) {
        active.mobProgress.set(mob.id, 0);
      }
    }

    this.activeQuests.set(questId, active);
    this.character.playQuestStart();
    console.log(`Quest force-started: ${QuestData.quests.get(questId)?.name} (#${questId})`);
  }

  // Force complete a quest (used by script engine — bypasses requirement checks)
  forceCompleteQuest(questId: number): void {
    this.activeQuests.delete(questId);
    this.completedQuests.add(questId);
    this.character.playQuestClear();
    console.log(`Quest force-completed: ${QuestData.quests.get(questId)?.name} (#${questId})`);
  }

  forfeitQuest(questId: number): void {
    this.activeQuests.delete(questId);
    console.log(`Quest forfeited: ${QuestData.quests.get(questId)?.name}`);
  }

  onMobKill(mobId: number): void {
    for (const [questId, active] of this.activeQuests) {
      if (active.mobProgress.has(mobId)) {
        const reqs = QuestData.requirements.get(questId);
        const required = reqs?.complete.mobs?.find(m => m.id === mobId)?.count || 0;
        const current = active.mobProgress.get(mobId) || 0;

        if (current < required) {
          active.mobProgress.set(mobId, current + 1);
          const newCount = current + 1;
          const questName = QuestData.quests.get(questId)?.name || '';
          console.log(`[Quest] ${questName}: killed mob ${mobId} (${newCount}/${required})`);
        }
      }
    }
  }

  getQuestsForNpc(npcId: number): {
    available: number[];
    inProgress: number[];
    completable: number[];
  } {
    const result = { available: [] as number[], inProgress: [] as number[], completable: [] as number[] };
    const questIds = QuestData.npcToQuests.get(npcId);
    if (!questIds) return result;

    for (const questId of questIds) {
      const reqs = QuestData.requirements.get(questId);
      if (!reqs) continue;

      const state = this.getQuestState(questId);

      if (state === QuestState.COMPLETED) continue;

      if (state === QuestState.STARTED) {
        // Check if this NPC completes the quest
        // If no completion NPC specified, the start NPC handles completion too
        const completionNpc = reqs.complete.npc || reqs.start.npc;
        if (completionNpc === npcId) {
          if (this.canCompleteQuest(questId)) {
            result.completable.push(questId);
          } else {
            result.inProgress.push(questId);
          }
        } else if (reqs.start.npc === npcId) {
          // Start NPC also shows in-progress indicator
          result.inProgress.push(questId);
        }
      } else if (state === QuestState.NOT_STARTED) {
        if (reqs.start.npc === npcId) {
          // Script-based quests show as available if this NPC starts them
          const hasScript = reqs.start.startscript || reqs.complete.endscript;
          if (hasScript || this.canStartQuest(questId)) {
            result.available.push(questId);
          }
        }
      }
    }

    return result;
  }

  // Get mob kill progress for display
  getMobProgress(questId: number): { mobId: number; current: number; required: number }[] {
    const active = this.activeQuests.get(questId);
    if (!active) return [];

    const reqs = QuestData.requirements.get(questId);
    if (!reqs?.complete.mobs) return [];

    return reqs.complete.mobs.map(mob => ({
      mobId: mob.id,
      current: active.mobProgress.get(mob.id) || 0,
      required: mob.count,
    }));
  }

  private meetsRequirement(req: QuestRequirement): boolean {
    // Level check
    if (req.lvmin && this.character.stats.level < req.lvmin) return false;
    if (req.lvmax && this.character.stats.level > req.lvmax) return false;

    // Prerequisite quest check
    if (req.quests) {
      for (const q of req.quests) {
        const state = this.getQuestState(q.id);
        if (state !== q.state) return false;
      }
    }

    // Skip item check for now — equip items (1xxxxxx) use Character.wz, not Item.wz,
    // and can't be reliably tracked in client-side inventory yet.

    return true;
  }

  getItemCount(itemId: number): number {
    const id = typeof itemId === 'string' ? parseInt(itemId as any, 10) : itemId;
    const inv = this.character.inventory;
    const tabs = [inv.equip, inv.use, inv.setup, inv.etc, inv.cash];
    for (const tab of tabs) {
      if (!tab) continue;
      for (const item of tab) {
        if (!item) continue;
        const storedId = typeof item.itemId === 'string' ? parseInt(item.itemId, 10) : item.itemId;
        if (storedId === id) {
          return item.quantity || 1;
        }
      }
    }
    return 0;
  }

  removeItems(itemId: number, count: number): void {
    const inv = this.character.inventory;
    const tabs = [inv.equip, inv.use, inv.setup, inv.etc];
    let remaining = count;

    for (const tab of tabs) {
      if (!tab || remaining <= 0) continue;
      for (let i = 0; i < tab.length; i++) {
        if (tab[i] && tab[i].itemId === itemId) {
          const qty = tab[i].quantity || 1;
          if (qty <= remaining) {
            remaining -= qty;
            tab.splice(i, 1);
            i--;
          } else {
            tab[i].quantity -= remaining;
            remaining = 0;
          }
          if (remaining <= 0) break;
        }
      }
    }
  }
}
