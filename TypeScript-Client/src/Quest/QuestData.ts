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
}

export interface QuestReward {
  exp?: number;
  meso?: number;
  items?: { id: number; count: number; prop?: number }[];
  nextQuest?: number;
  fame?: number;
}

export interface QuestDialogue {
  messages: string[];
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
let itemNamesLoaded = false;

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

async function ensureItemNames() {
  if (itemNamesLoaded) return;
  itemNamesLoaded = true;
  const files = ['Consume', 'Eqp', 'Etc', 'Ins', 'Cash'];
  for (const file of files) {
    try {
      const node: any = await WZManager.get(`String.wz/${file}.img`);
      extractItemNames(node);
    } catch {}
  }
}

function getItemNameSync(itemId: number): string {
  return itemNames.get(itemId) || 'item';
}

function getItemDescSync(itemId: number): string {
  return itemDescs.get(itemId) || '';
}

// Resolve deferred #t and #c codes in text (call after ensureItemNames)
export function resolveItemCodes(text: string, questManager?: any): string {
  return text
    .replace(/#t(\d+)#?/g, (_, id) => getItemNameSync(parseInt(id)))
    .replace(/#c(\d+)#?/g, (_, id) => {
      if (questManager) {
        return String(questManager.getItemCount(parseInt(id)));
      }
      return '0';
    });
}

// Strip MapleStory text formatting codes
function stripFormatCodes(text: any, playerName: string = 'Player'): string {
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
    .replace(/#h0#/g, playerName)
    .replace(/#p(\d+)#/g, (_, id) => npcNames.get(parseInt(id)) || 'NPC')
    .replace(/#o(\d+)#/g, (_, id) => mobNames.get(parseInt(id)) || 'monster')
    .replace(/#a\d+#/g, '')   // quest progress counter (dynamic, strip)
    .replace(/#t(\d+)#/g, '#t$1#')  // Keep item name codes — resolved at display time after item names load
    .replace(/#m\d+#/g, 'map')
    .replace(/#i(\d+)#/g, '\x01ITEM:$1\x02')  // item icon placeholder — rendered at display time
    .replace(/#c(\d+)#/g, '#c$1#')  // Keep item count codes — resolved at display time
    .replace(/#L\d+#/g, '')
    .replace(/#l/g, '')
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\n');
}

class QuestDataManager {
  quests: Map<number, QuestInfo> = new Map();
  requirements: Map<number, { start: QuestRequirement; complete: QuestRequirement }> = new Map();
  rewards: Map<number, { start: QuestReward; complete: QuestReward }> = new Map();
  dialogues: Map<number, { start: QuestDialogue; complete: QuestDialogue }> = new Map();
  npcToQuests: Map<number, number[]> = new Map();
  private initialized: boolean = false;

  async initialize(): Promise<void> {
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
          case '0': info.startText = stripFormatCodes(val || ''); break;
          case '1': info.inProgressText = stripFormatCodes(val || ''); break;
          case '2': info.completionText = stripFormatCodes(val || ''); break;
          case 'area': info.area = val || 0; break;
          case 'order': info.order = val; break;
          case 'autoStart': info.autoStart = val === 1; break;
          case 'autoPreComplete': info.autoPreComplete = val === 1; break;
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
      // Numbered messages: "0", "1", "2", etc.
      if (!isNaN(parseInt(name)) && typeof prop.nValue === 'string') {
        dialogue.messages[parseInt(name)] = stripFormatCodes(prop.nValue);
      }
      // Yes branch
      if (name === 'yes') {
        dialogue.yes = [];
        if (prop.nChildren) {
          for (const child of prop.nChildren) {
            if (!isNaN(parseInt(child.nName)) && typeof child.nValue === 'string') {
              dialogue.yes[parseInt(child.nName)] = stripFormatCodes(child.nValue);
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
              dialogue.no[parseInt(child.nName)] = stripFormatCodes(child.nValue);
            }
          }
        }
      }
      // Stop branch (in-progress text)
      if (name === 'stop') {
        dialogue.stop = {};
        if (prop.nChildren) {
          for (const child of prop.nChildren) {
            if (child.nName === 'npc') {
              dialogue.stop.npc = [];
              if (child.nChildren) {
                for (const msg of child.nChildren) {
                  if (typeof msg.nValue === 'string') {
                    dialogue.stop.npc.push(stripFormatCodes(msg.nValue));
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
export { mobNames, npcNames, itemNames, ensureItemNames, getItemNameSync, getItemDescSync };
