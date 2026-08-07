import QuestData, { QuestState, QuestRequirement } from './QuestData';
import type MapleCharacter from '../MapleCharacter';
import UIQuestAlarm from '../UI/UIQuestAlarm';

export interface ActiveQuest {
  questId: number;
  mobProgress: Map<number, number>; // mobId -> current kill count
}

const MAX_TRACKED_QUESTS = 5;

export default class QuestManager {
  activeQuests: Map<number, ActiveQuest> = new Map();
  // questId -> completion timestamp (ms) — needed for INTERVAL repeatables
  completedQuests: Map<number, number> = new Map();
  // Quest Helper (QuestAlarm widget) tracking
  trackedQuests: number[] = [];
  autoTrack: boolean = true;
  // questId -> whether completion requirements were already fulfilled (for
  // firing the GMS "quest completed" notification exactly on the transition)
  private fulfilledState: Map<number, boolean> = new Map();
  /**
   * "Area info" — the free-form per-quest scratch strings the Aran and Evan
   * tutorials use to remember which one-shot hint has already fired
   * (`updateAreaInfo(21002, "arr0=o")`). Keyed by the info-quest id the
   * scripts pass, which is the same `infoNumber` Check.img names.
   */
  private areaInfo: Map<number, string> = new Map();
  private character: MapleCharacter;

  constructor(character: MapleCharacter) {
    this.character = character;
  }

  // ─── Quest Helper tracking ───────────────────────────────────────

  isTracked(questId: number): boolean {
    return this.trackedQuests.includes(questId);
  }

  /**
   * True when a quest has goals that show measurable progress — mobs to kill
   * or items to gather. Pure "go talk to someone" quests (Nina's brother Sen,
   * for one) have nothing to count, and GMS doesn't list them in the helper.
   */
  hasTrackableRequirements(questId: number): boolean {
    const reqs = QuestData.requirements.get(questId);
    if (!reqs) return false;
    const mobs = reqs.complete?.mobs || [];
    const items = (reqs.complete?.items || []).filter((i: any) => i.count > 0);
    return mobs.length > 0 || items.length > 0;
  }

  /** Track an in-progress quest in the Quest Helper (oldest drops when full). */
  trackQuest(questId: number): boolean {
    if (!this.activeQuests.has(questId)) return false;
    // Nothing to show a counter for — don't take up a helper slot
    if (!this.hasTrackableRequirements(questId)) return false;
    UIQuestAlarm.visible = true; // re-open the helper panel if it was closed
    if (this.isTracked(questId)) return true;
    this.trackedQuests.push(questId);
    while (this.trackedQuests.length > MAX_TRACKED_QUESTS) this.trackedQuests.shift();
    return true;
  }

  untrackQuest(questId: number): void {
    this.trackedQuests = this.trackedQuests.filter(id => id !== questId);
    UIQuestAlarm.dismissQuestComplete(questId);
  }

  // ─── Fulfillment notification (GMS on-screen notice) ─────────────

  /**
   * Fire the authentic GMS notification when an active quest's completion
   * requirements transition to fulfilled: QuestAlert light-burst effect over
   * the character + QuestAlert jingle + bottom-center "Quest completed" notice.
   */
  private checkFulfilled(questId: number): void {
    if (!this.activeQuests.has(questId)) return;
    const fulfilled = this.canCompleteQuest(questId);
    const wasFulfilled = this.fulfilledState.get(questId) || false;
    this.fulfilledState.set(questId, fulfilled);

    if (fulfilled && !wasFulfilled) {
      // Requirements met. This is what the red balloon announces — it points
      // at the quest-notifier button and means "this one can be claimed now",
      // so it fires here and NOT on turn-in. Going to the NPC afterwards is
      // the player acting on it.
      const questName = QuestData.quests.get(questId)?.name || `Quest #${questId}`;
      UIQuestAlarm.showQuestComplete(questId, questName);
      this.character.playQuestFulfilled();
    }
  }

  /** Re-check all active quests (called periodically — catches item-based quests). */
  pollFulfillment(): void {
    for (const questId of this.activeQuests.keys()) {
      this.checkFulfilled(questId);
    }
  }

  /**
   * Recompute the fulfilled seed for every active quest without firing the
   * notification. Login restore replays quests one at a time, so the seed a
   * single forceStartQuest computes can be wrong — quest data still loading,
   * or a prereq quest not replayed yet. A wrong false there made the poll see
   * a false→true transition and pop the GMS "Quest completed" balloon on
   * every login. Call once after the whole restore has settled.
   */
  reseedFulfilled(): void {
    for (const questId of this.activeQuests.keys()) {
      this.fulfilledState.set(questId, this.canCompleteQuest(questId));
    }
  }

  async initialize(): Promise<void> {
    await QuestData.initialize();
  }

  /**
   * Drop every scrap of quest state. This manager hangs off the MyCharacter
   * singleton, which outlives any one character: log out and pick a different
   * one and the old quest log is still sitting here, so the restore below adds
   * to it instead of replacing it — and the next autosave writes the lot onto
   * the character you just loaded. A freshly created character turned up with
   * someone else's completed quests, job-advancement flags and mob progress.
   */
  reset(): void {
    this.activeQuests.clear();
    this.completedQuests.clear();
    this.fulfilledState.clear();
    this.areaInfo.clear();
    this.trackedQuests = [];
  }

  // ─── Area info (tutorial hint bookkeeping) ───────────────────────

  /** True once `data` has been written into this quest's area-info string */
  containsAreaInfo(questId: number, data: string): boolean {
    return (this.areaInfo.get(questId) || '').includes(data);
  }

  /**
   * Merge `data` into the quest's area-info string. Scripts pass either a
   * single `key=value` or a whole `;`-separated run of them, and re-set keys
   * they've already written, so each key is stored once and later writes win.
   */
  updateAreaInfo(questId: number, data: string): void {
    const entries = new Map<string, string>();
    const absorb = (raw: string) => {
      for (const pair of raw.split(';')) {
        if (!pair) continue;
        const eq = pair.indexOf('=');
        if (eq < 0) entries.set(pair, '');
        else entries.set(pair.slice(0, eq), pair.slice(eq + 1));
      }
    };
    absorb(this.areaInfo.get(questId) || '');
    absorb(data || '');
    const merged = [...entries]
      .map(([k, v]) => (v === '' ? k : `${k}=${v}`))
      .join(';');
    this.areaInfo.set(questId, merged);
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

    // Quests with a scripted START are begun by QuestScriptEngine (the script
    // calls forceStartQuest), not canStartQuest. A scripted END is irrelevant
    // here — those quests still start via the normal static accept dialog.
    if (reqs.start.startscript) return false;

    const met = this.meetsRequirement(reqs.start);
    return met;
  }

  // Full start-requirement check (level, job, prereq quests, items, dates) for
  // scripted quests — the QuestScriptEngine path bypasses canStartQuest, so the
  // NPC click flow uses this to gate startscripts the same way the listing does.
  canRunStartScript(questId: number): boolean {
    const reqs = QuestData.requirements.get(questId);
    if (!reqs) return false;
    return this.meetsRequirement(reqs.start);
  }

  // Gate for running a quest's endscript — Cosmic checks quest.canComplete()
  // server-side before running end scripts. Mob kills and positive item counts
  // must be met; count-0 item entries are skipped (Cosmic treats missing/zero
  // count as always-met — e.g. Roger's Apple relies on the script's own check).
  /**
   * Completion-side prerequisite quests. Wrapper quests hinge on this:
   * Lucas's "Chief's Introduction" (1040) completes only once Mai's four
   * trainings (1041-1044) are all done — ignoring it let 1040 be turned in
   * immediately, and since Mai's chain requires 1040 IN PROGRESS, the
   * premature completion dead-locked the whole training center.
   */
  private meetsCompleteQuestReqs(reqs: any): boolean {
    if (reqs.complete?.quests) {
      for (const q of reqs.complete.quests) {
        if (this.getQuestState(q.id) !== q.state) return false;
      }
    }
    return true;
  }

  canRunEndScript(questId: number): boolean {
    const active = this.activeQuests.get(questId);
    if (!active) return false;
    const reqs = QuestData.requirements.get(questId);
    if (!reqs) return false;
    if (!this.meetsCompleteQuestReqs(reqs)) return false;

    if (reqs.complete.mobs) {
      for (const mob of reqs.complete.mobs) {
        if ((active.mobProgress.get(mob.id) || 0) < mob.count) return false;
      }
    }
    if (reqs.complete.items) {
      for (const item of reqs.complete.items) {
        if (item.count > 0 && this.getItemCount(item.id) < item.count) return false;
      }
    }
    return true;
  }

  canCompleteQuest(questId: number): boolean {
    const active = this.activeQuests.get(questId);
    if (!active) return false;

    const reqs = QuestData.requirements.get(questId);
    if (!reqs) return false;

    if (!this.meetsCompleteQuestReqs(reqs)) return false;

    // Script-based quests — completable (the endscript runs when clicked in the
    // NPC's quest listing) as soon as the WZ completion reqs are met, exactly
    // what the real client computes from Check.img. The endscript does any
    // further checking itself (e.g. Roger's Apple HP check).
    if (reqs.complete.endscript) {
      return this.canRunEndScript(questId);
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
    // Quest state is part of the save payload — persist soon
    (window as any).__mySocket?.requestSave?.();
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
    if (this.autoTrack) this.trackQuest(questId);
    // Seed fulfillment state so quests that start already-completable don't
    // instantly fire the completed notification
    this.fulfilledState.set(questId, this.canCompleteQuest(questId));

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
    // Quest state is part of the save payload — persist soon
    (window as any).__mySocket?.requestSave?.();
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
    this.untrackQuest(questId);
    this.fulfilledState.delete(questId);
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
    // Quest state is part of the save payload — persist soon
    (window as any).__mySocket?.requestSave?.();
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
    this.fulfilledState.set(questId, this.canCompleteQuest(questId));
    if (!savedMobProgress) {
      this.character.playQuestStart();
      if (this.autoTrack) this.trackQuest(questId);
    }
    console.log(`Quest force-started: ${QuestData.quests.get(questId)?.name} (#${questId})${savedMobProgress ? ' (restored)' : ''}`);
  }

  // Force complete a quest (used by script engine and DB restore — bypasses checks)
  forceCompleteQuest(questId: number, completedAt?: number): void {
    // Quest state is part of the save payload — persist soon
    (window as any).__mySocket?.requestSave?.();
    this.activeQuests.delete(questId);
    this.completedQuests.set(questId, completedAt ?? Date.now());
    this.untrackQuest(questId);
    this.fulfilledState.delete(questId);
    const forcedName = QuestData.quests.get(questId)?.name;
    // completedAt is only set when replaying saved state on load
    if (completedAt === undefined) this.character.playQuestClear();
    console.log(`Quest force-completed: ${forcedName} (#${questId})`);
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
    // The one quest state change that was missing a save hook — forfeiting
    // worked in RAM but was never persisted, so the quest returned on the
    // next refresh
    (window as any).__mySocket?.requestSave?.();
    this.activeQuests.delete(questId);
    this.untrackQuest(questId);
    this.fulfilledState.delete(questId);
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
          this.checkFulfilled(questId);
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
      // Skip PQ/competition record sheets (1200 Moon Bunny, 1201-1206 other
      // PQs, 1300-1302 events) — internal records the PQ itself manages, never
      // clickable on the NPC in GMS
      if (questId >= 1200 && questId < 1400) continue;

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

  /**
   * Cosmic's needQuestItem: whether a quest drop should still drop for us.
   *
   * Having the quest active is only half the test — GMS also stops the drop
   * once you are holding the number the quest asks for. Without the count half,
   * killing a second Jr. Stone Ball for "Todd's How-to-Hunt" (which wants one
   * shellpiece) drops a second one, and the spare sits in the ETC tab forever
   * after turn-in, since completing the quest only removes what it asked for.
   */
  needQuestItem(questId: number, itemId: number): boolean {
    if (!this.activeQuests.has(questId)) return false;

    const reqs = QuestData.requirements.get(questId);
    const required = reqs?.complete.items?.find((i) => i.id === itemId)?.count ?? 0;
    // Quest-gated drops that the quest does not actually count (flavour items,
    // scripted checks) stay unlimited, exactly as they are in Cosmic
    if (required <= 0) return true;

    return this.getItemCount(itemId) < required;
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
    // WORN equips count too — Cosmic's haveItem scans the EQUIPPED inventory
    // alongside the tabs. Quests that require wearable items expect you to
    // wear them: the training shirt (1042003) gates Mai's 1016 and Yoona's
    // whole quiz line, all of which vanished the moment the shirt was
    // equipped because only the bag was counted.
    const equipped = (this.character as any).equippedItemIds;
    if (equipped) {
      for (const eid of Object.values(equipped)) {
        if (Number(eid) === id) total += 1;
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
