# MapleWeb Development Guide

## Project Vision
A 1:1 recreation of pre-Big Bang MapleStory v83 — both client and server — running entirely in the browser. The client is TypeScript/Canvas, the server will be ported from [Cosmic](https://github.com/P0nk/Cosmic) (Java v83 emulator) to TypeScript/JS.

## Quick Start

### Client
```bash
cd TypeScript-Client
npm install
npm run dev          # Vite dev server at http://localhost:5173
```

### Server (auth + multiplayer + persistence)
```bash
npm install
npm run dev          # WebSocket + SQLite server at http://localhost:3001
# Login: admin / admin
```

### WZ Conversion
```bash
# Convert v83 .wz binary files to JSON (requires Node.js)
cd tools/wz-parser && npm install && npx coffee -c parser/*.coffee && cd ../..
node tools/wz-to-json.js 83/UI.wz TypeScript-Client/public/wz_client/UI.wz/
# Repeat for all 17 .wz files
```

### Tools
```bash
npm run build        # Production build
npm run serve        # Preview production build
tsc --noEmit         # Typecheck without emitting
python3 tools/wz_explorer.py  # WZ asset explorer at http://localhost:5555
```

## Critical Rules

### NEVER build custom UI — always use WZ assets
- All UI elements (dialogs, buttons, panels, scroll frames, name tags, etc.) MUST be rendered using images from the `.wz` JSON files
- Do NOT create HTML DOM overlays (divs, styled elements) for in-game UI
- Do NOT draw custom rectangles/backgrounds with canvas fillRect for UI panels
- The original MapleStory client renders everything from WZ sprite data — this project must do the same
- Use `UI.wz/Basic.img` for common buttons (BtOK, BtCancel, etc.) and dialog frames (Notice, Notice4)
- Use `UI.wz/Login.img` for all login/character select UI elements

### WZ Node Access Patterns
- `WZNode.nGetImage()` returns an `HTMLImageElement` — but its `.width`/`.height` may be 0 until loaded async
- For layout calculations, use known pixel dimensions from WZ data or hardcode them, do NOT rely on `img.width/img.height` immediately after `nGetImage()`
- WZ node properties are stored with `n` prefix: `width` → `nWidth`, `height` → `nHeight`, `value` → `nValue`
- `nGet(key)` returns child node by name; returns empty node if not found (not null)
- `nGetImage()` should ONLY be called on `$canvas` tagged nodes — calling it on `$imgdir` nodes causes corruption
- WZ node structure: `$imgdir` = directory, `$canvas` = image, `$int`/`$string`/`$float`/`$vector` = properties
- Nested access pattern: `node.nGet('parent').nGet('child').nGetImage()` — verify each level is a canvas before calling nGetImage
- Example gotcha: `pageR/0` is an imgdir containing canvas `0`, so need `nGet('pageR').nGet('0').nGet('0').nGetImage()`

### Canvas Coordinate System
- Canvas internal resolution = 800x600 (authentic v83, from Config.ts); CSS scales the canvas to the window keeping 4:3 — canvas coords and CSS pixels differ by that scale factor
- Canvas drawing coordinates and CSS pixel coordinates may NOT match if canvas is scaled
- For UI elements that need text input, prefer canvas-rendered keyboard capture over HTML `<input>` elements — HTML inputs don't align with canvas coordinates
- `GameCanvas.drawImage` uses `sw`/`sh` (not `sWidth`/`sHeight`) for source crop
- `GameCanvas.drawText` supports `align: 'center'`

### Login Map Structure
The login screen is a single tall vertical map (`UI.wz/MapLogin.img`) with sections at different Y positions:
- **Login Screen**: Camera at `{ x: -370, y: -305 }`
- **World Select**: Camera at `{ x: -375, y: -900 }`
- **Character Select**: Camera at `{ x: -375, y: -1525 }`
- **Create Character**: Camera at `{ x: -375, y: -3325 }`
- Camera transitions use easing via `Camera.setTopLeft()` + `Camera.update()` called every frame in GameLoop

## Architecture Overview

### Client (TypeScript-Client/src/)

```
Core Engine
├── main.ts              → Entry point, loads WZ assets, starts game loop
├── GameLoop.ts          → 60 FPS update/render loop
├── GameCanvas.ts        → Canvas rendering, mouse/keyboard input
├── Camera.ts            → Viewport with easing transitions
├── Config.ts            → Resolution (800x600 — authentic v83; CSS scales canvas to window at 4:3)
├── StateManager.ts      → Game state machine (login → map)
├── Timer.ts             → Frame timing

Game Objects
├── MapleCharacter.ts    → Full character sprite composition (body/head/hair/face/equips)
├── MyCharacter.ts       → Player singleton with stats/inventory
├── MapleStandingCharacter.ts → Login screen character preview
├── Monster.ts           → Enemy AI, HP, drops, animations
├── NPC.ts               → NPC rendering, dialogue, taxi
├── MapleMap.ts          → Map loading (footholds, backgrounds, tiles, objects, portals)
├── Portal.ts            → Map transitions
├── Background.ts        → Parallax scrolling
├── Tile.ts / Obj.ts     → Map layer rendering

Systems
├── Physics/             → Gravity, collision, climbing, jumping
├── Stats/               → Damage formulas, AP system, accuracy/evasion
├── Inventory/           → 5-tab inventory, items, mesos
├── DropItem/            → Loot drops, pickup, randomization
├── Projectile/          → Arrows/stars, targeting, collision
├── Audio/               → BGM and SFX
├── Effects/             → Damage numbers
├── Pet/                 → Pet entity, follow AI, commands, feeding, equips (see Pet System)
├── Shop/CashShopData.ts → Cash Shop catalog (Commodity.img), expiry helpers, face coupons

Quest System
├── Quest/QuestData.ts       → Parses Quest.wz (QuestInfo, Check, Act, Say), name lookups, format codes
├── Quest/QuestManager.ts    → Player quest state, mob kill tracking, forceStart/forceComplete
├── Quest/QuestScriptEngine.ts → Executes backend quest scripts via new Function(), manages qm API, item name cache

NPC Script System
├── NpcScriptEngine.ts       → Executes backend NPC scripts (708 files) via new Function(), manages cm API

UI (all rendered from WZ assets)
├── UI/UILogin.ts        → Login flow (4 substates)
├── UI/UIMap.ts          → In-game HUD (HP/MP/EXP bars)
├── UI/MapleButton.ts    → WZ sprite buttons
├── UI/UINpcTalk.ts      → NPC dialogue
├── UI/UIQuestDialog.ts  → Quest dialog (static + script-driven modes)
├── UI/TaxiUI.ts         → Transportation dialog
├── UI/Menu/             → Inventory, Stats, Equipment, Quest Log windows (draggable)
├── UI/UIMiniMap.ts      → Minimap with cached offscreen rendering
├── UI/CashShopUI.ts     → Full-screen Cash Shop overlay (playable preview, buy flow)
├── UI/UIAvatarMegaphone.ts → Avatar megaphone dialog + top-right banner
├── UI/DebugDrag.ts      → F9 debug positioning tool

Networking
├── mysocket.ts          → WebSocket client (multiplayer sync, mob host, drops, reactors)
├── Net/                 → Packet serialization, encryption, login packets

Data
├── wz-utils/            → WZManager, WZNode (JSON-based WZ parsing)
├── Constants/           → ExpTable, Jobs, EquipType, DropData
```

### Server (server.js + server/ modules)
Node.js WebSocket server with authentication, persistence, and multiplayer:

**Authentication & Persistence (SQLite via better-sqlite3):**
- `server/db.js` — SQLite schema (users, characters, inventory_items, equipped_items, quests)
- `server/models/User.js` — register (bcrypt), login, validation
- `server/models/Character.js` — CRUD, save/load with inventory+equipment+quests, per-world character list
- `server/worlds.js` — v83 world list (Scania, Bera, Broa, Windia, Khaini, Bellocan, Mardia, Kradia)
- Auto-save on disconnect, map change, every 60s, browser close, server shutdown (SIGINT/SIGTERM)
- Default login: `admin` / `admin` (registration disabled)

**Multiplayer Relay:**
- Player join/leave/update synchronization (position, stance, animation)
- **Mob host system** — one player per map runs mob AI, broadcasts state; server tracks `mapHosts` map and handles host assignment/reassignment
- Item drop/pickup relay — drops broadcast to all players, pickups remove items on all clients
- Reactor hit/destroy/respawn relay
- Chat message relay with map-based filtering
- Level up and contact damage event relay
- Rate limiting (only `player_update` throttled, all other messages always processed)
- Remote logging — `client_log` messages from browser clients printed to server console

### Server (planned — Cosmic port)
Port of [Cosmic](https://github.com/P0nk/Cosmic) Java v83 emulator to TypeScript:
- Authoritative game logic
- Server-side validation
- Quest/skill/job systems
- Map instance management

### WZ Data (TypeScript-Client/public/wz_client/)
22,000+ JSON files converted from original MapleStory WZ archives:
- `Character.wz/` — Body, head, hair, face, equipment sprites
- `Map.wz/` — Map data, tiles, objects, footholds
- `Mob.wz/` — 1,567 monster sprites and data
- `Npc.wz/` — 6,965 NPC sprites
- `UI.wz/` — All UI elements, login screen, status bars
- `String.wz/` — Name lookups (mobs, NPCs, items, maps)
- `Item.wz/` — Item sprites and data
- `Skill.wz/` — Skill effects and data
- `Sound.wz/` — BGM and SFX
- `Effect.wz/` — Visual effects

## Key WZ Asset Locations

### UI Assets
- `UI.wz/Basic.img` — Common buttons (BtOK, BtCancel, BtOK2, BtCancel2), dialog frames (Notice, Notice2-5), scrollbars, cursors
- `UI.wz/Login.img` — Login UI: CharSelect, WorldSelect, NewChar, Common
- `UI.wz/UIWindow.img` — In-game windows: Item (inventory), Shop, etc.
- `UI.wz/ChatBalloon.img` — Chat balloon 9-patch pieces

### Character Assets
- `Character.wz/0000200X.img` — Body by skin color (X=0-11)
- `Character.wz/0001200X.img` — Head by skin color
- `Character.wz/Hair/000XXXXX.img` — Hair styles
- `Character.wz/Face/000XXXXX.img` — Face styles
- `Character.wz/{Cap,Coat,Pants,Shoes,Glove,Weapon,...}/` — Equipment

### String Lookups
- `String.wz/Mob.img` — Monster names by ID
- `String.wz/Npc.img` — NPC names by ID
- `String.wz/Eqp.img` — Equipment names (nested structure)
- `String.wz/Consume.img` — Consumable item names by ID (e.g., `2010000` → "Apple")
- `String.wz/Etc.img` — ETC item names by ID
- `String.wz/Ins.img` — Setup/Install item names by ID
- `String.wz/Cash.img` — Cash item names by ID

## Character Rendering Pipeline
1. `MapleCharacter.load()` loads body, head, hair, face, equipment from Character.wz
2. `getDrawableFrames(stance, frame, flipped)` composes all layers into z-sorted drawable array
3. Each frame has `{ img, x, y, z }` — draw at `pos + frame offset - camera`
4. Equipment attached via `attachEquip(slot, itemId)` — loads from Character.wz subdirectories
5. Stances: stand1, walk1, jump, alert, dead, ladder, etc.
6. Default character: hair 30030, face 20000, skin 0, equips: 1040002 (top), 1060002 (bottom), 1302000 (weapon)

## Code Style Guidelines
- **Naming**: Use PascalCase for classes/interfaces, camelCase for variables/methods
- **Formatting**: 2-space indentation, semicolons required, single quotes for strings
- **Typing**: Explicit types for function parameters and returns; avoid `any` where possible
- **Classes**: One class per file named after the class; factory methods use `fromOpts`/`fromWzNode`
- **Imports**: Group imports by source (internal/external); avoid wildcard imports
- **Error Handling**: Use try/catch blocks for async operations; log with console.error
- **Comments**: JSDoc for public methods; inline comments for complex logic
- **Constants**: Store in dedicated files within Constants directory
- **Organization**: Group related functionality in directories (UI, Physics, etc.)

## WZ Converter Tool
`tools/wz-to-json.js` converts v83 `.wz` binary files to JSON format:
```bash
node tools/wz-to-json.js <input.wz> <output_dir>
```
- Uses `tools/wz-parser/` (MapleStory-node-resources) for WZ parsing
- Outputs `$imgdir`/`$canvas`/`$$` JSON format with base64 PNG images and MP3 audio
- JSON property naming: use `value` (not `nValue`), `x`/`y` (not `nX`/`nY`) — WZNode constructor adds the `n` prefix
- Supports pixel formats: form 1 (BGRA4444), form 2 (BGRA8888), form 513 (BGR565)

### Background Type Mapping (Critical)
| Type | Tile X | Tile Y | Velocity |
|------|--------|--------|----------|
| 0 | no | no | none |
| 1 | yes | no | none |
| 2 | no | yes | none |
| 3 | yes | yes | none |
| 4 | yes | no | scroll X |
| 5 | no | yes | scroll Y |
| 6 | yes | yes | scroll X |
| 7 | yes | yes | scroll Y |

## Debugging Tips
- **F9 key** toggles DebugDrag mode — shows green boxes around registered UI elements, click to select (turns red), drag to reposition, offset logged to console
- When positioning UI elements, use DebugDrag to find correct offsets, then hardcode them
- Check browser console for errors
- Use `console.log` for object state inspection
- ~97 pre-existing TypeScript errors (not from our code) — check only for new errors in modified files
- `npm run dev` uses Vite with hot reload

## Common Pitfalls
- `drawImage` parameter `sw`/`sh` NOT `sWidth`/`sHeight` — wrong names silently ignored, draws full image
- `nGetImage()` on non-canvas WZ nodes corrupts rendering — always verify node type
- HTML inputs positioned in CSS pixels don't align with canvas-drawn elements when canvas is scaled
- Camera easing means `setTopLeft` doesn't jump instantly — `Camera.update()` must be called every frame
- `MyCharacter.load()` is async — must await before rendering character sprites; it also re-attaches equipment from `equippedItemIds`
- WZ `charInfo2` image already contains stat labels (JOB, LV, STR, etc.) — only draw values, not labels
- Login map backgrounds repeat vertically — the map extends well below y=-3000
- **Circular dependency**: `MyCharacter → MapleCharacter → Physics → MapleMap → Monster → mysocket → MyCharacter`. Broken by lazy-loading MapleMap in Physics.ts via `_setMapleMap()` registration pattern.
- **NPC click priority**: NPCs with scripts AND quests — if only in-progress quests exist, run NPC script directly (handles warps, shops). If available/completable quests exist, show GMS-style quest listing with "ETC" for conversation.
- **Quest script re-run bug**: Do NOT re-run startscripts when quest is in-progress (state=1) on the start NPC. The start script already ran — the NPC's own script should handle the next action.
- **Job loading**: Use `stats.setJobId(id)` not `stats.jobId = id` — the setter also updates `jobType` and `job` name.
- **Item count across stacks**: `QuestManager.getItemCount()` must sum ALL matching stacks, not just the first one.
- **Format codes**: `#t` and `#c` regexes need `#?` (optional closing hash) — some quest texts omit the closing `#`.
- **Map name resolution in NPC scripts**: `preloadMapNames()` must scan for all 6-9 digit numbers in script text, not just `#m<id>#` patterns — scripts build map codes dynamically via string concatenation.
- **Consume protection**: Only items 2000000-2049999 (potions/food) are consumable via double-click. Cards, arrows, scrolls, throwing stars must be blocked.
- **Korean quest filter**: Skip quests with Hangul characters (`\uAC00-\uD7AF`) in names — KMS quests not localized for GMS. Also skip medal quests (29xxx) and event quests (19xxx).
- **Player equipment sync**: `sendPlayerInfo` and `sendPlayerUpdate` must include `equipped` array. Remote characters use this to render correct gear. Equipment changes detected via key comparison in `handlePlayerUpdate`.

## Quest Script Engine
Quest scripts (`TypeScript-Client/public/scripts/quest/*.js`, ~258 files, originally from the Cosmic v83 emulator) are plain JavaScript that run client-side via `new Function()`. The Cosmic backend reference copy has been deleted — `public/scripts/` is the only location. Cosmic's DB seed data (shops, drops, etc.) is preserved in `tools/cosmic-db-data/`.

### Script Pattern
All scripts follow this structure:
```javascript
var status = -1;
function start(mode, type, selection) { /* dialog flow for quest start */ }
function end(mode, type, selection) { /* dialog flow for quest completion */ }
```
- `status` tracks the current dialog page
- `mode`: 1 = forward/accept, 0 = back/decline, -1 = close
- `type`: 0 = navigation, 1 = accept/decline or yes/no
- The engine builds the script closure ONCE per conversation and calls its start/end (NPC: start/action) functions on each interaction — ALL top-level vars (`status`, `selectedMap`, `town`, ...) persist naturally for the whole conversation, like the original server's per-conversation script instance. Do NOT re-run the source per interaction: patching only `status` back in resets helper vars (this sent Phil's cab passengers to the defaultMap instead of their chosen town).

### Critical: Dialog Button Mode Rules
- **Single-button dialogs (`sendNext`, `sendPrev`, `sendOk`) ALL send `mode=1`**. The button label is cosmetic — the single action always advances the script forward.
- **Multi-button dialogs (`sendNextPrev`, `sendAcceptDecline`, `sendYesNo`)** have two buttons: forward (mode=1) and back (mode=0).
- Getting this wrong causes scripts to loop forever or never reach reward-giving status values.

### Critical: `sendX` + `dispose()` in Same Call
Some scripts call `qm.sendNext("message")` followed by `qm.dispose()` in the same status block (e.g., Roger's Apple HP check). This means "show a final message, then close." Handle by showing the message as a one-shot OK dialog — the next user click closes it.

### qm API Mapping
| Script method | Maps to |
|---|---|
| `qm.sendNext/sendPrev/sendNextPrev/sendOk/sendAcceptDecline/sendYesNo` | UIQuestDialog with appropriate buttons |
| `qm.gainItem(id, count)` | `inventory.addToInventory(id, count)` |
| `qm.gainExp(amount)` | `character.addExp(amount)` |
| `qm.forceStartQuest()` / `qm.forceCompleteQuest()` | QuestManager force methods (bypass checks) |
| `qm.haveItem(id)` | `questManager.getItemCount(id) >= 1` |
| `qm.getPlayer().getHp()` | `character.hp` (NOT `character.stats.hp`) |
| `qm.getPlayer().updateHp(n)` | `character.hp = n` (NOT `character.stats.hp = n`) |
| `qm.dispose()` | Close dialog |

### Character Property Locations
- HP/MP are on `character.hp`, `character.mp`, `character.maxHp`, `character.maxMp` (direct properties)
- Stats (level, job, STR, DEX, etc.) are on `character.stats.level`, `character.stats.job`, etc.
- Inventory is `character.inventory` with `.equip`, `.use`, `.etc`, `.setup`, `.cash` arrays

### Item Inventory Type Mapping
Use `Math.floor(itemId / 1000000)` to determine inventory tab:
- 1 = Equip, 2 = Use, 3 = Setup, 4 = ETC, 5 = Cash
- Do NOT use the second digit of the item ID — this was a bug that caused items to go to wrong tabs

### Item Consumption
- Double-click on Use tab items triggers consumption
- Item `spec` data in WZ: `hp` (flat HP), `mp` (flat MP), `hpR` (% of maxHp), `mpR` (% of maxMp)
- Sound effect: `Sound.wz/Item.img/02000000/Use`

### Equipment System
- **Equipment window** (`UI/Menu/EquipMenuSprite.ts`) — draggable paper doll window, toggled with E key or t-shirt status bar button
- **`MapleCharacter.equippedItemIds: Record<number, number>`** — tracks which item ID is in each slot
- **`MapleCharacter.equippedItemIcons: Record<number, HTMLImageElement>`** — cached icons for equip window display
- **`attachEquip(slot, itemId)`** — loads Character.wz visual data, stores item ID, loads icon
- **`detachEquip(slot)`** — removes visual + tracking + icon
- **Equip**: double-click item in inventory Equip tab → determines slot via `getEquipSlotForItem()`, swaps if occupied
- **Unequip**: double-click slot in equip window → creates `Item.fromOpts()` and adds to `inventory.equip[]`

### Equipment Slot Mapping
| Prefix (itemId/10000) | Slot | Directory | Type |
|---|---|---|---|
| 100 | 0 | Cap | Hat |
| 101 | 1 | Accessory | Face Accessory |
| 102 | 2 | Accessory | Eye Accessory |
| 103 | 3 | Accessory | Earring |
| 104, 105 | 4 | Coat/Longcoat | Top |
| 106 | 5 | Pants | Bottom |
| 107 | 6 | Shoes | Shoes |
| 108 | 7 | Glove | Gloves |
| 109 | 9 | Shield | Shield |
| 110 | 8 | Cape | Cape |
| 111 | 11 | Ring | Ring |
| 112 | 16 | Accessory | Pendant |
| 113 | 18 | Accessory | Belt |
| 114 | 15 | Accessory | Medal |
| 130-170 | 10 | Weapon | Weapon |
| 190, 193 | 19 | TamingMob | Mount |
| 191 | 20 | TamingMob | Saddle |

### Equipment Item Icons
- Equip items (category 1) live in `Character.wz/{Dir}/0{itemId}.img`, NOT `Item.wz`
- Icons at `node.info.iconRaw` or `node.info.icon` (prefer iconRaw)
- `Item.load()` handles equip items separately — routes to `Character.wz` based on `equipDirMap`

### Inventory UI Grid
- Background: `UIWindow.img/Item/backgrnd` (175×289)
- Grid: 4 columns at x=[9, 45, 81, 117], 6 rows at y=[51, 85, 119, 153, 187, 221], cell size 32×32
- Scrollbar area: x=152-170 using `Basic.img/VScr` assets
- Tab labels: `UIWindow.img/Item/Tab/enabled|disabled/<0-4>` (WZ text images)
- Item quantity digits: `Basic.img/ItemNo/0-9` (WZ sprite digits)

### Minimap System
- `UI/UIMiniMap.ts` — renders once to offscreen canvas (cached), only player/other player dots drawn per frame
- Map data from `MapleMap.wzNode.miniMap` — canvas image, width, height, centerX, centerY
- Coordinate formula: `minimapX = (worldX + centerX) * canvasWidth / mapWidth`
- Frame: `UIWindow.img/MiniMap/MaxMap` 9-patch (cached to avoid per-frame tiling)
- Icons: `Map.wz/MapHelper.img/minimap` (user, another, npc, portal)
- Map marks: `Map.wz/MapHelper.img/mark/<markName>` (38×38 icons like Henesys, Perion)
- Toggle: M key, auto-loads on map change via `MapleMap.load()` → `UIMiniMap.loadMapData()`

### Quest Item Rules
- Quest items (items required by active quests) cannot be dropped from inventory
- Check both `reqs.complete.items` and `reqs.start.items` for active quests

### v83 Beginner Stats
- Level 1 Beginner: HP=50, MaxHP=50, MP=5, MaxMP=5
- Do NOT use lower values — many quest scripts check `getHp() >= 50`

### NPC Dialog Auto-Close Menus
When any NPC/quest dialog opens, all UI menus (inventory, stats, quest log) should be closed automatically via `MapStateInstance.closeAllMenus()`.

## NPC Script Engine
NPC scripts (`TypeScript-Client/public/scripts/npc/*.js`, ~683 files, originally from the Cosmic v83 emulator) run client-side via `new Function()`. The Cosmic backend reference copy has been deleted — `public/scripts/` is the only location.

### Script Pattern
NPC scripts follow this structure:
```javascript
var status = 0;
function start() { cm.sendNext("dialog text"); }
function action(mode, type, selection) { /* dialog flow */ }
```
- `start()` is called first, then `action()` on each subsequent user interaction
- `status` tracks the current dialog page
- `mode`: 1 = forward, 0 = back, -1 = close
- `selection`: index from `sendSimple` selection menus

### cm API Mapping
| Script method | Maps to |
|---|---|
| `cm.sendNext/sendPrev/sendNextPrev/sendOk/sendAcceptDecline/sendYesNo` | UIQuestDialog with appropriate buttons |
| `cm.sendSimple(text)` | Selection dialog with `#L<n>#option#l` parsed into clickable options |
| `cm.warp(mapId)` | `fadeToBlack()` + `changeMap(mapId)` |
| `cm.gainItem(id, count)` | `inventory.addToInventory(id, count)` |
| `cm.gainExp(amount)` | `character.addExp(amount, true)` (with IncEXP effect) |
| `cm.gainMeso(amount)` | `character.inventory.mesos += amount` |
| `cm.haveItem(id)` | `questManager.getItemCount(id) >= 1` |
| `cm.getPlayer()` | Player object with getHp/getMp/getLevel/getJob/getName etc. |
| `cm.dispose()` | Close dialog |

### NPC Click Flow (MapleMap.handleClick)
1. Check for quest scripts (QuestScriptEngine) — scripted quests with startscript/endscript
2. Check for quest listings — if NPC has available/in-progress/completable quests, show combined dialog with category headers
3. If NPC also has a script, add "ETC" section with conversation option in the quest listing
4. If no quests, try NPC script (NpcScriptEngine) — `tryNpcScript(npc)`
5. Fallback (authentic v83): shop → open ShopUI; else show the NPC's default dialogue `d0`/`d1` lines from `String.wz/Npc.img` as a paged dialog (`showDefaultNpcTalk`); NPCs with no d-lines say nothing at all — never a made-up "Hello"

### NPC Default Dialogue (String.wz/Npc.img)
- `n0`, `n1`, ... — overhead chat balloon lines; the pool an NPC actually uses is listed by key in `Npc.wz/<id>.img/info/speak` (values like "n0", occasionally "d0"). NPCs without an `info/speak` node show no balloon.
- `d0`, `d1`, ... — default click-dialogue pages (682 of 1733 NPCs have them, max 2). Shown as sendNext(d0) → sendOk(d1); single d0 → sendOk. Lines use standard format codes (`#p`, `#t`, `#b`) so they render through `stripScriptCodes` + UIQuestDialog.

### sendSimple Selection Parsing
`sendSimple` text contains `#L<index>#<label>#l` patterns for selectable options:
- `parseSelections()` extracts these into `SelectionOption[]` with `index` and `label`
- Remaining text becomes the dialog body
- Selection clicks send `(mode=1, type=4, selection=index)` back to the script

### Quest Listing in NPC Dialog
When an NPC has quests, a combined dialog shows quest categories with WZ header images:
- `UIWindow.img/UtilDlgEx/list0` (123x15) — "QUEST IN PROGRESS"
- `UIWindow.img/UtilDlgEx/list1` (105x18) — "QUEST AVAILABLE"
- `UIWindow.img/UtilDlgEx/list2` (19x12) — "ETC" (for NPC conversation option)
- `UIWindow.img/UtilDlgEx/list3` (179x14) — "QUEST THAT CAN BE COMPLETED"
- Quest names are clickable blue text with bullet dots (•)
- Clicking a quest opens the appropriate quest start/complete/inProgress dialog
- If NPC also has a script, "ETC" header + conversation link appears at the bottom

### Quest Completion Dialog (GMS behavior)
- Last page shows quest text + reward section (REWARD!! icon, EXP/meso/fame/item icons)
- Button is `UtilDlgEx/BtOK` ("OK"), NOT `Quest/BtOK` ("ACCEPT")
- Clicking OK completes the quest and closes immediately — no extra "Quest completed!" page

### Quest Reward Display
Reward icons loaded from `UIWindow.img/QuestIcon/`:
- `QuestIcon/4/0` (73x16) — "REWARD!!" header
- `QuestIcon/6/0` (48x16) — fame label
- `QuestIcon/7/0` (49x16) — meso label
- `QuestIcon/8/0` (43x17) — EXP label
Item rewards render the actual item icon from `Item.wz/<category>/<prefix>.img/<paddedId>/info/icon` with "x<count>" text.

### Inline Image Format Codes
Quest/NPC scripts embed images in dialog text via format codes:
- `#f<wzPath>#` — render WZ image inline (e.g., `#fUI/UIWindow.img/QuestIcon/4/0#` = REWARD icon)
- `#v<itemId>#` — render item icon inline
- `#t<itemId>#` — item name (resolved from `String.wz/Consume.img`, `Eqp.img`, `Etc.img`, etc.)
- `#i<itemId>#` — render item icon inline (same as `#v`)
- `#c<itemId>#` — current item count in player inventory
These are parsed into `\x01ITEM:id\x02` and `\x01QICON:id\x02` markers by the strip functions, then rendered as actual images by UIQuestDialog's draw method.

### Format Code Resolution Timing (Critical)
- `#t` and `#c` codes are **deferred** — `stripFormatCodes()` in QuestData.ts preserves them as-is during construction (item names aren't loaded yet)
- They are resolved at **display time** via `resolveItemCodes()` after `ensureItemNames()` has loaded the name cache
- All display sites must call `resolveItemCodes()`: UIQuestDialog.buildPages(), accepted yes/no text, QuestLogMenuSprite description
- `#i` and `#v` codes are converted to `\x01ITEM:id\x02` markers at strip time and rendered as images at draw time

### Item Name Lookup
`ensureItemNames()` in QuestData.ts loads names from `String.wz/{Consume,Eqp,Etc,Ins,Cash}.img` into a global cache using `extractItemNames()` which recursively walks nested structures (Etc.img has `Etc/<id>`, Eqp.img has `Eqp/Accessory/<id>`, `Eqp/Armor/<id>`, etc.). Called lazily from UIQuestDialog.show() and QuestScriptEngine.begin(). Access via `getItemNameSync(itemId)` or `resolveItemCodes(text, questManager)`.

### String.wz Nested Structures
- `Consume.img`, `Ins.img`, `Cash.img` — flat: `<itemId>` children directly
- `Etc.img` — nested: `Etc/<itemId>`
- `Eqp.img` — deeply nested: `Eqp/{Accessory,Armor,Cap,...}/<itemId>`
- Must use recursive extraction — cannot assume flat structure

### Item Icon Loading
Item icons are at `Item.wz/<category>/<prefix>.img/<paddedId>/info/icon` where:
- `paddedId` = item ID zero-padded to 8 digits (e.g., `02010000`)
- `prefix` = first 4 digits of padded ID (e.g., `0201`)
- `category` = `Math.floor(itemId / 1000000)`: 1=Equip, 2=Consume, 3=Install, 4=Etc, 5=Cash

### addExp Effect Rules
`character.addExp(exp, showEffect)`:
- `showEffect = false` (default): silent EXP gain — used for mob kills
- `showEffect = true`: plays IncEXP sound + animation — used only for quest/NPC rewards
- Prevents the quest completion sound/animation from playing on every mob kill

### Physics Reset on Map Change
After warp/map change, physics state must be reset:
- `pos.vx = 0`, `pos.vy = 0` — clear velocity
- `pos.fh = null`, `pos.lf = null` — clear foothold references
- `pos.isClimbing = false` — clear climbing state
- Player lands naturally on the nearest foothold (like the original game)

### Quest Random Rewards (prop system)
In `Act.img/<questId>/1/item/<n>`, each item can have a `prop` field:
- `prop > 0` → random reward item — server picks ONE at random from all prop items
- `prop = 0` or absent → always given (guaranteed reward)
- `count = -1` → item removal (quest item cleanup, always applied)
- Implementation: `QuestManager.completeQuest()` separates prop items from guaranteed, randomly picks one prop item. `UIQuestDialog.getDisplayRewardItems()` shows only the picked item (not all options).

### Spawn Position on Map Change
1. Try named portal (if `portalName` specified)
2. Try any spawn portal (`type === 0`)
3. Fall back to any portal regardless of type
4. Fall back to center foothold (`getCenterFootholdLocation`)
5. Fall back to map center coordinates

## Multiplayer Architecture

### Host-Client Model
One player per map is the **mob host** — runs mob AI locally and broadcasts state to all other players. Non-host players disable local AI and render received state via lerp interpolation.

### Server Role (`server.js`)
- **Message relay** — not authoritative, just routes messages between clients
- **Host tracking** — `mapHosts` Map tracks which playerId is host per mapId
- **Host assignment** — `assignMapHost(mapId, newJoinerId)` called on player join, disconnect, map change
- **Rate limiting** — only `player_update` messages throttled (16ms); all other messages (drops, pickups, damage, reactors) always processed

### Network Messages
| Message | Direction | Purpose |
|---------|-----------|---------|
| `player_update` | Client→Server→Others | Position, stance, flipped, attacking (~30/s) |
| `player_info` | Client→Server | Initial registration with character data |
| `player_joined/left` | Server→Clients | Player enters/leaves map |
| `mob_host_assign` | Server→Client | `{ isHost: boolean }` — tells client their host role |
| `mob_state_batch` | Host→Server→Others | Array of `{ oId, x, y, stance, frame, flipped, hp }` (~15/s) |
| `mob_damage_request` | Non-host→Server→Host | `{ oId, damage, knockbackDir }` |
| `mob_death` | Host→Server→Others | `{ oId }` — triggers death animation on non-hosts |
| `mob_respawn` | Host→Server→Others | `{ oId }` — triggers mob spawn on non-hosts |
| `item_drop` | Client→Server→Others | `{ dropId, itemId, amount, x, y, vx, vy }` |
| `item_pickup` | Client→Server→Others | `{ dropId }` — removes drop on all clients |
| `reactor_hit` | Client→Server→Others | `{ oId }` — plays hit animation on all clients |
| `reactor_respawn` | Host→Server→Others | `{ oId }` — resets reactor on all clients |
| `player_level_up` | Client→Server→Others | Triggers level up animation on remote player |
| `player_hit_by_mob` | Client→Server→Others | `{ damage, isMiss }` — shows damage indicator on remote player |
| `chat_message` | Client→Server→Others | `{ message }` — shows chat balloon above remote player |
| `client_log` | Client→Server | Debug logging — prints to server console |

### Remote Entity Pattern
Both `MapleCharacter` and `Monster` have an `isRemote` flag:
- **`isRemote = true`**: Skip local AI/stance logic, lerp position toward `_targetX`/`_targetY`, receive stance from network
- **`isRemote = false`**: Run normal local AI/physics
- Set at spawn time based on `(window as any).__mySocket?.isMobHost`
- Also enforced in `handleMobStateBatch` (forces `isRemote = true` on first batch received)

### Deterministic Entity IDs
- Mobs and reactors get `oId` from their **spawn index** in the WZ data
- Since all clients load the same WZ map data in the same order, `oId` values match across clients without network coordination
- Used for all network references instead of type ID (since maps can have multiple mobs of same type)

### Item Drop Sync Rules
- **Mob drops**: Host creates drops, broadcasts via `sendItemDrop`; non-host receives and creates visual drops
- **Inventory drops**: Dropping player creates drop + broadcasts; other players see it
- **Pickups**: Picking player calls `goToPlayer()` + broadcasts `sendItemPickup`; other clients animate pickup and remove drop
- **Reactor drops**: Hitting player creates drops; quest-gated drops (`questId > 0`) stay local-only; non-quest drops broadcast to all
- Each drop gets a unique `_netDropId` (Date.now + random) for cross-client identification

### Item Tooltip System
- Hover over inventory slots to see tooltip with item name, icon, and description
- Description loaded from `String.wz` via `getItemDescSync()` (cached alongside item names in QuestData.ts)
- Supports `#c...#` format codes rendered in orange (e.g., "Cannot be traded or dropped")
- Positioned below-right of hovered slot; flips if near screen edge
- Dark blue/purple background matching original MapleStory tooltip style

### Remote Logging
- `mysocket.installRemoteLogging()` hooks `console.log/warn/error` to also send `client_log` messages to server
- Server prints them with cyan `[CLIENT <id>]` prefix
- Catches `window.error` and `unhandledrejection` events
- Enables debugging without opening browser DevTools (which slows the game loop)

## Cash Shop System
- **Entry**: SHOP status-bar button → `UI/CashShopUI.ts`, a full-screen overlay inside MapState (NOT a StateManager state — the world keeps ticking so a mob-host player in the shop doesn't freeze mobs for everyone). ESC or EXIT returns; HUD buttons are snapshot-hidden/restored; ShopBgm swaps in/out.
- **NX currency** is client-authoritative like mesos: `Inventory.nx` accessor (setter fires requestSave), `gainNX()` clamped; rides the save payload, `characters.nx` column, and both restore paths. BtCharge grants +10,000 NX free.
- **Catalog**: `Shop/CashShopData.ts` parses `Etc.wz/Commodity.img` (8,941 entries) once. Tab mapping (label-verified off the baked strip): 1=MAIN (OnSale), 3=EQUIP, 4=USE (cat 2 + cat 5 minus pet stock), 5=SET-UP, 6=ETC, 7=PET (live pets + food + pet equips + Rock of Evolution, deduped by itemId preferring OnSale SKUs), others show the NoItem plate. Packages ≥9000000 excluded (no names exist).
- **Rentals**: `Period` days → `equipData.expireAt`; `sweepExpiredCashItems` runs in both restore paths before `_restoreComplete` (nulls expired items, dollifies pets, strips expired pet equips, detaches expired worn gear).
- **Cash equips** land in the CASH tab and wear as costume covers (slot base+100) over real gear — stats untouched.
- **Avatar megaphone** (`UIAvatarMegaphone`): CSNotice dialog → server `broadcastToAll` → top-right banner with the sender's look standing on the baked shadow (origin-anchored frames so only the tiger shakes).
- **Face coupons** 5160000-5160014 map to Face.wz expressions via `FACE_COUPON_EXPRESSIONS` (no WZ mapping field exists — pairing is by name); double-click or key binding fires the emote, never consumed.
- **Best items** rail: server tallies `cash_buy_log` per item (`cash_shop_sales` table), `get_best_items` returns top 5.
- **Icon loading**: pets are the ONLY whole-.img-per-item type (`Item.wz/Pet/<unpadded id>.img`); everything else is `<first4>.img/<8-digit>`. `_kickIconLoad` and `Item.load()` both special-case this.

## Pet System
Full v83 pets: up to 3 simultaneous, follow AI on real Physics, feeding/closeness/leveling (cap 30), chat commands, pet equips, evolution, 90-day life. Module: `src/Pet/` (PetConstants, PetWzData, Pet, PetCommands, PetManager, PetOverlayUI).

### Architecture invariants (do not break)
- **All pet state lives in the cash-tab item's `equipData` blob**: petName, petLevel, closeness, fullness, dead, summoned, petEquips, lifeUsedSec, expireAt (= life clock from `info/life` days at purchase; permanent pets have none). Zero DB schema — rides serializeTab → `inventory_items.equip_data`. PetManager mutates the live blob in place; the 30s autosave persists it.
- **Pet positions are NEVER sent over the network.** Remote pets run the same follow AI against the lerped remote owner. Only the roster `pets: [{itemId, name, level, equip}]` (on player_info + player_update, change-gated by `getSummonedKey()`) and one-shot `petAction {i, action, say}` sync. `server/handlers/player.js` merges an explicit field whitelist — `pets`/`petAction` must stay listed or they're silently dropped.
- Pet mutations use `Inventory.removeAt(tab, slot)`, never `removeFromInventory(itemId)` (could hit the wrong same-species pet). Pets have `getSlotMax()=1` (no WZ slotMax → the 100 default would merge two pets' blobs).
- `sweepExpiredCashItems` DOLLIFIES expired pets (`dead:true`, iconRawD in inventory, unsummonable) — never nulls a pet slot.
- `getWzNameFromInventoryId` receives 8-digit PADDED ids — the pet branch must use the numeric range 5000000-5009999 (`"05000000"[0]` is `'0'`, so the old `[0]==='5'` check was dead code).

### Behavior
- **Summon**: double-click in CASH tab (or item hotkey) toggles; `summoned` flag persists → `spawnFromInventory` re-summons after every map load (idempotent). Eggs (evolReqItemID=0) hatch on summon via the evolution roll.
- **Follow AI** (Pet.ts): walk hysteresis start>72px/stop<24px, +20% walk speed (150), ledge hop via `pos.jump()`, walks off edges freely, teleport-to-owner with `PetEff.img/<id>/warp` when >640x/350y away or stuck 3s. Train: pet i follows pet i-1; despawn splices re-chain. **Climbing: every pet hard-snaps to the owner's back** (x=owner, y=owner−8−12·i, no lerp, `hang` stance, drawn before the player so the torso covers it); remote owners climb via stance `ladder`/`rope`, not `pos.isClimbing`.
- **Fullness**: −1 every `(48−6·hungry)`s; ≤30 → hungry stance + warning; 0 → −1 closeness, despawn "went home", fullness left at 5. **Feeding**: food's WZ `spec` has `inc` + numbered petId whitelist → hungriest whitelisted pet; consumed on success AND full-refusal; +1 closeness only when below full.
- **Commands** (PetCommands.ts, hooked in UIMap chat submit, non-exclusive): normalize text → match pipe-separated `cN` aliases in `String.wz/PetDialog.img/<petId>` → interact entry band-gated by l0/l1 (bands 1-9/10-19/20-29/30) → roll `prob`% → success/fail `act` stance + dialog balloon. `interact/<i>/success|fail/<k>`: k is a VARIANT index, not a band. Level-up: ExpTable.pet thresholds, LevelUp effect + `levelup` sound.
- **Pet equips are MULTI-SLOT**: `petEquips: Record<slotKey, {id, expireAt?}>` — slot keys/cells pixel-scanned from `UIWindow.img/Equip/pet` (4×4 grid, cols x=14/47/80/113, rows y=12/45/78/111). Panel UI in EquipMenuSprite: PET EQUIP button at (97,281) on the window rim, panel docks right bottom-aligned, BtPet1/2/3 (y=150) select `PetManager.selectedPetIndex`, double-click a cell to unequip. `equipFlags` = merged info ints of ALL worn equips; cosmetic overlay (1802xxx, per-petId stance sprites with cross-petId `$uol`) from the 'equip' slot; cosmetic id rides the sync roster so remotes render it.
- **Functional equips**: Item Pouch `pickupItem` / Meso Magnet `pickupMeso` loot through `MapleCharacter.pickupDrop` — the single pickup path (never add a second); Binocular `longRange` widens the rect, Item Ignore disables. Auto HP/MP pouches drink below 50% via `inventoryMenu.consumeItem` (works with the menu closed).
- **Evolution**: Rock of Evolution 5380000 on a summoned pet with `evol` node + `petLevel ≥ evolReqPetLvl`; roll weights normalized by SUM of evolProbN (Dragons sum 100, Robos 1000 — never assume 100); `replacePetItem` rewrites the item in-place keeping the blob, petName resets to the new species.
- **No bindable pet key exists in v83** — verified against the KeyConfig icon strip (0-27 are menu plates, 54 = NPC CHAT). Don't invent a "pet" BindableAction; summon is double-click/item-hotkey only.
- Overlays: pet name tag = `UI.wz/NameTag.img/pet/<info.nameTag>` 3-slice (fallback plain tag), balloons = `ChatBalloon.img/pet/<info.chatBalloon>` 9-patch (fallback style "0"), both in the map overlay pass.
