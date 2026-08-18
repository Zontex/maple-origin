#!/usr/bin/env node
/**
 * Builds TypeScript-Client/public/data/monsterbook.json from the converted WZ.
 *
 * Everything the Monster Book shows comes out of the v83 WZ data:
 *
 *   Item.wz/Consume/0238.img/<8-digit>/info/mob   card -> monster
 *   String.wz/MonsterBook.img/<mobId>/map         the "FOUND IN" list
 *   String.wz/MonsterBook.img/<mobId>/reward      the "DROPPING" list
 *   String.wz/MonsterBook.img/<mobId>/episode     level / form / trait + lore
 *   Mob.wz/<7-digit>.img/info                     HP, MP, EXP, ATT, DEF, ...
 *
 * Mob.wz is the only expensive part — 950MB across 1565 files, up to 31MB for
 * one boss — and it is evicted from the client's WZ cache on every map change.
 * Reading the 343 stat blocks here instead means the book never touches Mob.wz
 * at runtime; the generated file is ~150KB.
 *
 * Names are deliberately NOT baked in: the client resolves monster, map and
 * item names through the same String.wz tables the rest of the UI uses.
 *
 * Usage: node tools/build-monsterbook-data.js
 */

const fs = require('fs');
const path = require('path');

const WZ = path.join(__dirname, '..', 'TypeScript-Client', 'public', 'wz_client');
const OUT = path.join(__dirname, '..', 'TypeScript-Client', 'public', 'data', 'monsterbook.json');

// ---- minimal reader for the $$-array WZ JSON format -----------------------

function nameOf(obj) {
  for (const k of Object.keys(obj)) {
    if (k !== '$$' && k.startsWith('$')) return obj[k];
  }
  return '';
}

function kids(obj) {
  return obj['$$'] || [];
}

function child(obj, name) {
  for (const c of kids(obj)) if (nameOf(c) === name) return c;
  return null;
}

function intOf(obj, name, fallback = 0) {
  const c = child(obj, name);
  if (!c || c.value === undefined) return fallback;
  const n = parseInt(c.value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(WZ, rel), 'utf8'));
}

// ---- episode string ------------------------------------------------------

/**
 * The episode string opens with a small header the original client prints as
 * the card's stat lines, then a blank line, then the lore paragraph:
 *
 *   " Lv. :  15\nForm : Plant\nSpecial Trait : Resistant to Poison...\n\nA
 *   Green Mushroom monster with a dull looking cap..."
 *
 * A few entries (all in the special/boss tab) use "Level : Lv.35\nType :
 * Creature" instead, so both spellings are accepted.
 */
function parseEpisode(raw) {
  const text = String(raw || '').replace(/\\n/g, '\n').replace(/\r/g, '');
  const out = { form: '', trait: '', lore: '' };
  const blank = text.search(/\n\s*\n/);
  const header = blank >= 0 ? text.slice(0, blank) : '';
  out.lore = (blank >= 0 ? text.slice(blank) : text).trim();

  for (const line of header.split('\n')) {
    const m = line.match(/^\s*([^:]+?)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].trim().toLowerCase();
    const value = m[2].trim();
    if (key === 'form' || key === 'type') out.form = value;
    else if (key === 'special trait') out.trait = value;
  }
  return out;
}

// ---- build ---------------------------------------------------------------

function build() {
  const cardsImg = readJson('Item.wz/Consume/0238.img.json');
  const bookImg = readJson('String.wz/MonsterBook.img.json');

  // card id -> mob id
  const cards = [];
  for (const c of kids(cardsImg)) {
    const cardId = parseInt(nameOf(c), 10);
    const info = child(c, 'info');
    if (!Number.isFinite(cardId) || !info) continue;
    // Only the entries the client itself flags as book cards
    if (intOf(info, 'monsterBook', 0) !== 1) continue;
    const mobId = intOf(info, 'mob', 0);
    if (!mobId) continue;
    cards.push({ id: cardId, mob: mobId });
  }
  cards.sort((a, b) => a.id - b.id);

  // String.wz/MonsterBook.img, keyed by mob id
  const bookByMob = new Map();
  for (const c of kids(bookImg)) {
    bookByMob.set(parseInt(nameOf(c), 10), c);
  }

  const mobs = {};
  let missingMobWz = 0;
  let missingBookStr = 0;

  for (const card of cards) {
    const mobId = card.mob;
    if (mobs[mobId]) continue;

    const entry = {
      lv: 0, hp: 0, mp: 0, exp: 0,
      pad: 0, pdd: 0, mad: 0, mdd: 0, acc: 0, eva: 0,
      boss: 0, undead: 0,
      form: '', trait: '', lore: '',
      maps: [], rewards: [],
    };

    // Mob.wz stats
    const mobFile = `Mob.wz/${String(mobId).padStart(7, '0')}.img.json`;
    if (fs.existsSync(path.join(WZ, mobFile))) {
      const info = child(readJson(mobFile), 'info');
      if (info) {
        entry.lv = intOf(info, 'level');
        entry.hp = intOf(info, 'maxHP');
        entry.mp = intOf(info, 'maxMP');
        entry.exp = intOf(info, 'exp');
        entry.pad = intOf(info, 'PADamage');
        entry.pdd = intOf(info, 'PDDamage');
        entry.mad = intOf(info, 'MADamage');
        entry.mdd = intOf(info, 'MDDamage');
        entry.acc = intOf(info, 'acc');
        entry.eva = intOf(info, 'eva');
        entry.boss = intOf(info, 'boss');
        entry.undead = intOf(info, 'undead');
      }
    } else {
      missingMobWz++;
    }

    // String.wz/MonsterBook.img: habitat, drops, episode
    const str = bookByMob.get(mobId);
    if (str) {
      const maps = child(str, 'map');
      if (maps) {
        for (const m of kids(maps)) {
          const v = parseInt(m.value, 10);
          if (Number.isFinite(v)) entry.maps.push(v);
        }
      }
      const rewards = child(str, 'reward');
      if (rewards) {
        for (const r of kids(rewards)) {
          const v = parseInt(r.value, 10);
          if (Number.isFinite(v)) entry.rewards.push(v);
        }
      }
      const ep = child(str, 'episode');
      if (ep) Object.assign(entry, parseEpisode(ep.value));
    } else {
      missingBookStr++;
    }

    mobs[mobId] = entry;
  }

  const data = { cards, mobs };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(data));

  const bytes = fs.statSync(OUT).size;
  const perTab = {};
  for (const c of cards) {
    const tab = Math.floor(c.id / 1000) - 2380;
    perTab[tab] = (perTab[tab] || 0) + 1;
  }
  console.log(`[monsterbook] ${cards.length} cards, ${Object.keys(mobs).length} monsters`);
  console.log(`[monsterbook] cards per tab:`, perTab);
  if (missingMobWz) console.warn(`[monsterbook] ${missingMobWz} monsters have no Mob.wz file`);
  if (missingBookStr) console.warn(`[monsterbook] ${missingBookStr} monsters have no String.wz/MonsterBook.img entry`);
  console.log(`[monsterbook] wrote ${OUT} (${(bytes / 1024).toFixed(1)} KB)`);
}

build();
