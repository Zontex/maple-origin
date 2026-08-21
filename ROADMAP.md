# MapleOrigin — Roadmap

Rewritten 2026-08-14 from a full three-way code audit (gameplay systems, UI/login,
server/multiplayer). The old 2026-07 tier list is retired — everything checked off
there has been verified in code and folded into "What works today"; everything below
**To Implement** was re-verified as genuinely missing, with file evidence.

---

## What works today

A quick inventory so the to-do list below stays honest:

- **Engine**: authentic 800x600 with selectable resolutions up to 1920x1080 (SYSTEM OPTION), Alt+Enter fullscreen, 60 FPS loop, camera easing, WZ-driven everything.
- **Login**: 3-race creation (Explorer/Cygnus/Aran) with server-side name checks, world/channel select screens, logout-to-login flow.
- **Combat core**: equip/buff/passive stat aggregation, real v83 magic formula (wand/staff gated), mastery, crits, elemental multipliers, Booster attack speed, ammo consumption + shop rechargeables, invented-formula cleanup (touch damage, accuracy), EXP loss on death + revive at 50 HP + tombstone flow.
- **Mobs**: aggro/chase, WZ attack1-4 (melee/magic/ranged ball), elemental resistance, Cosmic-style respawn tick with player-scaled capacity and boss timers, mob HP gauge.
- **Physics/world**: swimming (whole-map and `swimArea` rects), prone (+prone stab), chairs with HP recovery, drop-through, fall damage, transport system (boats/trains/genie/subway/elevator with schedules, dock ships, station clocks), Direction3 job-intro cutscenes.
- **Quests/NPCs**: 2,824 quests, 708 NPC scripts + portal scripts, `#L` selections, quest helper tracker + complete alarm, quest log with forfeit, GMS-style listings, job advancement through 4th job.
- **Items**: scroll upgrades with per-instance stats, slotMax enforcement, quest-gated drops, authentic meso formula, shops with quantity dialogs + WZ sell prices, return scrolls.
- **UI windows**: inventory, equipment (+ pet equip panel), stats, skills, quest log, key config (full drag-to-bind), world map (W), minimap min/max + WORLD, chat log (collapsed/expanded), ESC game menu, system/game options, channel select (UI), character info popup, party window, cash shop, hotkey bar (all sprite digits/keys).
- **Cash Shop**: full storefront (tabs, pagination, Best Items, playable preview, try-on), NX end-to-end, rentals with expiry sweep, costume-cover cash equips, avatar megaphones, face coupons.
- **Pets**: up to 3, physics follow AI + back-riding on ropes, feeding/closeness/leveling, chat commands with WZ balloons/name tags, multi-slot pet equips (cosmetic overlays, Item Pouch/Meso Magnet loot, auto HP/MP pouches), evolution + eggs, 90-day life → doll, full persistence + sync.
- **Multiplayer**: host-model mob AI with zombie-host revalidation + reregister, drops/pickups/reactors relay, chat + emotes + megaphones, remote pets, party system (create/invite/kick/leader/EXP split, cross-map roster), Henesys PQ (client-side event instance), level-up/death sync, remote logging, server clock sync.
- **Persistence**: SQLite with per-instance equip_data JSON, NX, SP by tier, keymap, quests + mob progress, autosave (30s/map change/disconnect/beforeunload) hardened with invalid-map, level-regression, and empty-wipe guards.

---

## To Implement

### Tier 1 — done 2026-08-21

Speed/jump wired (`pos.speedScale/jumpScale`, GMS caps 140/123), `checkForLadder`
uses `nGet`, weapon-shot skills consume `bulletConsume`/`bulletCount` rounds, the
`createHitEffect` placeholder is gone (v83 has no spark on a plain swing), and the
natural HP/MP recovery tick exists (10 HP + Improving HP Recovery while standing
still, 3 MP + `skillLv/10 × level` with Improving MP Recovery, Endure on ropes).

### Tier 2 — done 2026-08-21

Server drop ledger with server-issued ids, first-claim arbitration and v83
owner/party locking (15s) + 3-minute expiry; monotonic `save_seq` per character
(stale saves rejected, client fast-forwards) and SIGINT/SIGTERM save-all;
host-gap damage requests buffered and replayed to the next host (dead
`monster_damage` path deleted); buff relay (`player_buff`, remote cast art,
`remoteBuffs` on remote characters); rooms keyed by (world, channel, map) for
every broadcast/host/ledger, `change_channel`, world-scoped megaphones and
party invites.

### Tier 3 — done 2026-08-21 (with deferrals)

Trade (server-settled escrow, v83 meso fee), buddy list + whispers (R, `/w`,
`/find`), party polish (persistent character-keyed parties with offline grace,
HP gauges in-window and on-map, party chat) and party buffs (range-checked,
`affected` art), fame (Character Info FAME row → raise/drop, v83 limits), and
guilds (Heracle/Lea scripts, window, invite/expel/ranks/notice/titles/expand/
emblem designer, guild chat, name-tag looks).

Deferred inside Tier 3: guild alliances, Guild BBS/ranking/GP, the GUILD
CONTRACT co-signing scroll, buddy groups/TALK/NOTE/BLOCK, whisper via the
party window's buttons beyond the bridge, Trade's BtReset.

### Tier 4 — World fidelity

1. **Mob skills** — no `MobSkill.img` support: heal, summon, poison, stun,
   seduce, dispel, stat-ups, reflect (`Monster.ts` parses only attack1-4).
2. **Summons** — no player summons at all (Puppet, Silver Hawk, Golden Eagle...).
3. **Portals** — hidden portals (types 10/11) render permanently instead of
   revealing on proximity; touch portals (3/9) require Up instead of triggering
   on contact; Mystic Door (6) unhandled (`Portal.ts`).
4. **Map seats** — `Obj.ts:50` parses and discards `seat` nodes; town benches
   unusable (chair system exists — extend the sit action to map seats). Sitting
   is also never broadcast to other players.
5. **Ice/slippery maps** — per-map `info/fs` friction never read (`Physics.ts`).
6. **Weather effects + fieldLimit** — no snow/rain overlays; `fieldLimit`
   bitflags unenforced (jump-down/teleport/potion restrictions).
7. **Reactor scripts** — reactors run a full WZ state machine but drops come
   from a static table; no reactor ACT script engine, no generic event/mob-spawn
   reactors (HenesysPQ's are hand-coded).

### Tier 5 — Content

1. **More party quests** — only Henesys PQ exists; Kerning PQ and Ludi PQ port
   cleanly onto the same event-instance template (`Events/HenesysPQ.ts`).
   Longer-term: server-authoritative instances (today the leader simulates and
   members are inferred "passengers").
2. **Quest system gaps** — requirement checks still missing: pet/tameness,
   monster book, FIELD_ENTER, INFO_NUMBER/INFO_EX, buff; reward actions missing:
   buff, pet, Info; "choose one" reward selection UI (quiz chain final reward).
3. **~23 PQ/event NPC scripts** — blocked on event-instance coverage beyond HPQ.
4. **Cash Shop leftovers** — gifting/wishlist/packages (deliberate v1 cuts),
   SEARCH ITEM (button is a stub), Water of Life pet revival (dead pets are
   permanent dolls today).
5. **Per-job skill depth** — mechanics engine is done (damage/buffs/passives/
   projectiles/cooldowns); remaining are the special-case skills: summons
   (Tier 4.2), party buffs (Tier 3.4), map/door skills (Mystic Door), Dark Sight
   invisibility rules, Recovery-family passives (Tier 1.5).

### Tier 6 — UI fidelity polish

1. **Tabs** — inventory (`InventoryMenuSprite.ts:576`) and cash shop draw tabs
   as colored rounded rects; the WZ `Basic.img/Tab` pieces are already loaded
   and unused. Skill/quest/party windows do it right — copy them.
2. **Tooltip plates** — six copies of a custom navy fillRect panel (equip
   tooltip, inventory, equip window, skill window, shop, cash shop). Extract one
   shared plate renderer; v83 ships no UIToolTip frame in this version, so keep
   the current look but stop duplicating it.
3. **Minimap** — inner `#2a2a2a` fillRect backdrop + Arial map names; no NPC
   list (BtNpc) panel.
4. **Small fillRect offenders** — skill-window scrollbar track, quest-log
   checkbox/row highlight, party selected-row highlight, chat-log backdrops.
5. **Font** — prose is Arial everywhere; WZ bitmap digits are used only for
   numbers. Evaluate a v83-style webfont/bitmap pass (deliberate decision, not
   an accident — `UIQuestAlarm.ts:28` documents it).
6. **Login polish** — character delete has no confirmation dialog
   (`UILogin.ts:450`); world list is hardcoded client-side (server endpoint
   exists, never called); channel choice never sent (ties to Tier 2.5).
7. **Dead code cleanup** — `UINpcTalk` is never shown (superseded by
   UIQuestDialog); the `Net/` binary protocol stack is unused (keep as Cosmic
   port reference or delete); ESC menu `skin` action is a stub.

### Tier 7 — Long term: the Cosmic port

Move authority server-side (the client is fully trusted today — any client can
save arbitrary stats/mesos/NX): server-side movement validation, mob AI, damage
validation, drop tables, quest state, skills. The `Net/` v83 binary protocol
stack and the HeavenClientNX path are the reference points. Until then the
JSON-over-WS relay stays the trust model, by design.

---

## Suggested attack order

1. ~~Tier 1 sweep~~ done.
2. ~~Drop registry + save sequencing~~ done (all of Tier 2).
3. ~~Trade + whispers/buddy~~ done.
4. ~~Party buffs → party HP bars~~ done.
5. **Mob skills + summons** (Tier 4.1-4.2) — the last big combat-fidelity gap.
6. **Portals/seats/ice/weather** (Tier 4.3-4.6) — world polish batch.
7. **Kerning PQ** (Tier 5.1) — proves the event template generalizes.
8. **UI fidelity pass** (Tier 6) — tabs first, then the shared tooltip plate.
