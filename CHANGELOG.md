# Changelog

All notable changes to MapleOrigin are documented here.  
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [Unreleased] - 2026-07-31

### Added
- **Game menu and option windows** (Daniel) — GAME MENU panel with keyboard navigation and a working QUIT GAME, plus CHANGE CHANNEL (client-side selection only), SYSTEM OPTION with functioning BGM/sound sliders, and GAME OPTION with allow/refuse toggles. Volume settings persist and are applied behind the audio path (`Settings.ts`), so `PLAY_AUDIO` scales every effect by the player's SOUND level
- **Login screen polish** (Daniel) — press Enter to log in, double-click a character to enter the game, ID/password text lined up with their labels, and Chrome's password-manager breach popup suppressed
- **`VITE_WEBSOCKET_URL`** (Daniel) — an explicit endpoint in `TypeScript-Client/.env` now wins when resolving the server URL, the only way to point the client at a backend on a different host than the one serving the page
- **GMS quest-complete balloon** (`UIWindow.img/FadeYesNo/backgrnd4` + the `icon6` trophy) — anchored by its tail tip onto the status bar's alert button, announcing "requirements met, this can be claimed". It fires when the last kill or pickup lands, not on turn-in, and plays `Sound.wz/UI.img/Invite`; clearing the quest at the NPC keeps its own separate QuestClear sound and over-the-character effect
- **`GameIn` cue on entering the world** — plays once the server accepts the selected character, so it runs while the map loads rather than after the screen has already changed
- **Chairs** — double-clicking a chair in the Setup tab seats the character; double-clicking the same one stands up, as does walking, jumping, crouching, attacking, grabbing a rope or dying. The body reuses the `sit` stance mounts already drive, and the chair graphic is the item's `effect/0` canvas drawn behind the character (its `effect/z` is `-1`). `info/recoveryHP` is applied every 10s while seated — 50 HP on the Relaxer — which is what chairs are for in v83. The weapon is now hidden for the whole `sit` stance rather than only while riding: weapons have no sit frames, so it fell back to a standing pose and hung across the body
- **Blue recovery numbers** — v83 ships `NoBlue0`/`NoBlue1` in `Effect.wz/BasicEff.img` alongside the red, critical and violet damage digits, and nothing used them. HP gained from a chair now raises one, showing the amount actually gained so nothing appears at full HP

### Changed
- **Quest Helper rebuilt on real WZ assets** — the panel was drawing its own translucent background with `fillRect`, against the project's own rule. It now uses the `UIWindow.img/QuestAlarm` 9-slice (223 wide; ~73%-opaque title bar over a ~33% body, which is what lets the map show through), gained the `BtAuto` button wired to `QuestManager.autoTrack`, drags by its header, and renders requirements GMS-style as `10 / 10 Blue Snail Shell` in one flat colour instead of a red/struck-through mix. Quests with nothing to count no longer occupy a tracker slot
- **NPC dialog portrait and name tag** are treated as one group and centred vertically in the dialog body, instead of the portrait being pinned to the top while the tag floated at half the dialog height
- **Status bar gauges animate** — HP/MP/EXP were drawn straight from the raw values, so any change repainted between one frame and the next with nothing to see. They now ease toward the real value, so healing, damage, potions and EXP gain all slide through one mechanism. The step scales by `msPerTick`, settling in ~900ms at 30, 60 and 144fps alike; EXP eases upward only, since a level-up reset would otherwise drain the whole bar backwards. The numeric readout stays exact

### Fixed
- **Ladders and ropes let go properly at both ends** (Daniel) — a rope's `y1` sits 2px *below* the foothold it hangs from, so the symmetric grab box (`y1 - 4`) overlapped the platform at the top and the floor at the bottom. Standing on the platform was inside the box, so pressing up yanked the character back onto the ladder and left them in the climb stance above the terrain; the top of a climb pinned them at `y1` rather than stepping them off. The box is lopsided now and which way depends on the direction asked for — reaching **up** has slack at the foot (so you can catch a rope you are standing under, which previously did not work at all) and none at the head; reaching **down** is the mirror. Reaching the head of a rope now lets go and drops onto the platform instead of pinning. Separately, and the more damaging half: nothing gave the foothold back when a climb ended, so the character kept whatever platform they were standing on when they grabbed hold — walking away from the top of a ladder resolved against the floor far below and dropped them, and walking away from the bottom snapped them back up to the platform they had just left. Every exit from a rope now clears the foothold and re-acquires the one actually underfoot
- **Mobs froze until the backend was restarted** — the long-running one, finally root-caused by reproduction rather than reasoning: a scripted harness (`tools/host-harness.js`) drives fake clients through every host-assignment scenario against the live server, and all server-side election passed — the wedge was client registration. `player_info` sent while the map is still loading is deferred, and the retry lived inside `sendPlayerUpdate`, **which only runs when the player moves**. An unregistered client's watchdog pleas (`request_host_check`) were then silently dropped by the server (`if (!player.info) return`), so its mobs stayed in remote mode forever — walking and questing worked, and the "jump" in the user's fix ritual was the actual cure, since it triggered the movement-gated retry. Registration now retries every update tick regardless of movement, and the server answers an unregistered host-check with `reregister` instead of dropping it, which the client honours by re-sending `player_info`. Verified 9/9 scenarios in the harness, including the previously-frozen one end to end. Earlier hardening from the same hunt, each a real bug in its own right:
  - a host whose game loop stalled kept its socket open and its broadcasts running, so nothing revoked hostship — hosts are revalidated every 5s and reassigned to a live player
  - the server never re-sent an assignment when the joiner already *was* the host, or when re-election picked the same winner, so a client that missed its assignment was never told again — it now always answers a joiner, and a starved non-host asks it to restate the answer
  - `player.lastUpdate` was only refreshed by `player_update`, which the client sends solely when position or stance changes, so standing still looked identical to a crashed tab and hosting was taken away from healthy idle clients. Liveness now comes from a once-a-second heartbeat driven by `requestAnimationFrame`, which still catches a genuinely backgrounded tab (rAF pauses while `setInterval` keeps running) without punishing an idle player. The same signal stops the 10-minute inactivity sweep kicking stationary players
  - the recovery watchdog refreshed its timer on *any* batch that arrived, so it only detected a host that had gone silent. A stalled host does not go silent — mob broadcasts run on `setInterval` — so it streamed byte-identical frozen state forever and the victim concluded all was well. The timer now only advances when the batch contents actually change
- **A dropped connection left you in a dead world** — the client stayed in the map with `isMobHost` still false, so every mob sat pinned in remote mode waiting for broadcasts that could never arrive, and the recovery watchdog bails while offline. Restarting the backend was the only way out. GMS drops you to the login screen with a notice instead, which is both authentic and free of half-alive states: after the reconnect attempts are exhausted the client reloads to login and shows `UNABLE_TO_CONNECT_GAME_SERVER`. Dev auto-login is skipped on that path so it cannot silently drop you back into the session you were just kicked from
- **Melee attacks reached mobs a platform below** — the hit test allowed any target within a flat `Math.abs(dy) <= 100`, which is wider than the gap between most platforms. Vertical reach is now the attacker's own body: `pos.y` is the foothold contact point and sprites extend upward from it, so an attack connects when the two body spans overlap. Sloped ground and tall mobs standing lower still work; a full platform of separation does not. Reactors shared the same check
- **Black screen on boot** — `MapState` assigned `window.__MapleMap` at module scope, but there is an import cycle (`mysocket → MapleMap → NpcScriptEngine → MapState → MapleMap`), so when MapleMap entered the cycle its own `const MapleMap` had not initialised yet and reading the binding threw, aborting module evaluation. It is exposed through a getter now. `startGame()` also gained a catch that reports boot failures in the document title instead of leaving a silent black canvas
- **NPC dialogs covered the NPC** — both selection parsers replaced `#L..#l` markup with an empty string but left the surrounding line break, so Robin's 17 travel questions left 17 blank lines that were drawn and counted into the layout. The option list was pushed ~270px down and the dialog grew to 706px, taller than the screen
- **Quest dialogs reserved space for invisible options** — `recalcLayout` tested only `selections.length` while drawing additionally required a `simple` script dialog, so after picking from a 17-option menu every following page kept 280px of blank space
- **WZ cache leak** — `WZManager.get()` gated on whether an exact path existed rather than whether the `.img` was loaded, so any probe of an optional path re-fetched and re-parsed the whole file, stranding a full duplicate tree in `nChildren`. This fired on every monster spawn missing a `String.wz/Mob.img` entry and on portals, which re-parsed 4.3MB of `MapHelper.img` each time. `WZNode` manufactured those misses: `isNaN("")` is false, so every empty WZ string became `NaN` and was interpolated straight into lookup paths. Measured after: 5 map changes grow the tree 2.0% with zero duplicates, against ~12% and climbing
- **Tab froze on any console output after a disconnect** — `installRemoteLogging` routes `console.warn` through `remoteLog`, and `sendMessage` warns when the socket is down, so logging anything offline recursed until the stack blew, ~30x a second. The game logs per-frame during animation, so this pinned the main thread and threw mid-draw, which is why the player sprite vanished while still moving
- **Zero-dimension UI hangs** — several 9-patch tiling loops stepped by a source image's own width or height, which is 0 until it decodes; stepping by 0 never terminates and killed the tab rather than the frame. Layout and hit rectangles baked once from `nGetImage().width` had the same problem silently and permanently (the "only happens on vite refresh" bug in the stats window). Both now read the WZ node's own dimensions
- **Frame catch-up after a backgrounded tab** — `requestAnimationFrame` pauses in a background tab, so an uncapped lag accumulator ran thousands of update ticks in one frame and hung the page; catch-up is capped at 250ms
- **Per-frame allocations** — physics rebuilt an array of every foothold on the map per entity per substep, and the render loop filtered four entity collections once per layer across 8 layers (32 throwaway arrays a frame). Both are now built once
- **Dev server melted the CPU** — without `fsevents` the Vite watcher stat-polls everything it watches, and 22k+ converted WZ JSON files pushed static asset responses past 30s. The WZ trees are excluded from the watcher. The `immutable` cache header was also never applied: `server.headers` is set from inside Vite's static middleware, which runs after plugin middleware, so its `no-cache` overwrote it and every WZ file revalidated on every load
- **Pison's Florina Beach return warp** — the Cosmic saved-location API (`saveLocation` / `peekSavedLocation` / `getSavedLocation` / `clearSavedLocation`) was missing entirely, so the `-1` fallback never fired: the dialog rendered "Map 0" and the warp went nowhere. Also fixes the Mirror, Event, Happyville and Cygnus intro scripts, which share it
- **Camera easing stalled a few pixels short of its target**, and quitting to login left game state behind (Daniel)

---

## [Unreleased] - 2026-07-30

### Added
- **GMS Quest Helper** (`UI/UIQuestAlarm.ts`) — top-right tracker panel ("Quest Helper (n/5)") listing tracked quests with per-requirement `cur/req` lines: unmet counts in red, completed requirements struck through, round (x) to untrack, minimize/close window buttons from `Basic.img`. The QUEST HELPER button in the quest log toggles tracking; newly accepted quests auto-track. When a quest's requirements become fulfilled (last kill, or item pickup via a 500ms poll) a "Quest Complete!" bubble pops with the QuestAlert light-burst + jingle over the character; turn-in still plays QuestClear
- **Transportation system** (`Transport/`) — v83 boat/train/genie/subway/elevator/Kerning-train routes ported 1:1 from Cosmic's event scripts with authentic timings; dock `shipObj` vessels render, slide out at takeoff and glide back before arrival (including the Balrog invasion ship); station departure clocks (`UI/UIShipClock.ts`) count down on platform maps and timed rides
- **Chat log window** (`UI/UIChatLog.ts`) — GMS-style: collapsed mode floats recent lines over the game and fades them; expanded mode is a persistent translucent scrollable log (wheel + VScr4 arrows); yellow notices / white player chat / gray system / pink warnings
- **Mob HP gauge** (`UI/UIMobGage.ts`) — top-center bar with the last-hit mob's name and remaining HP, built from `UIWindow.img/MobGage` pieces with animated fill
- **Direction3 job-intro cutscenes** (`Effects/DirectionScene.ts`) — the Maple Island job-experience rooms play their full scripted scene (costume avatar equips, skill stances, effect overlays, title splash, warp-out), with the avatar always facing left as the scene coordinates expect
- **GMS status bar completed** — key pill row right-aligned like the original (BtClaim siren, Equip/Inventory/Stats/Skills/KeySet pills — Stats was missing entirely), working QuickSlot show/hide toggle with up/down arrow sprites, and the big SHOP / TRADE / MENU / SHORT CUT buttons on the lower band (visual-only until those systems exist)
- **Quest log window overhaul** — real `VScr4` scrollbars on both panels (tiled track, mouse wheel, draggable thumb, hold-to-repeat arrows, authentic disabled arrows + no thumb when content fits), scrollable description panel (was hard-truncated at 12 lines), active tab rendered bright vs dimmed (v83 ships byte-identical enabled/disabled tab sprites), and quest descriptions no longer covered by a stretched "OBTAIN SELECTIVELY" reward label misused as a row highlight
- **Inventory meso display** — right-aligned inside the white meso field like GMS (large amounts previously overflowed onto the window frame)

### Changed
- **GMS listing-first NPC quest dialog** — clicking an NPC never auto-runs a quest script anymore. NPCs with quests always show the combined quest listing first (completable / in progress / available + ETC conversation entry); scripted quests appear in it like static ones and their start/end script runs only when that quest is clicked — exactly how GMS behaves on job instructors that also give theme-dungeon quests

### Fixed
- **Dances with Balrog warped beginners to Mushroom Castle** — quest startscripts attached to an NPC ran on click after checking only prerequisite quests, ignoring level/job/item requirements. Quest 2300 (Kingdom of Mushroom in Danger, level 30–38 2nd-job warriors) hijacked every click on the Warrior instructor and its script offers a warp to Mushroom Castle, so a level-10 beginner seeking job advancement got shipped to the theme dungeon instead. Startscripts are now gated on the full Check.img start requirements (`canRunStartScript`) — 249 scripted quests with level/job restrictions were hijackable this way on job instructors and quest NPCs everywhere
- **Quest endscripts ran without completion requirements** — talking to the turn-in NPC ran the end script as soon as the quest was in progress; hunting-quest end scripts hand out rewards without re-checking kills, so 34 mob-gated quests (Hunt Up quests, Mushroom Castle 2333, …) were instantly completable with zero kills. End scripts now require the WZ mob-kill and item counts first (`canRunEndScript`, mirroring Cosmic's server-side `canComplete` gate — count-0 item entries always pass, preserving Roger's Apple's script-side check)
- **265 quests with a static start but scripted end could never be accepted** — `canStartQuest` rejected any quest that had an endscript, so clicking ACCEPT on those closed the dialog and silently did nothing; only a scripted *start* now bypasses the static accept path
- **NPC/quest script state loss between dialog pages** — the engines re-ran the whole script source on every click, patching only `status` back in, so every other top-level variable reset (Phil's cab set `selectedMap` on one page and read `-1` on the next, warping passengers to the default map — Amherst — instead of their destination). Both engines now build the script closure once per conversation and call its `start`/`action` (`start`/`end`) functions, so all script variables persist like the original server's per-conversation script instance; `cm.warp`/`qm.warp` also reject invalid map ids outright
- **Characters teleported to the start map on reload** — the server's disconnect auto-save evaluated `Number(info.mapId || player.mapId || 10000)`; a `NaN` map id (client mid-load) is falsy and fell through to literal 10000 with pos (0,0). Every save path now validates the map id (client refuses to send `player_info`/`player_update`/saves without a real map; server keeps the stored map/pos when a payload lacks one)
- **All mobs frozen (only blinking)** — a deferred `player_info` (map still loading) was silently dropped forever, so the server never registered the player and never assigned a mob host; registration now retries from the update loop the moment the map id is valid, and the server defers host assignment instead of ignoring the player
- **Job-intro cutscene mirrored** — the avatar kept the player's walking direction, shooting away from the scene's targets; scenes now force the sprite's natural left-facing orientation

---

## [Unreleased] - 2026-07-29

### Script engine overhaul (NPC / quest / portal)
Audited all 971 backend scripts by driving them through a recording sandbox; fixed the engine-level crash causes rather than patching scripts:
- **Chainable no-op stubs** — unimplemented API methods (and any chain hanging off them, e.g. `cm.getX().getY().getZ()`) degrade to warn-once no-ops instead of TypeErrors that close the dialog; predicates (`is*`/`has*`/`can*`) return false and `size`/`count` return 0 so `while (iter.hasNext())` loops terminate
- **Java/Nashorn shim** — `Java.type()` provides real semantics for `client.inventory.InventoryType` (tab ids), `client.Job` (v83 job ids), `config.YamlConfig` (feature flags off, rates 1), `ShopFactory`, `java.awt.Point`/`Rectangle`; unknown classes get chainable stubs; `java` and `Packages` globals added; shared across NPC, quest, and portal engines
- **Nested API objects wrapped** — `getPlayer()`, `getClient()`, `getMap()`, `cm.c`, the portal `pi`, and storage/event-manager objects are safety-wrapped; event *managers* exist with a null running instance (Cosmic semantics), party/guild/event-instance return null so scripts take their authentic "you need a party" branches
- **Result**: quest scripts 261/261 crash-free, NPC scripts 708/710 (remaining: 2 GM info panels using a Nashorn scope quirk), portal scripts shimmed; ~23 PQ/event-map NPCs still close their dialog early because they genuinely require the event-instance system
- Fixed Nashorn `for each` syntax in the beauty-salon GM NPC (9900000.js)

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
