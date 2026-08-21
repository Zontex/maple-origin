# MapleOrigin — Roadmap

Rewritten 2026-08-14 from a full three-way code audit; Tier 4b and the attack order updated 2026-08-21 after the first play-testing session (gameplay systems, UI/login,
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
- **Storage Keeper**: the v83 Trunk at all 25 keepers — per-account, per-world ledger on the server (4 slots, meso balance, first-take-out-wins, disconnect-save mirror), Npc.wz `trunkPut`/`trunkGet` fees, untradeable/quest items refused.
- **Salons & guides**: `cm.sendStyle` hair/face/skin picker with live character previews (34 scripts), Pet Command Guides readable from the ETC tab, scriptless NPCs say `d0` until you have helped them (`d1`).
- **Bosses**: item-triggered reactors (Zakum's altar eats an Eye of Fire after the 5s offering delay), fake-monster bodies that turn real when their parts die, `revive` stages, mobs hit by their frame's `lt`/`rb` box so multi-part bosses are fought part by part, budgeted frame decoding for 12MB mobs.
- **Warrior 3rd/4th job**: box-targeted melee skills, Crusher stances, Sacrifice/Power Crash/Rush as attacks, Dragon Roar %HP, Final Attack procs, Monster Magnet pull, every `effectN` cast layer with alpha fades, cure potions.
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

### Tier 4 — done 2026-08-21 (with deferrals)

Mob skills (`MobSkill.img`: heal, summon, stat-ups, immunity/reflect, the
player diseases with v83's two-disease cap), player summons (generic from the
skills' `summon` stances — hawks/eagles, Puppet, dragons, Ifrit/Elquines,
Octopus/Gaviota, Phoenix/Frostprey, Beholder), the full portal type table
(`ph`/`psh` hidden-portal reveal, contact portals), Mystic Door in both rooms,
map seats + remote chairs, `info/fs` ice friction, `fieldLimit` bits with their
gates, Cash Shop weather items, and Cosmic's 292 reactor ACT scripts through a
new `ReactorScriptEngine`.

Deferred inside Tier 4: mob poison mist (131), 134-136, hard skin (142); mobs
do not aggro the Puppet; a player joining after a mob-summoned mob appeared
doesn't see it until it dies; weather `stateChangeItem` map buffs; reactor
`touch()` scripts (no touch detection); script-spawned mobs are local to the
breaking client.

### Tier 4b — done 2026-08-21 (play-testing session; with deferrals)

Found by actually playing the 08-21 build with a level-200 Dark Knight
(`Spearman`, admin account, Bera): the Storage Keeper (`server/handlers/
storage.js`, `UI/UIStorage.ts`), the avatar style picker, Pet Command Guide
reader, `d0`/`d1` default-talk semantics, PQ scripts rerun with a null-safe
event instance (Amon), world-locked background layers drawn 1:1 (Zakum's lava
was covering the floor on large viewports), black outside a map's VR, and the
whole Zakum chain — item-triggered reactors with the 5s delay, fake body,
arm-release, revives, per-frame hit boxes, decode budget. Skill fixes: `lt/rb`
hit boxes for melee skills, per-level `action`, attack classification for
MP-spending damage levels, `effectN` layers + `a0/a1` fades, Final Attack,
Monster Magnet, Dragon Roar/Sacrifice HP rules, 3rd-job SP tier, cure potions.

Deferred inside Tier 4b: storage slot expansion (no v83 Commodity SKU — the
Cash Shop's `BtExTrunk` stays informational, `expandStorage()` is the server
hook) and the storage FIND button; bow/crossbow Final Attack (a follow-up
arrow); Rush's forward charge and Dragon Roar's stun; Monster Magnet on a
non-host client is cosmetic (mob positions are host-authoritative); Zakum and
every script-spawned mob are single-client until the host relay carries
script spawns (also Tier 4's deferral); the VR letterbox is a choice — flip
the block in `MapleMap.render` if stretched sky is preferred; `Stats.tiersFor`
and `SkillData.getJobTierFileIds` are still two copies of one rule.

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
   projectiles/cooldowns/hit boxes/Final Attack); the warrior spear line is
   play-tested through 4th job. Remaining special cases: Dark Sight
   invisibility rules, Rush/Assaulter-style charges, the bowman Final Attack
   arrow, Monster Magnet relay, stun/seduce from player skills, and a pass
   over the other four classes' 3rd/4th-job skills with the same method
   (level-200 test character → cast everything → read the WZ for what's
   special-cased).
6. **Boss fights beyond the spawn** — Zakum spawns and is fought part by part
   on one client; needed next: script-spawned mobs in the host relay, boss
   HP gauge for multi-part bosses, the expedition/event instance so Amon's
   real branches run, Zakum's drops/`explosiveReward`, and the same chain for
   Horntail/Pianus/Papulatus (all item- or NPC-triggered).

### Tier 6 — done 2026-08-21

WZ tab plates in the inventory and cash shop, one shared tooltip plate
(`UI/UIToolTipPlate.ts`), the minimap's fillRect backdrop dropped (the 9-patch
already paints the interior; v83 ships no NPC-list art), selection bars and
checkboxes from WZ, buff icons blink instead of a timer bar, character delete
confirmation from `Login.img/Notice/text/13`, the world list from the server
(20 channels from the art), CHANGE SKIN drawn disabled (no skin set exists in
UI.wz), `UINpcTalk` removed, `Net/` kept as the documented Cosmic-port
reference.

**Font decision (6.5): keep Arial.** GMS rendered text with Arial through GDI
(HeavenClient loads arial.ttf at 11/12/13/14/15/18 px); the WZ has no text
font beyond the Memo window's bitmap strips and the digit strips. What differs
from v83 is GDI's unhinted small-size look, which no web font reproduces. Only
follow-ups: audit any player-visible `monospace` sites, pin sizes to the
11/12/13 set with bold where v83 used A11B/A12B, and add Liberation Sans as a
metric-compatible fallback for platforms without Arial.

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
5. ~~Mob skills + summons~~ done.
6. ~~Portals/seats/ice/weather~~ done.
7. **Keep play-testing the 08-21 build** — the first session with a real
   player found ~20 defects in an afternoon (Tier 4b); the Tier 3 social
   windows, Tier 4 summons/mob skills and the Storage/style/guide dialogs
   are still only sprite-laid-out. A level-200 test character per class is
   the cheapest way to sweep skills (Dark Knight exists on Bera).
8. **Script-spawned mobs in the host relay** — unblocks Zakum for a party,
   reactor-spawned mobs for everyone, and the Tier 4 mob-summon deferral.
9. **Kerning PQ** (Tier 5.1) — proves the event template generalizes.
10. ~~UI fidelity pass~~ done.
