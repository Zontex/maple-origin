import WZManager from '../wz-utils/WZManager';

export enum QuestState {
  NOT_STARTED = 0,
  STARTED = 1,
  COMPLETED = 2,
}

export interface QuestInfo {
  id: number;
  name: string;
  parent?: string;
  startText: string;
  inProgressText: string;
  completionText: string;
  area: number;
  order?: number;
  autoStart?: boolean;
  autoPreComplete?: boolean;
  // Skill-tutorial quests (2415-2421, "Using Power Strike" and friends) name
  // the skill here — their mob counter only moves on kills made with it
  selectedSkillID?: number;
}

export interface QuestRequirement {
  npc?: number;
  lvmin?: number;
  lvmax?: number;
  jobs?: number[];
  items?: { id: number; count: number }[];
  mobs?: { id: number; count: number }[];
  quests?: { id: number; state: QuestState }[];
  startscript?: string;
  endscript?: string;
  startDate?: string;  // WZ format: YYYYMMDDHH
  endDate?: string;    // WZ format: YYYYMMDDHH
  meso?: number;       // required mesos
  interval?: number;   // repeatable-quest cooldown in minutes
}

export interface QuestReward {
  exp?: number;
  meso?: number;
  items?: { id: number; count: number; prop?: number }[];
  nextQuest?: number;
  fame?: number;
  skills?: { id: number; skillLevel: number; masterLevel: number; jobs: number[] }[];
}

// Same shape NpcScriptEngine.parseSelections produces
export interface QuestSelectionOption {
  index: number;
  label: string;
}

export interface QuestDialogue {
  messages: string[];
  // #L selection options per message index (quiz/branch dialogs)
  messageSelections?: Map<number, QuestSelectionOption[]>;
  // ask=1 marks quiz-style dialogs whose wrong answers reply via stop/<msg>/<sel>
  ask?: boolean;
  wrongAnswers?: Map<number, Map<number, string>>;
  yes?: string[];
  no?: string[];
  stop?: { npc?: string[] };
}

// Name lookup caches (populated during initialize)
const npcNames: Map<number, string> = new Map();
const mobNames: Map<number, string> = new Map();
const itemNames: Map<number, string> = new Map();
const itemDescs: Map<number, string> = new Map();

// Lazy-loaded item names from String.wz

// Lazy-loaded map names from String.wz/Map.img
const mapNames: Map<number, string> = new Map();

function extractMapNames(node: any) {
  if (!node?.nChildren) return;
  for (const child of node.nChildren) {
    const id = parseInt(child.nName);
    if (!isNaN(id)) {
      const nameNode = child.nGet?.('mapName');
      const streetNode = child.nGet?.('streetName');
      if (nameNode?.nValue) {
        const name = streetNode?.nValue ? `${streetNode.nValue}: ${nameNode.nValue}` : nameNode.nValue;
        mapNames.set(id, name);
      }
    } else {
      extractMapNames(child);
    }
  }
}

// Promise-cached, NOT flag-cached. The old `if (loaded) return; loaded =
// true;` marked the load done before the fetch finished, so a concurrent
// caller (the quest log kicks this off un-awaited at map load) sailed past
// the guard and resolved #m codes against an EMPTY table — "Map 1010000"
// baked into Maria's dialog instead of the map name. Worse, one failed
// fetch left the flag set and no name ever loaded for the whole session.
// Sharing the in-flight promise fixes the race; clearing it on failure
// makes the next caller retry.
let mapNamesPromise: Promise<void> | null = null;
function ensureMapNames(): Promise<void> {
  if (!mapNamesPromise) {
    mapNamesPromise = (async () => {
      const node: any = await WZManager.get('String.wz/Map.img');
      extractMapNames(node);
    })().catch((e) => {
      console.error('[QuestData] map name load failed, will retry:', e);
      mapNamesPromise = null;
    }) as Promise<void>;
  }
  return mapNamesPromise;
}

function getMapNameSync(mapId: number): string {
  return mapNames.get(mapId) || `Map ${mapId}`;
}

// Recursively extract item names and descriptions from a WZ node tree
function extractItemNames(node: any) {
  if (!node?.nChildren) return;
  for (const child of node.nChildren) {
    const id = parseInt(child.nName);
    if (!isNaN(id)) {
      // This is an item entry — get its name and description
      const nameNode = child.nGet?.('name');
      if (nameNode?.nValue) itemNames.set(id, nameNode.nValue);
      const descNode = child.nGet?.('desc');
      if (descNode?.nValue) itemDescs.set(id, descNode.nValue);
    } else {
      // This is a category folder (e.g., "Etc", "Eqp", "Accessory", "Armor") — recurse
      extractItemNames(child);
    }
  }
}

// Same promise-cache pattern as ensureMapNames, for the same race
let itemNamesPromise: Promise<void> | null = null;
function ensureItemNames(): Promise<void> {
  if (!itemNamesPromise) {
    itemNamesPromise = (async () => {
      const files = ['Consume', 'Eqp', 'Etc', 'Ins', 'Cash', 'Pet'];
      for (const file of files) {
        const node: any = await WZManager.get(`String.wz/${file}.img`);
        extractItemNames(node);
      }
    })().catch((e) => {
      console.error('[QuestData] item name load failed, will retry:', e);
      itemNamesPromise = null;
    }) as Promise<void>;
  }
  return itemNamesPromise;
}

function getItemNameSync(itemId: number): string {
  return itemNames.get(itemId) || 'item';
}

function getItemDescSync(itemId: number): string {
  return itemDescs.get(itemId) || '';
}

// Resolve deferred #t and #c codes in text (call after ensureItemNames)
export function resolveItemCodes(text: string, questManager?: any, contextQuestId?: number): string {
  return text
    .replace(/#h0#/g, () =>
      questManager?.character?.name || (window as any).charecter?.name || 'Player')
    .replace(/#t(\d+):?#?/g, (_, id) => getItemNameSync(parseInt(id)).trim())
    .replace(/#c(\d+):?#?/g, (_, id) => {
      if (questManager) {
        return String(questManager.getItemCount(parseInt(id)));
      }
      return '0';
    })
    .replace(/#m(\d+)#?/g, (_, id) => getMapNameSync(parseInt(id)))
    // Quest reference codes (umbrella quests like Chief's Introduction list
    // their subquests): #y = quest name, #u = its live completion state
    .replace(/#y(\d+)#/g, (_, id) => QuestData.quests.get(parseInt(id))?.name || `Quest ${id}`)
    .replace(/#u(\d+)#/g, (_, id) => {
      const s = questManager?.getQuestState?.(parseInt(id)) ?? 0;
      return s === 2 ? 'Complete' : s === 1 ? 'In Progress' : 'Incomplete';
    })
    // Later-era GMS quests write NPC references as #@<npcId>:# instead of #p
    .replace(/#@(\d+):?#?/g, (_, id) => npcNames.get(parseInt(id)) || 'NPC')
    // Item-name variant used by the dragon-guardian line; some ids are
    // KMS-only items with no v83 name — 'item' beats a bare apostrophe
    .replace(/#q(\d+)#/g, (_, id) => getItemNameSync(parseInt(id)).trim() || 'item')
    // Quest progress counter: #a{questId}{reqIndex}# (531 of these across
    // QuestInfo — every hunt/collection quest description ends with one).
    // GMS renders the live count; we show "cur / req". A bare one-digit code
    // (#a1#) indexes into the context quest instead of embedding an id.
    .replace(/#a(\d+)#/g, (_, code) => {
      if (!questManager) return '';
      let qid = contextQuestId ?? 0;
      let idx = parseInt(code);
      if (code.length > 1) {
        qid = parseInt(code.slice(0, -1));
        idx = parseInt(code.slice(-1));
      }
      if (!qid || !idx) return '';
      const reqs = QuestData.requirements.get(qid)?.complete;
      if (!reqs) return '';
      // Counters index the completion requirements, mobs first then items —
      // the order they appear in Check.img
      const list: { kind: 'mob' | 'item'; id: number; count: number }[] = [
        ...(reqs.mobs || []).map((m: any) => ({ kind: 'mob' as const, id: m.id, count: m.count })),
        ...(reqs.items || []).map((i: any) => ({ kind: 'item' as const, id: i.id, count: i.count })),
      ];
      const target = list[idx - 1];
      if (!target) return '';
      const active = questManager.activeQuests?.get(qid);
      const cur = target.kind === 'mob'
        ? (active?.mobProgress?.get(target.id) || 0)
        : Math.min(questManager.getItemCount(target.id), target.count);
      return `${cur} / ${target.count}`;
    });
}

// Strip MapleStory text formatting codes
function stripFormatCodes(text: any): string {
  if (!text) return '';
  if (typeof text !== 'string') return String(text);
  return text
    .replace(/#b/g, '')    // blue
    .replace(/#r/g, '')    // red
    .replace(/#k/g, '')    // black (reset)
    .replace(/#n/g, '')    // normal (reset)
    .replace(/#e/g, '')    // bold
    .replace(/#d/g, '')    // purple
    .replace(/#g/g, '')    // green
    // Keep player-name codes (normalize `#h #` → `#h0#`) — the character
    // name isn't known at quest-data load time; resolved at display time
    // by resolveItemCodes like #t/#c/#m
    .replace(/#h\s*0?\s*#/g, '#h0#')
    // Id codes tolerate stray whitespace and sloppy closings — Nexon's own
    // texts contain "#o 1210100#", "#p2091001:#" and "Rina#p1010100" with
    // no closing hash at all (all in playable GMS quests)
    .replace(/#p\s*(\d+)\s*:?#?/g, (_, id) => npcNames.get(parseInt(id)) || 'NPC')
    .replace(/#o\s*(\d+)#?/g, (_, id) => mobNames.get(parseInt(id)) || 'monster')
    .replace(/#a(\d+)#/g, '#a$1#')  // Keep progress counters — resolved live at display time
    // Party-quest record sheets (Moon Bunny, Ludibrium) are full of
    // #jcmp#/#jtry#/#jmin#... placeholders for per-character PQ statistics
    // the server tracked — stats we don't have. Zeros render as a blank
    // record instead of raw codes.
    .replace(/#jdate#?/g, '-')
    .replace(/#jrank#?/g, '-')
    .replace(/#j[A-Za-z]+#?/g, '0')
    // Medal-quest time limits (#Qdaylimit#Days ...) — untracked
    .replace(/#Q[A-Za-z]+#?/g, '0')
    // Stray typo'd codes in Nexon's texts: an uppercase #K after a selection
    // (Say 2224), and dangling #I / #L with no id — strip only when followed
    // by whitespace, a literal \n escape, or end of text, so legitimate
    // text like "Hall #4" survives. Runs before the \n-escape conversion,
    // hence the backslash in the lookahead.
    .replace(/#[KIL](?=[\s\\]|$)/g, '')
    // Event/infoEx progress records (#R2314# in Mushroom Castle) — untracked
    .replace(/#R\s*(\d+)#/g, '0')
    // KMS event remnants (#M/#x bonus-EXP placeholders) — server-substituted
    // values we can't reproduce; the quests are event-filtered anyway
    .replace(/#M\s*(\d+)#/g, '')
    .replace(/#x\s*(\d+)#/g, '')
    // Say-text emphasis marker
    .replace(/#E(?![a-z])/g, '')
    .replace(/#q\s*(\d+)#/g, '#q$1#')  // Item-name variant — resolved at display time
    // Requirement lists are written as one run-on line — "Slime #a10431#
    // #i4000004# #t4000004# ..." — but GMS puts each requirement on its own
    // row. Break the line whenever a progress counter is directly followed
    // by the next requirement's item icon.
    .replace(/(#a\d+#(?:#k)?)[ \t]+(?=#[iv]\d+[:#])/g, '$1\n')
    .replace(/#t\s*(\d+):?#/g, '#t$1#')  // Keep item name codes — resolved at display time after item names load
    .replace(/#m(\d+)#/g, '#m$1#')  // Keep map name codes — resolved at display time after map names load
    .replace(/#i\s*(\d+):?#/g, '\x01ITEM:$1\x02')  // item icon placeholder — rendered at display time
    .replace(/#v\s*(\d+):?#/g, '\x01ITEM:$1\x02')  // item icon placeholder (same as #i; some GMS texts use #v<id>:#)
    .replace(/#c\s*(\d+):?#/g, '#c$1#')  // Keep item count codes — resolved at display time
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\n');
}

// Strip #L selection markup outright — for non-interactive text (QuestInfo)
function stripSelectionCodes(text: string): string {
  return text.replace(/#L\d+#/g, '').replace(/#l/g, '');
}

// Parse #L<i>#label#l selection markup out of a Say message.
// Sloppy WZ text often omits the closing #l (e.g. quest 1036), so a selection
// also ends at the next #L, a line break (literal \r\n or real), or end of text.
const SAY_SELECTION_RE = /#L(\d+)#((?:(?!#l|#L\d+#|\\r|\\n|\r|\n)[\s\S])*)(?:#l)?/g;

/**
 * Tidy the text left behind after #L selection markup is removed.
 *
 * Each option sits on its own line, so replacing the markup with '' leaves
 * that line break behind — a menu of 17 options left 17 blank lines, which
 * both padded out the message and pushed the rendered option list hundreds
 * of pixels down the dialog. Runs of blank lines collapse to one so
 * deliberate paragraph breaks survive; leading and trailing ones go.
 */
export function collapseBlankLines(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseSayMessage(raw: string): { text: string; selections: QuestSelectionOption[] } {
  const selections: QuestSelectionOption[] = [];
  const remaining = raw.replace(SAY_SELECTION_RE, (_, idx, label) => {
    selections.push({
      index: parseInt(idx),
      label: stripFormatCodes(label).trim(),
    });
    return '';
  });
  // Any stray selection markup left over is stripped so it never renders raw
  const text = collapseBlankLines(
    stripSelectionCodes(stripFormatCodes(remaining))
  );
  return { text, selections };
}

class QuestDataManager {
  quests: Map<number, QuestInfo> = new Map();
  requirements: Map<number, { start: QuestRequirement; complete: QuestRequirement }> = new Map();
  rewards: Map<number, { start: QuestReward; complete: QuestReward }> = new Map();
  dialogues: Map<number, { start: QuestDialogue; complete: QuestDialogue }> = new Map();
  npcToQuests: Map<number, number[]> = new Map();
  private initialized: boolean = false;
  private initPromise: Promise<void> | null = null;

  /**
   * Idempotent: concurrent callers share one load. Without the guard, a
   * second call while the first was still fetching started the whole load
   * again — and callers that awaited it still returned before data existed.
   */
  async initialize(): Promise<void> {
    if (!this.initPromise) this.initPromise = this.doInitialize();
    return this.initPromise;
  }

  private async doInitialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Load name tables first so stripFormatCodes can resolve #p and #o codes
      await this.loadNameTables();

      await Promise.all([
        this.loadQuestInfo(),
        this.loadCheck(),
        this.loadAct(),
        this.loadSay(),
      ]);
      this.buildNpcLookup();
      this.initialized = true;
      console.log(`[QuestData] Loaded: ${this.quests.size} quests, ${this.requirements.size} requirements, ${this.npcToQuests.size} quest NPCs`);
      // Debug: check if NPC 9101002 is in the lookup
      const testNpc = this.npcToQuests.get(9101002);
      if (testNpc) {
        console.log(`[QuestData] NPC 9101002 has quests:`, testNpc);
      } else {
        console.log(`[QuestData] NPC 9101002 NOT found in npcToQuests. Sample keys:`, Array.from(this.npcToQuests.keys()).slice(0, 10));
      }
    } catch (e) {
      console.error('Failed to load quest data:', e);
    }
  }

  private async loadNameTables(): Promise<void> {
    try {
      const npcStrings: any = await WZManager.get('String.wz/Npc.img');
      if (npcStrings?.nChildren) {
        for (const npc of npcStrings.nChildren) {
          const id = parseInt(npc.nName);
          if (isNaN(id)) continue;
          for (const prop of npc.nChildren) {
            if (prop.nName === 'name' && prop.nValue) {
              npcNames.set(id, prop.nValue);
              break;
            }
          }
        }
      }
    } catch (e) {
      console.warn('Failed to load NPC names for quest text:', e);
    }

    try {
      const mobStrings: any = await WZManager.get('String.wz/Mob.img');
      if (mobStrings?.nChildren) {
        for (const mob of mobStrings.nChildren) {
          const id = parseInt(mob.nName);
          if (isNaN(id)) continue;
          for (const prop of mob.nChildren) {
            if (prop.nName === 'name' && prop.nValue) {
              mobNames.set(id, prop.nValue);
              break;
            }
          }
        }
      }
    } catch (e) {
      console.warn('Failed to load mob names for quest text:', e);
    }

    console.log(`[QuestData] Name tables: ${npcNames.size} NPCs, ${mobNames.size} mobs`);
  }

  private async loadQuestInfo(): Promise<void> {
    const node: any = await WZManager.get('Quest.wz/QuestInfo.img');
    if (!node?.nChildren) return;

    for (const questNode of node.nChildren) {
      const id = parseInt(questNode.nName);
      if (isNaN(id)) continue;

      const info: QuestInfo = {
        id,
        name: '',
        startText: '',
        inProgressText: '',
        completionText: '',
        area: 0,
      };

      for (const prop of questNode.nChildren) {
        const name = prop.nName;
        const val = prop.nValue;
        switch (name) {
          case 'name': info.name = val || ''; break;
          case 'parent': info.parent = val; break;
          case '0': info.startText = stripSelectionCodes(stripFormatCodes(val || '')); break;
          case '1': info.inProgressText = stripSelectionCodes(stripFormatCodes(val || '')); break;
          case '2': info.completionText = stripSelectionCodes(stripFormatCodes(val || '')); break;
          case 'area': info.area = val || 0; break;
          case 'order': info.order = val; break;
          case 'autoStart': info.autoStart = val === 1; break;
          case 'autoPreComplete': info.autoPreComplete = val === 1; break;
          case 'selectedSkillID': info.selectedSkillID = val || 0; break;
        }
      }

      this.quests.set(id, info);
    }
  }

  private async loadCheck(): Promise<void> {
    const node: any = await WZManager.get('Quest.wz/Check.img');
    if (!node?.nChildren) return;

    for (const questNode of node.nChildren) {
      const id = parseInt(questNode.nName);
      if (isNaN(id)) continue;

      const startNode = questNode.nGet('0');
      const completeNode = questNode.nGet('1');

      this.requirements.set(id, {
        start: this.parseRequirement(startNode),
        complete: this.parseRequirement(completeNode),
      });
    }
  }

  private parseRequirement(node: any): QuestRequirement {
    const req: QuestRequirement = {};
    if (!node?.nChildren) return req;

    for (const prop of node.nChildren) {
      const name = prop.nName;
      switch (name) {
        case 'npc':
          req.npc = prop.nValue;
          break;
        case 'lvmin':
          req.lvmin = prop.nValue;
          break;
        case 'lvmax':
          req.lvmax = prop.nValue;
          break;
        case 'job':
          req.jobs = [];
          if (prop.nChildren) {
            for (const j of prop.nChildren) {
              req.jobs.push(j.nValue);
            }
          }
          break;
        case 'item':
          req.items = [];
          if (prop.nChildren) {
            for (const itemNode of prop.nChildren) {
              let itemId = 0, count = 0;
              for (const p of itemNode.nChildren) {
                if (p.nName === 'id') itemId = p.nValue;
                if (p.nName === 'count') count = p.nValue;
              }
              if (itemId) req.items.push({ id: itemId, count });
            }
          }
          break;
        case 'mob':
          req.mobs = [];
          if (prop.nChildren) {
            for (const mobNode of prop.nChildren) {
              let mobId = 0, count = 0;
              for (const p of mobNode.nChildren) {
                if (p.nName === 'id') mobId = p.nValue;
                if (p.nName === 'count') count = p.nValue;
              }
              if (mobId) req.mobs.push({ id: mobId, count });
            }
          }
          break;
        case 'quest':
          req.quests = [];
          if (prop.nChildren) {
            for (const qNode of prop.nChildren) {
              let qId = 0, state = 0;
              for (const p of qNode.nChildren) {
                if (p.nName === 'id') qId = p.nValue;
                if (p.nName === 'state') state = p.nValue;
              }
              if (qId) req.quests.push({ id: qId, state });
            }
          }
          break;
        case 'startscript':
          req.startscript = prop.nValue;
          break;
        case 'endscript':
          req.endscript = prop.nValue;
          break;
        case 'start':
          req.startDate = String(prop.nValue);
          break;
        case 'end':
          req.endDate = String(prop.nValue);
          break;
        case 'meso':
        case 'endmeso':
          req.meso = prop.nValue;
          break;
        case 'interval':
          req.interval = prop.nValue;
          break;
      }
    }
    return req;
  }

  private async loadAct(): Promise<void> {
    const node: any = await WZManager.get('Quest.wz/Act.img');
    if (!node?.nChildren) return;

    for (const questNode of node.nChildren) {
      const id = parseInt(questNode.nName);
      if (isNaN(id)) continue;

      const startNode = questNode.nGet('0');
      const completeNode = questNode.nGet('1');

      this.rewards.set(id, {
        start: this.parseReward(startNode),
        complete: this.parseReward(completeNode),
      });
    }
  }

  private parseReward(node: any): QuestReward {
    const reward: QuestReward = {};
    if (!node?.nChildren) return reward;

    for (const prop of node.nChildren) {
      const name = prop.nName;
      switch (name) {
        case 'exp':
          reward.exp = prop.nValue;
          break;
        case 'money':
          reward.meso = prop.nValue;
          break;
        case 'fame':
          reward.fame = prop.nValue;
          break;
        case 'nextQuest':
          reward.nextQuest = prop.nValue;
          break;
        case 'item':
          reward.items = [];
          if (prop.nChildren) {
            for (const itemNode of prop.nChildren) {
              let itemId = 0, count = 0, itemProp = 0;
              for (const p of itemNode.nChildren) {
                if (p.nName === 'id') itemId = p.nValue;
                if (p.nName === 'count') count = p.nValue;
                if (p.nName === 'prop') itemProp = p.nValue;
              }
              if (itemId && count > 0) {
                const entry: { id: number; count: number; prop?: number } = { id: itemId, count };
                if (itemProp > 0) entry.prop = itemProp;
                reward.items.push(entry);
              }
            }
          }
          break;
        case 'skill':
          // Skill rewards: skill/<n>/{id, skillLevel, masterLevel, job/<i>}
          reward.skills = [];
          if (prop.nChildren) {
            for (const skillNode of prop.nChildren) {
              let skillId = 0, skillLevel = 0, masterLevel = 0;
              const jobs: number[] = [];
              for (const p of skillNode.nChildren) {
                if (p.nName === 'id') skillId = p.nValue;
                if (p.nName === 'skillLevel') skillLevel = p.nValue;
                if (p.nName === 'masterLevel') masterLevel = p.nValue;
                if (p.nName === 'job' && p.nChildren) {
                  for (const j of p.nChildren) jobs.push(j.nValue);
                }
              }
              if (skillId) reward.skills.push({ id: skillId, skillLevel, masterLevel, jobs });
            }
          }
          break;
      }
    }
    return reward;
  }

  private async loadSay(): Promise<void> {
    const node: any = await WZManager.get('Quest.wz/Say.img');
    if (!node?.nChildren) return;

    for (const questNode of node.nChildren) {
      const id = parseInt(questNode.nName);
      if (isNaN(id)) continue;

      const startNode = questNode.nGet('0');
      const completeNode = questNode.nGet('1');

      this.dialogues.set(id, {
        start: this.parseDialogue(startNode),
        complete: this.parseDialogue(completeNode),
      });
    }
  }

  private parseDialogue(node: any): QuestDialogue {
    const dialogue: QuestDialogue = { messages: [] };
    if (!node?.nChildren) return dialogue;

    for (const prop of node.nChildren) {
      const name = prop.nName;
      // Numbered messages: "0", "1", "2", etc. — may embed #L selections
      if (!isNaN(parseInt(name)) && typeof prop.nValue === 'string') {
        const msgIdx = parseInt(name);
        const parsed = parseSayMessage(prop.nValue);
        dialogue.messages[msgIdx] = parsed.text;
        if (parsed.selections.length > 0) {
          if (!dialogue.messageSelections) dialogue.messageSelections = new Map();
          dialogue.messageSelections.set(msgIdx, parsed.selections);
        }
      }
      if (name === 'ask') {
        dialogue.ask = prop.nValue === 1;
      }
      // Yes branch
      if (name === 'yes') {
        dialogue.yes = [];
        if (prop.nChildren) {
          for (const child of prop.nChildren) {
            if (!isNaN(parseInt(child.nName)) && typeof child.nValue === 'string') {
              dialogue.yes[parseInt(child.nName)] = stripSelectionCodes(stripFormatCodes(child.nValue));
            }
          }
        }
      }
      // No branch
      if (name === 'no') {
        dialogue.no = [];
        if (prop.nChildren) {
          for (const child of prop.nChildren) {
            if (!isNaN(parseInt(child.nName)) && typeof child.nValue === 'string') {
              dialogue.no[parseInt(child.nName)] = stripSelectionCodes(stripFormatCodes(child.nValue));
            }
          }
        }
      }
      // Stop branch (in-progress text + quiz wrong-answer replies)
      if (name === 'stop') {
        dialogue.stop = {};
        if (prop.nChildren) {
          for (const child of prop.nChildren) {
            // stop/<msgIndex>/<selIndex> = reply text for a wrong quiz answer
            const stopMsgIdx = parseInt(child.nName);
            if (!isNaN(stopMsgIdx) && child.nChildren) {
              for (const ans of child.nChildren) {
                const selIdx = parseInt(ans.nName);
                if (!isNaN(selIdx) && typeof ans.nValue === 'string') {
                  if (!dialogue.wrongAnswers) dialogue.wrongAnswers = new Map();
                  if (!dialogue.wrongAnswers.has(stopMsgIdx)) {
                    dialogue.wrongAnswers.set(stopMsgIdx, new Map());
                  }
                  dialogue.wrongAnswers
                    .get(stopMsgIdx)!
                    .set(selIdx, stripSelectionCodes(stripFormatCodes(ans.nValue)));
                }
              }
            }
            if (child.nName === 'npc') {
              dialogue.stop.npc = [];
              if (child.nChildren) {
                for (const msg of child.nChildren) {
                  if (typeof msg.nValue === 'string') {
                    dialogue.stop.npc.push(stripSelectionCodes(stripFormatCodes(msg.nValue)));
                  }
                }
              }
            }
          }
        }
      }
    }

    // Filter out empty slots from sparse arrays
    dialogue.messages = dialogue.messages.filter(m => m !== undefined);
    if (dialogue.yes) dialogue.yes = dialogue.yes.filter(m => m !== undefined);
    if (dialogue.no) dialogue.no = dialogue.no.filter(m => m !== undefined);

    return dialogue;
  }

  private buildNpcLookup(): void {
    this.npcToQuests.clear();

    for (const [questId, reqs] of this.requirements) {
      const addNpc = (npcId: number) => {
        if (!npcId) return;
        const list = this.npcToQuests.get(npcId) || [];
        if (!list.includes(questId)) {
          list.push(questId);
          this.npcToQuests.set(npcId, list);
        }
      };

      if (reqs.start.npc) addNpc(reqs.start.npc);
      if (reqs.complete.npc) addNpc(reqs.complete.npc);
    }
  }
}

const QuestData = new QuestDataManager();
export default QuestData;
export { mobNames, npcNames, itemNames, ensureItemNames, ensureMapNames, getItemNameSync, getItemDescSync, getMapNameSync };
