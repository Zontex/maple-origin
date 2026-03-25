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

### Server (multiplayer)
```bash
npm install
npm run dev          # WebSocket server at http://localhost:3001
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
- Canvas internal resolution = `window.innerWidth x window.innerHeight` (set by Config.ts goFullScreen)
- Canvas drawing coordinates and CSS pixel coordinates may NOT match if canvas is scaled
- For UI elements that need text input, prefer canvas-rendered keyboard capture over HTML `<input>` elements — HTML inputs don't align with canvas coordinates
- `GameCanvas.drawImage` uses `sw`/`sh` (not `sWidth`/`sHeight`) for source crop
- `GameCanvas.drawText` supports `align: 'center'`

### Login Map Structure
The login screen is a single tall vertical map (`UI.wz/MapLogin.img`) with sections at different Y positions:
- **Login Screen**: Camera at `{ x: -372, y: -308 }`
- **World Select**: Camera at `{ x: -372, y: -914 }`
- **Character Select**: Camera at `{ x: -372, y: -1544 }`
- **Create Character**: Camera at `{ x: -372, y: -2723 }`
- Camera transitions use easing via `Camera.setTopLeft()` + `Camera.update()` called every frame in GameLoop

## Architecture Overview

### Client (TypeScript-Client/src/)

```
Core Engine
├── main.ts              → Entry point, loads WZ assets, starts game loop
├── GameLoop.ts          → 60 FPS update/render loop
├── GameCanvas.ts        → Canvas rendering, mouse/keyboard input
├── Camera.ts            → Viewport with easing transitions
├── Config.ts            → Resolution (1280x720 default)
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

UI (all rendered from WZ assets)
├── UI/UILogin.ts        → Login flow (4 substates)
├── UI/UIMap.ts          → In-game HUD (HP/MP/EXP bars)
├── UI/MapleButton.ts    → WZ sprite buttons
├── UI/UINpcTalk.ts      → NPC dialogue
├── UI/TaxiUI.ts         → Transportation dialog
├── UI/Menu/             → Inventory, Stats windows (draggable)
├── UI/DebugDrag.ts      → F9 debug positioning tool

Networking
├── mysocket.ts          → WebSocket client (multiplayer sync)
├── Net/                 → Packet serialization, encryption, login packets

Data
├── wz-utils/            → WZManager, WZNode (JSON-based WZ parsing)
├── Constants/           → ExpTable, Jobs, EquipType, DropData
```

### Server (server.js — current)
Basic Node.js WebSocket relay server:
- Player join/leave/update synchronization
- Monster damage broadcasting
- Chat message relay
- Map-based message filtering
- Rate limiting and health checks
- **NOT an authoritative game server** — client does all game logic

### Server (planned — Cosmic port)
Port of [Cosmic](https://github.com/P0nk/Cosmic) Java v83 emulator to TypeScript:
- Authoritative game logic
- Character persistence (database)
- Server-side validation
- Quest/skill/job systems
- Proper authentication
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
- `MyCharacter.load()` is async — must await before rendering character sprites
- WZ `charInfo2` image already contains stat labels (JOB, LV, STR, etc.) — only draw values, not labels
- Login map backgrounds repeat vertically — the map extends well below y=-3000
