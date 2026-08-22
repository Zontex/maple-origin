import { npcNames, mobNames, QuestState, ensureItemNames, ensureMapNames, getMapNameSync, collapseBlankLines, getItemNameSync } from './Quest/QuestData';
import GuildManager, { getIncreaseGuildCost as guildIncreaseCost } from './Guild/GuildManager';
import { cachedFetch } from './AssetDownloader';
import { getItemName } from './Quest/QuestScriptEngine';
import { fadeToBlack } from './MapState';
import ShopUI from './UI/ShopUI';
import UIStorage from './UI/UIStorage';
import TransportationManager from './Transport/TransportationManager';
import HenesysPQ from './Events/HenesysPQ';
import PartyManager from './Party/PartyManager';

export type ScriptDialogType =
  | 'next' | 'nextPrev' | 'acceptDecline' | 'ok' | 'prev' | 'yesNo' | 'simple'
  | 'getText' | 'getNumber' | 'style';

export interface SelectionOption {
  index: number;
  label: string;
  headerType?: 'available' | 'inProgress' | 'completable' | 'etc';  // Quest category header above this option
}

export interface PendingDialog {
  text: string;
  type: ScriptDialogType;
  selections?: SelectionOption[];
  /** sendStyle candidates (hair / face / skin ids) for the avatar picker. */
  styles?: number[];
  // For getText/getNumber dialogs: input config + where the value goes
  input?: { def?: string | number; min?: number; max?: number };
  onInput?: (value: string) => void;
}

// Warn once per missing method, not once per call
const stubWarned = new Set<string>();

/**
 * Infinitely chainable no-op stub: any method call returns another stub, so
 * backend script chains like `cm.getX().getY().getZ()` degrade to no-ops
 * instead of TypeErrors that close the dialog. Predicates (`is*`/`has*`/
 * `can*`) return false and `size`/`count` return 0 so `while (iter.hasNext())`
 * style loops terminate. Coerces to 0 / '' in arithmetic and string contexts.
 */
export function makeChainableStub(label: string): any {
  const fn: any = function () {};
  return new Proxy(fn, {
    get(_t, prop) {
      if (typeof prop === 'symbol') {
        if (prop === Symbol.toPrimitive) return () => 0;
        return undefined;
      }
      if (prop === 'toString') return () => '';
      if (prop === 'valueOf') return () => 0;
      if (prop === 'then') return undefined;
      // Property reads chain too (`ExpeditionType.CWKPQ.getMinLevel()`)
      return makeChainableStub(`${label}.${String(prop)}`);
    },
    apply(_t, _thisArg, _args) {
      if (!stubWarned.has(label)) {
        stubWarned.add(label);
        console.warn(`[Script] stub ${label}() — no-op`);
      }
      const seg = label.split(/[.()]/).filter(Boolean).pop() || '';
      if (/^(is|has|can|contains)[A-Z_]?/.test(seg)) return false;
      if (/^(size|count|getSize|getCount|length)$/.test(seg)) return 0;
      return makeChainableStub(`${label}()`);
    },
  });
}

/**
 * Wrap a script API object so any method the engine hasn't implemented
 * becomes a warning chainable no-op instead of a TypeError that closes
 * the dialog.
 */
export function makeSafeScriptApi(target: any, label: string) {
  return new Proxy(target, {
    get(t, prop, recv) {
      if (prop in t || typeof prop === 'symbol') return Reflect.get(t, prop, recv);
      return makeChainableStub(`${label}.${String(prop)}`);
    },
  });
}

/**
 * Shim for the Nashorn/Java globals Cosmic backend scripts rely on.
 * Semantically meaningful classes get real values (InventoryType tab ids,
 * v83 Job ids, YamlConfig feature flags off / rates 1); everything else
 * degrades to a chainable no-op stub.
 */
export function createScriptJavaShim(cm?: any) {
  const InventoryType: any = {};
  for (const [n, v] of [['UNDEFINED', -1], ['EQUIP', 1], ['USE', 2], ['SETUP', 3], ['ETC', 4], ['CASH', 5]] as [string, number][]) {
    InventoryType[n] = { getType: () => v, name: () => n };
  }

  const jobIds: Record<string, number> = {
    BEGINNER: 0, WARRIOR: 100, FIGHTER: 110, CRUSADER: 111, HERO: 112,
    PAGE: 120, WHITEKNIGHT: 121, PALADIN: 122, SPEARMAN: 130,
    DRAGONKNIGHT: 131, DARKKNIGHT: 132, MAGICIAN: 200, FP_WIZARD: 210,
    FP_MAGE: 211, FP_ARCHMAGE: 212, IL_WIZARD: 220, IL_MAGE: 221,
    IL_ARCHMAGE: 222, CLERIC: 230, PRIEST: 231, BISHOP: 232, BOWMAN: 300,
    HUNTER: 310, RANGER: 311, BOWMASTER: 312, CROSSBOWMAN: 320, SNIPER: 321,
    MARKSMAN: 322, THIEF: 400, ASSASSIN: 410, HERMIT: 411, NIGHTLORD: 412,
    BANDIT: 420, CHIEFBANDIT: 421, SHADOWER: 422, PIRATE: 500, BRAWLER: 510,
    MARAUDER: 511, BUCCANEER: 512, GUNSLINGER: 520, OUTLAW: 521, CORSAIR: 522,
    GM: 900, SUPERGM: 910,
  };
  const Job: any = {};
  for (const [n, id] of Object.entries(jobIds)) {
    Job[n] = { getId: () => id, id, name: () => n };
  }
  Job.getById = (id: number) => ({ getId: () => id, id });

  // Feature flags off, rates 1, any other number 0
  const yamlServer = new Proxy({}, {
    get(_t, p) {
      if (typeof p !== 'string') return 0;
      if (p.startsWith('USE_')) return false;
      if (p.endsWith('_RATE')) return 1;
      return 0;
    },
  });

  const type = (cls: string) => {
    switch (cls) {
      case 'client.inventory.InventoryType': return InventoryType;
      case 'client.Job': return Job;
      case 'config.YamlConfig': return { config: { server: yamlServer } };
      case 'server.ShopFactory':
        return {
          getInstance: () => ({
            getShop: (id: number) => ({ sendShop: () => cm?.openShopNPC?.(id) }),
          }),
        };
      // Heracle's capacity quote: Guild.getIncreaseGuildCost(capacity)
      case 'net.server.guild.Guild':
        return { getIncreaseGuildCost: (size: number) => guildIncreaseCost(Number(size) || 0) };
      case 'java.awt.Point':
        return function (x: number, y: number) { return { x, y, getX: () => x, getY: () => y }; };
      case 'java.awt.Rectangle':
        return function (x: number, y: number, w: number, h: number) { return { x, y, width: w, height: h }; };
      default:
        return makeChainableStub(`Java(${cls})`);
    }
  };

  return {
    Java: { type },
    java: makeChainableStub('java'),
    Packages: makeChainableStub('Packages'),
  };
}

// Parse #L<index>#<text>#l selection options from script text.
// The closing #l is optional in sloppy source texts — a selection also ends
// at the next #L, a line break (literal \r\n or real), or end of text.
const SELECTION_RE = /#L(\d+)#((?:(?!#l|#L\d+#|\\r|\\n|\r|\n)[\s\S])*)(?:#l)?/g;

function parseSelections(text: string, mapNameResolver?: (id: number) => string): { body: string; selections: SelectionOption[] } {
  const selections: SelectionOption[] = [];
  const raw = text.replace(SELECTION_RE, (_, idx, label) => {
    selections.push({
      index: parseInt(idx),
      label: stripFormatCodes(label, mapNameResolver).trim(),
    });
    return '';
  });

  // Body is returned raw — callers collapse blank lines only after
  // stripFormatCodes has run, otherwise leftover codes like a trailing #k
  // keep the empty lines around them alive
  return { body: raw, selections };
}

// Strip MapleStory format codes from text (no selection parsing)
function stripFormatCodes(text: string, mapNameResolver?: (id: number) => string): string {
  if (!text) return '';
  return text
    .replace(/#b/g, '').replace(/#r/g, '').replace(/#k/g, '')
    .replace(/#n/g, '').replace(/#e/g, '').replace(/#d/g, '').replace(/#g/g, '')
    .replace(/#h\s*0?\s*#/g, () => (window as any).charecter?.name || 'Player')
    .replace(/#p(\d+)#/g, (_, id) => npcNames.get(parseInt(id)) || 'NPC')
    .replace(/#o(\d+)#/g, (_, id) => mobNames.get(parseInt(id)) || 'monster')
    // Fall back to QuestData's full String.wz/Map.img table before giving
    // up: the per-script resolver only knows ids preloadMapNames scanned out
    // of script SOURCE, so NPC default d-lines (no script) and map codes
    // built at runtime by concatenation always missed it — Maria's d0 showed
    // "Map 1010000" instead of the map name.
    .replace(/#m(\d+)#/g, (_, id) => {
      const n = parseInt(id);
      const resolved = mapNameResolver?.(n);
      return resolved && !resolved.startsWith('Map ') ? resolved : getMapNameSync(n);
    })
    .replace(/#a\d+#/g, '')
    .replace(/#t(\d+):?#/g, (_, id) => getItemName(parseInt(id)).trim())
    .replace(/#i\d+:?#/g, '').replace(/#c\d+:?#/g, '')
    .replace(/#v(\d+):?#/g, '\x01ITEM:$1\x02')
    .replace(/#fUI\/UIWindow\.img\/QuestIcon\/(\d+)\/\d+#/g, '\x01QICON:$1\x02')
    .replace(/#f[^#]*#/g, '')
    .replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\\r/g, '\n')
    .replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

// Strip all format codes including selections
export function stripScriptCodes(text: string, mapNameResolver?: (id: number) => string): string {
  if (!text) return '';
  let result = stripFormatCodes(text, mapNameResolver);
  result = result.replace(/#L\d+#/g, '').replace(/#l/g, '');
  return result;
}

export default class NpcScriptEngine {
  private scriptCache: Map<number, string> = new Map();
  private npcId: number = 0;
  pendingDialog: PendingDialog | null = null;
  private disposed: boolean = false;
  // A script dereferenced an event instance that does not exist (Amon in a
  // Zakum altar entered without the expedition): rerun it once against a
  // null-safe instance so its dialog still shows. Scripts that test for
  // null themselves never trip this and keep their authentic branches.
  private eventStub: boolean = false;
  private character: any = null;
  private mapNameCache: Map<number, string> = new Map();
  // Values captured by sendGetText/sendGetNumber input dialogs (Cosmic pattern)
  private lastGetText: string = '';
  private lastGetNumber: number = 0;
  // The script's start/action closures, created ONCE per conversation so ALL
  // top-level vars persist between interactions — not just `status`. Scripts
  // like Phil's cab set `selectedMap` on one click and read it on the next;
  // re-running the source each time reset it to -1 and warp(maps[-1]) sent
  // players to the default map (Amherst) instead of their destination.
  private scriptFuncs: { start: Function | null; action: Function | null } | null = null;
  private scriptCm: any = null;

  // Callbacks set by caller
  private onShowDialog: ((dialog: PendingDialog) => void) | null = null;
  private onDispose: (() => void) | null = null;
  private changeMapFn: ((mapId: number, portalName?: string | number) => Promise<void>) | null = null;

  async loadScript(npcId: number): Promise<string | null> {
    if (this.scriptCache.has(npcId)) return this.scriptCache.get(npcId)!;
    try {
      const resp = await cachedFetch(`/scripts/npc/${npcId}.js`);
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
    changeMap?: (mapId: number, portalName?: string | number) => Promise<void>;
  }) {
    this.npcId = opts.npcId;
    this.eventStub = false;
    this.character = opts.character;
    this.onShowDialog = opts.onShowDialog;
    this.onDispose = opts.onDispose;
    this.changeMapFn = opts.changeMap || null;
    this.disposed = false;
    // Fresh conversation — new script closure with fresh top-level vars
    this.scriptFuncs = null;
    this.scriptCm = null;

    // Preload map names used by this NPC's script + item names for #t codes
    await this.preloadMapNames();
    await ensureItemNames();
    // The #m fallback resolves through QuestData's map table synchronously,
    // so it has to be populated before any text is stripped
    await ensureMapNames();

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
    // Also find map IDs in arrays/variables (e.g. `var imaps = [104000000, ...]`)
    // and warp() calls — any 6-9 digit number is likely a map ID
    const numRegex = /\b(\d{6,9})\b/g;
    while ((match = numRegex.exec(scriptCode)) !== null) {
      const id = parseInt(match[1]);
      if (id >= 100000 && id <= 999999999) mapIds.add(id);
    }
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

  /** The live event instance, or the null-safe stand-in after a crash on one. */
  eventInstanceApi(): any {
    if (HenesysPQ.isRegistered()) return makeSafeScriptApi(HenesysPQ.getInstanceApi(), 'EventInstance:HenesysPQ');
    if (!this.eventStub) return null;
    return makeSafeScriptApi({
      isEventCleared() { return false; },
      getProperty(_k: string) { return null; },
      getIntProperty(_k: string) { return 0; },
      setProperty(_k: string, _v: any) { /* no instance */ },
      getPlayerCount() { return 1; },
      getPlayers() { return []; },
      isExpeditionTeamTogether() { return true; },
    }, 'EventInstance:none');
  }

  private async runScript(funcName: string, mode: number, type: number, selection: number): Promise<void> {
    const scriptCode = await this.loadScript(this.npcId);
    if (!scriptCode) {
      this.onDispose?.();
      return;
    }

    this.pendingDialog = null;
    this.disposed = false;

    try {
      // Build the script closure once per conversation — its start/action
      // functions capture the script's own top-level vars (status,
      // selectedMap, town, ...) which then persist across interactions,
      // matching the original server's one-script-instance-per-conversation
      // behavior
      if (!this.scriptFuncs) {
        this.scriptCm = this.createCM();
        const shim = createScriptJavaShim(this.scriptCm);
        const factory = new Function('cm', 'Java', 'java', 'Packages', `
          ${scriptCode}
          return {
            start: typeof start === 'function' ? start : null,
            action: typeof action === 'function' ? action : null,
          };
        `);
        this.scriptFuncs = factory(this.scriptCm, shim.Java, shim.java, shim.Packages);
      }

      const fn = (this.scriptFuncs as any)?.[funcName];
      if (typeof fn === 'function') {
        fn(mode, type, selection);
      }
    } catch (e) {
      const msg = String((e as any)?.message ?? e);
      if (!this.eventStub && /null|undefined/.test(msg)) {
        console.warn(`[NpcScript] NPC ${this.npcId} (${funcName}) needs an event instance that is not running — retrying with a null-safe one:`, msg);
        this.eventStub = true;
        return this.runScript(funcName, mode, type, selection);
      }
      console.error(`[NpcScript] Error in NPC ${this.npcId} (${funcName}):`, e);
      this.onDispose?.();
      return;
    }

    const dialog = this.pendingDialog as PendingDialog | null;
    if (dialog && this.disposed) {
      dialog.type = 'ok';
      this.onShowDialog?.(dialog);
    } else if (this.disposed) {
      this.onDispose?.();
    } else if (dialog) {
      this.onShowDialog?.(dialog);
    }
  }

  /**
   * A world point in the shape Cosmic scripts expect. Scripts compare a
   * player's position against a portal's — Happyville's 9209100 measures the
   * distance to the chimney01 portal to decide which line Santa says — and
   * through the safe-stub proxy those reads silently became NaN, so the
   * comparison was always false and only the generic greeting ever showed.
   */
  private static point(x: number, y: number) {
    return { getX() { return x; }, getY() { return y; }, x, y };
  }

  /** Cosmic Guild object shim — null when the player has no guild. */
  private static guildApi() {
    const g = GuildManager.guild;
    if (!g) return null;
    return makeSafeScriptApi({
      getId() { return g.id; },
      getName() { return g.name; },
      getCapacity() { return g.capacity; },
      getLeaderId() { return g.leaderId; },
      getGP() { return g.gp; },
      getAllianceId() { return 0; },
      getNotice() { return g.notice; },
      getSize() { return g.members.length; },
      getRankTitle(rank: number) { return g.ranks[rank - 1] ?? ""; },
    }, "NpcScript guild");
  }

  /** The map shim scripts reach through cm.getMap() / player.getMap(). */
  private mapApi() {
    const character = this.character;
    return makeSafeScriptApi({
      getId() { return character?.map?.mapId ?? 0; },
      getPortal(nameOrIndex: string | number) {
        const portals = character?.map?.portals ?? [];
        const index = typeof nameOrIndex === 'number'
          ? nameOrIndex
          : portals.findIndex((p: any) => p.name === nameOrIndex);
        const portal = portals[index];
        if (!portal) return null;
        return makeSafeScriptApi({
          // Portal ids in the WZ are the node names, i.e. load order — the
          // Portal class doesn't keep one, so the index is that same number
          getId() { return index; },
          getName() { return portal.name ?? ''; },
          getPosition() { return NpcScriptEngine.point(portal.x ?? 0, portal.y ?? 0); },
        }, `NpcScript portal ${String(nameOrIndex)}`);
      },
    }, 'NpcScript map');
  }

  private createCM(): any {
    const engine = this;
    const character = this.character;
    const questManager = character?.questManager;
    const mapNameResolver = (id: number) => engine.mapNameCache.get(id) || `Map ${id}`;

    const isSuperuser = () => !!(window as any).__mySocket?.isSuperuser;
    const playerObjBase = {
      // GM rank for the scripts that gate on it (KIN / NimaKIN in the GM map
      // 180000000, a few event NPCs): the account's superuser flag, as the
      // highest rank Cosmic's scripts check for
      gmLevel() { return isSuperuser() ? 6 : 0; },
      isGM() { return isSuperuser(); },
      isMale() { return (character?.gender || 0) === 0; },
      isFemale() { return (character?.gender || 0) === 1; },
      // NimaKIN: one level per click, with the effect
      levelUp(_show?: boolean) { character?.levelUp?.(); },
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
      getMap() { return engine.mapApi(); },
      getPosition() {
        return NpcScriptEngine.point(character?.pos?.x ?? 0, character?.pos?.y ?? 0);
      },
      // Cosmic saved-location API (FLORINA, MIRROR, EVENT, ...): entry NPCs
      // save the origin map before warping, exit NPCs read it to warp back.
      // Stored on the character so it survives map changes (this engine is
      // recreated per map). -1 = nothing saved, matching Cosmic scripts'
      // `if (returnmap == -1)` fallback checks.
      saveLocation(type: string) {
        const c: any = character;
        if (!c) return;
        c.savedLocations = c.savedLocations || {};
        // Coerced: the store's readers gate on `typeof v === 'number'`, so a
        // map id that arrived as a string would read back as nothing saved
        const mapId = Number(c.map?.mapId);
        c.savedLocations[type] = Number.isFinite(mapId) && mapId > 0 ? mapId : 0;
      },
      peekSavedLocation(type: string) {
        const v = Number((character as any)?.savedLocations?.[type]);
        return Number.isFinite(v) && v > 0 ? v : -1;
      },
      getSavedLocation(type: string) {
        const c: any = character;
        const v = c?.savedLocations?.[type];
        if (c?.savedLocations) delete c.savedLocations[type];
        const n = Number(v);
        return Number.isFinite(n) && n > 0 ? n : -1;
      },
      clearSavedLocation(type: string) {
        const c: any = character;
        if (c?.savedLocations) delete c.savedLocations[type];
      },
      getClient() { return { getPlayer() { return playerObj; } }; },
      getBuddylist() { return { getCapacity() { return 20; } }; },
      setBuddyCapacity(n: number) { /* stub */ },
      getInventory(type: any) {
        return { getNumFreeSlot() { return 10; } };
      },
      isQuestStarted(questId: number) { return questManager?.getQuestState(questId) === QuestState.STARTED; },
      isQuestCompleted(questId: number) { return questManager?.getQuestState(questId) === QuestState.COMPLETED; },
      // Systems that don't exist yet return null so scripts take their
      // authentic "you don't have X" branches instead of chaining into stubs
      getParty() { return null; },
      // Guild API (Heracle 2010007 / Lea 2010008 / Lenario 2010009). Backed
      // by GuildManager, the client mirror of the server guild record.
      getGuild() { return NpcScriptEngine.guildApi(); },
      getGuildId() { return GuildManager.guild?.id ?? 0; },
      getGuildRank() { return GuildManager.myRank() || 5; },
      getMGC() { return null; }, // alliance membership — no alliances yet
      genericGuildMessage(code: number) {
        // 1 = "enter guild name", 17 = emblem designer (Cosmic packet codes)
        if (code === 1) GuildManager.promptGuildName();
        else if (code === 17) GuildManager.promptEmblem();
      },
      disbandGuild() { GuildManager.disband(); },
      increaseGuildCapacity() { GuildManager.expand(); },
      getEventInstance() { return engine.eventInstanceApi(); },
      // Party Search (HeavenMS extra surfaced in Tory's menu)
      isRecvPartySearchInviteEnabled() { return false; },
      toggleRecvPartySearchInvite() { return false; },
      getSkillLevel(skillId: any) {
        const id = typeof skillId === 'number' ? skillId : skillId?.getId?.() ?? 0;
        return character?.skillManager?.getSkillLevel?.(id) ?? 0;
      },
      getStorage() {
        // cm.getPlayer().getStorage().sendStorage(cm.getClient(), npcId) — the
        // 25 storage keepers. The keeper's id decides the deposit fee.
        return makeSafeScriptApi({
          sendStorage(_client: any, npcId?: number) {
            void UIStorage.show(Number(npcId) || engine.npcId);
          },
        }, 'Storage');
      },
    };
    // Any player method the engine doesn't implement degrades to a chainable
    // no-op — backend scripts call dozens of Cosmic player methods
    const playerObj = makeSafeScriptApi(playerObjBase, `NpcScript player`);

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
          // Removing #L..#l leaves each option's line break behind: Robin's
          // 17 travel questions left 17 blank lines, which padded the
          // message out and pushed the option list ~270px down the dialog —
          // far enough that the NPC underneath could no longer be clicked
          text: collapseBlankLines(stripFormatCodes(body, mapNameResolver)),
          type: 'simple',
          selections,
        };
      },
      sendImage(text: string) { engine.pendingDialog = { text: stripScriptCodes(text, mapNameResolver), type: 'ok' }; },
      sendStyle(text: string, options: any) {
        // The v83 avatar picker (UtilDlgEx_Avatar): the script gets back
        // (mode 1, type 7, index) and applies cm.setHair(styles[selection])
        // itself. An empty list is Cosmic's "no cosmetics" notice + dispose.
        const styles: number[] = (Array.isArray(options) ? options : [])
          .map((v: any) => Number(v)).filter((v: number) => Number.isFinite(v) && v >= 0);
        if (styles.length === 0) {
          engine.pendingDialog = {
            text: 'Sorry, there are no options of cosmetics available for you here at the moment.',
            type: 'ok',
          };
          engine.disposed = true;
          return;
        }
        engine.pendingDialog = { text: stripScriptCodes(text, mapNameResolver), type: 'style', styles };
      },
      sendGetText(text: string, def?: string) {
        engine.pendingDialog = {
          text: stripScriptCodes(text, mapNameResolver),
          type: 'getText',
          input: { def: def ?? '' },
          onInput: (v: string) => { engine.lastGetText = v; },
        };
      },
      sendGetNumber(text: string, def?: number, min?: number, max?: number) {
        engine.pendingDialog = {
          text: stripScriptCodes(text, mapNameResolver),
          type: 'getNumber',
          input: { def: def ?? 0, min, max },
          onInput: (v: string) => { engine.lastGetNumber = parseInt(v) || 0; },
        };
      },
      getText() { return engine.lastGetText; },
      getNumber() { return engine.lastGetNumber; },

      dispose() { engine.disposed = true; },

      // Player info shortcuts
      getPlayer() { return playerObj; },
      getChar() { return playerObj; },
      getClient() {
        return makeSafeScriptApi({
          getPlayer() { return playerObj; },
          getChannel() { return 1; },
          getWorld() { return 0; },
        }, 'NpcScript client');
      },
      c: makeSafeScriptApi({ getPlayer() { return playerObj; } }, 'NpcScript c'),
      getJobId() { return character?.stats?.jobId ?? 0; },
      getLevel() { return character?.stats?.level ?? 1; },
      getMeso() { return character?.inventory?.mesos ?? 0; },
      getMapId() { return character?.map?.mapId ?? 0; },
      getNpc() { return engine.npcId; },
      getMap() { return engine.mapApi(); },

      // Items
      gainItem(itemId: number, count?: number) {
        const qty = count ?? 1;
        if (qty > 0) {
          character?.inventory?.addToInventory(itemId, qty);
        } else if (qty < 0) {
          questManager?.removeItems(itemId, -qty);
        }
        import('./UI/UIChatLog').then(({ default: UIChatLog }) => UIChatLog.logItemChange(itemId, qty)).catch(() => {});
      },
      haveItem(itemId: number, count?: number) {
        const has = questManager?.getItemCount(itemId) ?? 0;
        return has >= (count ?? 1);
      },
      hasItem(itemId: number, count?: number) {
        return (questManager?.getItemCount(itemId) ?? 0) >= (count ?? 1);
      },
      haveItemWithId(itemId: number, checkEquipped?: boolean) {
        if ((questManager?.getItemCount(itemId) ?? 0) > 0) return true;
        if (checkEquipped && character?.equippedItemIds) {
          return Object.values(character.equippedItemIds).includes(itemId);
        }
        return false;
      },
      itemQuantity(itemId: number) { return questManager?.getItemCount(itemId) ?? 0; },
      getItemQuantity(itemId: number) { return questManager?.getItemCount(itemId) ?? 0; },
      canHold(itemId: number, count?: number) {
        return character?.inventory?.canHold?.(itemId, count ?? 1) ?? true;
      },
      canHoldAll() { return true; },
      removeItem(itemId: number) { questManager?.removeItems(itemId, 1); },
      removeAll(itemId: number) {
        const count = questManager?.getItemCount(itemId) ?? 0;
        if (count > 0) questManager?.removeItems(itemId, count);
      },

      // Rewards
      gainExp(amount: number) { character?.addExp(amount, true); },
      gainMeso(amount: number) {
        if (character?.inventory) character.inventory.gainMesos(amount);
      },
      gainFame(amount: number) {
        if (character) character.fame = (character.fame || 0) + amount;
      },

      // Map
      warp(mapId: number, portalId?: number | string) {
        engine.disposed = true;
        const id = Number(mapId);
        // A broken script must never warp via changeMap's defaultMap fallback
        if (!Number.isFinite(id) || id <= 0) {
          console.error(`[NpcScript] NPC ${engine.npcId} warp with invalid mapId:`, mapId);
          return;
        }
        if (engine.changeMapFn) {
          fadeToBlack();
          engine.changeMapFn(id, portalId);
        }
      },

      // Quest
      startQuest(questId: number) { questManager?.forceStartQuest(questId); },
      completeQuest(questId: number) { questManager?.forceCompleteQuest(questId); },
      forceStartQuest(questId: number) { questManager?.forceStartQuest(questId); },
      forceCompleteQuest(questId: number) { questManager?.forceCompleteQuest(questId); },
      isQuestStarted(questId: number) { return questManager?.getQuestState(questId) === QuestState.STARTED; },
      isQuestCompleted(questId: number) { return questManager?.getQuestState(questId) === QuestState.COMPLETED; },
      getQuestStatus(questId: number) { return questManager?.getQuestState(questId) ?? 0; },
      isQuestActive(questId: number) { return questManager?.getQuestState(questId) === QuestState.STARTED; },
      setQuestProgress(questId: number, progress: string) { /* stub */ },
      getQuestProgress(questId: number) { return ''; },
      getQuestProgressInt(questId: number) { return 0; },

      // Cosmetics — mutate the character and persist on next save
      // Cosmic: a cosmetic "exists" when String.wz names it; a missing colour
      // variant falls back to its base (hair xxxx0, face xxx00), else -1
      isCosmeticEquipped(id: number) {
        id = Number(id);
        if (id < 100) return (character?.skinColor ?? 0) === id;
        if (id < 30000) return (character?.face ?? 20000) === id;
        return (character?.hair ?? 30030) === id;
      },
      getCosmeticItem(id: number) {
        id = Number(id);
        if (!Number.isFinite(id)) return -1;
        if (id < 100) return id;
        const exists = (v: number) => !!getItemNameSync(v);
        if (exists(id)) return id;
        const base = id < 30000 ? Math.floor(id / 1000) * 1000 + (id % 100) : Math.floor(id / 10) * 10;
        return id !== base && exists(base) ? base : -1;
      },
      /**
       * Put an equip straight onto the character, no inventory round trip.
       * Used by the Maple avatar NPC, which dresses the player rather than
       * handing them pieces to equip themselves.
       */
      equipItem(itemId: number) {
        void (async () => {
          try {
            const { getEquipSlotForItem } = await import("./UI/Menu/EquipMenuSprite");
            const slot = getEquipSlotForItem(itemId);
            if (slot === undefined || slot === null || slot < 0) {
              console.warn(`[cm.equipItem] no slot for ${itemId}`);
              return;
            }
            await character?.attachEquip?.(slot, itemId);
          } catch (e) {
            console.error("[cm.equipItem] failed", e);
          }
        })();
      },
      setHair(id: number) { character?.setHair?.(id)?.then?.(() => (window as any).__mySocket?.requestSave?.())?.catch?.(console.error); },
      setFace(id: number) { character?.setFace?.(id)?.then?.(() => (window as any).__mySocket?.requestSave?.())?.catch?.(console.error); },
      setSkin(id: number) { character?.setSkinColor?.(id)?.then?.(() => (window as any).__mySocket?.requestSave?.())?.catch?.(console.error); },

      // Skills/jobs
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
      changeJob(job: any) { character?.changeJob(typeof job === 'number' ? job : job?.getId?.() ?? 0); },
      changeJobById(jobId: number) { character?.changeJob(jobId); },

      // Party/events. HenesysPQ is a real client-side event instance; other
      // event managers keep the safe stub (it's the running INSTANCE that can
      // be null in Cosmic, so scripts chain manager calls unconditionally).
      // No party system exists yet — NPCs of an implemented event see a
      // solo party of one so their scripts can start the instance; everyone
      // else keeps the authentic "you have no party" branches.
      getParty() {
        // A real party always shows through; without one, NPCs of an
        // implemented event still see a solo party of one so their scripts
        // can start the instance
        if (PartyManager.isInParty()) {
          const members = PartyManager.getMembers();
          return makeSafeScriptApi({
            size() { return members.length; },
            getLeader() { return playerObj; },
            toArray() { return members; },
            getMembers() { return members; },
          }, 'Party');
        }
        if (!HenesysPQ.NPC_IDS.includes(engine.npcId)) return null;
        return makeSafeScriptApi({
          size() { return 1; },
          getLeader() { return playerObj; },
          toArray() { return [playerObj]; },
          getMembers() { return [playerObj]; },
        }, 'Party');
      },
      isLeader() {
        return PartyManager.isInParty() ? PartyManager.isLeader() : true;
      },
      isEventLeader() { return HenesysPQ.isEventLeader(); },
      getEventInstance() { return engine.eventInstanceApi(); },
      isUsingOldPqNpcStyle() { return false; },
      getEventManager(name: string) {
        if (name === 'HenesysPQ') {
          return makeSafeScriptApi(HenesysPQ.getManagerApi(), 'EventManager:HenesysPQ');
        }
        // Transportation events (Boats/Trains/.../KerningTrain/Hak) are real —
        // backed by the wall-clock scheduler; everything else keeps the safe stub
        const transport = TransportationManager.getEventManagerApi(name);
        if (transport) return makeSafeScriptApi(transport, `EventManager:${name}`);
        return makeSafeScriptApi({
          getEventInstance() { return null; },
          getProperty(_k: string) { return null; },
          getIntProperty(_k: string) { return 0; },
          setProperty(_k: string, _v: any) { /* stub */ },
          getTransportationTime() { return 60000; },
        }, 'EventManager');
      },
      getExpedition() { return null; },

      // Misc
      getJob() { return playerObj.getJob(); },
      getPlayerCount(mapId?: number) {
        const socket = (window as any).__mySocket;
        const targetMap = Number(mapId ?? character?.map?.mapId ?? 0);
        // Count only players actually on that map — the asker included only
        // when it IS their map (the old version counted yourself everywhere,
        // so every empty Training Center room read 1/5)
        let count = Number(character?.map?.mapId) === targetMap ? 1 : 0;
        if (!socket?.otherPlayers) return count;
        for (const p of socket.otherPlayers.values()) {
          // Remote instances only exist for the map we're on — an entry
          // without its own mapId means "here"
          const pMap = Number((p as any).mapId ?? character?.map?.mapId);
          if (pMap === targetMap) count++;
        }
        return count;
      },
      dropMessage(type: number, text: string) { cm.playerMessage(type, text); },
      message(text: string) { cm.playerMessage(5, text); },
      playerMessage(type: number, text: string) {
        // Show as the player's own chat balloon (pink notice line is Tier 4 UI)
        if (character) {
          character.chatMessage = stripScriptCodes(String(text), mapNameResolver);
          character.showChatBalloon = true;
          character.chatBalloonTimer = 0;
          character.chatBalloonDuration = 5000;
        }
        console.log(`[NpcScript] ${text}`);
      },
      mapMessage(type: number, text: string) { cm.playerMessage(type, text); },
      showInfo(path: string) { /* stub */ },
      guideHint(hint: number) { /* stub */ },
      openNpc(npcId: number) { /* stub — open another NPC's dialog */ },
      openShopNPC(shopId: number) { ShopUI.show(shopId); },
      openShop(shopId: number) { ShopUI.show(shopId); },
      getGuild() { return NpcScriptEngine.guildApi(); },
      getGuildId() { return GuildManager.guild?.id ?? 0; },
      getAllianceCapacity() { return 0; },
    };

    // Safety net: unimplemented cm.* calls warn instead of killing the dialog
    return makeSafeScriptApi(cm, `NpcScript ${this.npcId} cm`);
  }
}
