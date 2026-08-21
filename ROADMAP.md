# MapleOrigin — Roadmap

Updated 2026-08-21. A 1:1 recreation of pre-Big Bang MapleStory v83 in the browser.

## What exists

**Engine**
- 800x600 authentic view, selectable resolutions up to 1920x1080, Alt+Enter fullscreen
- 60 FPS loop, camera easing, maps end at their VR (letterboxed beyond it)
- Everything rendered from WZ data; backgrounds scaled for large viewports, world-locked layers drawn 1:1

**Login**
- Explorer / Cygnus / Aran creation, server-side name check
- World and channel select, character delete confirmation, logout

**World**
- Footholds, ladders/ropes, swimming (whole-map and `swimArea`), ice friction, prone
- Portals: the full type table, hidden portals, contact portals, Mystic Door
- Seats/chairs, drop-through, fall damage, `fieldLimit` gates
- Transport: boats, trains, genie, subway, elevator with schedules
- Weather items, reactors with Cosmic's ACT scripts, item-triggered reactors (Zakum's altar)
- Job-intro cutscenes

**Combat**
- Stat aggregation from equips, buffs and passives; v83 physical and magic formulas; mastery, crits, elements
- Mob AI: aggro, chase, WZ attacks, elemental resistance, respawn tick, boss timers, mob skills and player diseases
- Mobs hit by their frame's `lt/rb` box; fake monsters and revive stages (Zakum)
- Skills: damage/buffs/passives/projectiles/cooldowns, hit boxes, per-level stances, all cast-effect layers, Final Attack, summons, party buffs
- Death: EXP loss, revive, tombstone

**Items**
- Inventory, equipment, scroll upgrades with per-instance stats, slotMax, quest-gated drops
- Shops, return scrolls, potions and cure potions, pets (3 at once, equips, feeding, evolution, life)
- Storage Keeper: per-account, per-world, 4 slots, mesos, keeper fees
- Cash Shop: storefront, NX, rentals, costume equips, megaphones, face coupons

**Quests and NPCs**
- 2,824 quests, 708 NPC scripts, selections, quest tracker and log, job advancement to 4th job
- Default NPC talk (`d0`/`d1`), hair/face/skin salons, Pet Command Guides

**UI** (all WZ-drawn)
- Inventory, equipment, stats, skills, quest log, key config, world map, minimap, chat log
- Game menu, system/game options, channel select, character info
- Cash Shop, storage, trade, party, buddy, guild, monster book, hotkey bar

**Social and multiplayer**
- Host-model mob AI with reassignment, drop ledger with owner locks, reactor relay
- Chat, whispers, megaphones, emotes
- Trade (server-settled), buddy list, guilds (create, ranks, emblem, chat), fame, parties (EXP split, HP bars, party buffs)
- Henesys PQ, remote pets, buff relay, level-up/death sync
- Rooms keyed by world + channel + map

**Persistence**
- SQLite: characters, inventory with instance data, skills, quests, keymap, storage, social tables
- Autosave every 30s, on map change, disconnect and shutdown; stale-save rejection; wipe guards

## What's missing

**Priority 1 — stabilise the 08-21 build**
- Play-test every window and effect shipped on 08-21 (one session already found ~20 defects)
- Script-spawned mobs in the host relay — unblocks Zakum for parties, reactor mobs, mob summons

**Priority 2 — bosses**
- Boss HP gauge for multi-part bosses; Zakum's drops and expedition instance
- Horntail, Pianus, Papulatus on the same trigger chain

**Priority 3 — skills**
- Dark Sight, Rush-style charges, bowman Final Attack arrow, player stun/seduce
- Sweep 3rd/4th job of the other four classes with a level-200 test character

**Priority 4 — content**
- Kerning PQ and Ludibrium PQ on the event-instance template
- Quest checks: pet tameness, monster book, field enter, info numbers, buffs; "choose one" rewards
- ~23 PQ/event NPC scripts blocked on event coverage

**Priority 5 — leftovers**
- Storage slot expansion and FIND button
- Guild alliances, BBS, GP; buddy groups; Cash Shop gifting, wishlist, item search; Water of Life
- Mob poison mist and hard-skin skills; mobs aggroing Puppet; reactor touch scripts

**Long term — the Cosmic port**
- Move authority to the server: movement, mob AI, damage, drops, quests, skills
- `Net/` binary protocol and HeavenClientNX are the reference points

## Known deferrals

- Monster Magnet is cosmetic on a non-host client (mob positions belong to the host)
- Storage has no expansion SKU in the v83 Cash Shop data
- Font stays Arial (GMS used Arial through GDI; no web font reproduces the hinting)
- The VR letterbox is a choice; the block in `MapleMap.render` flips it back
