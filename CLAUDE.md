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

**Rooms, drops, saves (2026-08-21):**
- **Everything is scoped to a room = (worldId, channel, mapId)** — `state.roomOf(player)`/`roomKey()`. `broadcastToMap(mapId, msg, excludeId, scope)` filters by the excluded player's world/channel, or by an explicit `scope` when the record is already gone (disconnect paths). `mapHosts`, the drop ledger and the host-gap damage buffer are keyed by room string. `worldId`/`channel` land on the player at `select_character` (channel picked on the login scroll, `change_channel` in game). Megaphones are world-wide (`broadcastToWorld`); party invites resolve names within the inviter's world only.
- **Drops are a server ledger** (`handlers/item.js`): server-issued ids (the client's provisional id is acked with `item_drop_ack`), first pickup wins, v83 owner lock (killer + party, 15s) then free-for-all, 3-minute expiry (`item_expire`), joiners get `item_drops_on_map`. Clients loot optimistically and `revertPickup` on `item_pickup_denied`. Mob loot is owned by the killer (`Monster._killerNetId`, the damage-request sender when a non-host killed it).
- **Saves carry a monotonic `saveSeq`** (`characters.save_seq`): anything ≤ stored is rejected as `stale_save` with `currentSeq`, and the client fast-forwards and resends. Server-originated saves (disconnect, SIGINT/SIGTERM `saveAllConnected`) take `stored+1` themselves.
- **Feature modules register their own messages**: server `registerHandler(type, fn)` (router.js) + a `require` line in `server/features.js`; client `mySocket.on(type, handler)`. Trade, buddy, guild, fame and party chat live there, not in the router switch.
- **Buff relay**: `player_buff {skillId, on, durationMs, level}` from the local `BuffManager` (`isLocal`); remote characters keep `remoteBuffs` and play the cast art (`Skills/SkillCastEffect.ts`); `player.info.buffs` is what joiners see. `PartyManager.onMemberBuff` is the party-buff hook.

## World Fidelity (Tier 4, 2026-08-21)
- **Portal `pt` table** (`Portal.ts`): 0 spawn · 1 invisible/Up · 2 `pv`/Up · 3 touch (50×110 contact box, no Up) · 4 `pv`/Up · 5 invisible/Up · 6 Mystic Door `tp` slot · 7 `pv`/Up + script · 8 invisible script · 9 touch script · 10 `ph` reveal → like 2 · 11 `psh/<image>` reveal + script. Hidden portals keep the 87×182 `pv` entry box regardless of reveal state.
- **A Mystic Door lives in two rooms** (field + town); the server (`handlers/door.js`) is the keeper and clients `door_sync` on every map load — never infer doors. Town slot = index into the town's `tp` portals in WZ order. Refused in towns, `fieldLimit & DOOR`, no `tp`, no Magic Rock (`itemCon` on the level node), within 5s of the last cast. Art: `Skill.wz/231.img/skill/2311002/cDoor` (field) / `mDoor` (town). Buffs cast from the hotkey bypass `useSkill` — special buff-typed skills need a guard in BOTH `useSkill` and `UIHotkeyBar.activateSkill`.
- **Seats**: `Obj.seats` from the object's `seat` vectors; id `"${layer}:${objWzName}:${seatIndex}"`; `player_update` carries `chairId`/`seatId` and remotes apply via `applyRemoteSeat`.
- **`info/fs` scales BOTH walking force and ground drag** (`pos.groundFriction`, fed per frame like `speedScale`); only 0.2 exists (62 maps: El Nath, Orbis Tower ice, Dead Mine, Happyville).
- **fieldLimit bits are the client's FIELDOPT enum, not Cosmic's** (`Constants/FieldLimit.ts`): potions are 0x400 (Cosmic's 0x1000 is wrong — the WZ sets 0x400 on the 576 Mu Lung Dojo floors). `MapleMap.forbids(bit)` / `currentMapForbids()`; gates: JUMP, MOVEMENTSKILLS, CHANGECHANNEL, PORTALSCROLL, TAMINGMOB, POTIONUSE, CASHWEATHER, FALLDOWN (drop-through), SUMMON/DOOR read by their modules.
- **Map HP drain** (`info/decHP`, 123 maps): every `decInterval` ms (only Balrog's Tomb sets one; default 10s — Cassandra's Magic's own text says "every 10 seconds") the local player loses `decHP` unless `info/protectItem` is worn or a `thaw` item buff of the map's kind is up. Aqua Road: 6 HP, Oxygen Tank cape 1102061, buffs with `thaw<0` (Air Bubble 2022040 15min, Cassandra's Magic 2022187 30min); El Nath: 10 HP, Cape of Warmness 1102109, `thaw>0` (Soft White Bun 2022186 30min); water vs cold is the map's own `swim` flag (Orbis Tower B2 is water). Silent (no number/sound), goes through `takeDamage` so it can kill. `MapleCharacter.updateMapHpDecrease` / `isMapProtected`. **Timed consumable specs are item buffs** (`BuffManager.applyItemBuff`, keyed by the NEGATIVE item id, never relayed): Ciders' pad/mad, Bubble Gum's jump and `thaw` all ride `spec/time` — before this no potion buff applied at all. The cape scroll `warmsupport` (2041058) is not modelled. Monster Book cards carry `thaw`/`time` too but v83 has no card buffs.
- **Weather is WZ-driven**: `Item.wz/Cash/0512.img/<id>/info/path` picks the `MapHelper.img/weather` set (`type` 1/2 falling, 3 bursts, 4 plume; `floatType`), `String.wz/Cash.img/<id>/msg` is the banner; relayed with the sender included; map-bound, 30s.
- **Reactor breaks run `public/scripts/reactor/<id>.js act()` first** (all 292 Cosmic scripts, `ReactorScriptEngine.ts` with the `rm` API); the static drop table is only the no-script fallback; both go through `spawnReactorDrops`. Scripts with no `act()` are touch-only and drop nothing. Regenerate `asset-manifest.json` after adding scripts.
- **A reactor draws in its platform's layer** — the nearest foothold to its anchor, like mobs/NPCs (HeavenClient's `fhlayer`), EXCEPT an item-triggered reactor, whose state-0 `lt/rb` drop box says which platform it serves: the foothold inside the box's vertical span (16px slack) nearest its bottom edge, under the box's centre. Papulatus' summon beam (2201004, Origin of Clocktower) hangs mid-air between the layer-3 platform you drop the Piece of Cracked Dimension on (foothold y=-538) and the layer-5 floor; the floor was nearer, so the beam took layer 5 and painted over the player standing in it. Across all 3,278 reactor placements this rule moves only that one. Reactors draw after objects and before characters within a layer.
- **Item-triggered reactors are generic** (`MapleMap.checkItemReactors`): a reactor state with a type-100 `event` (`0`=item id, `1`=exact stack count, `lt/rb` box around the reactor) arms on a matching landed drop, lets it lie there **5 seconds** (Cosmic's `ActivateItemReactor` schedule; a pickup meanwhile cancels), then swallows it, `forceAdvance`s and runs the reactor script's `act()` — Zakum's altar 2111001 + Eye of Fire 4001017 → `reactor/2111001.js`. Henesys PQ's moonflowers are the same event type and keep their own handler (the generic pass skips while the PQ is registered). `rm.spawnFakeMonster` spawns with `fake:true` → `Monster.isFake`: drawn and animated, but no hits land, no targeting (attacks/projectiles/summons/contact/boss gauge skip it), no attacks or mob skills of its own. **Zakum**: body 8800000 is spawned fake with arms 8800003-8800010 at the altar; when the last arm dies the body turns real; a dying body spawns its `Mob.wz info/revive` ids in place (8800000 → 8800001 → 8800002). Script-spawned mobs (oId ≥100000, revives 200000+id) only exist on the client that ran the script — the host relay does not carry them yet, so Zakum is a single-client fight for now.
- **Mob skills** (`Mob/`, `Status/PlayerStatus.ts`, `handlers/mobskill.js`): only the host rolls; one relayed `mob_skill` record is replayed everywhere (stance `skill<action>` — never `attack<action>`; sound `Mob.img/<id>/Skill<N>`). `Monster.pad/mad` are accessors over buffed bases. Player diseases: cap 2, poison never kills, Darkness ×0.5 accuracy, Slow −x speed. MobSkill.img has no icons — the buff-bar slot uses the `affected` art's first frame. Stubbed: 131 mist, 134-136, 142.
- **Summons** (`Summon/`, `handlers/summon.js`): any skill with a `summon` imgdir is a summon (classed `isAttack` so MP is charged post-cast; `useSkill` diverts it first). One creature summon at a time, Puppet coexists, recast replaces; remotes run no AI; art faces left, stances alias via UOL (`collectFrames`). Summoning Rock `itemCon` is checked before anything is spent.
- **Gun effects anchor at the muzzle**: every 149xxxx gun maps `navel(0,0)` + `muzzle` (no `hand`); `getMuzzleWorldPosition()` = body navel + muzzle, mirrored with facing, from the same `mapPoints` the renderer composes. Skills with `weapon=49` set `skillEffectAnchor='muzzle'`; bullets spawn from the barrel on the recoil frame. Everything else keeps the feet anchor — the WZ art for knuckle/claw/warrior effects sits above the origin.

## UI Fidelity (Tier 6, 2026-08-21)
- Tabs: `UIWindow.img/Item/New/Tab1|Tab0/0` plates + `Item/Tab/enabled|disabled` labels (inventory at x=4+34i bottom y=42; cash shop five plates at a 30px stride over the 156px red line). `Basic.img/Tab` is the blue folder tab, not these windows'.
- One tooltip plate: `UI/UIToolTipPlate.ts` (translucent navy — `UIToolTip.img/Item/Frame` is the post-BB v140 frame and was rejected; `Item/ItemIcon/base` is used for the 82×82 icon plate). List highlight: `UI/UISelectionBar.ts` = `UIWindow.img/Teleport/select` at alpha 0.3 — the only selection art v83 ships. Minimap: the 9-patch `c` piece paints the interior; no NPC-list art exists in v83. Buff icons blink in their last 5s (no timer bar in v83).
- Login: delete confirm = `Login.img/Notice/text/13` + `Notice/BtYes|BtNo` (v83 then asked for the PIC — we have none); worlds come from `get_worlds` (fallback mirror of `server/worlds.js`), art indexed by world id, 20 channels from `WorldSelect/channel`. `GameMenu/BtSkin` is real v83 art but no skin set exists → drawn from its `disabled` frame. `src/Net/` + `SessionManager.ts` are the binary-protocol reference for the Cosmic port, imported by nothing.

## Social Systems (Tier 3, 2026-08-21)
All five live as feature modules (`server/handlers/{trade,buddy,guild,fame,party}.js` + `registerHandler`; client `mySocket.on`). Persistence is always by **characterId** — a `playerId` is only the character's current socket. Online presence for buddies/guilds/parties comes from 2s polls over `players` inside each module (no hooks in player.js/connection.js); stored requests are delivered on the client's `*_sync` sent at map load.
- **Trade** (`Trade/TradeManager.ts`, `UI/UITrade.ts`): nothing leaves a bag until `trade_complete`; items are referenced by `(tab, slot)` and settled with `removeAt`, `equipData` rides the offer; the v83 meso fee table baked into `TradingRoom/backgrnd` is real (0.8% ≥100k … 6% ≥100M, server-computed, `receive.mesos` is net); `backgrnd` is L-shaped and drawn whole; items enter by dragging out of the inventory window (UITrade claims the drop with a capture-phase mouseup); same room required; cancel on map change/death/Cash Shop/ESC.
- **Buddy list** (`Buddy/`, `UI/Menu/BuddyMenuSprite.ts`, key R = KeyConfig icon 4): rows `buddies(character_id, buddy_id, pending)` — `pending=1` on the owner's row is an incoming request and counts toward the 20 capacity; presence is mutual-only; whispers `/w name msg`, `@name msg`, `/r`, `/find`; whisper text is `#9cf59c`. Groups/TALK/NOTE/BLOCK are disabled buttons only.
- **Guild** (`Guild/`, `UI/Menu/GuildMenuSprite.ts`, key G = KeyConfig icon 17; 18 is the "TO GUILD" chat target): created through Heracle (2010007) / emblem through Lea (2010008) — their `cm` calls are implemented in NpcScriptEngine; `genericGuildMessage(1)` must defer its name dialog ~60ms because the script disposes right after. Mesos are deducted client-side on `guild_result.ok` like every meso sink. Name-tag looks: `drawName` asks `GuildManager.lookForCharacter()`, misses batch into `guild_look_request`; emblem = `{bg 1000-1030, bgColor 1-16, mark 2000-9026 (Etc = 9000-series), markColor 1-16}` composed by `Guild/GuildEmblem.ts`. Guild chat is `!text`, `#d2b4ff`. Deferred: alliances (Lenario 2010009 takes the no-union branches), BBS/ranking, GP, the GUILD CONTRACT scroll.
- **Fame** (`server/handlers/fame.js`, `UI/UIFameDialog.ts`): v83 has no fame button — clicking the FAME plate row of another player's Character Info opens the prompt (`Basic.img/YesNo3` + `CheckBox` radios + `BtOK2/BtCancel2`). Rules by character id in `fame_log`: Lv15+, one per 24h, same target once per 30 days, same room, ±1. Fame is still client-authoritative in saves, so the target applies `fame_changed` to `MyCharacter.fame` (`CharInfoMenuSprite.hookFameMessages`) — do not remove. Remote fame arrives via `fame_query`/`fame_info` and `player_info.fame`.
- **Party** (`server/handlers/party.js`, `Party/PartyManager.ts`): `parties`/`party_members` tables; disconnect ≠ leave — 2-minute offline grace (leader's expiry disbands); always go through `getPartyOf()` (it relinks by characterId). party.js registers its extra handlers inside `setImmediate` because of the router require cycle. HP gauges depend on the client's throttled `party_hp` feed (player_update never copies hp); `PartyHP` is a floating 9-patch panel at (10,280) toggled by HP MARK, not an under-name bar. Party chat `/p text` or leading `{`, `#ffc864`. Party buffs: `PartyManager.onMemberBuff` applies a member's buff when I'm inside its `lt/rb` box; echo guards = caster's job tier must own the skill and an identical remaining time is not re-applied; receivers play the `affected` art.

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

### Background parallax and the scaled sky pass
- Parallax is the original client's: `screen = bg.xy + r*(cameraCentre)/100 + view/2` (`r=-100` = pinned to the world, `0` = pinned to the screen; a scrolling axis of type 4-7 is world-locked on that axis). On viewports larger than 800x600 the back/front passes are composed at the authored size and magnified (`getBackgroundScale`, `_bgCompose`) so sky sheets still cover the view — but art with parallax ≤ -80 on BOTH axes is **world-locked** (`Background.worldLocked`, ~13k of 43k layers: Zakum's lava `ry=-95` scrolling in X, its lava rocks at -80/-80, the Ludibrium PQ room walls) and is drawn 1:1 at its world position after the scaled pass, like an object. Magnifying those moved Zakum's lava (a `front=1` layer) up over the arena floor, so players "fell into the lava" while standing on the invisible floor. Zakum's Altar has a 600px VR (-695..-95), the floor is a 1230px band of short footholds at y≈-213 over `moltenRock` tiles, and the lava's top is authored to sit right at the floor.
- **Nothing is drawn outside a map's VR.** The camera bottom-anchors a VR shorter than the viewport, and the strip above `VRTop` is painted black after the front pass (MapleMap.render) — the original client never showed past the VR, and the authored sky there is just roof pieces stopping mid-air. Only maps with a `VRTop` (all but ~0) get the mask.

## Sprite warm-up (2026-08-22)
- **A WZ canvas becomes an `HTMLImageElement` the first time `nGetImage()` runs, and `drawImage` of an image that has not loaded draws nothing.** Anything composed lazily on the draw path is therefore blank for its first renders: a character's walk/jump/attack frames the first time each comes up after login or an equip change (the "flicker while walking"), each face expression's first blink, a skill's effect/hit frames on its first cast (which also fetched and parsed the 2.7MB `Sound.wz/Skill.img` inside the cast). `Character.wz`/`Skill.wz`/`Sound.wz` are persistent in WZManager, so this is once per session per sprite — not per map.
- Fix pattern: `wz-utils/SpriteWarmup.ts` (`collectNodeImages` + `decodeImages`, sliced with `nextIdle`). `MapleCharacter.warmSprites()` composes every stance/frame through `getDrawableFrames` and decodes the parts (scheduled after `load`, `attachEquip`, `setHair`, `setFace`, debounced, generation-guarded). `Skills/SkillWarmup.ts` warms a skill's art + Use/Hit clips when it lands on the hotkey bar; `SkillCastEffect` still `preloadFrames` what it arms for unbound/remote casts; `MapleMap.load` prefetches the skill sound bank. `preloadFrames()` remains the tool for one-shot effects. In `npm run dev` the first `await import()` of a module also costs a Vite transform — that part is dev-only.

## Chairs
- **Chairs animate**: `sitOnChair` keeps every `effect/N` canvas in `chairFrames` and `updateChair` steps them by each frame's `delay` (remotes too) — Dragon Chair's 19 frames and Olivia's 16 used to freeze on frame 0. Chairs are drawn bottom-centred at the feet (`drawChair` ignores origin). Composed character frames carry `zName`/`width`/`height` so an effect can find a layer's drawn rectangle.

## Debugging Tips
- **GM/dev chat commands** live in `src/DevCommands.ts` (`runDevCommand`, `!` prefix, checked in UIMap before `!text` falls through to guild chat; `!help` lists them): help, warp/map, level, item, meso, nx, job, hp, mp, heal, ap, sp, stat, maxstats, exp, fame, skill, maxskills, buff, dispel, killall (mobs), kill [player] (yourself, or a named player via `server/handlers/gm.js` `gm_kill` → `gm_killed`, superuser checked server-side; `installGmHooks` at map load so every client listens), spawn, cleardrops, pos, mapinfo, search. They act through the game's own APIs (inventory, stats, SkillManager, BuffManager, MapleMap.spawnMonster) so saves/relays follow; `!spawn` mobs are script-spawned (oId 300000+, this client only). Add a command = one entry in the `commands` table. **Gated by `users.superuser`** (INTEGER 0/1, migrated in `server/db.js`, the `admin` account is flagged there): `User.login` returns it, `login_result` carries it, `mysocket.isSuperuser` keeps it, and UIMap consults the command table only when it is set — a non-superuser's `!killall` is just an ordinary `!text` line (guild chat), with no refusal. Flag another account with `UPDATE users SET superuser=1 WHERE username='…'`.
- **F9 key** toggles DebugDrag mode — shows green boxes around registered UI elements, click to select (turns red), drag to reposition, offset logged to console
- When positioning UI elements, use DebugDrag to find correct offsets, then hardcode them
- Check browser console for errors
- Use `console.log` for object state inspection
- ~97 pre-existing TypeScript errors (not from our code) — check only for new errors in modified files
- `npm run dev` uses Vite with hot reload

## Common Pitfalls
- **Mobs are hit where their WZ frame says** (`Monster.getHitRect` / `hitCenter`): every mob frame carries `lt`/`rb`, the body rectangle relative to the anchor (authored facing left, mirrored with the sprite). Basic attacks, skill boxes/reach, Final Attack, projectiles, summons, touch damage, damage numbers, the HP bar and impact art all use it; frames without one fall back to the drawn sprite. Zakum's eight arms share the body's anchor — only the boxes tell them apart (Arm 1: lt(-144,-400) rb(-48,-266)) — which is why hitting "the middle" used to hit every arm at once.
- **Mob frame decoding is budgeted** (`Monster.EAGER_DECODE_PIXEL_BUDGET`, 6M px ≈ 24MB): a mob under it pre-decodes every stance at spawn (no first-frame blink), one over it decodes only `stand` and then each stance on its first `setStance`. Zakum's body is ~230 frames up to 697x513 and the summon spawns nine mobs in one tick — decoding all of it eagerly (~370MB of bitmaps) lost the GPU context and tiled the screen. Mob.wz is huge (12MB JSON for 8800000); keep it lazy.
- **Viewport culling must test the sprite box, never the anchor point.** An NPC's `cy` is its feet and `x` its centre, so a tall sprite lives entirely above its own anchor — Perion's MapleTV (NPC 9250045) is 411x520 with origin (213,520). Point-testing the anchor against a margin culls it while it still fills the screen (that was the "TV disappears when you stand on top of it" bug). `NPC.isOffScreen()` tests `getBounds()`; 32 NPCs have stand sprites over 300px tall and all were affected.
- **Two-handed weapons have NO `stand1`/`walk1` node** — 322 of the 1220 Character.wz/Weapon entries (2H sword/axe/blunt 140-142, spear 143, polearm 144, crossbow 146) ship `stand2`/`walk2` only, and the body's `stand2` is what adds the `hand` part they anchor to. Anything that hardcodes `stand1` draws the character empty-handed with no error, because `nGet` returns an empty node and the layer contributes zero parts. Always pick the pose from the weapon's WZ `info/stand` / `info/walk` (`weaponStandType`/`weaponWalkType`), as MapleCharacter, ShopUI, CharInfoMenuSprite and MapleStandingCharacter now do. (The 219 entries that declare `stand=1` with no stance nodes at all are placeholder cash ids — they render nothing either way.)
- **Water is not only `info/swim=1`.** Five maps (Nautilus Generator Room 120000301, Nautilus Harbor, 108010700, 140020300, the fishing pond) have `swim=0` plus `swimArea/<name>` rects; `MapleMap.isInWater(x, y)` covers both and Physics reads it per frame. The Generator Room's only way up is a ladder whose foot (y=-56) sits just above the waterline (y1=-45): swim kicks carry you out of the water and holding Up grabs it. **Swim controls are tap-to-rise (GMS)**: a jump PRESS is one kick (`Physics.jump`, -350) and a HELD key does nothing more — you sink between kicks; down+jump drops through a submerged platform. MapState must edge-trigger `tryJump` while swimming (`canJump` is unconditionally true in water), or the held key plays the jump sound every frame and re-kicks you up the instant you drop through. A mob hit in water is a sideways push only (`hitKnockback`): the ground hop under water gravity (700 vs 2000) flew like a jump.
- **Map objects with `hide=1` are invisible until toggled.** All 50 in v83 are `signboard/market/arrow` job-advancement guide arrows tagged `sordQuest`/`bowQuest`/`magicQuest`/`thiefQuest`/`pirateQuest` (the server's field-effect tag toggle shows a trail for one quest). `Obj.visible` honours it; `MapleMap.setTaggedObjectsVisible(tag, bool)` is the toggle. 21 tagged arrows ship without `hide` (Lith Harbor's `21705` trail, one each in Henesys Market and on the Nautilus) and are visible by design. The sprite points right; `f=1` flips it left.
- **Damaging terrain exists — as OBJECT DEFINITIONS, not map placements.** `Map.wz/Obj/trap.img` (and nine other banks: trapGL, halloween, dungeon4, guild, thai, masteriaGL1, event, globalJP, halloweenGL) define objects with `obstacle=1`, `damage=N` (flat HP, calibrated for the map's level: Pig Park's `trap/nature/7` thorn 40, the tiny sprouts 1) and an `lt/rb` contact box on the frame. A grep of the MAP files for `damage` finds nothing — the attribute lives on the Obj node. `Obj.obstacleDamage`/`getObstacleRect()` + `MapleCharacter.checkForObstacleHit` (always connects, flat damage, knockback, the mob-touch i-frames, purple number, relayed with mob id -1). Moving traps (`trap/moving/*` saws, javelins) damage at their placed position only — their `move`/`flow` paths are not animated yet.
- **Mob-hit knockback is JourneyClient's, not invented**: `Physics.hitKnockback` = ±187.5 px/s back, 437.5 px/s hop (JourneyClient `Player::damage`: hspeed 1.5 / vforce 3.5 per 8ms tick). Hop only from the ground (airborne hits push sideways, no juggling); on a ladder/rope the damage lands but the grip holds. v83's Stance roll is not modelled yet.
- **HP/MP/EXP and every damage number must be finite integers.** The status bar (`UIMap.drawNumbers`) and `DamageIndicator.drawDamage` render from WZ digit sprites that exist for 0-9 only; a `NaN` or fraction threw inside the render loop every frame and produced the "tiled GPU smear" crash. The `hp`/`mp` setters (`MapleCharacter.wholeVital`), `addExp` and `takeDamage` floor and reject non-finite values with a stack trace, and both renderers skip unknown glyphs — keep any new HP/EXP path going through them.
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
- **Consume protection**: potions/food 2000000-2039999 and the cure potions 2050000-2050099 (spec `poison/darkness/weakness/seal/curse` flags → `PlayerStatus.remove(MobSkillId.X)`, spent even with nothing to cure) are double-click usable. Cards, arrows, upgrade scrolls (2040xxx), throwing stars must be blocked.
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

### Item icon rule (inventory cells)
- `info/icon` = `iconRaw` + the 2-3px baked drop shadow; its `origin` bottom-anchors it in a 32px cell (Red Potion: 27x30, origin (-3,30) → drawn at cell (3,2)). The inventory draws `icon` placed by origin, `iconRaw` only as a fallback, and scales anything over 36px to fit. 590 items (chairs, some ETC/quest pieces) author an oversized `iconRaw` — never centre a raw by its pixel size in a cell. Storage/Trade/Shop/Hotkey still draw iconRaw centred.

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
- Only TRUE quest items — flagged `quest=1` in the item's own WZ `info` node — are undroppable (`ItemRestrictions.canDropItem`). **Untradeable items (`tradeBlock=1`) DO drop in v83**: the client warns "it will disappear" (`UI/UIConfirmDialog`, the YesNo3 panel) and the drop is a local `DropItemSprite.vanishing` toss that fades where it lands — never pickable, never broadcast (the emulator's "disappearing item drop"). `ItemRestrictions.dropVanishes` decides; both the inventory and equip windows go through it.
- A common item that an active quest merely requires (Branch, Stone, ...) stays droppable, like GMS — do NOT block drops by scanning active quests' `reqs.start/complete.items`

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

### Event-instance scripts outside their event
`cm.getEventInstance()` / `getPlayer().getEventInstance()` return `null` unless a PQ is registered (scripts take their "not in an event" branches). PQ-only NPCs dereference it blindly (Amon 2030010 at Zakum: `cm.getEventInstance().isEventCleared()`), which threw before any dialog when the altar was entered without the expedition. `NpcScriptEngine.runScript` catches a null/undefined TypeError once per conversation, flips `eventStub`, and reruns with a null-safe instance (`eventInstanceApi()`: isEventCleared=false, properties null/0) so the NPC still talks and warps you out.

### NPC Default Dialogue (String.wz/Npc.img)
- `n0`, `n1`, ... — overhead chat balloon lines; the pool an NPC actually uses is listed by key in `Npc.wz/<id>.img/info/speak` (values like "n0", occasionally "d0"). NPCs without an `info/speak` node show no balloon.
- `d0`, `d1` — default click lines (682 of 1733 NPCs; 583 have both). **They are not pages**: `d0` is what the NPC says before you have helped them, `d1` after you have completed a quest they end (Johnson: "I can't believe I got a cold" → "Thank you very much for helping me out"; Cody's `d1` "Thanks to your help, the party went bananas"). `showDefaultNpcTalk` shows exactly one as sendOk, keyed via `npc.strings.defaultTalk` — playing both in sequence made every scriptless NPC thank you for a quest that never happened. Lines use standard format codes (`#p`, `#t`, `#b`) so they render through `stripScriptCodes` + UIQuestDialog.

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
- All display sites must call `resolveItemCodes()`: UIQuestDialog.buildPages(), accepted yes/no text, the Say `#L` selection labels (`getStaticSelections`), QuestLogMenuSprite description
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

## Storage Keeper (2026-08-21)
The v83 trunk: `UI.wz/UIWindow.img/Trunk`, opened by the 25 keepers' scripts through `cm.getPlayer().getStorage().sendStorage(client, npcId)` (NpcScriptEngine → `UI/UIStorage.ts`). Module: `Storage/StorageManager.ts` (rules + socket), `server/handlers/storage.js` (ledger).
- **One storage per (user, world)** — `storages(user_id, world_id, slots, mesos)` + `storage_items`; 4 slots by default, 48 max, every stored stack takes a slot whatever its tab. The server is the authority on what is in the trunk (capacity, meso bounds, first-take-out-wins) and every reply carries a full snapshot; the client owns the bag and mesos as everywhere else, applies its half optimistically and reverts on refusal, then flushes `saveCharacterToServer()` at once.
- **Fees come from Npc.wz**: `info/trunkPut` (deposit, default 100 — Orbis 150, NLC 9030100 500) and `info/trunkGet` (withdrawal, default 0; 9030100 = 1000). Charged client-side like every meso sink; the request carries `fee` only so the server can mirror it.
- **Disconnect-save mirror**: every accepted move is also applied to `player.lastSaveData` (remove/add the stack, subtract the fee), otherwise a tab closed before the client's next save would resurrect a stored item. Keep it when touching the save path.
- Rules: `tradeBlock`/`quest` items are refused ("This item cannot be stored."); one-of-a-kind items can't come out while one is held; rechargeables go in whole; stackables prompt for a count via `UIMesoDropDialog` (verb "store"/"take out"/"save"); a summoned pet is despawned before it is boxed; there is no level-15 gate (Cosmic-only, nothing in the WZ).
- **No storage-slot SKU exists in v83** — `Commodity.img` lists 9110000/9111000/9112000/9114000 with no names and no `0911.img`; the Cash Shop's `BtExTrunk` stays informational and `expandStorage()` in storage.js is the hook for when one is found.
- Layout (measured off `backgrnd` with a per-row brightness scan, 463x318, two panes 230 apart): left rows y=87 (5 rows) = the trunk, right rows y=127 (4 rows) = the bag, both on a **40px pitch with 35px strips** (the Shop's geometry — an eyeball read of the 2x art said 35 and was wrong); a row is the 35px icon cell at x+6 and the 162px `select` strip at x+43; scrollbar column x+211; meso boxes x+43..194, y=296..309 with the amount right-aligned at x+193, coin buttons at (3,293); EXIT/TAKE OUT/ARRANGE ITEM at (155,16/36/56), STORE at (385,16) — the two dots baked under each button column are the original client's alignment marks; inventory tabs hang from the red line at y=116 on the `Item/New/Tab0|Tab1` plates with `Trunk/Tab` labels. `en` is the enabled-slot plate and is drawn over every slot the trunk owns; the greyed 5th row in the art is the default 4-slot look. `BtGetAll` is labelled FIND (search) and is not wired.

## Style Picker (cm.sendStyle, 2026-08-21)
- `cm.sendStyle(text, styles)` (34 salon/plastic-surgery/skin scripts) opens `UI/UIAvatarStyleDialog.ts`, the v83 `UIWindow.img/UtilDlgEx_Avatar` picker: speaker in the blue column, talk text in the white box, three `MapleStandingCharacter` previews of YOUR look wearing each candidate (hair ≥30000, face 20000-29999, skin <100) on the shelf, BACK/NEXT pages of three, TAKE OFF ALL / DEFAULT SETTINGS strip or restore gear, name tag shows the style's String.wz name, OK returns `(mode 1, type 7, index)` — the script applies `cm.setHair(styles[selection])` itself, so the index must be into the array the script passed. LEAVE STORE/ESC = mode -1 like every dialog. Routed from `UIQuestDialog.showScriptDialog` (`dialogType === 'style'`), hidden with it.
- **`cm.getCosmeticItem(id)` / `cm.isCosmeticEquipped(id)` are real now** (Cosmic semantics: exists = String.wz names it, missing colour falls back to the base id, else -1; equipped = current hair/face/skin). The scripts filter their candidate arrays through these; when they were stubs every entry became the stub value and the picker showed seven "Style 0"s.
- Layout measured off the 419x306 art: text box x=102..397 y=25..127; preview columns x=106/210/313 with feet on y=238 (the four baked dots mark the outer columns and the feet line); arrows in the side columns at y=194; button band y=282. `UtilDlgEx_Avatar` has no OK — `UtilDlgEx/BtOK` (46x18) is used.

## Pet Command Guides (2026-08-21)
- The 91 `416xxxx` ETC guides are WZ picture-less books: `Item.wz/Etc/0416.img/<id>/book/<page>/<para>/{text, align}` (a page may carry a lone `text`); `align=1` centres the paragraph, `#b..#k`/`#r` colour runs, `\n` is a literal backslash-n in the JSON. Double-clicking any ETC item whose node has `book` opens `UI/UIPetGuideDialog.ts`.
- The reader is v83's pet talk frame `UIWindow.img/UtilDlgEx_Pet` (419x297): text box x=101..399 y=24..126, the species' `Item.wz/Pet/<id>.img/stand0/0` standing on the shelf at (210, feet 238) over the Avatar dialog's `shadow`, the baked LEVEL/CLOSENESS value boxes (x=178..207 / 265..294, y=241..254) filled from your own pet of that kind, PREV/NEXT/END CHAT from `UtilDlgEx` on the y=267..292 band. Guide→species is by name against `String.wz/Pet.img` (exact, then "… Puppy" suffix, then any slash-word) — nothing in the WZ links them.

## Skill System Notes
- **Some skills keep their stat in `x`/`y`** (Bullet Time: acc/eva, Dash: speed/jump). `XY_STAT_SKILLS` in `Constants/CombatSkills.ts` maps them onto the named fields at parse time; without it the passive/buff aggregators (which only read `acc`/`eva`/`speed`/`jump`) see nothing. Add to the table when another such skill turns up — the original client special-cases them by id too.
- **Speed/Jump stats reach Physics through `pos.speedScale`/`pos.jumpScale`** (the `shoe_walk_speed`/`shoe_walk_jump` terms of the original formula), fed every frame in `MapleCharacter.update` from `stats.localSpeed/localJump`, capped 140/123 like GMS. Mounts keep their fixed 187.5 walk speed.
- **Melee skills target by their WZ `lt`/`rb` box when they have one** (Dragon Roar ±400×−350..250 reaches behind; Spear Crusher −150..−16 in front; Rush, Power Crash). Boxes are authored for a LEFT-facing character and mirror with the facing; `executeSkillDamage` honours them, nearest mobs first up to `mobCount`. Skills with neither `range` nor a box (Power Strike, Dragon Fury, Sacrifice) use `SINGLE_TARGET_REACH` (200) — never the weapon's 70-80px swing, which is what made every 3rd-job attack look dead. A level can carry its own `action` string (Crusher alternates `burster1`/`burster2`) — `effect.action` beats the root `action`.
- **A skill's cast art is `effect` PLUS every `effectN`** (`effect0`..`effect3` = Spear Crusher's per-hit slashes, Dragon Fury's burst lives in `effect0`), all armed at cast on their own clocks (`skillEffectLayers`); each `effectN` opens with a blank 1x1 frame whose delay is its stagger. Frames fade by `a0`→`a1` over their delay — `drawEffectAt` takes the clock's elapsed ms for that; without the fade Crusher's `effect` (0→255→0 on one image) reads as a frozen still.
- **Multi-hit skills land one line per ATTACK FRAME** (`attackHitTimes`): line i lands at the start of the i-th body frame after the trigger whose delay is not negative (negative = wind-up, HeavenClient's `isattackframe`). Proof in the WZ: `burster2` is -300/-300/150/150/150 and Crusher's `effect1/2/3` slashes are staggered exactly 600/750/900. When the stance runs out of frames (Demolition holds ONE 2670ms frame for 8 hits, Vampire's frames are all wind-up, Double Stab's `stabO1` fires on its last frame) the rest follow at the skill's Hit-art frame delay (`hitArtCadence`, 90 default) — never the frame's own delay, which spread Demolition over 19s. Times are read on the trigger frame before any `await`. Every line calls `monster.hit(..., stackOffset)` (24px a row, 36 after a crit — `Monster.damageRowHeight`); a mob killed by an earlier line still prints the rest of its column (`Monster.hit` draws only, on `dying`); knockback is once per attack (direction 0 on later lines); the mob's Damage thud + the skill's Hit clip play per line. Damage is rolled up front (Sacrifice drains off the total). Projectile skills land `attackCount` lines per impact (`Projectile.landLines`, Wind Shot 3). `stackOffset` rides `mob_damage_request` so the host draws a non-host's column too. **Assassinate** (`ASSASSINATE_ID`) has no hit/ball art and a stun `time`, so it must be force-classed as an attack; GMS text says 4 strikes — `attackCount` 3 + a final strike that lands at `criticalDamage`% with `prop`% odds (our reading; the WZ carries no other field for it).
- **Every explorer skill's hit count was audited against the WZ and the GMS tooltips (2026-08-22)**: the multi-line skills in v83 are exactly the ones with `attackCount` (Brandish 2, Crusher 2→3, Magic Claw 2, Double Stab 2, Savage Blow 4→6, Boomerang Step 2, Double Uppercut 2, Barrage 6, Demolition 8, Vampire/Soul Driver 4, Wind Shot 3) or `bulletCount` (Double Shot 2, Strafe 4, Lucky Seven 2, Triple Throw 3, Burst Fire 3, Battleship Cannon 3→4) plus Assassinate; everything else (all magic, Dragon Fury/Roar, Arrow Rain/Eruption, Assaulter, Band of Thieves...) is one line. Hurricane/Rapid Fire/Big Bang are `keydown` hold skills (not modelled — they fire once).
- **Shadow Partner** (`SHADOW_PARTNER_IDS`, Hermit 4111002 / Night Walker 14111000) doubles every attack while it lasts: the shadow's copy of each line at `x`% of a basic attack / `y`% of a skill (lv30 tooltip "Attack 80%, Skill 50%"), landing `SHADOW_PARTNER_LAG_MS` (200, not in the WZ) after the originals and continuing the same column — wired into `executeAttackDamage`, `executeSkillDamage` and `Projectile.landLines` via `shadowPartnerRatio()`. The shadow itself is the player's own composed frames replayed from the `shadowTrail` ring buffer, drawn `brightness(0)` at alpha 0.55 under the body (`drawShadowPartner`); remotes show it through `remoteBuffs`. It costs a Summoning Rock: `consumeBuffItem()` is the generic `itemCon` gate on BOTH buff cast sites (`useSkill` and `UIHotkeyBar.activateSkill`); party-relayed buffs never pass through it.
- **Classification gotchas** (`SkillData`): a magic attack may carry `mad` and no `damage` (Explosion, Big Bang) — `levelIsAttack` accepts either; Soul Arrow's `ball` is the free arrow of a buff (`SOUL_ARROW_IDS`, explicit because a generic "timed, no damage" rule also swallows Arrow Bomb, Taunt and Hypnotize).
- **Final Attack procs on basic melee hits** (`FINAL_ATTACK_SKILLS` per weapon, `SkillManager.getFinalAttack`): `prop`% after a swing that connected → `pendingFinalAttack`, played when the swing ends as the body's F-stance (`swingO1→swingOF`, `stabT2→stabTF`, `swingP1→swingPF`; `finalAttackStanceFor`) with the weapon clip, the skill's root `hit` art on each target and `damage`% of a regular hit. FA has no `action`/`effect`/sound of its own in the WZ (`skillType=3`, `hit` only). Bow/crossbow FA (a follow-up arrow) is not modelled.
- **Monster Magnet** (1121001/1221001/1321001, `MONSTER_MAGNET_IDS`) is an attack with no damage: it drags up to `mobCount` mobs within `range` in front to your feet at `prop`% each; cast stance is its `prepare/action` (`dash`) — `SkillInfo.prepareAction` is the fallback when a skill has no `action`. Mobs are host-authoritative, so a non-host's pull is cosmetic until the next state batch.
- **Attack classification**: root `hit`/`ball`/`summon`, OR any level with `damage>0 && mpCon>0 && !time` (Sacrifice, Power Crash, Rush, Pole Arm Fury have no root art). Passives with a damage% (Final Attack, Berserk) spend no MP and stay passive. Dragon Roar's HP cost is `x`% of max HP (`skillHpCost`), Sacrifice drains `x`% of damage dealt; Rush's charge and Monster Magnet's pull are not modelled yet. `Stats.tiersFor` must list 3rd AND 4th job (131 and 132) — it used to skip 131 so a 4th-jobber had no 3rd-job SP pool.
- **Negative frame delays in the body's alias stances mark the wind-up**: the hit lands on the first frame whose delay is not negative (`straight` -240/360 → frame 1, `shot` -240/540/0 → frame 1, `doublefire` 90/... → frame 0, `doubleupper` → frame 2, `backspin` → frame 4). `MapleCharacter.attackFrameOf(stance)` derives it; both `useSkill` and the basic attack fire there via the `skillTriggerFrame` hook in `setFrame`. Plain stances (swingO1, shoot1) carry no marker and keep firing on the last frame.
- **Guns attack with the body's `shot` stance** (= `handgun`; weapon attack type 9 per JourneyClient's `CharLook::attack`), not the bow's `shoot1`. Knuckle (attack type 8) has no reference table anywhere — `swingP1/P2` is our guess.
- **`Sound.wz/Skill.img/5001000-5001007` is NOT pirate audio.** Verified against the raw v83 Sound.wz (separate copies, same bytes): it's the pre-pirate GM job's block (GMs were job 500, then 900 — 9001xxx is identical). Flash Fist/Use = Haste, Sommersault Kick/Use = Holy Symbol, Double Shot/Use = Bless, Dash/Use = Shining Ray; only the 5001001-3 `Hit` clips are genuine. `WEAPON_SOUND_SKILLS` routes those three casts to `Weapon.img/knuckle|gun/Attack` (one gunshot per Double Shot bullet). Real pirate clips start at 2nd job (5101002+).
- **Basic-attack sounds are `Sound.wz/Weapon.img/<info/sfx>/Attack`** (knuckle → `knuckle`, gun → `gun`). `Attack2` (bow, cBow, tGlove, gun, knuckle, barehands) is the "degenerate" clip — a ranged weapon swung at melee / prone — per JourneyClient's `WeaponData`; the client never plays it because it always fires a projectile.
- **A `ball` skill on a ranged weapon with no `mad`/`fixdamage` is a weapon shot** (Double Shot): `fireProjectile(weaponType, skill)` fires real ammo `bulletCount` times (staggered `SKILL_BULLET_STAGGER_MS`), applies `damage%`, shows the skill's `ball` art and `hit` art, uses the skill `range`, refuses to cast with no ammo, and honours the WZ `weapon` class (49 = gun). Magic/fixed-damage balls keep the `fireSkillProjectile` path.
- **Criticals in v83** exist only through Critical Shot (bow/crossbow), Critical Throw (claw) and Sharp Eyes (`SHARP_EYES_IDS`, `x` adds to the chance, `y` = crit damage, for every class under the buff) — `SkillManager.getCritical` combines them; no warrior, mage or pirate skill crits.
- **Skill sounds**: `Skills/SkillSound.ts` — `Use` at cast, the skill's own `Hit` on impact (falls back to `Game.img/Hit`). Skills do NOT also play the weapon swing sfx.
- **Caster effects flip with facing** (`drawEffectAt` in MapleMap) — WZ skill art is drawn for a left-facing character. Symmetric overlays (level up, quest) never flip.
- **Dash (5001005) is activated by double-tapping ← or →** (`checkDashDoubleTap` in MapState, 300 ms window), not by a key — the hotkey still works. `effect` = activation burst, `special` = dust puffs dropped at the feet while running under the buff (`updateDashTrail`); `effect0` is unused, nothing in the WZ says what triggers it.
- Buffs cast from the hotkey go `activateSkill → applyBuff` directly; the `isBuff` branch inside `MapleCharacter.useSkill` (alert2 cast pose) is not on that path.

## Monster Book System
Full v83 Monster Book: 343 monster cards, five copies each revealing more of a card's page, an 8-level book, a registerable book cover, and the four-tab monster page. Module: `src/MonsterBook/` (MonsterBookData, MonsterBook) + `src/UI/Menu/MonsterBookMenuSprite.ts`.

### Data invariants (do not break)
- **Cards never enter the inventory.** Their WZ `spec/consumeOnPickup` means the card is spent registering itself. Two gates enforce it: `MapleCharacter.collectMonsterCard` (pickup — also plays the effect and the chat line) and `Inventory.addToInventory` (the catch-all every other grant path goes through: quest and NPC `gainItem`). `sweepInventoryCards` drains cards left in a tab by pre-Monster-Book saves, in both restore paths before `_restoreComplete`.
- **Card↔monster comes from `Item.wz/Consume/0238.img/<8-digit>/info/mob`**, and every card carries `info/monsterBook=1`. Don't source it from Cosmic's `monstercarddata` — the WZ is the authority and matches it 1:1 (343 rows).
- **The nine left tabs are the monster's level band**, keyed off the card id block: 2380xxx = Lv 1-15, 2381xxx = 16-30, ... 2387xxx = 106+, 2388xxx = SPECIAL. Verified against Mob.wz levels. Card ids are NOT contiguous inside a block, so grid position is the card's sorted index within its tab, never `id % 25`.
- **Book level** (from the v83 emulator): walk up a level at a time, each rung costing 10 more cards than the last — 11, 31, 61, 101, 151, 211, 281. Only the FIRST copy of a card counts. 343 cards exist so 8 is the ceiling, which is exactly how many book covers `MonsterBook/icon` ships (icon 0 = level 1).
- **`/data/monsterbook.json`** (generated by `tools/build-monsterbook-data.js`, rerun after a WZ reconvert) holds per-card mob id and per-monster stats/episode/maps/rewards. It exists because Mob.wz averages 620KB an entry, peaks at 31MB, and is evicted on every map change — the book must never load it. Names are NOT baked in: monster/map/item names resolve through the usual String.wz tables.
- **v83 has no card sets and no card buffs.** Nothing in the WZ defines them (the only MonsterBook nodes anywhere are `UIWindow.img` and `BasicEff.img`); the hour-long card abilities are a later-version feature. Don't add them.
- Persistence: `characters.monsterbook` (JSON card map) + `monsterbook_cover`, like `sp_by_tier`. Absent on a partial save → the stored value is kept, and the empty-state backstop drops it too.
- Sync: only `monsterBook: {level, cover, total, basic, special}` rides player_info/player_update for other players' character-info windows — never the card map. `server/handlers/player.js` whitelists it.

### UI notes
- Progressive reveal by copies held: 1 = card face + name + LEVEL, 2 = HP/MP, 3 = the rest of the stat block + FORM + the EPISODE tab, 4 = DROPPING, 5 = FOUND IN + the `fullMark` medal. `RightTab`'s `disabled` frame is exactly for the locked tabs.
- **The WZ carries no layout coordinates** — the original client hardcodes them, and `backgrnd`'s left page is blank paper. Everything in the constants block was measured off the art: page bounds from `backgrnd`, the 27x38 grid holes and the baked search field from `cardSlot`, `select`/`cover` positioned by their own origin (2,40) against the cell's bottom-left corner.
- Three places where space is the constraint, so check before widening any string: the footer fits band label + pager + progress in 174px only at fontSize 10 sized against the worst case ("Lv. 91 ~ 105", "20 / 20"); the header row is full (cardSlot's baked field 60..179, BtSearch 184..218); and the four RightTabs need 51px slots — `selected` art is solid, 62 wide, and overhangs into its neighbours, so it is drawn LAST and the row runs to x=454, past the paper but inside the window.
- The right-page portrait is the card's own art at 2x, not the mob sprite — see the Mob.wz size note above.
- **The MONSTER BOOK KeyConfig plate is icon 22** (unlike pets, the action is genuinely v83's). Nexon shipped it unbound; B is our default so the window is reachable.
- `tools/build-asset-manifest.js` must be rerun after regenerating monsterbook.json, or packaged builds fetch it over the network instead of the asset cache.
