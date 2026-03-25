# MapleWeb

A 1:1 recreation of pre-Big Bang MapleStory v83, running entirely in the browser. Built with TypeScript and HTML5 Canvas, rendering everything from original WZ game assets.

> All graphics and sound assets are rights reserved to Nexon. This open source project is for research and educational purposes only, with no commercial intent.

## What Works

- Full login flow (login screen, world/channel select, character select, character creation)
- Character rendering with full sprite composition (body, head, hair, face, equipment)
- Map loading with backgrounds, tiles, objects, footholds, portals
- Physics engine (gravity, jumping, walking, climbing ropes/ladders)
- Monster spawning with AI, HP bars, death animations
- Combat system with weapon-range-based hit detection and v83 damage formulas
- Projectile system (arrows/stars with auto-targeting)
- Item drops from monsters with reliable pickup system
- Death system — tombstone animation (Effect.wz/Tomb.img), SFX, revival dialog (UIWindow.img/Notice), respawn at nearest town
- NPC interaction with centered dialog (UtilDlgEx), overhead chat balloons (9-patch ChatBalloon.img), movement blocked during dialog
- Player chat — Enter to type, Enter to send, chat balloon above character (auto-fades after 5s)
- Map transitions with fade from black (portals, death respawn, taxi, initial load)
- Taxi system — WZ UtilDlgEx dialog with NPC sprite, clickable destination list, proper spawn at town portals
- Fall damage — triggers after high drops (500+ pixels), scales with distance
- Inventory system (5 tabs) with canvas-based drag-to-drop
- Drop dialogs — WZ Notice4 frame for meso/item quantity input, single items drop immediately on drag-out
- Quest system — quest data from Quest.wz (2824 quests), accept/decline dialog, mob kill tracking, quest rewards, animated book icons above NPCs
- Quest script engine — 253 backend quest scripts (JavaScript) run client-side, full dialog flow (sendNext/sendPrev/sendAcceptDecline), item rewards, EXP, quest state management
- NPC script engine — 708 backend NPC scripts run client-side with full `cm` API (dialog, warp, items, quests, cosmetics), `sendSimple` selection menus with clickable options
- NPC quest listings — NPCs with quests show GMS-style combined dialog with category headers (QUEST AVAILABLE / IN PROGRESS / COMPLETABLE from UtilDlgEx list sprites), quest reward display with WZ icons (REWARD!!, EXP, meso, fame, item sprites)
- Inline image format codes — `#f`, `#v`, `#i`, `#t`, `#c` codes in quest/NPC scripts render actual WZ images, item icons, item names, and inventory counts inline in dialog text and quest log
- Quest log UI (Q key) — two-panel WZ layout (backgrnd/backgrnd2), Available/In Progress/Complete tabs, NPC sprite in detail panel, forfeit button
- Item consumption — double-click Use tab items to consume potions/food, HP/MP recovery from WZ spec data, consumption SFX
- Stats menu with AP allocation
- In-game HUD (HP/MP/EXP bars, level display)
- Original 800x600 resolution with fullscreen CSS scaling (4:3 aspect ratio preserved)
- Canvas-rendered cursor (no DOM overlay, correct at all resolutions)
- Real-time multiplayer (WebSocket — player sync, chat, shared combat)
- Background music
- Mobile touch controls
- EXP and leveling system

## Getting Started

### Prerequisites
- Node.js v14+
- npm
- WZ game data (see below)

### WZ Data Setup
The WZ game data (~3.8GB of JSON files) is not included in this repo. Place the `wz_client/` folder at:
```
TypeScript-Client/public/wz_client/
```

### Install & Run

```bash
# Install server dependencies
npm install

# Install client dependencies
cd TypeScript-Client && npm install && cd ..

# Start client (dev mode)
cd TypeScript-Client && npm run dev
# → http://localhost:5173

# Start multiplayer server (separate terminal)
npm run dev
# → WebSocket on port 3001
```

### Production Build

```bash
cd TypeScript-Client && npm run build && cd ..
npm start
# → http://localhost:3001
```

## Game Controls

| Key | Action |
|-----|--------|
| Arrow Keys | Move |
| Alt | Jump |
| Ctrl | Attack |
| Z | Pick up items |
| I | Inventory |
| S | Stats |
| Q | Quest Log |
| Enter | Chat |
| Esc | Close menus |
| F9 | Debug drag mode |

## Architecture

```
MapleWeb/
├── TypeScript-Client/          # Browser client
│   ├── src/                    # ~80 TypeScript files
│   │   ├── GameCanvas.ts       # Canvas rendering engine
│   │   ├── MapleCharacter.ts   # Character sprite composition
│   │   ├── MapleMap.ts         # Map loading and rendering
│   │   ├── Monster.ts          # Enemy system
│   │   ├── NPC.ts              # NPC system
│   │   ├── Physics/            # Movement and collision
│   │   ├── Stats/              # Damage formulas, AP system
│   │   ├── Inventory/          # Item management
│   │   ├── Quest/              # Quest data parsing and state management
│   │   ├── UI/                 # All UI (rendered from WZ assets)
│   │   ├── Net/                # Packet system
│   │   ├── wz-utils/           # WZ data parsing
│   │   └── ...
│   └── public/wz_client/       # 22K+ JSON files from WZ archives
├── backend/                    # Cosmic Java v83 emulator (reference for TS port)
│   ├── src/                    # 857 Java files, 30+ game systems
│   └── scripts/                # 1,823 JS scripts (NPC, quest, portal, event)
├── server.js                   # WebSocket multiplayer relay
└── tools/wz_explorer.py        # WZ asset browser (Flask, port 5555)
```

### Key Design Principle
**Everything is rendered from WZ assets.** No custom HTML/CSS UI, no canvas-drawn rectangles for panels. The original MapleStory client renders everything from WZ sprite data — this project does the same.

## Server Roadmap

The current `server.js` is a basic WebSocket relay — the client runs all game logic. The plan is to port [Cosmic](https://github.com/P0nk/Cosmic) (Java v83 server emulator) to TypeScript to create a proper authoritative game server with:
- Character persistence (database)
- Server-side validation
- Quest, skill, and job advancement systems
- Proper authentication
- Map instance management

## Communication with Server

Set `VITE_WEBSOCKET_URL` in `.env` to the WebSocket URL. Without it, the game runs in local/offline mode for UI development.

For connecting to a traditional TCP-based server emulator, use [websocat](https://github.com/vi/websocat) as a protocol converter:
```bash
websocat --binary ws-l:127.0.0.1:8089 tcp:127.0.0.1:8484
```

## Screenshots

![Screenshot 2024-03-10 at 1 18 04 PM](https://github.com/Jeck-Sparrow-5/MapleWeb/assets/162882278/a865ca04-ff39-41df-8e58-04a457825e10)
![Screenshot 2024-03-10 at 1 17 28 PM](https://github.com/Jeck-Sparrow-5/MapleWeb/assets/162882278/6231bd8f-d593-44d4-96d6-83cd72dad603)

## Credits

Fork of [Nodein Maple Web](https://github.com/Jeck-Sparrow-5/MapleWeb). Server emulator reference: [Cosmic](https://github.com/P0nk/Cosmic).
