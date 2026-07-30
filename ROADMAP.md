# MapleOrigin — 1:1 Fidelity Roadmap

Full-codebase audit (2026-07-20) comparing the current implementation against authentic
pre-Big Bang v83 behavior, using the Cosmic Java source as reference (the local `backend/`
copy has since been deleted — consult https://github.com/P0nk/Cosmic instead; its DB seed
SQL is preserved in `tools/cosmic-db-data/`).
Severity: **broken** (doesn't work) / **missing** (absent) / **inaccurate** (works but wrong vs v83).

> **Progress (2026-07-20):** Tiers 0-2 executed in commits `175ba2ad`..`20e09d1f` —
> Tier 0 bug sweep, stat aggregation (equips/buffs/passives), magic/mastery/crits/elements,
> authentic touch damage/knockback/ammo/death/attack speed, mob AI (move types, aggro,
> attacks, Cosmic respawn), quest/NPC unbreaking (#L selections, cm/qm hardening, styling,
> quest req/reward gaps), and item systems (slotMax, return scrolls, authentic drops,
> scroll upgrades, shop). Checked items below are done; *partial* notes mark remainders.

> **Progress (2026-07-30):** swim physics on `info/swim` maps; transportation system
> (`Transport/` — Cosmic boat/train/genie/subway/elevator schedules, dock `shipObj`
> rendering, station clocks); Direction3 job-intro cutscenes; GMS Quest Helper panel +
> quest-complete alarm; chat log window; mob HP gauge; quest log window overhaul (real
> VScr4 scrollbars, detail scrolling, tab states); GMS status bar (key pill row, claim,
> quickslot toggle, SHOP/TRADE/MENU/SHORTCUT); script engines now persist per-conversation
> closures (fixes cab warps); save-path hardening against invalid map ids.


---

## Tier 0 — Outright bugs (small fixes, big payoff)

- [x] **`forbidFallDown` typo** — `FootHold.ts:48` stores the flag as `this.forbid`, but `Physics.ts:101` reads `fh.forbit` (always undefined). Footholds flagged no-jump-down can be jumped through. *(broken)*
- [x] **Shop list can't scroll** — `ShopUI.ts:347` reads `(canvas as any).scrollDelta`, a property `GameCanvas` never sets (it exposes `scrolledUp`/`scrolledDown`). Any shop with >5 items has unreachable entries. *(broken)*
- [x] **Meso/fame wiped to 0 by fallback auto-save** — `server/handlers/auth.js:132-135` builds save data from `player.info` (a positional-update object that never carries meso/fame), and `Character.js:238-242` writes `mesos ?? 0`. Disconnect before the first full client save = meso/fame wipe. *(broken)*
- [x] **Inventory slot positions not stable across save/load** — client serializes with `.filter(Boolean)` (`mysocket.ts:210-211`), collapsing empty slots; items compact to the front on every login. *(inaccurate)*
- [x] **`getLocationAboveRandomFoothold` indexing bug** — `MapleMap.ts:223-228` mixes keys of horizontal footholds with `this.footholds.length`; picks nonsense footholds. *(broken)*
- [x] **Latent: `getMagicDamageAfterMonsterDefense` min uses `damageRange.max`** — `Stats.ts:331`. Dead code today but wrong when magic lands. *(inaccurate)*

## Tier 1 — Core combat correctness (biggest gameplay gaps)

- [x] **Equipment stats are never applied** — `equipItem` (`InventoryMenuSprite.ts:895-927`) only changes visuals. No STR/DEX/WATK/WDEF/HP aggregation from equips exists anywhere; combat and the stats window ignore gear entirely. *(broken — highest impact single fix in the game)*
- [x] **Buffs/passives have zero effect** — `BuffManager.getTotalPad/Acc/...` and `SkillManager.getPassiveBonuses()` are computed but never read by any damage/stat formula (`Stats.ts:18` TODO). Rage, Booster, Iron Body, Magic Guard, mastery passives etc. only show an icon. *(broken)*
- [x] **No magic attack system** — `Stats.getAttackRange` (`Stats.ts:140-144`) has no magic branch; wands/staffs use `str·4.0` physical. Magicians are unplayable. Needs authentic v83 magic formula (INT + MATK + spell mastery). *(missing)*
- [x] **Mastery hardcoded to 0.1** — `Stats.ts:123`; should come from learned mastery skills. *(inaccurate)*
- [x] **Critical hits absent** — `criticalChance/criticalDamage` set but never used; crit indicator exists but never triggers (Critical Shot/Throw dead). *(missing)*
- [x] **Elemental weakness/immunity missing** — no reading of mob elemental resistances (Cosmic `ElementalEffectiveness`). *(missing)*
- [x] **Mob combat AI missing** — mobs only wander randomly (`Monster.ts:506-524`). No aggro/chase (`firstAttack`), no mob ranged/magic attacks, no mob skills (heal/buff/poison/stun/seduce/dispel), no self-destruct, no summons/revives. *(missing — major)* — *partial: aggro/chase + WZ attack1-4 melee/magic/ball attacks done; mob skills (heal/summon/poison/etc) still out of scope*
- [x] **`moveAbility` ignored** — flying mobs fall under gravity, stationary mobs wander, no platform jumping (`Monster.ts:112, 512-513`). *(inaccurate)*
- [x] **Invented touch-damage/knockback/accuracy formulas** — touch damage `pad·(0.8–1.2)−WDEF` (`MapleCharacter.ts:1616`), knockback on any damage>0 with fixed force (`Monster.ts:448`, `Physics.ts:187` — bosses get knocked back; authentic requires ~1% max-HP damage), job-branched accuracy formula (`Stats.ts:240-260`; authentic is uniform `dex·0.8+luk·0.5`). *(inaccurate)*
- [x] **No ammo consumption** — arrows/stars never deducted; `fireProjectile` uses hardcoded `DEFAULT_PROJECTILE_ID` (`MapleCharacter.ts:1020-1047`). *(missing)*
- [x] **No attack speed model** — no weapon attackSpeed, no Booster effect; gated only by animation (`MapleCharacter.ts:670-715`). *(missing)*
- [x] **No EXP loss on death; revive HP hardcoded 100** (`MapleCharacter.ts:214, 1333, 1449`). v83 loses % EXP on death, revives at HP 50. *(inaccurate)*
- [ ] **Job advancement is a stub** — `changeJob` (`MapleCharacter.ts:510-522`) just sets ID + 1 SP; no proper advancement flow. *(inaccurate)*
- [x] **i-frame 1500ms** (`MapleCharacter.ts:212`) — authentic ~1000ms. *(minor)*
- [ ] **Melee hit effect is a `console.log` placeholder** (`MapleCharacter.ts:1052-1067`). *(missing)*

## Tier 2 — Quests / NPCs / items

- [x] **Say.img `#L` selections stripped instead of parsed** — `QuestData.ts:165-166` deletes `#L…#l` markup, so ~1112 quests show branch text mashed together with no clickable options. Fix: parse like `NpcScriptEngine.parseSelections` and route through `UIQuestDialog.selections`. *(broken — known issue, confirmed)*
- [x] **NPC script engine crashes on missing cm methods** — undefined methods throw and silently close the dialog (`NpcScriptEngine.ts:197-201`). Missing with high usage: `getQuestStatus` (11), `sendGetNumber` (19), `sendGetText` (16), `getText`/`getNumber`, `itemQuantity` (23), `hasItem` (10), `getJob` (12), `removeAll` (25), `getPlayerCount` (20), `mapMessage` (14), plus party/PQ/event/gachapon/marriage methods. *(broken)*
- [x] **Styling NPCs do nothing** — `sendStyle` ignores options (`NpcScriptEngine.ts:263`); `setHair/setFace/setSkin` are empty stubs (`:328-330`). Beauty salon dead. *(missing)*
- [x] **Scroll/upgrade system entirely absent** — no scrolling, no upgrade slots (`tuc`), no success/fail/boom; equips have no per-instance stats (`Inventory/Item.ts` holds only itemId+quantity — no flags, no expiry, no potential). *(missing subsystem)* — *partial: scrolling + per-instance stats/tuc done; flags/expiry/potential still absent*
- [x] **Use-item variety absent** — only HP/MP potions work. Return scrolls, teleport rocks, pet food, mastery books, summoning sacks, AP/SP resets all dead (`InventoryMenuSprite.ts:930-1002`). *(missing)* — *partial: return scrolls done; pet food/mastery books/sacks/AP-SP resets still absent*
- [x] **Quest requirement gaps** — item-to-start explicitly skipped (`QuestManager.ts:347`), meso, pet/tameness, monster book, INTERVAL (all repeatables become one-time!), FIELD_ENTER, INFO_NUMBER/INFO_EX, buff checks, start-date window not enforced. *(missing)* — *partial: item-to-start/meso/startDate/INTERVAL done; pet/monsterbook/FIELD_ENTER/INFO_NUMBER/buff still missing*
- [x] **Quest reward gaps** — SKILL rewards not applied (breaks skill quests/advancement), buff rewards, pet rewards, Info action; prop-item random pick is equal-weighted instead of prop-weighted (`QuestManager.ts:161-166`). *(missing)* — *partial: SKILL rewards + prop-weighted pick done; buff/pet/Info actions still missing*
- [x] **Quest-gated mob drops not filtered** — `questid` on drop entries ignored (`DropRandomizer.ts:186-197`, `Monster.ts:185-240`); quest items always drop. (Reactor path does this correctly.) *(inaccurate)*
- [x] **Meso drops faked** — flat 10-100 @ 30% only when the item table is empty (`Monster.ts:194-210`); real per-mob formula is commented out (`DropRandomizer.ts:199-215`). *(inaccurate)*
- [x] **Shop gaps** — no rechargeable stars/bullets (buy full slot at unitPrice×slotMax, recharge), no buy/sell quantity dialog (always qty 1), sell price is a custom `wzPrice/3` heuristic (`ShopData.ts:57`). *(missing/inaccurate)* — *partial: rechargeables/quantity dialogs/WZ sell price done*
- [x] **slotMax / inventory capacity not enforced** — stacks grow unbounded, inventory never "full" (`Inventory.ts:26-68`); `canHold` always true in script engines. Meso not clamped to int32 max. *(inaccurate)*

## Tier 3 — Movement / world fidelity

- [x] **Swimming missing entirely** — all swim constants dead, `flying` unreachable (`Physics.ts:26-41, 126-128`); water maps just have normal gravity. *(missing)* — *swim physics active on `info/swim=1` maps (`MapleMap.isSwimMap`)*
- [ ] **Prone/crawl missing** — `prone` stances exist in enum but never used; down key doesn't prone (`MapleCharacter.ts:1276-1279, 2033-2069`). *(missing)*
- [ ] **Ice/slippery maps** — `info.fs` per-map friction never read (`Physics.ts:36-37` only used on steep slopes). *(missing)*
- [ ] **Climb-down 2× too fast** — `slide_down_speed=300` vs authentic ~150 (`Physics.ts:45-46`); ladder/rope differ only by x-snap tolerance. *(inaccurate)*
- [ ] **Jump height** — `jump_speed=570` vs reference 555 (commented out at `Physics.ts:21`). *(inaccurate)*
- [ ] **Camera too floaty** — `easeSpeed=0.1` (`Camera.ts:57`); original follows much tighter. *(inaccurate)*
- [ ] **Hidden portals always visible** — types 10/11 drawn permanently instead of revealing on proximity (`Portal.ts:106-121, 165`). Touch portals (type 3/9) don't trigger on contact — only on up-key. Mystic Door (type 6) unhandled (`Portal.ts:86-89`). *(inaccurate/missing)*
- [ ] **Chairs/seats missing** — `Obj.ts:50-51` recognizes and ignores `seat`; no sit stance. *(missing)*
- [ ] **Weather effects, field limits missing** — no snow/rain, `fieldLimit` bitflags unread. *(missing)*
- [ ] **Respawn timing** — flat `DEFAULT_MOB_INTERVAL=7560` (`MapleMap.ts:456`) vs authentic spawn-system tick. *(inaccurate)*
- [ ] **Reactor ACT scripts missing** — drops from hardcoded table; no mob-spawn/event reactors. *(missing)*
- [ ] Edge-of-platform heuristic uses magic 50px boundary probe (`Physics.ts:293,323`); speed buff hack `speedFactor=90` (`Physics.ts:48`); `checkForLadder` no null guard (`MapleCharacter.ts:1133`). *(minor)*

## Tier 4 — UI fidelity & missing windows

**Replace custom-drawn chrome with WZ assets** (violates project rule):
- [ ] Inventory/skill tabs drawn as colored rounded rects (`InventoryMenuSprite.ts:515-548`, `SkillMenuSprite.ts:354-390`) — use WZ `Tab/enabled|disabled`.
- [ ] Tooltips are custom fillRect boxes (`InventoryMenuSprite.ts:1151-1195`, `EquipMenuSprite.ts:314-318`, `SkillMenuSprite.ts:651-658`) — use `UIToolTip.img`; equip tooltip shows only name+icon, **no stats**.
- [ ] Skill window white content fill/borders/scrollbar (`SkillMenuSprite.ts:294-315, 503-507`) — use WZ `VScr`.
- [x] Quest log highlights/bullets/checkboxes via fillRect/arc/strokeRect (`QuestLogMenuSprite.ts:436-485`). — *partial: real VScr4 scrollbars (wheel/thumb/disabled arrows), scrolling detail panel, tab active state, removed "OBTAIN SELECTIVELY" sprite misuse; category collapse icons still drawn*
- [ ] Minimap inner fill, border, Arial names (`UIMiniMap.ts:300, 313-319, 329`).
- [ ] Hotkey bar key labels/cooldown via fillText (`UIHotkeyBar.ts:251-266`) — v83 uses sprite digits.
- [ ] Pervasive: all text is Arial via `drawText` — evaluate a v83-style bitmap/webfont pass.

**Missing windows/features vs v83 client:**
- [x] Chat log window (only single input line + balloons; `UIMap.ts:165`) — *`UIChatLog`: collapsed fading overlay + expanded scrollable log from WZ pieces*
- [ ] Keyboard config window (status-bar button is a `console.log` stub); quickslot show/hide toggle now works; SHOP/TRADE/MENU/SHORTCUT buttons present but visual-only
- [ ] World map (W key; minimap WORLD button stubbed, `UIMiniMap.ts:465`)
- [x] Mob HP bar + boss HP gauge (no `MobGage` code at all) — *`UIMobGage` top-center bar from `UIWindow.img/MobGage`; boss `DualMobGauge` still missing*
- [ ] ESC system menu / options window
- [x] Minimap collapsed/normal states + min/max buttons (only MaxMap exists) — *`UIMiniMap.viewMode` max/min with collapsed title strip + header buttons; M toggles*
- [x] Quest side-notifier/tracker — *GMS Quest Helper panel (per-requirement cur/req, strikethrough) + quest-complete alarm bubble; QuestAlert/QuestClear effects on fulfillment/turn-in*
- [ ] Character info popup (double-click player), fame give UI
- [ ] Party / buddy / guild / trade / storage windows (blocked on server work, Tier 5)
- [ ] `UINpcTalk` renders only a close button; 8 open TODOs (`UINpcTalk.ts:13-20`) — mostly superseded by UIQuestDialog; consider deleting or finishing
- [ ] Shop: no quantity/confirm dialogs

**Login flow:**
- [ ] Implement Cygnus Knights / Aran creation flows — both predate Big Bang and exist in GMS v83, so the race-select screen is authentic; currently they error out (`UILogin.ts:1461-1529`)
- [ ] v83 dice-roll stat assignment at creation — computed but never shown/sent; button commented out (`UILogin.ts:643-657`)
- [ ] Character delete has no confirmation step (`UILogin.ts:393-408`)
- [ ] World list hardcoded client-side; server `world_list` endpoint exists but is never called (`UILogin.ts:180-193`)
- [ ] Channel selection is cosmetic — never sent to server

## Tier 5 — Server / multiplayer architecture

- [ ] **Save consistency** — three independent full-state replace paths (30s autosave, beforeunload, server on-close) with no version/sequence number; stale `lastSaveData` can roll back progress (`auth.js:95-105`, `mysocket.ts:300-303, 1391`). Add a monotonic save sequence + server-side merge. — *partial: all paths now reject invalid map ids (NaN/0 → keep stored map/pos), fixing the reload-teleports-to-start-map corruption; sequence numbers still missing*
- [ ] **Drop ownership/duping** — no server drop registry; two clients can both pick up the same drop (`item.js:13-17`, `mysocket.ts:1086`). Original v83 owner-locks loot to killer/party. Drop IDs (`Date.now()+random`) can collide across clients.
- [ ] **Mob host handoff gap** — between host leave and reassignment, damage requests are dropped and mob HP can resurrect/desync from stale batches (`hostManager.js:27-33`, `mob.js:47`, `mysocket.ts:1211-1250`). Server holds no mob HP truth (the `state.monsters` path is dead code).
- [ ] **World/channel partitioning** — relay filters by mapId only (`network.js:16-36`); two worlds share the same room. Channels don't exist server-side.
- [ ] **Party → trade → whispers → buddy list** — none exist (also blocks PQ NPCs, party quests, `cm.getParty` scripts, HS/party buffs).
- [ ] **Persistence gaps** — no buddy, storage, pets, guild, monster book, teleport-rock locations tables.
- [ ] **Decide fate of dead `Net/` stack** — `SessionManager`, `Cryptography`, `In/OutPacket`, `LoginPacket` implement the real v83 binary protocol but nothing uses them; keep as reference for the Cosmic port or delete.
- [ ] Client-authoritative everything (damage, saves) — acceptable for now, but note any client can save arbitrary stats (`Character.js:236-243`); revisit with the Cosmic port.
- [ ] No graceful-shutdown save on server (SIGINT handlers intentionally removed, `server/index.js:24-27`).

---

## Suggested attack order

1. **Tier 0 bug sweep** — all six are small, isolated fixes.
2. **Equip stats + buffs/passives wired into `Stats`** — one stat-aggregation layer fixes both; combat instantly feels right.
3. **Magic system + mastery + crits** — makes all five job branches playable.
4. **NPC engine missing methods + `#L` quest selections** — unbreaks hundreds of NPCs/quests cheaply (mostly stub-filling).
5. **Mob AI (aggro, moveAbility, attacks)** — biggest "feels like Maple" jump.
6. **Item systems** (scrolls, use-items, slotMax, quest-gated drops, meso formula, rechargeables).
7. **Movement fidelity** (swim, prone, ice, climb speed, camera, portals).
8. **UI pass** (WZ chrome, tooltips with stats, missing windows).
9. **Server hardening** (save versioning, drop registry, host handoff), then party/trade/social.
