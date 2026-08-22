/**
 * GM / dev chat commands, private-server style: "!killall", "!spawn 100100 5",
 * "!warp 100000000", "!job 132"... Typed into the chat with a leading "!";
 * anything that is not a known command falls through to guild chat (see
 * UIMap). Everything here acts on the local client the same way the game's
 * own systems do (inventory, stats, MapleMap), so saves and multiplayer
 * relays follow naturally. "!help" lists them.
 */
import MyCharacter from './MyCharacter';
import MapleMap from './MapleMap';
import UIChatLog from './UI/UIChatLog';
import SkillData from './Skills/SkillData';
import Stats from './Stats/Stats';
import {
  ensureItemNames, ensureMapNames, itemNames, mobNames, npcNames, mapNames, getMapNameSync,
} from './Quest/QuestData';

type Command = {
  usage: string;
  help: string;
  run: (args: string[]) => Promise<void> | void;
};

const say = (text: string) => UIChatLog.system(text);
const int = (s: string | undefined, fallback = NaN) => {
  const n = Math.floor(Number(s));
  return Number.isFinite(n) ? n : fallback;
};
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

let spawnCounter = 0;

const commands: Record<string, Command> = {
  help: {
    usage: '!help [command]',
    help: 'List the commands, or explain one.',
    run: ([name]) => {
      if (name) {
        const c = commands[name.replace(/^!/, '').toLowerCase()];
        say(c ? `${c.usage} — ${c.help}` : `No such command: ${name}`);
        return;
      }
      say('Commands: ' + Object.keys(commands).map((k) => '!' + k).join(' '));
      say('"!help <command>" explains one.');
    },
  },

  warp: {
    usage: '!warp <mapId> [portalName]',
    help: 'Go to a map (alias: !map).',
    run: ([id, portal]) => {
      const mapId = int(id);
      if (!Number.isInteger(mapId) || mapId < 0) { say('Usage: !warp <mapId> [portal]'); return; }
      // MapState.changeMap fades and spawns at the named portal; plain load otherwise
      return import('./MapState').then((m: any) => {
        const state = m.default ?? (window as any).MapStateInstance;
        if (state?.changeMap) return state.changeMap(mapId, portal || undefined);
        return MapleMap.load(mapId);
      });
    },
  },
  map: { usage: '!map <mapId>', help: 'Alias of !warp.', run: (a) => commands.warp.run(a) },

  level: {
    usage: '!level <1-200>',
    help: 'Set your level (plays the level-up effect when going up).',
    run: ([n]) => {
      const level = int(n);
      if (!Number.isInteger(level) || level < 1 || level > 200) { say('Usage: !level <1-200>'); return; }
      if (level > MyCharacter.stats.level) MyCharacter.playLevelUp();
      MyCharacter.stats.level = level;
      MyCharacter.exp = 0;
      MyCharacter.recalcLocalStats?.();
      say(`Level set to ${level}.`);
    },
  },

  item: {
    usage: '!item <itemId> [count]',
    help: 'Give yourself an item (only ids String.wz names).',
    run: async ([id, count]) => {
      const itemId = int(id);
      const qty = clamp(int(count, 1) || 1, 1, 1000);
      if (!Number.isInteger(itemId) || itemId < 1000000) { say('Usage: !item <itemId> [count]'); return; }
      await ensureItemNames();
      const name = itemNames.get(itemId);
      if (!name) { say(`No item with id ${itemId}.`); return; }
      const ok = await MyCharacter.inventory.addToInventory(itemId, qty);
      say(ok === false ? `Could not add ${name} (${itemId}) — tab full?` : `Gained ${name} (${itemId}) x${qty}.`);
    },
  },

  meso: {
    usage: '!meso <amount>',
    help: 'Add mesos (negative to remove).',
    run: ([n]) => {
      const amount = int(n);
      if (!Number.isInteger(amount)) { say('Usage: !meso <amount>'); return; }
      MyCharacter.inventory.mesos = clamp(MyCharacter.inventory.mesos + amount, 0, 2147483647);
      say(`Mesos: ${MyCharacter.inventory.mesos.toLocaleString()}.`);
    },
  },
  nx: {
    usage: '!nx <amount>',
    help: 'Add NX cash.',
    run: ([n]) => {
      const amount = int(n);
      if (!Number.isInteger(amount)) { say('Usage: !nx <amount>'); return; }
      MyCharacter.inventory.gainNX(amount);
      say(`NX: ${MyCharacter.inventory.nx.toLocaleString()}.`);
    },
  },

  job: {
    usage: '!job <jobId>',
    help: 'Change job (0 Beginner, 100 Warrior, 110 Fighter, 111 Crusader, 112 Hero, 130 Spearman, 131 DK, 132 Dark Knight, 200/210..232 Magician, 300/310..322 Bowman, 400/410..422 Thief, 500/510..522 Pirate).',
    run: ([n]) => {
      const jobId = int(n);
      if (!Number.isInteger(jobId) || jobId < 0 || jobId > 2299) { say('Usage: !job <jobId>'); return; }
      MyCharacter.changeJob(jobId);
      MyCharacter.recalcLocalStats?.();
      say(`Job: ${MyCharacter.stats.job} (${jobId}).`);
    },
  },

  hp: {
    usage: '!hp <n>',
    help: 'Set max HP (and fill it).',
    run: ([n]) => {
      const v = int(n);
      if (!Number.isInteger(v) || v < 1) { say('Usage: !hp <n>'); return; }
      MyCharacter.maxHp = clamp(v, 1, 99999);
      MyCharacter.recalcLocalStats?.();
      MyCharacter.hp = MyCharacter.effectiveMaxHp ?? MyCharacter.maxHp;
      say(`Max HP: ${MyCharacter.maxHp}.`);
    },
  },
  mp: {
    usage: '!mp <n>',
    help: 'Set max MP (and fill it).',
    run: ([n]) => {
      const v = int(n);
      if (!Number.isInteger(v) || v < 0) { say('Usage: !mp <n>'); return; }
      MyCharacter.maxMp = clamp(v, 0, 99999);
      MyCharacter.recalcLocalStats?.();
      MyCharacter.mp = MyCharacter.effectiveMaxMp ?? MyCharacter.maxMp;
      say(`Max MP: ${MyCharacter.maxMp}.`);
    },
  },
  heal: {
    usage: '!heal',
    help: 'Full HP and MP, diseases lifted.',
    run: () => {
      MyCharacter.hp = MyCharacter.effectiveMaxHp ?? MyCharacter.maxHp;
      MyCharacter.mp = MyCharacter.effectiveMaxMp ?? MyCharacter.maxMp;
      try { (MyCharacter as any).status?.clearAll?.(); } catch { /* optional */ }
      say('Healed.');
    },
  },

  ap: {
    usage: '!ap <n>',
    help: 'Set unspent ability points.',
    run: ([n]) => {
      const v = int(n);
      if (!Number.isInteger(v) || v < 0) { say('Usage: !ap <n>'); return; }
      MyCharacter.stats.abilityPoints = clamp(v, 0, 9999);
      say(`AP: ${MyCharacter.stats.abilityPoints}.`);
    },
  },
  sp: {
    usage: '!sp <n> [jobTier]',
    help: "Set unspent skill points for your current job tier (or the given tier id).",
    run: ([n, tier]) => {
      const v = int(n);
      if (!Number.isInteger(v) || v < 0) { say('Usage: !sp <n> [jobTier]'); return; }
      const t = int(tier, MyCharacter.stats.jobId ?? 0);
      MyCharacter.stats.spByTier[t] = clamp(v, 0, 9999);
      say(`SP for tier ${t}: ${v}.`);
    },
  },
  stat: {
    usage: '!stat <str|dex|int|luk> <n>',
    help: 'Set a base stat.',
    run: ([which, n]) => {
      const key = String(which || '').toLowerCase();
      const v = int(n);
      if (!['str', 'dex', 'int', 'luk'].includes(key) || !Number.isInteger(v) || v < 4) { say('Usage: !stat <str|dex|int|luk> <4-999>'); return; }
      (MyCharacter.stats as any)[key] = clamp(v, 4, 999);
      MyCharacter.recalcLocalStats?.();
      say(`${key.toUpperCase()}: ${v}.`);
    },
  },
  maxstats: {
    usage: '!maxstats',
    help: 'STR/DEX/INT/LUK 999, max HP/MP 30000/30000, full heal.',
    run: () => {
      const s: any = MyCharacter.stats;
      s.str = 999; s.dex = 999; s.int = 999; s.luk = 999;
      MyCharacter.maxHp = 30000; MyCharacter.maxMp = 30000;
      MyCharacter.recalcLocalStats?.();
      MyCharacter.hp = MyCharacter.effectiveMaxHp ?? 30000;
      MyCharacter.mp = MyCharacter.effectiveMaxMp ?? 30000;
      say('Stats maxed.');
    },
  },

  exp: {
    usage: '!exp <amount>',
    help: 'Gain EXP (with the effect).',
    run: ([n]) => {
      const v = int(n);
      if (!Number.isInteger(v) || v <= 0) { say('Usage: !exp <amount>'); return; }
      MyCharacter.addExp(v, true);
    },
  },
  fame: {
    usage: '!fame <n>',
    help: 'Set fame.',
    run: ([n]) => {
      const v = int(n);
      if (!Number.isInteger(v)) { say('Usage: !fame <n>'); return; }
      MyCharacter.fame = clamp(v, -30000, 30000);
      say(`Fame: ${MyCharacter.fame}.`);
    },
  },

  skill: {
    usage: '!skill <skillId> <level> [masterLevel]',
    help: 'Set a skill level (0 removes it).',
    run: async ([id, lv, ml]) => {
      const skillId = int(id);
      const level = int(lv);
      if (!Number.isInteger(skillId) || !Number.isInteger(level) || level < 0) { say('Usage: !skill <skillId> <level> [masterLevel]'); return; }
      const info = await SkillData.getSkill(skillId);
      if (!info) { say(`No skill ${skillId}.`); return; }
      const capped = clamp(level, 0, info.maxLevel || level);
      const master = int(ml, Math.max(capped, MyCharacter.skillManager.getMasterLevel(skillId)));
      MyCharacter.skillManager.changeSkillLevel(skillId, capped, master);
      MyCharacter.recalcLocalStats?.();
      say(`${info.name}: level ${capped}${master ? ` (master ${master})` : ''}.`);
    },
  },
  maxskills: {
    usage: '!maxskills',
    help: 'Every skill of your job line to its max level.',
    run: async () => {
      const jobId = MyCharacter.stats.jobId ?? 0;
      let n = 0;
      for (const tier of Stats.tiersFor(jobId)) {
        const skills = await SkillData.getJobSkills(tier);
        for (const s of skills) {
          if (!s.maxLevel) continue;
          MyCharacter.skillManager.changeSkillLevel(s.id, s.maxLevel, s.maxLevel);
          n++;
        }
      }
      MyCharacter.recalcLocalStats?.();
      say(`${n} skills maxed.`);
    },
  },
  buff: {
    usage: '!buff <skillId> [level]',
    help: "Apply a skill's buff at the given level (default its max).",
    run: async ([id, lv]) => {
      const skillId = int(id);
      const info = Number.isInteger(skillId) ? await SkillData.getSkill(skillId) : null;
      if (!info) { say('Usage: !buff <skillId> [level]'); return; }
      const level = clamp(int(lv, info.maxLevel) || info.maxLevel, 1, info.maxLevel);
      const effect = info.effects?.[level - 1];
      if (!effect || !(effect.time > 0)) { say(`${info.name} is not a timed buff.`); return; }
      MyCharacter.buffManager?.applyBuff(skillId, effect);
      say(`${info.name} level ${level} applied.`);
    },
  },
  dispel: {
    usage: '!dispel',
    help: 'Remove every buff.',
    run: () => {
      const bm = MyCharacter.buffManager;
      for (const id of [...(bm?.activeBuffs?.keys?.() ?? [])]) bm.removeBuff(id);
      say('Buffs removed.');
    },
  },

  killall: {
    usage: '!killall',
    help: 'Kill every mob on the map (alias: !kill).',
    run: () => {
      let n = 0;
      for (const m of [...(MapleMap.monsters || [])]) {
        if (!m || m.dying || m.destroyed || m.isFake) continue;
        m.hit(Math.max(1, Math.floor(m.hp)), 1, MyCharacter, false);
        n++;
      }
      say(`${n} mobs killed.`);
    },
  },
  kill: {
    usage: '!kill [playerName]',
    help: 'Kill a player (yourself with no name). Mobs: !killall.',
    run: ([name]) => {
      if (!name) {
        void MyCharacter.takeDamage(Math.max(1, Math.floor(MyCharacter.hp)));
        say('You died.');
        return;
      }
      const sock = (window as any).__mySocket;
      if (!sock?.sendMessage) { say('Not connected.'); return; }
      sock.sendMessage({ type: 'gm_kill', data: { name } });
    },
  },

  spawn: {
    usage: '!spawn <mobId> [count]',
    help: 'Spawn mobs at your feet (this client only — the host relay does not carry script spawns).',
    run: async ([id, count]) => {
      const mobId = int(id);
      const qty = clamp(int(count, 1) || 1, 1, 50);
      if (!Number.isInteger(mobId) || !mobNames.has(mobId)) { say(`Usage: !spawn <mobId> [count]${Number.isInteger(mobId) ? ` — no mob ${mobId}` : ''}`); return; }
      const x = MyCharacter.pos.x, y = MyCharacter.pos.y;
      const ground = MapleMap.getFootholdBelow?.(x, y) || MapleMap.getNearestFootholdPosition?.(x, y);
      const gy = ground?.y ?? y;
      const fh = (ground as any)?.fh;
      for (let i = 0; i < qty; i++) {
        const sx = x + (i - (qty - 1) / 2) * 40;
        try {
          await MapleMap.spawnMonster({
            oId: 300000 + spawnCounter++, id: mobId, x: sx, y: gy, fh: fh?.id,
            minX: fh ? fh.x1 : sx - 100, maxX: fh ? fh.x2 : sx + 100,
            stance: '', map: MapleMap, alive: true, nextPossibleSpawn: 0, fadeIn: true,
          });
        } catch (e) { console.warn('[!spawn] failed', e); }
      }
      say(`Spawned ${mobNames.get(mobId)} x${qty}.`);
    },
  },
  cleardrops: {
    usage: '!cleardrops',
    help: 'Remove every item lying on the map.',
    run: () => {
      let n = 0;
      for (const d of [...(MapleMap.itemDrops || [])]) { if (d && !d.destroyed) { d.destroy?.(); n++; } }
      say(`${n} drops cleared.`);
    },
  },

  pos: {
    usage: '!pos',
    help: 'Your position, foothold and layer.',
    run: () => {
      const p = MyCharacter.pos;
      say(`Map ${MapleMap.id} (${getMapNameSync(Number(MapleMap.id)) || '?'}) x=${Math.round(p.x)} y=${Math.round(p.y)} fh=${p.fh?.id ?? '-'} layer=${p.fh?.layer ?? '-'}`);
    },
  },
  mapinfo: {
    usage: '!mapinfo',
    help: 'Map id, name, mob/NPC/reactor counts, flags.',
    run: async () => {
      await ensureMapNames();
      const m: any = MapleMap;
      say(`${MapleMap.id} ${getMapNameSync(Number(MapleMap.id))} — mobs ${(m.monsters || []).length}, npcs ${(m.npcs || []).length}, reactors ${(m.reactors || []).length}, drops ${(m.itemDrops || []).length}`);
      say(`town=${!!m.isTown} swim=${!!m.isSwimMap} fs=${m.fs} fieldLimit=0x${Number(m.fieldLimit || 0).toString(16)} decHP=${m.decHP || 0}${m.protectItem ? ` (protect ${m.protectItem})` : ''} host=${(window as any).__mySocket?.isMobHost ?? '?'}`);
    },
  },
  search: {
    usage: '!search <map|mob|npc|item> <name>',
    help: 'Find ids by (partial) name.',
    run: async ([kind, ...rest]) => {
      const q = rest.join(' ').trim().toLowerCase();
      const k = String(kind || '').toLowerCase();
      if (!q || !['map', 'mob', 'npc', 'item'].includes(k)) { say('Usage: !search <map|mob|npc|item> <name>'); return; }
      let table: Map<number, string>;
      if (k === 'map') { await ensureMapNames(); table = mapNames; }
      else if (k === 'item') { await ensureItemNames(); table = itemNames; }
      else table = k === 'mob' ? mobNames : npcNames;
      const hits: string[] = [];
      for (const [id, name] of table) {
        if (String(name).toLowerCase().includes(q)) { hits.push(`${id} ${name}`); if (hits.length >= 12) break; }
      }
      say(hits.length ? hits.join(' | ') : `No ${k} matching "${q}".`);
      if (hits.length >= 12) say('(first 12 shown — narrow the name)');
    },
  },
};

let socketHooked = false;
/**
 * Server replies for the commands that go through it (!kill <name>), and
 * being killed by a GM — installed for EVERY client at map load (a target
 * never runs a command itself), idempotent.
 */
export function installGmHooks() {
  hookSocket();
}
function hookSocket() {
  if (socketHooked) return;
  const sock = (window as any).__mySocket;
  if (!sock?.on) return;
  socketHooked = true;
  sock.on('gm_result', (msg: any) => { if (msg?.data?.message) say(msg.data.message); });
  sock.on('gm_killed', (msg: any) => {
    say(`You were killed by ${msg?.data?.by || 'a GM'}.`);
    void MyCharacter.takeDamage(Math.max(1, Math.floor(MyCharacter.hp)));
  });
}

/** Run a "!command" line; false when it is not a known command. */
export function runDevCommand(line: string): boolean {
  const [raw, ...args] = line.trim().split(/\s+/);
  const name = raw.replace(/^!/, '').toLowerCase();
  const cmd = commands[name];
  if (!cmd) return false;
  hookSocket();
  Promise.resolve()
    .then(() => cmd.run(args))
    .catch((e) => { console.error(`[!${name}] failed`, e); say(`!${name} failed: ${e?.message || e}`); });
  return true;
}

export const devCommandNames = () => Object.keys(commands);
