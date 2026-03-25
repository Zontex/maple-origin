# MapleWeb TODO

Tasks ordered from quick wins to major milestones. Check off as completed.

---

## Quick Wins (hours each)

- [ ] **Add keyboard shortcuts for menus** — I for inventory, S for stats already partially wired
- [ ] **Equipment stat application** — Equipment stats are loaded but not applied to damage calculations
- [ ] **Item pickup improvements** — Z key pickup radius, better loot targeting
- [ ] **Add more SFX** — Attack sounds, portal sounds, level-up jingle (assets exist in Sound.wz)
- [ ] **Monster respawn timers** — Mobs respawn after delay instead of staying dead
- [ ] **HP/MP recovery** — Passive regen over time, potion use from inventory
- [ ] **Map name display** — Show map name on entry (String.wz/Map.img has all names)
- [ ] **Minimap** — Render minimap from Map.wz miniMap data (image + markers)
- [ ] **Death and respawn** — Player dies when HP=0, respawn at nearest town

---

## Medium Tasks (days each)

- [ ] **Skill system foundation** — Load skill data from Skill.wz, skill UI window, hotkey bar
- [ ] **Hotkey/quickslot bar** — Bottom bar for skills, potions, actions (UI.wz/StatusBar3.img)
- [ ] **Equipment from inventory** — Equip/unequip items by double-click or drag
- [ ] **NPC shops** — Buy/sell items from NPCs (UI.wz/UIWindow.img/Shop)
- [ ] **Meso drop/trade** — Drop mesos on ground (dialog exists), basic trading
- [ ] **Multiple map connectivity** — Portal network between towns (Henesys, Ellinia, Perion, Kerning, Lith Harbor)
- [ ] **Job advancement NPCs** — Talk to job NPCs to change class (Beginner → Warrior/Mage/Bowman/Thief)
- [ ] **Proper chat system** — Chat history, whisper, party chat, ! commands
- [ ] **Party system** — Create/join parties, shared EXP, party HP display
- [ ] **World map** — UI.wz/WorldMap for navigation between areas
- [ ] **Scrolling text input** — Replace HTML `<input>` with canvas-rendered text input for chat

---

## Server Port — Cosmic to TypeScript

Port the [Cosmic](https://github.com/P0nk/Cosmic) Java v83 server emulator to TypeScript/JS.

### Phase 1: Foundation
- [ ] **Project scaffold** — Set up TypeScript server project with shared types between client/server
- [ ] **Database layer** — Character, account, inventory persistence (SQLite or PostgreSQL)
- [ ] **Authentication** — Account creation, login validation, session tokens
- [ ] **MapleStory packet protocol** — Port Cosmic's packet encoding/decoding (AES + custom cipher)
- [ ] **Character CRUD** — Create, load, save, delete characters server-side

### Phase 2: Core Game Logic
- [ ] **Server-authoritative movement** — Validate positions, anti-speed-hack
- [ ] **Monster spawning** — Server controls spawn points, timers, respawn
- [ ] **Damage validation** — Server calculates damage, prevents hacked damage
- [ ] **Item/inventory management** — Server-side inventory, prevent item duplication
- [ ] **Drop system** — Server determines drops, prevents loot hacking
- [ ] **EXP/leveling** — Server awards EXP, validates level-ups

### Phase 3: Game Systems
- [ ] **Skill system** — Skill points, skill effects, cooldowns, buffs
- [ ] **Job advancement** — Job change quests and requirements
- [ ] **Quest system** — Quest data from Quest.wz, progress tracking, rewards
- [ ] **NPC scripts** — Port Cosmic NPC scripts (or create JS equivalent)
- [ ] **Party system** — Server-managed parties, shared EXP distribution
- [ ] **Guild system** — Create, join, manage guilds
- [ ] **Buddy list** — Friends list, online status

### Phase 4: Content & Polish
- [ ] **All maps accessible** — Load any map from Map.wz, proper portal connections
- [ ] **Boss fights** — Zakum, Horntail, Pianus, etc. with mechanics
- [ ] **PQ (Party Quests)** — KPQ, LPQ, OPQ, EPQ with stage logic
- [ ] **Cash shop** — Cosmetic items, pets
- [ ] **FM (Free Market)** — Player shops, Owl of Minerva
- [ ] **Events** — GM events, seasonal content

---

## Client Feature Completeness

### Combat
- [ ] **Melee attack range** — Proper weapon-range-based hit detection
- [ ] **Skill animations** — Render skill effects from Skill.wz
- [ ] **Buff/debuff visuals** — Status effect icons and character overlays
- [ ] **Multi-hit skills** — Skills that hit multiple monsters
- [ ] **Summons** — Summoned creatures that fight alongside player

### UI
- [ ] **Skill window** — Full skill tree UI with point allocation
- [ ] **Quest log** — Available/in-progress/completed quests
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
- [ ] **Facial expressions** — F1-F7 expression hotkeys
- [ ] **Medals and titles** — Name tag decorations

---

## Infrastructure

- [ ] **Deployment** — Docker containerization, cloud hosting
- [ ] **CI/CD** — Automated builds and testing
- [ ] **Monitoring** — Server health, player count, error tracking
- [ ] **Admin tools** — GM commands, player management, ban system
- [ ] **Load testing** — Stress test multiplayer with many concurrent players
