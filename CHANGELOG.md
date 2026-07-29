# Changelog

All notable changes to MapleOrigin are documented here.  
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [Unreleased] - 2026-07-29

### Added
- **Authentic 800×600 resolution** — the whole game (login + in-game) now runs at the original pre-Big Bang client resolution. Login art (natively 800×600) fills the canvas exactly; the HUD lands at its designed v83 positions; CSS scales the canvas to the window in a single resample (4:3)
- **GMS-style equip tooltips** (`UI/UIEquipTooltip.ts`) — enlarged icon, REQ LEV/STR/DEX/INT/LUK/FAM block, job class bar from the `reqJob` bitmask, CATEGORY, combined base+scroll stats, and NUMBER OF UPGRADES AVAILABLE; shown in both the equipment window and the inventory
- **Equip ground drops** — dropped equips (from inventory, equipment window, mobs, or other players) now render on the ground and can be picked up; scroll bonuses (`equipData`) survive the drop/pickup round-trip
- **Drag-and-drop from the equipment window** — drag a worn item onto the inventory to unequip it, or anywhere else to drop it on the ground, with a cursor ghost icon (inventory item drags now show the ghost too)
- **Three Snails tier shells** — skill level 1/2/3 consumes exactly Snail Shell / Blue Snail Shell / Red Snail Shell with v83 fixed damage 10/25/40 and the matching ball sprite; no shell of the level's tier → no cast (and no MP consumed on failed casts)
- **Default underwear rendering** — characters with empty top/bottom slots render v83 default underwear instead of appearing naked
- **Rope vs ladder stances** — climbing uses the correct v83 stance (`rope` = hands on rope, `ladder` = hands on rungs) based on the map's ladderRope `l` flag

### Fixed
- **Character save wipe ("naked player") bug** — root-caused and fixed in layers: the server's disconnect auto-save fallback no longer persists item data from render-sync state; partial saves can never clear equipment; saves are blocked client-side until login restore completes (`_restoreComplete`); the dev-session snapshot is rejected when it has no equips but the DB does
- **Level/stat regression corruption** — the server rejects saves carrying a lower level than stored (levels never decrease in v83) and logs the offending payload; client saves are skipped until the game map is loaded (early saves recorded mapId 10000, teleporting characters back to the start map)
- **Black screen on boot** — `connectForLogin`/`sendLogin`/`selectCharacter` promises could hang forever when the server was briefly unreachable, stalling `tryAutoLogin` before the game loop started; all login network calls now time out and fall back to the login screen
- **Climbing animation** — key releases were firing every frame instead of on the actual key-up transition, zeroing climb velocity and freezing the climb animation ("sliding" up ropes); animation now plays while moving and freezes when hanging still, including after dropping off and re-grabbing
- **Weapon drawn across the face while climbing** — equips without ladder/rope stance frames (weapons have none) are now skipped during climb stances instead of falling back to their standing pose
- **Login screen fidelity** — login flow renders its native 800×600 art 1:1 (was top-left anchored in a larger canvas with black bars, then blurred by double resampling); sign text is crisp again
- **Ghost login buttons** — Guest Login/Register/Quit etc. were invisible but still clickable on world/character select; ID and password fields are recreated when returning to the login screen via Back
- **Player name in dialogs** — `#h0#` format code now resolves to the actual character name in quest dialogs, quest scripts, and NPC scripts (was showing the literal "Player")
- **Login input fields** — track the sign with the camera and scale with the canvas (were misaligned after window resizes)

---

## [Unreleased] - 2026-04-04

### Added
- **Portal script engine** (`PortalScriptEngine.ts`) — 458 portal scripts from backend now execute client-side via `new Function()`, with `pi` API (warp, quest checks, items, messages). Scripted portals (types 7, 8, 9, 11) now work instead of being silently ignored
- **Lazy-load optimizations** — parallelized `MapleMap.load()` asset fetches (backgrounds, tiles, objects, portals, names, NPCs, monsters, reactors), deferred character model preload so login screen appears faster
- **WZ asset eviction** — `WZManager.unloadTransient()` frees map-specific assets (Map.wz, Mob.wz, Npc.wz sprites) on map change, reducing memory growth on mobile
- **NPC hitbox from sprite** — NPC click detection now uses actual sprite dimensions and origin instead of hardcoded 56×70 rectangle
- **Resolution upgrade to 1024×768** — matches original v83 windowed resolution; status bar extends to full width via clipped right-aligned copy; buttons repositioned for wider viewport
- **Minimap size cap** — large maps (e.g., Lith Harbor) now scale down to max 200×200px, matching original v83 compact minimap size
- **Character name availability check** — new `check_name` server endpoint validates name on the name entry screen before advancing to customization
- **Quest log item progress** — item requirements now shown in green/red like mob progress (e.g., "Jr. Sentinel Shellpiece: 0/1")
- **Character select sound effect** — plays `Sound.wz/UI.img/CharSelect` when clicking a character
- **Map name format code (`#m`)** — resolved from `String.wz/Map.img` instead of showing literal "map" or raw ID
- **Smart training center portal routing** — `entertraining.js` checks active quests and routes to the correct training center (Red Snails, Stumps, Slimes, Pigs) based on what the player needs

### Fixed
- **BGM not playing on first load** — browser autoplay policy blocked initial `audio.play()`; permanent global listener retries on any user interaction
- **Create character OK button unreliable** — fast clicks missed because `canvas.clicked` is a held-state flag; added `wasClicked` flag that persists until the frame processes it
- **Cursor freezes over text inputs** — `mousemove` only listened on canvas; overlaid `<input>` elements blocked events; changed to `window` listener
- **Character equipment ignored during creation** — server handler didn't pass `equips` to `Character.create()`, defaulting all characters to starter gear
- **Sub-pixel rendering artifacts** — camera easing produced fractional positions causing flickering lines between tiles; rounded camera to integers in `Camera.update()`
- **NPC/effect sprite flickering** — physics produces fractional positions; rounded `dx`/`dy` in all `GameCanvas` draw methods
- **Player renders on wrong layer** — player now draws within their foothold's layer so foreground map objects correctly appear in front; layer persists during jumps
- **Quest script phase mismatch** — quests with `startscript` but no `endscript` (e.g., quest 1028 "To Lith Harbor!") no longer silently run an empty `end()` function; completion now uses the standard WZ dialog
- **NPC click handler swallowing errors** — added try/catch and re-entrancy guard to async `handleClick`
- **NPC click-through dialogs** — clicking dialog buttons would re-trigger NPC behind them; added guard when dialogs are open
- **Tutorial mobs dealing damage** — tutorial mobs (9300018, 9300328, 9300383, 9409000, 9409001) now always show "MISS" with no damage or knockback
- **Quest log showing raw `ITEM:4031802`** — `\x01ITEM:id\x02` markers now replaced with item names via `getItemNameSync()`
- **Quest dialog duplicate item progress** — removed appended item progress from quest dialog since quest text already includes it via format codes
- **Enter channel without selection** — button now requires a channel to be selected first
- **Scripted portals teleporting within same map** — portals with `tm=999999999` and no destination no longer teleport to spawn points
- **Minimap showing non-functional portals** — invisible portals with no destination or script no longer show portal icons
- **Quest item removal missing Cash tab** — `removeItems()` now searches all 5 inventory tabs including Cash
- **Blocked portal script spamming** — added 1-second cooldown after portal script returns false
- **`save_character_result` unknown message warning** — silenced by adding handler
- **Random quest reward mismatch** — dialog and quest manager now use the same randomly picked prop item

---

## [0.9.1] - 2026-04-03

### Added
- Quest mob kill progress persisted across login sessions via `mob_progress` JSON column
- Skip quest-start sound effect when restoring saved quests on login

### Fixed
- Job not saving on disconnect (`player_info` sends `job` not `jobId`)
- NPC click triggering multiple overlapping NPCs (changed `forEach` to `for...of` with break)
- Quest items dropping from any mob instead of only quest-required mobs
- Mob respawn using WZ `cy`/`fh` for ground spawn position, per-mob `mobTime`, fade-in effect
- Mobs walking off foothold edges (reverse direction at platform boundaries)
- Invisible portals (type 1) having no collision rect (Free Market etc.)
- EXP/maxExp not restored on login (stuck at level 1 values)
- Browser caching: aggressive cache for WZ data only, no-cache for code/scripts
- Filtered out expired time-limited event quests via WZ start/end dates
- Added Cassandra default dialog script

---

## [0.9.0] - 2026-04-03

### Changed
- Removed private-server TaxiUI system; all cab NPCs now use their GMS scripts with `sendSimple` destination menus
- Disabled canvas image smoothing for crisper pixel art rendering

---

## [0.8.1] - 2026-04-02

### Changed
- Replaced NPC shop data with Cosmic v83 SQL exports (102 shops, 3,569 items with correct prices)

### Fixed
- **EXP table** — replaced incorrect pre-BB/private server curve with official v83 GMS values from Cosmic (every value from level 9+ was wrong)
- **Mob stats** — `Monster.ts` now loads `acc`, `eva`, `PADamage`, and `level` from WZ (previously only HP/MP/exp/speed)
- **HP/MP level-up gains** — characters now gain HP/MP on level-up based on job class (Beginner: +12-16 HP; Warrior: +24-28 HP; Magician: +22-24 MP; etc.). Previously maxHP/maxMP never increased
- **Hit formula** — removed erroneous `-1` that made hit chance negative for almost every mob

---

## [0.8.0] - 2026-04-02

### Changed
- Removed 12,210 private server drop entries; kept only official v83 WZ MonsterBook drops (22,309 → 10,099 entries)

### Fixed — Alpha Playtest Session
- Character equipment not persisting on reconnect (full save on disconnect)
- Character appearing naked on load (re-attach equips after body reload, fix smap bug)
- Job not persisting (use `setJobId()` instead of direct assignment)
- Circular dependency crash (`Physics → MapleMap` lazy loading via registration pattern)
- EXP overflow not triggering multi-level ups (while loop instead of single check)
- Player-to-mob hit formula (remove erroneous -1 making hit chance always 0)
- Mob-to-player miss formula (level-gap scaling: each gap adds 5% miss chance)
- Quest item count only checking first stack (now sums all matching stacks)
- Quest completion failing silently when items spread across stacks
- NPC scripts blocked by in-progress quest scripts (skip re-running startscripts)
- Dances with Balrog incorrectly flagged as taxi NPC
- Sell price always 0 (now reads actual WZ prices)
- Korean/medal/event quests showing in NPC dialogs (filter by Hangul, 19xxx, 29xxx)
- Map name codes not resolving in NPC scripts (scan all 6-9 digit numbers)
- `#t` format codes with missing closing hash (make `#` optional in regex)
- Cards/arrows consumable via double-click (restricted to potions 2000000-2049999)
- Players falling off map edges (boundary clamping + invisible walls)
- Remote players always showing beginner equipment (sync equipped items in updates)
- Character select showing wrong stats/job (load full stats from DB)
- Channel double-click not entering character select
- Mob boundary enforcement (clamp after physics, disable random jumping)
- Character creation not using selected equipment
- Added shoes to default beginner equipment
- Reduced auto-save interval from 60s to 30s, added initial save 2s after entering game
- Disabled fall damage

---

## [0.7.0] - 2026-04-02

### Added
- SQLite backend with user auth (bcrypt) and character persistence (stats, inventory, equipment, quests, map position)
- Auto-save on disconnect, map change, 60s timer, and browser close
- WZ-to-JSON converter (`tools/wz-to-json.js`) for v83 `.wz` binary files
- 3-stage character creation: race selection, name entry, appearance customization with live preview
- Login screen wired to server auth with v83 notice popups for wrong credentials
- Character select with equipped items preview
- Job advancement NPC scripts for all 5 instructors (Warrior, Magician, Bowman, Thief, Pirate)

### Fixed
- Background type-to-tiling mapping (type 1=tileX, 2=tileY, 3=both) — was broken by switch fall-through

---

## [0.6.0] - 2026-04-02

### Added
- **Modular weapon system** — `WeaponConfig` table for all 16 weapon types with correct stances, melee range, and ranged/melee classification
- **v83 damage formulas** — complete stat formulas for all weapon types with stab/swing multipliers
- **Projectile integration** — bows, crossbows, claws, and pistols fire projectiles with auto-targeting
- Randomized attack stance selection from weapon's stance pool
- Monster defense and miss chance applied to melee attacks

### Fixed
- Beginner starting stats from STR/DEX 500 to correct v83 values (STR 12, DEX 5)
- Minimap text clipping — frame width now accounts for street/map name length
- Minimap image centered when frame is wider than map canvas

---

## [0.5.0] - 2026-04-01

### Added
- **Minimap** (`UIMiniMap.ts`) — WZ 9-patch frame, map image, player/NPC/portal icons, map mark, street/map name, toggle with M key, offscreen canvas caching
- **Equipment window** (`EquipMenuSprite.ts`) — paper doll with 16+ slots, WZ background, double-click to unequip, tooltip, toggle with E key
- Equip from inventory via double-click with slot swap support
- Equipment items loaded from `Character.wz` with full `equipDirMap`
- Inventory UI polish: WZ scrollbar, rounded tabs, WZ digit sprites for quantities
- **Multiplayer system** — mob host model, item drop/pickup sync, reactor sync, chat balloons, level-up effects, contact damage relay, remote logging, host failover

### Fixed
- Broken `HTMLImageElement` in `DropItemSprite` causing drawImage crash

---

## [0.4.0] - 2026-03-26

### Fixed
- **Potion consuming 3x** — `onMouseDown` on draggable menus was inside button loop, firing once per registered button; moved outside to fire once per click
- **NPC dialog button types** — `sendOk`/`sendNext`/`sendPrev` now use "OK" button; `sendAcceptDecline`/`sendYesNo` use "Accept" button
- Added Pio (NPC 10000) post-quest script with actual GMS dialog

---

## [0.3.0] - 2026-03-25

### Added
- **Reactor system** — breakable map objects from `Reactor.wz`, multi-state hit animations (4 hits to destroy), item drops, respawn timers
- `ReactorDropData.ts` with 1,126 drop entries covering 163 reactors
- **Quest random rewards** (prop system) — items with `prop > 0` randomly selected (one from pool)

### Fixed
- Quest completion NPC fallback: when no completion NPC specified, fall back to start NPC
- Reactor hit animation: plays from current state before advancing

---

## [0.2.0] - 2026-03-25

### Added
- **NPC script engine** — 708 scripts running client-side via `NpcScriptEngine` with full `cm` API (dialog, warp, items, quests, cosmetics, `sendSimple` selections)
- **Quest listing dialog** — GMS-style combined dialog with category headers (Available/In Progress/Completable/ETC)
- **Quest reward display** — REWARD!!, EXP, meso, fame icons; item rewards show actual icon sprites
- **Inline format codes** — `#f` (WZ images), `#v`/`#i` (item icons), `#t` (item names), `#c` (inventory counts) rendered inline in dialog text
- **Item name deferred resolution** — `#t`/`#c` preserved at parse time, resolved at display time after `ensureItemNames()` loads from `String.wz`
- **Quest item drops** — mobs drop quest-required items (70% if quest targets mob, 15% otherwise)
- **Monster respawn** — 7-second timer after death, respawns at original position

### Fixed
- `IncEXP` effect: `addExp(exp, showEffect)` only plays sound/animation for quest rewards, not mob kills
- Physics state reset on map change (clear velocity, foothold, climbing)
- Spawn position fallback chain: named portal → spawn portal → any portal → center foothold
- Item count type mismatch: `getItemCount`/`addToInventory` handle string/number ID comparison

### Removed
- Connection status overlay
- Mobile touch controls
- Hardcoded ETC inventory items

---

## [0.1.0] - 2026-03-25

### Added
- Initial release — MapleStory v83 pre-Big Bang web recreation
- TypeScript client with canvas rendering from WZ assets
- Core engine: 800x600 resolution, 60 FPS game loop, camera system
- Physics: gravity, walking, jumping, climbing ropes/ladders
- Character sprite composition (body, head, hair, face, equipment layers)
- Map loading from `Map.wz` (backgrounds, tiles, objects, footholds, portals)
- Monster rendering and basic AI
- NPC rendering with dialog system
- Quest system foundation (2,824 quests from `Quest.wz`)
- 5-tab inventory system
- Background music from `Sound.wz`
- WebSocket multiplayer server with player sync
