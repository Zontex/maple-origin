import QuestData, { QuestState, QuestRequirement } from './QuestData';
import type MapleCharacter from '../MapleCharacter';

export interface ActiveQuest {
  questId: number;
  mobProgress: Map<number, number>; // mobId -> current kill count
}

export default class QuestManager {
  activeQuests: Map<number, ActiveQuest> = new Map();
  // questId -> completion timestamp (ms) — needed for INTERVAL repeatables
  completedQuests: Map<number, number> = new Map();
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
    if (this.activeQuests.has(questId)) return false;

    const reqs = QuestData.requirements.get(questId);
    if (!reqs) return false;

    // Completed quests can restart only if an INTERVAL (minutes) has elapsed
    const completedAt = this.completedQuests.get(questId);
    if (completedAt !== undefined) {
      const interval = reqs.start.interval;
      if (!interval || interval <= 0) return false;
      if (Date.now() - completedAt < interval * 60 * 1000) return false;
    }

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

    // Repeatable quest restarting — clear the previous completion record
    this.completedQuests.delete(questId);

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
        this.character.inventory.gainMesos(r.meso);
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
      this.applySkillRewards(r.skills);
    }

    console.log(`Quest started: ${QuestData.quests.get(questId)?.name} (#${questId})`);
    return true;
  }

  // Learn quest-granted skills whose job list matches (empty list = any job)
  private applySkillRewards(skills?: { id: number; skillLevel: number; masterLevel: number; jobs: number[] }[]) {
    if (!skills) return;
    const jobId = this.character.stats.jobId;
    for (const skill of skills) {
      if (skill.jobs.length > 0 && !skill.jobs.includes(jobId)) continue;
      this.character.skillManager?.changeSkillLevel(skill.id, skill.skillLevel, skill.masterLevel);
      console.log(`Quest reward: skill #${skill.id} level ${skill.skillLevel}`);
    }
  }

  completeQuest(questId: number, pickedPropItemId?: number): boolean {
    if (!this.canCompleteQuest(questId)) {
      console.warn(`[Quest] Cannot complete quest ${questId} — requirements not met`);
      return false;
    }

    // Apply rewards
    const rewards = QuestData.rewards.get(questId);
    if (rewards?.complete) {
      const r = rewards.complete;
      if (r.exp) {
        this.character.addExp(r.exp, true);
        console.log(`Quest reward: +${r.exp} EXP`);
      }
      if (r.meso) {
        this.character.inventory.gainMesos(r.meso);
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

        // Pick one from prop items — use pre-selected item from dialog if available
        if (propItems.length > 0) {
          const picked = (pickedPropItemId && propItems.find(i => i.id === pickedPropItemId))
            || QuestManager.pickWeightedPropItem(propItems);
          this.character.inventory.addToInventory(picked.id, picked.count);
          console.log(`Quest reward (random): +${picked.count}x item #${picked.id} (from ${propItems.length} options)`);
        }
      }
      this.applySkillRewards(r.skills);
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
    this.completedQuests.set(questId, Date.now());
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
  // savedMobProgress: optional Record<mobId, killCount> to restore from DB
  forceStartQuest(questId: number, savedMobProgress?: Record<string, number>): void {
    if (this.activeQuests.has(questId) || this.completedQuests.has(questId)) return;

    const reqs = QuestData.requirements.get(questId);
    const active: ActiveQuest = { questId, mobProgress: new Map() };

    if (reqs?.complete.mobs) {
      for (const mob of reqs.complete.mobs) {
        const saved = savedMobProgress ? (savedMobProgress[String(mob.id)] ?? 0) : 0;
        active.mobProgress.set(mob.id, saved);
      }
    }

    this.activeQuests.set(questId, active);
    if (!savedMobProgress) this.character.playQuestStart();
    console.log(`Quest force-started: ${QuestData.quests.get(questId)?.name} (#${questId})${savedMobProgress ? ' (restored)' : ''}`);
  }

  // Force complete a quest (used by script engine and DB restore — bypasses checks)
  forceCompleteQuest(questId: number, completedAt?: number): void {
    this.activeQuests.delete(questId);
    this.completedQuests.set(questId, completedAt ?? Date.now());
    if (completedAt === undefined) this.character.playQuestClear();
    console.log(`Quest force-completed: ${QuestData.quests.get(questId)?.name} (#${questId})`);
  }

  // Cosmic-style weighted pick: roll against the sum of prop weights
  static pickWeightedPropItem<T extends { prop?: number }>(propItems: T[]): T {
    const total = propItems.reduce((sum, i) => sum + (i.prop || 1), 0);
    let roll = Math.random() * total;
    for (const item of propItems) {
      roll -= item.prop || 1;
      if (roll <= 0) return item;
    }
    return propItems[propItems.length - 1];
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

    // Filter out Korean-only quests (Hangul characters)
    const hasKorean = (text: string) => /[\uAC00-\uD7AF]/.test(text);

    for (const questId of questIds) {
      const reqs = QuestData.requirements.get(questId);
      if (!reqs) continue;

      // Skip quests with Korean-only names (KMS quests not localized for GMS)
      const questName = QuestData.quests.get(questId)?.name || '';
      if (hasKorean(questName)) continue;

      // Skip medal/title quests (29xxx) and event quests (19xxx) — need server-side validation
      if (questId >= 19000 && questId < 20000) continue;
      if (questId >= 29000 && questId < 30000) continue;

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
          // Script-based quests still need to meet prerequisites (level, pre-quests, job)
          const hasScript = reqs.start.startscript || reqs.complete.endscript;
          if (hasScript ? this.meetsRequirement(reqs.start) : this.canStartQuest(questId)) {
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
    // Parse a WZ YYYYMMDDHH timestamp
    const wzTime = (s: string) => {
      const y = parseInt(s.slice(0, 4));
      const m = parseInt(s.slice(4, 6)) - 1;
      const d = parseInt(s.slice(6, 8));
      const h = parseInt(s.slice(8, 10)) || 0;
      return new Date(y, m, d, h).getTime();
    };

    // Availability window — not yet open or already expired
    if (req.startDate && Date.now() < wzTime(req.startDate)) return false;
    if (req.endDate && Date.now() > wzTime(req.endDate)) return false;

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

    // Job check — numeric job IDs from WZ (0=Beginner, 100=Warrior, etc.)
    if (req.jobs && req.jobs.length > 0) {
      if (!req.jobs.includes(this.character.stats.jobId)) return false;
    }

    // Required items in inventory (count 0 = must NOT have the item)
    if (req.items) {
      for (const item of req.items) {
        const count = this.getItemCount(item.id);
        if (item.count > 0 && count < item.count) return false;
        if (item.count === 0 && count > 0) return false;
      }
    }

    // Required mesos
    if (req.meso && (this.character.inventory?.mesos ?? 0) < req.meso) return false;

    return true;
  }

  getItemCount(itemId: number): number {
    const id = typeof itemId === 'string' ? parseInt(itemId as any, 10) : itemId;
    const inv = this.character.inventory;
    const tabs = [inv.equip, inv.use, inv.setup, inv.etc, inv.cash];
    let total = 0;
    for (const tab of tabs) {
      if (!tab) continue;
      for (const item of tab) {
        if (!item) continue;
        const storedId = typeof item.itemId === 'string' ? parseInt(item.itemId, 10) : item.itemId;
        if (storedId === id) {
          total += item.quantity || 1;
        }
      }
    }
    return total;
  }

  removeItems(itemId: number, count: number): void {
    const inv = this.character.inventory;
    const tabs = [inv.equip, inv.use, inv.setup, inv.etc, inv.cash];
    let remaining = count;

    for (const tab of tabs) {
      if (!tab || remaining <= 0) continue;
      for (let i = 0; i < tab.length; i++) {
        if (tab[i] && tab[i].itemId === itemId) {
          const qty = tab[i].quantity || 1;
          if (qty <= remaining) {
            remaining -= qty;
            // Null the slot (not splice) so later items keep their positions
            tab[i] = null as any;
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
