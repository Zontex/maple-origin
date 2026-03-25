# MapleWeb TODO

Tasks ordered from quick wins to long-term plans. Check off as completed.

---

## Recently Completed

### Bug Fixes
- [x] **Drop/pickup reliability** — Fixed 3 bugs: `frame` null crash for mesos (setFrame never set this.frame), instant-destroy on pickup (`vy >= 0` condition), items pickable mid-air before landing
- [x] **Pickup sound missing** — PLAY_AUDIO's Set-based deduplication blocked rapid pickup sounds; replaced with timestamp throttle
- [x] **Camera not following player downward** — `bottomSafeGap` was 200 (for old 1280x720); set to 0 for 800x600
- [x] **NPC click coordinates broken** — `handleClick` used raw CSS pixels without CSS scale factor; added `scaleX`/`scaleY` division
- [x] **Character bald in dead stance** — Hair/equips have no `dead` stance in WZ data; `getParts()` now falls back to `stand1`
- [x] **Mouse cursor misalignment** — Cursor was a DOM element positioned in CSS pixels; now drawn on canvas with `drawImage`
- [x] **Scripted portal crash** — Portals with `toMap=999999999` (script-handled) caused black screen; now skipped until script engine exists
- [x] **Portal black screen** — `doneLoading` was set via setTimeout with artificial delay; removed delay so fade-in triggers immediately when map loads
- [x] **Chat input position** — DOM `<input>` positioned in CSS pixels didn't match scaled canvas; now scaled to match CSS transform
- [x] **Map transition too slow** — Skips character reload on subsequent map changes; fade duration reduced from 1s to 0.5s
- [x] **Attack range inconsistent** — Sword range was 60px (too small); increased to 80px with monster-width-aware hit detection
- [x] **Spawn position wrong on map change** — Player spawned at map center (mid-air); now uses portal 0 (town entrance) for proper foothold placement

### New Features
- [x] **Original 800x600 resolution** — Canvas at native v83 resolution, CSS scales to fullscreen with 4:3 letterboxing
- [x] **Death system** — Full sequence: dead stance → tombstone fall animation + SFX → revival dialog (UIWindow.img/Notice/0 + BtOK) → respawn at town center foothold
- [x] **NPC dialog improvements** — Centered on screen, not draggable, blocks player movement/attack while open, ESC to close
- [x] **NPC chat balloons** — Proper 9-patch rendering with canvas clip (no tile overflow), positioned above NPC head, anchored to world position
- [x] **Player chat balloons** — Enter to open chat, type message, Enter to send; 9-patch balloon above player head, auto-disappears after 5 seconds
- [x] **Map transition fade** — 0.5-second fade from black on map load, portal transitions, and death respawn; hides sprite decode flicker
- [x] **Dialog blocks input** — Player movement/attack/jump blocked while NPC dialog or taxi UI is open; ESC closes dialogs
- [x] **Taxi UI rewrite** — Replaced custom rectangle UI with proper WZ UtilDlgEx dialog frame (same as NPC dialog), NPC sprite, name tag, clickable blue destination links with dot bullets
- [x] **Fall damage** — Triggers after falling 500+ pixels; scales at 5% max HP per 100px beyond threshold
- [x] **Drop dialog (WZ)** — Item drop dialog replaced from DOM elements to WZ Notice4 frame; meso drop dialog text/button alignment fixed
- [x] **Canvas drag-to-drop** — Inventory drag uses canvas-rendered item icon at cursor (replaces DOM drag); single items drop immediately, stackable items show quantity dialog
- [x] **Quest system (client-side)** — Full quest data loader parsing 4 Quest.wz files (2824 quests); quest state manager with active/completed tracking; mob kill progress; quest rewards (EXP, meso, items); NPC→quest reverse lookup
- [x] **Quest dialog** — UtilDlgEx dialog with multi-page text from Say.img, Accept/Decline buttons (UIWindow.img/Quest/BtOK, BtNo), yes/no branching, quest completion flow
- [x] **Quest log UI** — Two-panel WZ layout (backgrnd + backgrnd2), tabs (Available/In Progress/Complete) using Item/New/Tab sprites with Quest/Tab text overlays, quest list with selection, detail panel with NPC sprite, description, mob progress, rewards, Forfeit button
- [x] **Quest NPC indicators** — Animated book icons above quest NPCs (QuestIcon/0 = available, QuestIcon/1 = in-progress, QuestIcon/2 = completable), suppresses NPC chat balloon
- [x] **Quest text formatting** — Resolves MapleStory format codes (#p = NPC names, #o = mob names from String.wz lookup tables, #b/#r/#k color codes stripped, #a progress counters stripped)
- [x] **Quest script engine** — 253 backend JS quest scripts run client-side via `new Function()`; full `qm` API (sendNext/sendPrev/sendAcceptDecline, gainItem/gainExp, forceStartQuest/forceCompleteQuest, haveItem, getPlayer); scripts copied to `public/scripts/quest/`
- [x] **Item consumption** — Double-click Use tab items to consume; reads WZ spec (hp/mp/hpR/mpR); plays Sound.wz consumption SFX; removes item from inventory
- [x] **Quest item protection** — Quest items required by active quests cannot be dropped from inventory
- [x] **Inventory type fix** — `getInventoryTypeFromItemId` now uses `Math.floor(id/1000000)` instead of broken second-digit mapping; fixes items going to wrong tabs
- [x] **Start quest rewards** — `startQuest()` now applies Act.img start rewards (items given on quest accept, e.g. Mushroom Candy)
- [x] **NPC dialog auto-close menus** — Opening NPC/quest dialog automatically closes all open UI menus (inventory, stats, quest log)
- [x] **NPC script engine** — 708 backend NPC scripts run client-side via `new Function()`; full `cm` API (sendNext/sendPrev/sendSimple/sendYesNo, warp, gainItem/gainExp/gainMeso, quest state); scripts loaded from `public/scripts/npc/`
- [x] **NPC sendSimple selections** — `#L<n>#option#l` patterns parsed into clickable blue text options; selection index passed back to script on click
- [x] **NPC quest listing dialog** — NPCs with quests show GMS-style combined dialog: category headers from UtilDlgEx (list0=IN PROGRESS, list1=AVAILABLE, list2=ETC, list3=COMPLETABLE), bullet-prefixed quest names, clicking opens quest start/complete/inProgress dialog
- [x] **Quest reward display** — Last page of quest dialogs shows REWARD!! icon (QuestIcon/4), EXP/meso/fame icons (QuestIcon/6-8), item rewards with actual item icon sprites loaded from Item.wz
- [x] **Quest completion OK button** — Complete quest dialog uses UtilDlgEx/BtOK ("OK") not Quest/BtOK ("ACCEPT"); click completes and closes immediately (GMS behavior)
- [x] **Inline image format codes** — `#f<path>#` renders WZ images, `#v<id>#` renders item icons, `#t<id>#` resolves to item names from String.wz; enables scripted quests (e.g. Roger's Apple) to show reward icons inline
- [x] **Item name lookup** — Global cache loaded from String.wz (Consume/Eqp/Etc/Ins/Cash); resolves `#t` format codes to actual names (e.g. "Apple" instead of "item")
- [x] **IncEXP effect fix** — `addExp(exp, showEffect)` only plays IncEXP sound/animation when `showEffect=true` (quest rewards); silent for mob kills
- [x] **Warp out of bounds fix** — Physics state (velocity, foothold, climbing) reset on map change; spawn logic falls back to any portal type, then center foothold
- [x] **NPC ETC conversation** — When NPC has both quests and a script, quest listing includes "ETC" header with conversation option that runs the NPC script
- [x] **Item name deferred resolution** — `#t`/`#c` format codes preserved at QuestData construction time, resolved at display time via `resolveItemCodes()` after item names loaded; fixes "item" showing instead of actual names (e.g., "Rusty Screw")
- [x] **String.wz nested extraction** — `extractItemNames()` recursively walks nested WZ structures (Etc.img/Etc/, Eqp.img/Eqp/Accessory/) to find all item names
- [x] **Quest log item names** — QuestLogMenuSprite now resolves `#t`/`#c` codes in quest descriptions
- [x] **Inline item icons (#i code)** — `#i<itemId>#` now renders item icon inline in dialog text (same as `#v`), not stripped
- [x] **Equip item icons in rewards** — Item icon loading supports equips from `Character.wz/<subfolder>` with proper ID→subfolder mapping (Cap, Coat, Weapon, etc.)
- [x] **Quest item drops from mobs** — Mobs drop quest-required items when player has active quests; 70% drop rate if quest requires this mob type, 15% otherwise; stops dropping once player has enough
- [x] **Item count type fix** — `getItemCount()` and `addToInventory()` now handle string/number itemId comparison correctly; fixes quest completion checks failing despite having items
- [x] **Remove hardcoded inventory items** — ETC tab starts empty; quest items only obtained through drops/rewards
- [x] **Remove connection status overlay** — "Connected" indicator removed from screen
- [x] **Remove mobile touch controls** — Touch joystick disabled

---

## Quick Wins (hours each)

- [ ] **Add keyboard shortcuts for menus** — I for inventory, S for stats already partially wired
- [ ] **Equipment stat application** — Equipment stats are loaded but not applied to damage calculations
- [x] **Item pickup improvements** — Fixed: null frame crash for mesos, hasLanded guard, pickup animation time increased to 500ms
- [x] **Pickup/drop SFX** — Fixed: PLAY_AUDIO deduplication was blocking rapid sounds, replaced with 50ms throttle
- [ ] **Add more SFX** — Attack sounds, portal sounds, level-up jingle (assets exist in Sound.wz)
- [x] **Monster respawn timers** — Mobs respawn 7 seconds after death at original spawn position; timers cleared on map change
- [x] **Potion use from inventory** — Double-click Use tab items to consume; HP/MP recovery from WZ spec data
- [ ] **Passive HP/MP regen** — Automatic recovery over time for beginners
- [ ] **Map name display** — Show map name on entry (String.wz/Map.img has all names)
- [ ] **Minimap** — Render minimap from Map.wz miniMap data (image + markers)
- [x] **Death and respawn** — Tombstone animation (Effect.wz/Tomb.img/fall), Tombstone SFX, revival dialog (UIWindow.img/Notice/0 + BtOK), respawn at center foothold of nearest town
- [ ] **Facial expressions** — F1-F7 expression hotkeys (simple key→animation mapping)

---

## Medium Tasks (days each)

- [ ] **Say.img quest selection dialogs (1112 quests affected)** — Many quests in Say.img use `#L<n>#option#l` selection codes for quiz/branching dialogs (e.g., Rain's Maple Quiz). Currently these are stripped to plain text. Implementation plan:
  - **Where the text comes from**: `Quest.wz/Say.img/<questId>/start/<pageIndex>` or `complete/<pageIndex>` — these are the `messages` array in `QuestDialogue`
  - **Current bug**: `stripFormatCodes()` in `QuestData.ts` (line ~73) strips `#L\d+#` and `#l` entirely, so selections render as plain text letters (I, K, S, E)
  - **What needs to change in QuestData.ts**: Parse `#L<n>#label#l` into structured data like `{ body: string, selections: SelectionOption[] }` — same `parseSelections()` pattern used in `NpcScriptEngine.ts`. Store selections per-page alongside the message text
  - **What needs to change in UIQuestDialog.ts `buildPages()`**: When a quest page has selections, set the dialog to `simple` mode with clickable options (reuse the existing selection rendering code)
  - **Selection callback**: When user clicks a selection, the quest dialog needs to check Say.img for response text. The structure is: `Say.img/<questId>/start/<pageIndex>/<selectionIndex>` — each selection has its own response text (e.g., "That's right!!" vs "K is for the Skill Window...")
  - **Branching logic**: Some selections are "correct" answers that advance the quest, others show error text and loop back. Need to parse the `yes`/`no` or numbered response children from Say.img
  - **Quest completion on correct answer**: The correct selection should advance to the next page or complete the quest. Wrong answers should show the error response and return to the question
  - **QuestDialogue structure change**: `QuestDialogue.start.messages` currently stores `string[]`. Needs to store `{ text: string, selections?: SelectionOption[], responses?: Map<number, string> }[]` instead, or a parallel array of selections per page
  - **Scale**: 1112 quest texts in Say.img use `#L` codes — this is a core feature affecting quiz quests, branching dialogs, and multi-choice conversations throughout the game (Rain's quizzes, job advancement choices, etc.)
- [ ] **Quest "select one" item rewards (prop system)** — Many quest completion rewards have multiple items with `prop=1` in Act.img, meaning the player must SELECT ONE item, not receive all of them (e.g., Todd's Hunting Method quest 1035 offers 5 different hats). Implementation:
  - **How to detect**: In `Act.img/<questId>/1/item/<n>`, items with `prop` property > 0 are selection items. Items without `prop` or `prop=0` are always given. Items with negative `count` are removed (quest item cleanup)
  - **QuestReward type change**: Add `selectable?: boolean` flag to each item in `QuestReward.items[]`. Parse `prop` field during QuestData init in `case 'item':` reward parsing
  - **UIQuestDialog change**: When reward has selectable items, render them as clickable choices (highlighted on hover, click to select). Show `QuestIcon/3/0` ("SELECT ITEM") header above them. Only the selected item should be given on quest completion
  - **Quest completion change**: `QuestManager.completeQuest()` needs to accept a `selectedItemIndex` parameter. Only give the selected item (plus any non-selectable items like EXP, always-given items, and negative-count removals)
  - **Current bug**: All 5 items show as regular rewards and none are actually given because `addToInventory` for equips may be failing silently, or the items are all given but equip tab isn't rendering them
- [ ] **Quest system polish** — Persist quest state to localStorage, extend script engine stubs (warp, teachSkill, changeJobById)
- [ ] **Skill system foundation** — Load skill data from Skill.wz, skill UI window, hotkey bar
- [ ] **Hotkey/quickslot bar** — Bottom bar for skills, potions, actions (UI.wz/StatusBar3.img)
- [ ] **Equipment from inventory** — Equip/unequip items by double-click or drag
- [ ] **NPC shops** — Buy/sell items from NPCs (UI.wz/UIWindow.img/Shop)
- [x] **Meso drop/trade** — Drop mesos on ground via WZ Notice4 dialog with canvas keyboard input
- [ ] **Multiple map connectivity** — Portal network between towns (Henesys, Ellinia, Perion, Kerning, Lith Harbor)
- [ ] **Job advancement NPCs** — Talk to job NPCs to change class (Beginner → Warrior/Mage/Bowman/Thief)
- [ ] **Proper chat system** — Chat history, whisper, party chat, ! commands
- [ ] **Party system** — Create/join parties, shared EXP, party HP display
- [ ] **World map** — UI.wz/WorldMap for navigation between areas
- [ ] **Scrolling text input** — Replace HTML `<input>` with canvas-rendered text input for chat

---

## Server Port — Cosmic (Java) → TypeScript

The full [Cosmic](https://github.com/P0nk/Cosmic) Java v83 emulator lives in `backend/`. It is the reference implementation for the TypeScript server port. Key stats:

- **857 Java files** across 10 packages (net, client, server, constants, tools, scripting, provider, database, config, service)
- **147 packet handlers** covering all client↔server interactions
- **53 job skill trees** with full constant definitions
- **1,823 scripts** — 708 NPC, 253 quest, 458 portal, 292 reactor, 108 event
- **30+ game systems** — guilds, marriage, PQs, expeditions, cash shop, trading, Gachapon, etc.

### Phase 1: Foundation
- [ ] **Project scaffold** — TypeScript server project with shared types between client/server
- [ ] **WebSocket protocol layer** — Replace Netty/AES packet protocol with WebSocket messages (JSON or binary). Port opcode structure from `backend/src/.../net/`
- [ ] **Database layer** — Character, account, inventory persistence (SQLite or PostgreSQL). Reference: `backend/database/`, Cosmic's MySQL schema auto-generated on first run
- [ ] **Authentication** — Account creation, login validation, session tokens. Reference: `backend/src/.../net/server/coordinator/session/`
- [ ] **Character CRUD** — Create, load, save, delete characters server-side. Reference: `backend/src/.../client/Character.java` (241 client files)

### Phase 2: Core Game Logic
- [ ] **Server-authoritative movement** — Validate positions, anti-speed-hack. Reference: `backend/src/.../server/movement/` (9 files)
- [ ] **Monster spawning & AI** — Server controls spawn points, timers, respawn, aggro. Reference: `backend/src/.../server/life/` (24 files), `MonsterAggroCoordinator`
- [ ] **Damage validation** — Server calculates damage, prevents hacked damage. Reference: combat packet handlers (`CloseRangeDamage`, `MagicDamage`, `RangedAttack`)
- [ ] **Item/inventory management** — Server-side inventory, prevent item duplication. Reference: `backend/src/.../client/inventory/`
- [ ] **Drop system** — Server determines drops, prevents loot hacking. Reference: `backend/src/.../server/loot/`
- [ ] **EXP/leveling** — Server awards EXP, validates level-ups. Reference: `backend/src/.../client/processor/`

### Phase 3: Game Systems
- [ ] **Skill system** — Port 53 job skill trees, skill points, cooldowns, buffs. Reference: `backend/src/.../constants/skills/` (53 files)
- [ ] **Job advancement** — Job change quests and requirements. Reference: `backend/src/.../client/Job.java`
- [ ] **Quest system** — 21 requirement types, 13 action types, 253 quest scripts. Reference: `backend/src/.../server/quest/`, `backend/scripts/quest/`
- [x] **NPC script engine (client-side)** — 708 NPC scripts now run client-side via NpcScriptEngine with full cm API. Server-side will add authoritative validation. Reference: `backend/scripts/npc/`, `backend/src/.../scripting/npc/`
- [ ] **Party system** — Server-managed parties, shared EXP, party search. Reference: `PartySearchCoordinator`, `PartyOperation` handler
- [ ] **Guild & alliance system** — Create, join, manage guilds and alliances. Reference: `GuildOperation`, `AllianceOperation` handlers
- [ ] **Buddy list** — Friends list, online status. Reference: `BuddylistModify` handler
- [ ] **Trading & economy** — Player trade, NPC shops, storage. Reference: `backend/src/.../server/Trade.java`, `Shop.java`, `Storage.java`

### Phase 4: Content & Polish
- [ ] **Portal network** — Port 458 portal scripts for full map connectivity. Reference: `backend/scripts/portal/`
- [ ] **Boss fights** — Zakum, Horntail, Pinkbean, etc. with mechanics. Reference: expedition system (6+ raids), `backend/src/.../server/partyquest/`
- [ ] **Party Quests** — KPQ, LPQ, OPQ, EPQ, CWKPQ, Monster Carnival, Mu Lung Dojo (16+ PQs). Reference: `backend/scripts/event/`, `backend/src/.../server/partyquest/` (7 files)
- [ ] **Cash shop** — Cosmetic items, pets, surprise boxes. Reference: `backend/src/.../server/CashShop.java`, cash item handlers
- [ ] **FM (Free Market)** — Player shops, hired merchants, Owl of Minerva. Reference: `HiredMerchant.java`, `PlayerInteraction` handler
- [ ] **Marriage system** — Rings, wedding ceremony, spouse features. Reference: `backend/src/.../server/Marriage.java`
- [ ] **Reactor scripts** — Port 292 reactor scripts for interactive map objects. Reference: `backend/scripts/reactor/`
- [ ] **Event system** — 108 event scripts, GM events, seasonal content. Reference: `backend/scripts/event/`
- [ ] **GM commands** — 200+ admin commands across 7 privilege levels. Reference: `backend/src/.../client/command/commands/gm0-gm6/`

---

## Client Feature Completeness

### Combat
- [x] **Melee attack range** — Weapon-range-based hit detection with monster-width awareness
- [ ] **Skill animations** — Render skill effects from Skill.wz
- [ ] **Buff/debuff visuals** — Status effect icons and character overlays
- [ ] **Multi-hit skills** — Skills that hit multiple monsters
- [ ] **Summons** — Summoned creatures that fight alongside player

### UI
- [ ] **Skill window** — Full skill tree UI with point allocation
- [x] **Quest log** — Available/in-progress/completed quests with two-panel WZ UI, NPC sprites, animated quest indicators
- [ ] **Equipment window** — Paper doll with equipment slots
- [ ] **Guild window** — Member list, guild skills
- [ ] **Buddy list window** — Friends online/offline
- [ ] **Options/settings** — Volume, keybinds, screen size
- [ ] **Cash shop UI** — Item preview, purchase flow
- [ ] **Damage skin** — Different damage number styles

### World
- [ ] **All Victoria Island maps** — Henesys, Ellinia, Perion, Kerning City, Lith Harbor, Nautilus, Sleepywood
- [ ] **Ossyria** — Orbis, El Nath, Aqua Road, Ludibrium, Omega Sector, Korean Folk Town
- [ ] **Masteria** — New Leaf City, Crimsonwood Keep
- [ ] **World tour** — Singapore, Malaysia, etc.
- [ ] **Maple Island** — New player tutorial area
- [ ] **Hidden Street maps** — Secret areas, JQ maps

### Polish
- [ ] **Screen shake** — On big hits and boss attacks
- [ ] **Weather effects** — Rain, snow from map data
- [ ] **Pet system** — Following pets, auto-loot, pet food
- [ ] **Mount system** — Riding mounts from TamingMob.wz
- [ ] **Chair sitting** — Sit in chairs for HP/MP recovery
- [ ] **Medals and titles** — Name tag decorations

---

## Infrastructure

- [ ] **Deployment** — Docker containerization, cloud hosting (Cosmic already has `Dockerfile` + `docker-compose.yml` as reference)
- [ ] **CI/CD** — Automated builds and testing
- [ ] **Monitoring** — Server health, player count, error tracking
- [ ] **Admin tools** — GM commands, player management, ban system (port 200+ commands from Cosmic)
- [ ] **Load testing** — Stress test multiplayer with many concurrent players
- [ ] **Anti-exploit** — HWID tracking, session coordination, rate limiting (reference: Cosmic's `SessionCoordinator`, `AutobanManager`)
