# MapleWeb

A 1:1 recreation of pre-Big Bang **MapleStory v83** — running entirely in the browser. Built with TypeScript and HTML5 Canvas, rendering everything from original WZ game assets.

> All graphics and sound assets are rights reserved to Nexon. This open source project is for research and educational purposes only, with no commercial intent.

---

## Screenshots

![Screenshot 2024-03-10 at 1 18 04 PM](https://github.com/Jeck-Sparrow-5/MapleWeb/assets/162882278/a865ca04-ff39-41df-8e58-04a457825e10)
![Screenshot 2024-03-10 at 1 17 28 PM](https://github.com/Jeck-Sparrow-5/MapleWeb/assets/162882278/6231bd8f-d593-44d4-96d6-83cd72dad603)

---

## Getting Started

### Prerequisites
- Node.js v14+
- npm
- WZ game data (see below)

### WZ Data Setup
The WZ game data (~3.4GB of JSON files) is not included in this repo. You need authentic v83 `.wz` files, then convert them:

```bash
# 1. Place v83 .wz files in a folder (e.g., 83/)
# 2. Install the WZ parser
cd tools/wz-parser && npm install && npx coffee -c parser/*.coffee && cd ../..

# 3. Convert each .wz file to JSON
node tools/wz-to-json.js 83/UI.wz TypeScript-Client/public/wz_client/UI.wz/
node tools/wz-to-json.js 83/Map.wz TypeScript-Client/public/wz_client/Map.wz/
# ... repeat for all 17 .wz files (String, Quest, Etc, Character, Mob, Npc, etc.)
```

The JSON files go to `TypeScript-Client/public/wz_client/`.

### Install & Run

```bash
# Install dependencies
npm install
cd TypeScript-Client && npm install && cd ..

# Start client (dev mode)
cd TypeScript-Client && npm run dev
# → http://localhost:5173

# Start server (separate terminal)
npm run dev
# → WebSocket + SQLite on port 3001

# Login with: admin / admin
```

### Production Build

```bash
cd TypeScript-Client && npm run build && cd ..
npm start
# → http://localhost:3001
```

---

## Game Controls

| Key | Action |
|-----|--------|
| Arrow Keys | Move |
| Alt | Jump |
| Ctrl | Attack |
| Z | Pick up items |
| E | Equipment |
| I | Inventory |
| S | Stats |
| Q | Quest Log |
| M | Toggle Minimap |
| Enter | Chat |
| Esc | Close menus |

---

## What's Implemented

### Core Engine
- Original **800x600 resolution** with fullscreen CSS scaling (4:3 letterboxing)
- **60 FPS game loop** with frame timing and camera easing
- **Physics engine** — gravity, jumping, walking, climbing ropes/ladders, knockback
- **Fall damage** — triggers after 500+ pixel falls, scales with distance
- **Canvas-rendered cursor** — no DOM overlay, correct at all resolutions

### Character System
- Full **sprite composition** — body, head, hair, face, equipment layers (z-sorted)
- **Login flow** — authentic v83 login screen, world/channel select, character select with equipment preview, 3-stage character creation (race select → name → customize)
- **User accounts** — SQLite database with bcrypt authentication, character persistence (stats, inventory, equipment, quests, map position)
- **Character creation** — race selection (Explorers/Cygnus Knights/Aran), name validation, face/hair/skin/clothes/weapon/gender customization with live preview
- **Auto-save** — character state saved on map change, every 30s, on disconnect (with full inventory/equipment data), and on browser close
- **Job advancement** — first job advancement NPCs (Warrior, Magician, Bowman, Thief, Pirate) with stat requirement checks
- **Death system** — dead stance, tombstone animation + SFX, revival dialog, respawn at nearest town
- **Stats menu** with AP allocation
- **EXP and leveling** with level-up animation and sound

### Combat
- **All 16 weapon types** — swords, axes, maces, daggers, wands, staves, 2H swords/axes/maces, spears, polearms, bows, crossbows, claws, knucklers, pistols — each with correct attack stances, range, and sound effects
- **v83 damage formulas** — proper per-weapon stat multipliers (STR/DEX/LUK scaling), attack type variants (stab vs swing), monster defense reduction, accuracy/evasion hit chance, level-gap mob miss scaling
- **Projectile system** — bows, crossbows, claws, and pistols fire projectiles with auto-targeting, homing physics, and proper damage calculation
- **Weapon-range-based hit detection** with monster-width awareness, directional filtering, and per-weapon melee range
- **Randomized attack stances** — each attack picks a random stance from the weapon's stance pool for visual variety
- **Monster AI** — random patrol, boundary enforcement (clamped after physics), map-edge containment
- **Monster HP bars** — show on hit, fade after 6 seconds
- **Damage numbers** — player-hit-mob (red), mob-hit-player (violet), miss indicators
- **Reactors** — breakable map objects from Reactor.wz, multi-state hit animations, item drops (163 reactors, 1126 drop entries), quest-gated drops, respawn timers

### Maps & World
- **Map loading** — backgrounds, tiles, objects, footholds, portals from Map.wz
- **Map transitions** — 0.5s fade from black on portals, death respawn, taxi, initial load
- **Taxi system** — WZ dialog with NPC sprite, clickable destination list
- **Minimap** — WZ-rendered minimap with 9-patch frame, map mark icon, street/map name, player position dot, NPC/portal/other player icons, toggle with M key
- **Background music** from Sound.wz

### NPCs & Quests
- **NPC dialog** — centered UtilDlgEx frame, overhead 9-patch chat balloons, movement blocked during dialog
- **NPC script engine** — 708 backend JS scripts run client-side via `new Function()`, full `cm` API (dialog, warp, items, quests, cosmetics, `sendSimple` selection menus)
- **Quest system** — 2824 quests from Quest.wz, accept/decline dialog, mob kill tracking, rewards (EXP, meso, items with random prop selection)
- **Quest script engine** — 253 backend JS quest scripts, full `qm` API (sendNext/sendPrev/sendAcceptDecline, gainItem/gainExp, forceStart/forceComplete)
- **Quest log UI** (Q key) — two-panel WZ layout, Available/In Progress/Complete tabs, NPC sprites, forfeit button
- **Quest NPC indicators** — animated book icons above NPCs (available/in-progress/completable)
- **GMS-style quest listings** — NPCs with quests show combined dialog with category headers, reward display with WZ icons
- **Inline format codes** — `#f`, `#v`, `#i`, `#t`, `#c` render WZ images, item icons, item names, inventory counts inline

### Inventory & Items
- **5-tab inventory** (Equip, Use, Setup, Etc, Cash) with WZ grid alignment, rounded tab styling, scrollbar, WZ digit quantity sprites
- **Equipment window** (E key) — paper doll with 16+ equipment slots, WZ background, item icons, double-click to unequip, tooltip on hover
- **Equip/unequip system** — double-click equip tab items to wear them (with slot swap), double-click equipped items to unequip back to inventory, character visuals update in real-time
- **Item consumption** — double-click Use items for HP/MP recovery from WZ spec data (only potions/food 2000000-2049999; arrows, cards, scrolls protected)
- **NPC shops** — buy items with mesos, sell items for WZ-based prices (price/3 formula)
- **Item tooltips** — hover to see name, icon, description with `#c` colored text support
- **Drop dialogs** — WZ Notice4 frame for meso/item quantity input
- **Quest item protection** — quest items cannot be dropped
- **Item drops from monsters** — random drops + quest item drops (70% if quest requires mob, 15% otherwise)

### Multiplayer
Real-time multiplayer via WebSocket with **host-client architecture**:

| Feature | How It Works |
|---------|-------------|
| **Player sync** | Position, stance, animation, and equipment synced via lerp interpolation (~30 updates/sec) |
| **Monster sync** | Host-client model — one player per map runs mob AI, broadcasts state ~15/s to others |
| **Combat sync** | Attack animations, mob damage, and contact damage visible to all players |
| **Item drops** | Drops visible to all players, pickups broadcast and animated across clients |
| **Reactor sync** | Hit animations, destruction, and non-quest drops synced across players |
| **Chat** | Chat balloons render above remote players with proper 9-patch WZ rendering |
| **Level up** | Level up animation and sound plays for all players on map |
| **Host failover** | Automatic host reassignment when host disconnects or changes map |

### Player Chat
- Enter to type, Enter to send
- 9-patch chat balloon above character (auto-fades after 5s)
- Synced to all players on the same map

---

## Architecture

```
MapleWeb/
├── TypeScript-Client/          # Browser client
│   ├── src/                    # ~80 TypeScript files
│   │   ├── GameCanvas.ts       # Canvas rendering engine
│   │   ├── MapleCharacter.ts   # Character sprite composition
│   │   ├── MapleMap.ts         # Map loading and rendering
│   │   ├── Monster.ts          # Enemy AI, HP, drops, animations
│   │   ├── Reactor.ts          # Breakable map objects
│   │   ├── NPC.ts              # NPC rendering, dialogue, taxi
│   │   ├── mysocket.ts         # WebSocket client (auth, multiplayer, character save)
│   │   ├── Physics/            # Movement, collision, climbing
│   │   ├── Stats/              # Damage formulas, AP system
│   │   ├── Inventory/          # 5-tab inventory, items, mesos
│   │   ├── DropItem/           # Loot drops, pickup, physics
│   │   ├── Quest/              # Quest data, state manager, script engine
│   │   ├── UI/                 # All UI rendered from WZ assets
│   │   ├── Effects/            # Damage numbers, level up, IncEXP
│   │   └── wz-utils/           # WZManager, WZNode (JSON WZ parsing)
│   └── public/wz_client/       # 22K+ JSON files from WZ archives
├── server/                     # Backend server modules
│   ├── db.js                   # SQLite database (WAL mode, schema init)
│   ├── worlds.js               # v83 world list (Scania, Bera, Broa, etc.)
│   └── models/
│       ├── User.js             # Registration, login (bcrypt)
│       └── Character.js        # Character CRUD, inventory, equipment, quests
├── server.js                   # WebSocket server (auth, multiplayer relay, auto-save)
├── backend/                    # Cosmic Java v83 emulator (reference for TS port)
│   ├── src/                    # 857 Java files, 30+ game systems
│   └── scripts/                # 1,823 JS scripts (NPC, quest, portal, event)
└── tools/
    ├── wz-to-json.js           # WZ binary → JSON converter (uses wz-parser)
    ├── wz-parser/              # MapleStory-node-resources WZ parser
    ├── wz_scripts/             # XML → JSON converter (alternative pipeline)
    └── wz_explorer.py          # WZ asset browser (Flask, port 5555)
```

### Key Design Principle
**Everything is rendered from WZ assets.** No custom HTML/CSS UI, no canvas-drawn rectangles for panels. The original MapleStory client renders everything from WZ sprite data — this project does the same.

---

## TODO

### Critical Bugs (High Impact)

- [ ] **Fame reward not applied** — `Act.img` uses `"pop"` for fame but parser looks for `"fame"`. **104 quests** silently lose fame rewards. One-line fix in `QuestData.ts parseReward()`.
- [ ] **`#L` selection codes stripped in Say.img** — **530 quests** have selection-based dialog (quiz, branching choices) but `stripFormatCodes()` removes `#L`/`#l` markers, rendering them as plain text with no interactivity.
- [ ] **Item start requirements skipped** — `meetsRequirement()` has "Skip item check for now" comment. **488 quests** show as available even without required items.
- [ ] **Item removals dropped in Act.img** — `parseReward()` filters `count > 0`, silently dropping `count=-1` removal entries. 21 quests have Act-only removals not covered by Check.img.

### Quest System Gaps

#### Script Compatibility (65 broken scripts)
- [ ] **Remove `Java.type()` calls** — 33 quest scripts and 76 NPC scripts use `Java.type('client.Job')`, `Java.type('client.inventory.InventoryType')`, etc. These crash immediately with `ReferenceError`. Need to replace with JS equivalents or add shim constants.
- [ ] **Add missing `qm` API methods** — Quest scripts call methods not in `QuestScriptEngine.createQM()`:
  - `canGetFirstJob()`, `getFirstJobStatRequirement()` — Cygnus job advancement
  - `getMeso()`, `getMapId()`, `getJobId()` — direct accessors
  - `changeJob()` — job advancement (exists in NPC engine but not quest engine)
  - `getQuestProgressInt()`, `getQuestStatus()` — quest state tracking
  - `resetStats()` — stat reset for job changes
  - `getMedalName()`, `earnTitle()` — medal/title quests
  - `evolvePet()`, `getPet()` — pet evolution quests
  - `sendGetNumber()` — numeric input dialog
  - `showInfoText()`, `playSound()`, `showVideo()` — presentation
- [ ] **Add missing `cm` API methods** — NPC scripts (214 broken) call:
  - `removeAll()` (25 scripts), `itemQuantity()` (23), `sendGetNumber()` (19), `sendGetText()`/`getText()` (16/14)
  - `getPlayerCount()` (21), `mapMessage()` (14), `getNpcObjectId()` (14)
  - `hasItem()` (10) — alias for `haveItem`, trivial fix
  - `canGetFirstJob()` / `getFirstJobStatRequirement()` (10) — job advancement NPCs
  - `answerCPQChallenge()` (10) — CPQ system
- [ ] **Add missing `getPlayer()` sub-methods** — `getStr()`, `getDex()`, `getInt()`, `getLuk()`, `getSkillLevel()`, `dropMessage()`, `getPet()`, `resetStats()`

#### Data-Driven Quest Gaps
- [ ] **Format code `#m` (map name)** — shows literal "map" instead of resolved name from `String.wz/Map.img`. 371 occurrences.
- [ ] **Format code `#s` (skill name)** — not handled, raw code passes through. 379 occurrences.
- [ ] **Format code `#q` (quest status)** — not handled. 37 occurrences.
- [ ] **Format code `#a` (quest progress counter)** — stripped to nothing instead of showing actual kill/collect count.
- [ ] **Repeatable quest cooldowns (`interval`)** — 535 quests have repeat timers, not enforced. Quests can be repeated immediately.
- [ ] **`fieldEnter` auto-start** — 29 quests should auto-start when entering a map. Not implemented.
- [ ] **`normalAutoStart` on level-up** — Quests like job advancement (1048-1053) should trigger automatically at certain levels. Currently only work via NPC click.
- [ ] **Daily quest limiter (`dayByDay`)** — 63 quests, not enforced.
- [ ] **Skill requirements** — 45 quest start checks + 65 quest rewards involve skills. Neither checked nor granted.
- [ ] **Equipment requirements (`equipAllNeed`/`equipSelectNeed`)** — 13 quests, not checked.
- [ ] **Meso completion requirement (`endmeso`)** — 54 quests require meso payment to complete, not checked.
- [ ] **Fame requirement (`pop` in Check.img)** — 3 quests, not checked.
- [ ] **`infoex`/`infoNumber` progress tracking** — 78+ quests use custom progress variables, system not implemented.
- [ ] **Pet-related requirements** — 13+ quests, not implemented.

#### Missing Quest Scripts (6 files)
- [ ] `20015.js` — Greetings From the Young Empress (Cygnus Knights)
- [ ] `29002.js` — Title Challenge - Celebrity!
- [ ] `29400.js` — Title Challenge - Veteran Hunter
- [ ] `29500.js` — Title Challenge - Maple Idol Star
- [ ] `29503.js` — Title Challenge - Donation King
- [ ] `29508.js` — Outstanding Citizen

### Portal Script System (not implemented)
- [ ] **Build `PortalScriptEngine`** — 458 portal scripts exist in `backend/scripts/portal/` but are never executed. Client currently warps directly on portal contact based on WZ `tm`/`tn` fields, bypassing all script logic.
  - Quest-gated portals (e.g., "must complete quest X to enter") don't block
  - Event-restricted areas are wide open
  - Need a `pi` API similar to `cm`/`qm`: `warp()`, `playPortalSound()`, `playerMessage()`, `isQuestCompleted()`, `blockPortal()`
- [ ] **Portal script naming mismatch** — WZ maps reference portals by IDs like `001E` but scripts use semantic names like `enterDollcave`. Need to verify how these resolve at runtime.

### Script Coverage Overview

| Category | Total | Working | Broken | Notes |
|----------|-------|---------|--------|-------|
| NPC scripts | 709 | 495 (70%) | 214 | Java.type, missing cm methods |
| Quest scripts | 261 | 196 (75%) | 65 | Java.type, missing qm methods |
| Portal scripts | 458 | 0 (0%) | — | Engine not built yet |
| Reactor scripts | 292 | — | — | Many are stubs (3 lines) |
| Event scripts | 108 | — | — | Well-implemented, need event system |
| Data-driven quests | ~2,226 | ~1,304 (59%) | ~890 soft issues | Fame bug, selections, format codes |

### Existing Roadmap

#### Next Up
- [x] Equipment equip/unequip from inventory
- [x] Minimap rendering
- [x] Job advancement NPCs (quest scripts 1048-1054 written)
- [ ] Equipment stat application (STR, DEX, etc. affect damage)
- [ ] Skill system foundation (Skill.wz data, skill UI, hotkey bar)
- [x] NPC shops (buy/sell items)
- [x] Quest state persistence (SQLite)
- [ ] Facial expressions (F1-F7 hotkeys)
- [ ] Passive HP/MP regen
- [ ] Map name display on entry

#### Medium Term
- [x] Multiple map connectivity (portal network between towns)
- [ ] Party system (shared EXP, party HP display)
- [ ] Proper chat system (history, whisper, party chat)
- [x] Equipment window (paper doll)
- [ ] World map navigation

### Server Port — Cosmic (Java) to TypeScript

The full [Cosmic](https://github.com/P0nk/Cosmic) Java v83 emulator lives in `backend/` as reference for the TypeScript server port.

| Stat | Count |
|------|-------|
| Java files | 857 across 10 packages |
| Packet handlers | 147 |
| Job skill trees | 53 |
| Scripts | 1,823 (708 NPC, 253 quest, 458 portal, 292 reactor, 108 event) |
| Game systems | 30+ (guilds, marriage, PQs, cash shop, trading, etc.) |

**Phase 1** ✅ — Project scaffold, WebSocket protocol, SQLite database, bcrypt authentication, character CRUD, inventory/equipment persistence, auto-save

**Phase 2** — Server-authoritative movement, monster AI, damage validation, inventory management, drop system, EXP/leveling

**Phase 3** — Skills, job advancement, quests, parties, guilds, buddy list, trading

**Phase 4** — Portal network, boss fights, party quests, cash shop, FM, marriage, reactor scripts, events, GM commands

### Client Features Remaining

| Category | Features |
|----------|----------|
| **Combat** | Skill system, skill animations, buff/debuff visuals, multi-hit skills, summons, afterimage weapon trails |
| **UI** | Skill window, guild/buddy windows, options, cash shop |
| **World** | All Victoria Island maps, Ossyria, Masteria, world tour, Maple Island, hidden streets |
| **Polish** | Screen shake, weather effects, pets, mounts, chair sitting, medals |

### Infrastructure
- [ ] Docker deployment
- [ ] CI/CD pipeline
- [ ] Monitoring and error tracking
- [ ] Load testing for multiplayer
- [ ] Anti-exploit measures

---

## Communication with Server

The client connects to the WebSocket server automatically on login. The server handles:
- **Authentication** — login/register via WebSocket messages, bcrypt password hashing
- **Character persistence** — SQLite database stores stats, inventory, equipment, quests, map position
- **Multiplayer relay** — player sync, mob host system, item drops, chat, reactors
- **Auto-save** — characters saved on disconnect, map change, every 60s, and server shutdown

Default login: `admin` / `admin`. Registration is disabled by default.

---

## Credits

Fork of [Nodein Maple Web](https://github.com/Jeck-Sparrow-5/MapleWeb). Server emulator reference: [Cosmic](https://github.com/P0nk/Cosmic).
