// Socket.io client for multiplayer functionality
import MapleMap from "./MapleMap";
import MyCharacter from "./MyCharacter";
import MapleCharacter from "./MapleCharacter";
import { Physics } from "./Physics";
import Monster from "./Monster";
import Inventory from "./Inventory/Inventory";
import Stats from "./Stats/Stats";
import DropItemSprite from "./DropItem/DropItemSprite";
import config from "./Config";

let nextDropId = 1;

// Survives the reload that returns a disconnected player to login, so the
// login screen can show the "unable to connect" notice
const DISCONNECTED_FLAG = 'maple:disconnected';

/** True when this page load followed a lost-connection reload. */
export function wasDisconnected(): boolean {
  try {
    return sessionStorage.getItem(DISCONNECTED_FLAG) !== null;
  } catch {
    return false;
  }
}

/** Read and clear the flag — call once, from whoever shows the notice. */
export function consumeDisconnected(): boolean {
  const hit = wasDisconnected();
  if (hit) {
    try {
      sessionStorage.removeItem(DISCONNECTED_FLAG);
    } catch {}
  }
  return hit;
}

export function markDisconnected() {
  try {
    sessionStorage.setItem(DISCONNECTED_FLAG, '1');
  } catch {}
}

interface PlayerState {
  id: string;
  x: number;
  y: number;
  stance: string;
  frame: number;
  flipped: boolean;
  name: string;
  hair: number;
  face: number;
  skin: number;  // Used as skinColor in character creation
  mapId: number;
  level: number;
  job: number;
  hp: number;
  maxHp: number;
  attacking: boolean;
}

interface PlayerUpdate {
  x: number;
  y: number;
  stance: string;
  frame: number;
  flipped: boolean;
  mapId: number;
  attacking: boolean;
}

interface MonsterUpdate {
  id: number;
  x: number;
  y: number;
  stance: string;
  frame: number;
  flipped: boolean;
  hp: number;
  maxHp: number;
  mapId: number;
}

interface DamageEvent {
  sourceId: string;
  targetId: number;
  damage: number;
  mapId: number;
}

interface ChatMessage {
  playerId: string;
  message: string;
  mapId: number;
}

class MySocket {
  socket: WebSocket | null = null;
  playerId: string = "";
  otherPlayers: Map<string, MapleCharacter> = new Map();
  isMobHost: boolean = false;
  // player_info couldn't be sent yet (map still loading) — retried by the
  // update loop; without it the server never assigns a mob host
  _needsRegistration: boolean = false;
  isConnected: boolean = false;
  isLoggedIn: boolean = false;
  // Set by disconnect() so handleSocketClose skips the reconnect path
  intentionalDisconnect: boolean = false;
  userId: number = 0;
  reconnectAttempts: number = 0;
  maxReconnectAttempts: number = 5;
  reconnectInterval: number = 3000; // 3 seconds
  serverUrl: string = "ws://localhost:3001"; // Default development server
  lastUpdate: number = 0;
  updateInterval: number = 50; // 50ms = 20 updates per second
  connectionStatusElement: HTMLElement | null = null;

  // Callbacks for login flow
  private _loginCallback: ((result: { success: boolean; error?: string; userId?: number }) => void) | null = null;
  private _characterListCallback: ((data: any) => void) | null = null;
  private _checkNameCallback: ((result: any) => void) | null = null;
  private _createCharCallback: ((result: any) => void) | null = null;
  private _deleteCharCallback: ((result: any) => void) | null = null;
  private _selectCharCallback: ((result: any) => void) | null = null;

  constructor() {}

  private _inRemoteLog = false;

  // Send a log message to the server for display in server console
  remoteLog(...args: any[]) {
    // Bail out while disconnected. installRemoteLogging() routes console.warn
    // through here, and sendMessage() warns when the socket is down — so
    // logging anything after a disconnect would recurse until the stack blew.
    if (!this.isConnected || !this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }
    // Belt-and-braces against the same recursion arriving by another route:
    // any send path that logs on failure would otherwise re-enter here even
    // while the socket looks healthy.
    if (this._inRemoteLog) return;

    this._inRemoteLog = true;
    try {
      const msg = args.map(a => {
        if (a instanceof Error) return `${a.message}\n${a.stack}`;
        if (typeof a === 'object') try { return JSON.stringify(a); } catch { return String(a); }
        return String(a);
      }).join(' ');
      this.sendMessage({ type: 'client_log', data: msg });
    } finally {
      this._inRemoteLog = false;
    }
  }

  // Install console hooks — all console.log/warn/error also go to server
  installRemoteLogging() {
    const self = this;
    const origLog = console.log.bind(console);
    const origWarn = console.warn.bind(console);
    const origError = console.error.bind(console);

    console.log = function(...args: any[]) {
      origLog(...args);
      self.remoteLog('[LOG]', ...args);
    };
    console.warn = function(...args: any[]) {
      origWarn(...args);
      self.remoteLog('[WARN]', ...args);
    };
    console.error = function(...args: any[]) {
      origError(...args);
      self.remoteLog('[ERROR]', ...args);
    };

    // Catch uncaught errors too
    window.addEventListener('error', (e) => {
      self.remoteLog('[UNCAUGHT]', e.message, e.filename, e.lineno, e.colno);
    });
    window.addEventListener('unhandledrejection', (e) => {
      self.remoteLog('[UNHANDLED PROMISE]', String(e.reason));
    });
  }

  private resolveServerUrl() {
    // An explicit VITE_WEBSOCKET_URL (TypeScript-Client/.env) always wins —
    // it's the only way to point the client at a backend on a different host
    // than the one serving the page.
    if (config.websocketUrl) {
      this.serverUrl = config.websocketUrl;
      return;
    }
    if (window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1") {
      this.serverUrl = `ws://${window.location.hostname}:3001`;
      if (window.location.protocol === 'https:') {
        this.serverUrl = `wss://${window.location.hostname}:3001`;
      }
    }
  }

  // Connect early for login — does NOT send player info or start update loop
  async connectForLogin(): Promise<void> {
    if (this.isConnected) return;
    this.resolveServerUrl();
    console.log(`Connecting to server for login at ${this.serverUrl}`);
    return new Promise<void>((resolve, reject) => {
      // Must reject on failure — a forever-pending promise here hangs
      // tryAutoLogin (black screen on boot) and the Log in button
      const timeout = setTimeout(() => {
        this._onConnectedForLogin = null;
        reject(new Error(`Could not connect to ${this.serverUrl} within 8s`));
      }, 8000);
      this._onConnectedForLogin = () => {
        clearTimeout(timeout);
        resolve();
      };
      this.connectSocket();
    });
  }
  private _onConnectedForLogin: (() => void) | null = null;

  // Reject request-style promises that never get a server response, so
  // callers' try/catch runs instead of awaiting forever (black screen /
  // dead login button when the server restarts mid-flight)
  private _withTimeout<T>(p: Promise<T>, what: string, ms = 10000): Promise<T> {
    return Promise.race([
      p,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), ms)
      ),
    ]);
  }

  // Send login credentials, returns result via promise
  // Kept for silent session resume after a reconnect — the server holds all
  // auth state in RAM keyed to the connection, so every server restart or
  // socket drop forgets who we are
  _resumeUsername: string = '';
  _resumePassword: string = '';
  _resumeCharId: number = 0;

  sendLogin(username: string, password: string): Promise<{ success: boolean; error?: string; userId?: number }> {
    this._resumeUsername = username;
    this._resumePassword = password;
    return this._withTimeout(new Promise((resolve) => {
      this._loginCallback = resolve;
      this.sendMessage({ type: 'login', data: { username, password } });
    }), 'login');
  }

  // Request character list for a world
  getCharacters(worldId: number): Promise<any> {
    return new Promise((resolve) => {
      this._characterListCallback = resolve;
      this.sendMessage({ type: 'get_characters', data: { worldId } });
    });
  }

  // Check if a character name is available
  checkName(worldId: number, name: string): Promise<any> {
    return new Promise((resolve) => {
      this._checkNameCallback = resolve;
      this.sendMessage({ type: 'check_name', data: { worldId, name } });
    });
  }

  // Create a character
  createCharacter(data: { worldId: number; name: string; hair: number; face: number; skin: number; gender: number }): Promise<any> {
    return new Promise((resolve) => {
      this._createCharCallback = resolve;
      this.sendMessage({ type: 'create_character', data });
    });
  }

  // Delete a character
  deleteCharacter(characterId: number): Promise<any> {
    return new Promise((resolve) => {
      this._deleteCharCallback = resolve;
      this.sendMessage({ type: 'delete_character', data: { characterId } });
    });
  }

  // Select a character (load full data)
  selectCharacter(characterId: number): Promise<any> {
    this._resumeCharId = characterId;
    return this._withTimeout(new Promise((resolve) => {
      this._selectCharCallback = resolve;
      this.sendMessage({ type: 'select_character', data: { characterId } });
    }), 'select_character');
  }

  /**
   * Rebuild the server-side session after a reconnect.
   *
   * The server keeps userId/characterId in RAM keyed to the connection, so
   * a server restart or dropped socket erases them while the client plays
   * on believing everything is fine. The visible half of that was mobs
   * freezing (no registration -> no host); the invisible half was WORSE:
   * handleSaveCharacter requires player.characterId, so every auto-save
   * after a reconnect was silently discarded — hours of progress gone on
   * the next refresh.
   *
   * Re-login and re-select restore the server's identity for this
   * connection. The character data the select returns is deliberately
   * ignored — the DB is STALE (it missed our saves); applying it would
   * overwrite live progress with old state. Instead we immediately save,
   * pushing the in-RAM truth back to the DB.
   */
  _lastResumeAt: number = 0;

  async resumeSession() {
    // Throttle: a rejected save retriggers resume, and a resume ends in a
    // save — if auth is genuinely broken that would spin. Once per 10s.
    const now = Date.now();
    if (now - this._lastResumeAt < 10000) return;
    this._lastResumeAt = now;
    try {
      if (this._resumeUsername) {
        const login = await this.sendLogin(this._resumeUsername, this._resumePassword);
        if (login.success && this._resumeCharId) {
          await this.selectCharacter(this._resumeCharId); // result ignored on purpose
          console.log('[Socket] Session resumed — re-authenticated and character re-selected');
        } else if (!login.success) {
          console.error('[Socket] Session resume: re-login failed:', login.error);
        }
      }
    } catch (e) {
      console.error('[Socket] Session resume failed:', e);
    }
    this.sendPlayerInfo();
    this.sendMessage({ type: 'get_player_list' });
    // The DB missed every save since the drop — push current state now
    setTimeout(() => this.saveCharacterToServer(), 1000);
  }

  _saveDebounce: ReturnType<typeof setTimeout> | null = null;

  /**
   * Coalesced event-driven save. Every gameplay change (item/meso pickup,
   * HP/MP change, exp, equip, quest, purchase, sale) calls this; a burst of
   * changes collapses into one full save ~2s after the first. Bounds data
   * loss to ~2s without hammering the socket and DB at combat rates — a
   * full save serializes the entire inventory, so firing it per damage
   * tick would be 30 writes a second.
   */
  requestSave() {
    if (this._saveDebounce) return;
    this._saveDebounce = setTimeout(() => {
      this._saveDebounce = null;
      this.saveCharacterToServer();
    }, 2000);
  }

  // Save current character state to server
  saveCharacterToServer() {
    const charId = (MyCharacter as any)._serverCharId;
    if (!charId) { console.warn('[Save] No _serverCharId — character not saved'); return; }
    if (!this.isConnected) return;
    // Don't save until the game map is loaded — MapleMap.id would be
    // missing/login-map and the save would record mapId 10000 (start map),
    // teleporting the character back on next login
    if (!MapleMap.doneLoading || !Number(MapleMap.id)) {
      console.warn('[Save] Skipped — map not loaded yet');
      return;
    }
    // NEVER save before the login restore finished — a save fired mid-restore
    // (or after a restore crash) carries empty inventory/equips and would
    // delete-and-replace the DB rows with nothing
    if (!(MyCharacter as any)._restoreComplete) {
      console.warn('[Save] Skipped — character restore not complete');
      return;
    }

    const inv = MyCharacter.inventory;
    // Keep null holes so slot positions survive save/load (server inserts by index)
    const serializeTab = (items: any[]) =>
      (items || []).map((item: any) =>
        item
          ? {
              itemId: item.itemId,
              quantity: item.quantity ?? 1,
              equipData: item.equipData ?? undefined,
            }
          : null
      );

    const equipped: { slot: number; itemId: number; equipData?: any }[] = [];
    if (MyCharacter.equippedItemIds) {
      for (const [slot, itemId] of Object.entries(MyCharacter.equippedItemIds)) {
        if (itemId) {
          equipped.push({
            slot: Number(slot),
            itemId: itemId as number,
            equipData: MyCharacter.equippedItemData?.[Number(slot)] ?? undefined,
          });
        }
      }
    }

    const quests: { questId: number; state: number; mobProgress?: string }[] = [];
    if (MyCharacter.questManager) {
      const qm = MyCharacter.questManager;
      if (qm.activeQuests) {
        for (const [qId, active] of qm.activeQuests) {
          const mp: Record<string, number> = {};
          if (active.mobProgress) {
            for (const [mobId, count] of active.mobProgress) {
              mp[String(mobId)] = count;
            }
          }
          quests.push({ questId: qId, state: 1, mobProgress: JSON.stringify(mp) });
        }
      }
      if (qm.completedQuests) {
        for (const [qId, completedAt] of qm.completedQuests) {
          quests.push({ questId: qId, state: 2, completedAt } as any);
        }
      }
    }

    this.sendMessage({
      type: 'save_character',
      data: {
        level: MyCharacter.stats?.level ?? 1,
        exp: MyCharacter.exp ?? 0,
        str: MyCharacter.stats?.str ?? 12,
        dex: MyCharacter.stats?.dex ?? 5,
        int: MyCharacter.stats?.int ?? 4,
        luk: MyCharacter.stats?.luk ?? 4,
        ap: MyCharacter.stats?.abilityPoints ?? 0,
        hp: MyCharacter.hp,
        maxHp: MyCharacter.maxHp,
        mp: MyCharacter.mp,
        maxMp: MyCharacter.maxMp,
        jobId: MyCharacter.stats?.jobId ?? 0,
        mapId: Number(MapleMap.id),
        posX: (MapleMap.isPositionValid?.(MyCharacter.pos.x, MyCharacter.pos.y))
          ? Math.round(MyCharacter.pos.x) : 0,
        posY: (MapleMap.isPositionValid?.(MyCharacter.pos.x, MyCharacter.pos.y))
          ? Math.round(MyCharacter.pos.y) : 0,
        mesos: inv?.mesos ?? 0,
        fame: MyCharacter.fame ?? 0,
        sp: MyCharacter.stats?.sp ?? 0,
        // The per-tier split; `sp` above stays the total for anything reading it
        spByTier: MyCharacter.stats?.spByTier ?? {},
        hair: MyCharacter.hair,
        face: MyCharacter.face,
        skin: MyCharacter.skinColor,
        equipped,
        inventory: {
          equip: serializeTab(inv?.equip),
          use: serializeTab(inv?.use),
          setup: serializeTab(inv?.setup),
          etc: serializeTab(inv?.etc),
          cash: serializeTab(inv?.cash),
        },
        quests,
        skills: MyCharacter.skillManager?.serialize() || [],
        keymap: (window as any).__uiHotkeyBar?.serialize() || [],
      },
    });
  }

  async initialize() {
    console.log("Initializing WebSocket connection...");

    // Create a connection status indicator
    this.createConnectionStatusIndicator();

    this.resolveServerUrl();

    console.log(`Connecting to WebSocket server at ${this.serverUrl}`);
    if (!this.isConnected) {
      this.connectSocket();
    } else {
      // Already connected from login — register with game server now
      this.sendPlayerInfo();
      this.sendMessage({ type: "get_player_list" });
    }

    // Start the game loop for sending position updates
    this.startUpdateLoop();

    // Initial save so server has full data immediately (for disconnect recovery)
    setTimeout(() => this.saveCharacterToServer(), 2000);

    // Save character on page close/refresh
    window.addEventListener('beforeunload', () => {
      this.saveCharacterToServer();
      // Also save snapshot to sessionStorage for dev auto-login
      // (synchronous — guaranteed to persist even if WS send fails)
      if (typeof (window as any).__saveDevSnapshot === 'function') {
        (window as any).__saveDevSnapshot();
      }
    });

    // Add window error handler to prevent crashes
    window.addEventListener('error', (event) => {
      console.error('Caught runtime error:', event.error);
      // Prevent the error from crashing the game
      event.preventDefault();
      return true;
    });
  }
  
  createConnectionStatusIndicator() {
    // Connection status indicator disabled — no visible UI element
  }
  
  updateConnectionStatus(status: 'connecting' | 'connected' | 'disconnected' | 'error') {
    if (!this.connectionStatusElement) return;
    
    switch (status) {
      case 'connecting':
        this.connectionStatusElement.innerText = '🔄 Connecting...';
        this.connectionStatusElement.style.backgroundColor = 'rgba(255, 165, 0, 0.7)'; // Orange
        break;
      case 'connected':
        this.connectionStatusElement.innerText = '🟢 Connected';
        this.connectionStatusElement.style.backgroundColor = 'rgba(0, 128, 0, 0.7)'; // Green
        // Make it fade out after 5 seconds
        setTimeout(() => {
          if (this.connectionStatusElement) {
            this.connectionStatusElement.style.opacity = '0.5';
          }
        }, 5000);
        break;
      case 'disconnected':
        this.connectionStatusElement.innerText = '🔴 Disconnected';
        this.connectionStatusElement.style.backgroundColor = 'rgba(255, 0, 0, 0.7)'; // Red
        this.connectionStatusElement.style.opacity = '1';
        break;
      case 'error':
        this.connectionStatusElement.innerText = '⚠️ Connection Error';
        this.connectionStatusElement.style.backgroundColor = 'rgba(255, 0, 0, 0.7)'; // Red
        this.connectionStatusElement.style.opacity = '1';
        break;
    }
  }
  
  connectSocket() {
    try {
      this.updateConnectionStatus('connecting');
      
      // Close any existing connection first
      if (this.socket) {
        this.socket.close();
      }
      
      this.socket = new WebSocket(this.serverUrl);
      
      this.socket.onopen = this.handleSocketOpen.bind(this);
      this.socket.onmessage = this.handleSocketMessage.bind(this);
      this.socket.onclose = this.handleSocketClose.bind(this);
      this.socket.onerror = this.handleSocketError.bind(this);
    } catch (error) {
      console.error("Failed to connect to WebSocket server:", error);
      this.updateConnectionStatus('error');
      this.handleReconnect();
    }
  }
  
  _loggingInstalled: boolean = false;
  handleSocketOpen(event: Event) {
    this.isConnected = true;
    this.reconnectAttempts = 0;
    this.updateConnectionStatus('connected');

    // Install remote logging on first connect
    if (!this._loggingInstalled) {
      this._loggingInstalled = true;
      this.installRemoteLogging();
    }

    console.log("Connected to WebSocket server");

    // If connecting for login, resolve the promise and wait for auth
    if (this._onConnectedForLogin) {
      this._onConnectedForLogin();
      this._onConnectedForLogin = null;
      return;
    }

    // Reconnect mid-game: the server forgot everything about us (auth AND
    // registration are per-connection RAM). Rebuild the whole session, not
    // just the world registration — without re-auth every save is dropped.
    if (this.isLoggedIn) {
      void this.resumeSession();
    }
  }
  
  handleSocketMessage(event: MessageEvent) {
    try {
      const data = JSON.parse(event.data);
      
      switch (data.type) {
        case "player_id":
          this.handlePlayerId(data);
          break;
        case "reregister":
          // Server got a request from us but has no player.info — our
          // registration was lost (reconnect, server restart). Re-send it.
          console.warn('[Socket] Server asked us to re-register');
          this.sendPlayerInfo();
          break;
        case "player_joined":
          this.handlePlayerJoined(data);
          break;
        case "player_left":
          this.handlePlayerLeft(data);
          break;
        case "player_list":
          this.handlePlayerList(data);
          break;
        case "player_update":
          this.handlePlayerUpdate(data);
          break;
        case "monster_update":
          this.handleMonsterUpdate(data);
          break;
        case "monster_damage":
          this.handleMonsterDamage(data);
          break;
        case "chat_message":
          this.handleChatMessage(data);
          break;
        case "item_drop":
          this.handleItemDrop(data.data);
          break;
        case "item_pickup":
          this.handleItemPickup(data.data);
          break;
        case "mob_host_assign":
          this.handleMobHostAssign(data);
          break;
        case "mob_state_batch":
          this.handleMobStateBatch(data.data);
          break;
        case "mob_damage_request":
          this.handleMobDamageRequest(data.data);
          break;
        case "mob_death":
          this.handleMobDeath(data.data);
          break;
        case "mob_respawn":
          this.handleMobRespawn(data.data);
          break;
        case "player_hit_by_mob":
          this.handlePlayerHitByMob(data.data);
          break;
        case "player_level_up":
          this.handlePlayerLevelUp(data.data);
          break;
        case "reactor_hit":
          this.handleReactorHit(data.data);
          break;
        case "reactor_respawn":
          this.handleReactorRespawn(data.data);
          break;
        case "login_result":
          if (this._loginCallback) {
            this._loginCallback(data);
            this._loginCallback = null;
          }
          if (data.success) {
            this.isLoggedIn = true;
            this.userId = data.userId;
          }
          break;
        case "character_list":
          if (this._characterListCallback) {
            this._characterListCallback(data);
            this._characterListCallback = null;
          }
          break;
        case "check_name_result":
          if (this._checkNameCallback) {
            this._checkNameCallback(data);
            this._checkNameCallback = null;
          }
          break;
        case "create_character_result":
          if (this._createCharCallback) {
            this._createCharCallback(data);
            this._createCharCallback = null;
          }
          break;
        case "delete_character_result":
          if (this._deleteCharCallback) {
            this._deleteCharCallback(data);
            this._deleteCharCallback = null;
          }
          break;
        case "select_character_result":
          if (this._selectCharCallback) {
            this._selectCharCallback(data);
            this._selectCharCallback = null;
          }
          break;
        case "error":
          console.error("Server error:", data.message);
          break;
        case "save_character_result":
          if (data.success === false) {
            console.error('[Save] Server REJECTED save:', data.error);
            if (data.error === 'not_authenticated') {
              // Server restarted/reconnected under us — rebuild the session,
              // which ends by re-saving the current state
              void this.resumeSession();
            }
          }
          break;
        default:
          console.warn("Unknown message type:", data.type);
      }
    } catch (error) {
      console.error("Error handling WebSocket message:", error);
    }
  }
  
  /**
   * Close the session deliberately (QUIT GAME). Distinct from a dropped
   * connection: handleSocketClose would otherwise start reconnecting and drag
   * the player straight back into the world they just left.
   */
  disconnect() {
    this.intentionalDisconnect = true;
    this.isLoggedIn = false;
    this.userId = 0;
    this.otherPlayers.clear();
    this.isMobHost = false;
    this._needsRegistration = false;
    try {
      this.socket?.close();
    } finally {
      this.socket = null;
      this.isConnected = false;
    }
  }

  handleSocketClose(event: CloseEvent) {
    console.log("WebSocket connection closed:", event.code, event.reason);
    this.isConnected = false;
    this.updateConnectionStatus('disconnected');

    // Deliberate quit — stay disconnected until the player logs in again.
    if (this.intentionalDisconnect) {
      this.intentionalDisconnect = false;
      return;
    }

    // Idle timeout — go back to login instead of reconnecting
    if (event.code === 4000 || event.reason === 'idle_timeout') {
      console.log('Disconnected due to idle timeout — returning to login');
      window.location.reload();
      return;
    }

    this.handleReconnect();
  }
  
  handleSocketError(event: Event) {
    console.error("WebSocket error:", event);
    this.isConnected = false;
    this.updateConnectionStatus('error');
  }
  
  handleReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      console.log(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
      
      setTimeout(() => {
        this.connectSocket();
      }, this.reconnectInterval);
    } else {
      // Out of retries. GMS drops you to the login screen with a notice
      // rather than leaving you standing in a world that no longer updates —
      // mobs frozen, nothing syncing, and previously no way back short of a
      // manual reload. Reloading guarantees clean state; the flag survives it
      // so the login screen can explain what happened.
      console.error('Connection lost — returning to the login screen');
      markDisconnected();
      window.location.reload();
    }
  }
  
  sendMessage(message: any) {
    if (this.isConnected && this.socket && this.socket.readyState === WebSocket.OPEN) {
      try {
        this.socket.send(JSON.stringify(message));
      } catch (error) {
        console.error("Error sending message:", error);
      }
    } else {
      // Throttled: the update loop calls this ~30x/second, so an unnoticed
      // disconnect otherwise buries the console in identical warnings
      const now = Date.now();
      if (now - this._lastDisconnectWarn > 5000) {
        this._lastDisconnectWarn = now;
        console.warn("Cannot send message: WebSocket not connected");
      }
    }
  }

  private _lastDisconnectWarn = 0;
  
  sendPlayerInfo() {
    if (!MyCharacter || !MyCharacter.stats) {
      console.warn("Cannot send player info: MyCharacter not initialized");
      return;
    }
    
    // Always convert mapId to number to ensure consistent behavior
    const mapId = Number(MapleMap.id);
    // Never register with a bogus map — the server tracks this id and its
    // disconnect auto-save would persist it (teleport-to-start-map bug).
    // Mark registration as pending so the update loop retries once the map
    // is loaded — without registration the server never assigns a mob host
    // and every mob on the map stays frozen.
    if (!Number.isFinite(mapId) || mapId <= 0) {
      console.warn(`[Socket] Deferring player_info — invalid mapId (${MapleMap.id})`);
      this._needsRegistration = true;
      return;
    }
    this._needsRegistration = false;
    console.log(`Sending player info with mapId=${mapId} (${typeof mapId})`);
    
    // Collect equipped item IDs for other players to see
    const equippedItems: { slot: number; itemId: number }[] = [];
    if (MyCharacter.equippedItemIds) {
      for (const [slot, itemId] of Object.entries(MyCharacter.equippedItemIds)) {
        if (itemId) equippedItems.push({ slot: Number(slot), itemId: itemId as number });
      }
    }

    const playerInfo: PlayerState = {
      id: this.playerId || "unregistered",
      x: MyCharacter.pos.x,
      y: MyCharacter.pos.y,
      stance: MyCharacter.stance,
      frame: MyCharacter.frame,
      flipped: MyCharacter.flipped,
      name: MyCharacter.name || "Player",
      hair: MyCharacter.hair || 30030,
      face: MyCharacter.face || 20000,
      skin: MyCharacter.skinColor || 0,
      mapId: mapId,
      level: MyCharacter.stats.level,
      job: MyCharacter.stats.jobId,
      hp: MyCharacter.hp,
      maxHp: MyCharacter.maxHp,
      attacking: false,
      equipped: equippedItems,
    };
    
    console.log("Sending player info:", playerInfo);
    
    this.sendMessage({
      type: "player_info",
      data: playerInfo
    });
  }
  
  sendPlayerUpdate() {
    if (!this.playerId || !MyCharacter) return;
    
    const currentTime = Date.now();
    if (currentTime - this.lastUpdate < this.updateInterval) return;
    this.lastUpdate = currentTime;
    
    // Always convert mapId to number; skip updates while no real map is
    // loaded so the server never tracks an invalid location
    const mapId = Number(MapleMap.id);
    if (!Number.isFinite(mapId) || mapId <= 0) return;

    // Registration was deferred while the map was loading — do it now so the
    // server has player.info and can assign the mob host for this map
    if (this._needsRegistration) {
      this.sendPlayerInfo();
    }

    // Collect equipped item IDs
    const equippedItems: { slot: number; itemId: number }[] = [];
    if (MyCharacter.equippedItemIds) {
      for (const [slot, itemId] of Object.entries(MyCharacter.equippedItemIds)) {
        if (itemId) equippedItems.push({ slot: Number(slot), itemId: itemId as number });
      }
    }

    const update: PlayerUpdate = {
      x: MyCharacter.pos.x,
      y: MyCharacter.pos.y,
      stance: MyCharacter.stance,
      frame: MyCharacter.frame,
      flipped: MyCharacter.flipped,
      mapId: mapId,
      attacking: MyCharacter.isInAttack || false,
      onGround: !!MyCharacter.pos.fh,
      vx: MyCharacter.pos.vx,
      vy: MyCharacter.pos.vy,
      equipped: equippedItems,
    };
    
    this.sendMessage({
      type: "player_update",
      data: update
    });
  }
  
  sendChatMessage(message: string) {
    if (!this.playerId) return;
    
    // Always convert mapId to number
    const mapId = Number(MapleMap.id);
    
    const chatMessage: ChatMessage = {
      playerId: this.playerId,
      message: message,
      mapId: mapId
    };
    
    this.sendMessage({
      type: "chat_message",
      data: chatMessage
    });
  }
  
  sendMonsterDamage(monsterId: number, damage: number) {
    if (!this.playerId) return;
    
    // Always convert mapId to number
    const mapId = Number(MapleMap.id);
    
    const damageEvent: DamageEvent = {
      sourceId: this.playerId,
      targetId: monsterId,
      damage: damage,
      mapId: mapId
    };
    
    this.sendMessage({
      type: "monster_damage",
      data: damageEvent
    });
  }
  
  // Server clock minus ours, captured at connect — station clocks add this
  // to Date.now() so every player's board shows the same time
  serverTimeOffset: number = 0;

  handlePlayerId(data: any) {
    this.playerId = data.id;
    if (typeof data.serverTime === 'number') {
      this.serverTimeOffset = data.serverTime - Date.now();
    }
    console.log(`Assigned player ID: ${this.playerId}`);
    
    // Now that we have an ID, send full player info
    this.sendPlayerInfo();
  }
  
  handlePlayerJoined(data: any) {
    const playerData = data.player;
    
    // Ensure mapId is a number for consistent comparison
    const playerMapId = Number(playerData.mapId);
    const currentMapId = Number(MapleMap.id);
    
    // Only add players in the same map
    if (playerMapId !== currentMapId) {
      console.log(`Ignoring player ${playerData.id} because they are in map ${playerMapId} and we are in ${currentMapId}`);
      return;
    }
    
    console.log(`Player joined: ${playerData.name} (${playerData.id})`);
    
    // Create a new MapleCharacter for the player
    this.addOrUpdateOtherPlayer(playerData);
  }
  
  handlePlayerLeft(data: any) {
    const playerId = data.id;
    
    if (this.otherPlayers.has(playerId)) {
      console.log(`Player left: ${playerId}`);
      
      // Remove player from the map
      const player = this.otherPlayers.get(playerId)!;
      const index = MapleMap.characters.indexOf(player);
      if (index !== -1) {
        MapleMap.characters.splice(index, 1);
      }
      
      this.otherPlayers.delete(playerId);
    }
  }
  
  handlePlayerList(data: any) {
    if (!data.players || !Array.isArray(data.players)) {
      console.error("Invalid player list received:", data);
      return;
    }
    
    const playerList = data.players;
    // Convert current map ID to number to ensure consistent comparison
    const currentMapId = Number(MapleMap.id);
    
    console.log(`Received player list with ${playerList.length} players`);
    console.log("Current map ID:", currentMapId);
    
    // First, remove any players that are no longer in the list
    const currentIds = new Set(playerList.map((p: any) => p.id));
    
    for (const [id, player] of this.otherPlayers.entries()) {
      if (!currentIds.has(id) && id !== this.playerId) {
        console.log(`Removing player ${id} as they are no longer in the list`);
        // Remove player from the map
        const index = MapleMap.characters.indexOf(player);
        if (index !== -1) {
          MapleMap.characters.splice(index, 1);
        }
        
        this.otherPlayers.delete(id);
      }
    }
    
    // Then add/update all players from the list
    for (const playerData of playerList) {
      // Skip ourselves
      if (playerData.id === this.playerId) {
        continue;
      }
      
      // Ensure mapId is converted to a number for consistent comparison
      const playerMapId = Number(playerData.mapId);
      
      // Only add players in the same map
      if (playerMapId !== currentMapId) {
        continue;
      }
      
      this.addOrUpdateOtherPlayer(playerData);
    }
  }
  
  // Track players currently being loaded to prevent duplicate creation
  private _loadingPlayers: Set<string> = new Set();

  async addOrUpdateOtherPlayer(playerData: PlayerState) {
    const playerId = playerData.id;

    // Skip adding our own character
    if (playerId === this.playerId) return;

    if (!this.otherPlayers.has(playerId)) {
      // Prevent duplicate creation while async load is in progress
      if (this._loadingPlayers.has(playerId)) return;
      this._loadingPlayers.add(playerId);

      // Create a new player character
      try {
        console.log(`Creating new character for player ${playerId}`, playerData);

        // Create character with proper initialization options
        const character = new MapleCharacter({
          id: playerId,
          name: playerData.name || "Player",
          hair: playerData.hair || 30030,
          face: playerData.face || 20000,
          skinColor: playerData.skin || 0,  // Use skin as skinColor
          stance: playerData.stance || "stand1",
          frame: playerData.frame || 0,
          flipped: playerData.flipped || false,
          hp: playerData.hp || 100,
          maxHp: playerData.maxHp || 100,
          stats: new Stats({
            level: playerData.level || 1,
            jobId: playerData.job || 0,
            str: 4,
            dex: 4,
            int: 4,
            luk: 4,
            maxHp: playerData.maxHp || 100,
            hp: playerData.hp || 100
          }),
          inventory: new Inventory({
            mesos: 0
          })
        });
        // assign map to character
        character.map = MapleMap;
        character.isRemote = true;
        // Set initial position
        character.pos = new Physics(playerData.x, playerData.y);

        
        
        // Target position for interpolation
        (character as any)._targetX = playerData.x;
        (character as any)._targetY = playerData.y;

        // Override physics update to lerp toward target position
        character.pos.update = function(msPerTick: number) {
          const targetX = (character as any)._targetX;
          const targetY = (character as any)._targetY;
          if (targetX === undefined) return;

          const dx = targetX - this.x;
          const dy = targetY - this.y;

          // Lerp factor — higher = snappier, 0.3 at 60fps ≈ reaches target in ~5 frames
          const lerp = Math.min(1, 0.3 * (msPerTick / 16));

          if (Math.abs(dx) < 1 && Math.abs(dy) < 1) {
            this.x = targetX;
            this.y = targetY;
          } else {
            this.x += dx * lerp;
            this.y += dy * lerp;
          }
        };
        
        // Load assets for this character
        await character.load();

        // Properly initialize animation now that baseBody is loaded
        // Force stance reset so setFrame() initializes nextDelay from WZ data
        character.stance = '';  // Clear so setStance actually runs
        character.setStance(playerData.stance || 'stand1', 0);

        // Attach actual equipped items from player data
        try {
          const equipped = (playerData as any).equipped;
          if (Array.isArray(equipped) && equipped.length > 0) {
            for (const eq of equipped) {
              await character.attachEquip(eq.slot, eq.itemId);
            }
          } else {
            // Fallback to beginner defaults if no equip data received
            await character.attachEquip(4, 1040002);
            await character.attachEquip(5, 1060002);
            await character.attachEquip(10, 1302000);
          }
        } catch (error) {
          console.error("Failed to attach equipment to player:", error);
        }

        // Add to tracking
        this.otherPlayers.set(playerId, character);
        this._loadingPlayers.delete(playerId);

        // Add to map characters
        MapleMap.characters.push(character);

        console.log(`Added player ${character.name} to the map`);
      } catch (error) {
        this._loadingPlayers.delete(playerId);
        console.error(`Failed to create character for player ${playerId}:`, error);
      }
    } else {
      // Update existing player — set target for lerp interpolation
      try {
        const character = this.otherPlayers.get(playerId)!;

        const dx = playerData.x - character.pos.x;
        const dy = playerData.y - character.pos.y;

        // Teleport if too far
        if (Math.abs(dx) > 200 || Math.abs(dy) > 200) {
          character.pos.x = playerData.x;
          character.pos.y = playerData.y;
        }

        // Set lerp target
        (character as any)._targetX = playerData.x;
        (character as any)._targetY = playerData.y;

        // Handle stance changes
        if (playerData.stance) {
          const isAttackStance = playerData.stance.startsWith('swing') ||
            playerData.stance.startsWith('stab') ||
            playerData.stance.startsWith('shoot');

          if (isAttackStance && !character.isInAttack) {
            // Play attack animation: complete once, then return to alert/stand
            character.isInAttack = true;
            character.setStance(playerData.stance, 0, true, false, () => {
              character.isInAttack = false;
              character.setStance('alert', 0);
            });
          } else if (!isAttackStance && !character.isInAttack && playerData.stance !== character.stance) {
            // Normal stance change — only when not mid-attack
            character.setStance(playerData.stance, 0);
          }
        }
        if (playerData.flipped !== undefined) character.flipped = playerData.flipped;
      } catch (error) {
        console.error(`Failed to update character for player ${playerId}:`, error);
      }
    }
  }
  
  handlePlayerUpdate(data: any) {
    const playerData = data.player;
    
    // Skip our own updates
    if (playerData.id === this.playerId) return;
    
    // Skip players in other maps
    const playerMapId = Number(playerData.mapId);
    const currentMapId = Number(MapleMap.id);
    
    if (playerMapId !== currentMapId) return;
    
    const playerId = playerData.id;
    
    if (this.otherPlayers.has(playerId)) {
      const character = this.otherPlayers.get(playerId)!;

      // Set lerp target position
      if (playerData.x !== undefined && playerData.y !== undefined) {
        const dx = playerData.x - character.pos.x;
        const dy = playerData.y - character.pos.y;

        // Teleport if too far
        if (Math.abs(dx) > 200 || Math.abs(dy) > 200) {
          character.pos.x = playerData.x;
          character.pos.y = playerData.y;
        }

        (character as any)._targetX = playerData.x;
        (character as any)._targetY = playerData.y;
      }

      // Handle stance changes — detect attack stances specially
      if (playerData.stance) {
        const isAttackStance = playerData.stance.startsWith('swing') ||
          playerData.stance.startsWith('stab') ||
          playerData.stance.startsWith('shoot');

        if (isAttackStance && !character.isInAttack) {
          character.isInAttack = true;
          character.setStance(playerData.stance, 0, true, false, () => {
            character.isInAttack = false;
            character.setStance('alert', 0);
          });
        } else if (!isAttackStance && !character.isInAttack && playerData.stance !== character.stance) {
          character.setStance(playerData.stance, 0);
        }
      }

      if (playerData.flipped !== undefined) {
        character.flipped = playerData.flipped;
      }

      // Update equipment if changed
      if (Array.isArray(playerData.equipped)) {
        const newEquipKey = playerData.equipped.map((e: any) => `${e.slot}:${e.itemId}`).sort().join(',');
        const oldEquipKey = (character as any)._lastEquipKey || '';
        if (newEquipKey !== oldEquipKey) {
          (character as any)._lastEquipKey = newEquipKey;
          // Re-attach all equips
          character.equips = [];
          character.equippedItemIds = {};
          (async () => {
            for (const eq of playerData.equipped) {
              try { await character.attachEquip(eq.slot, eq.itemId); } catch {}
            }
          })();
        }
      }
    }
  }
  
  handleMonsterUpdate(data: any) {
    const monsterData = data.monster;
    
    // Skip monsters in other maps
    if (Number(monsterData.mapId) !== Number(MapleMap.id)) return;
    
    // Find the monster in our map
    const monster = MapleMap.monsters.find(m => m.id === monsterData.id);
    
    if (monster) {
      // Update position and state
      monster.pos.x = monsterData.x;
      monster.pos.y = monsterData.y;
      monster.hp = monsterData.hp;
      
      // If the monster was killed, mark it for destruction
      if (monsterData.hp <= 0) {
        monster.dying = true;
        setTimeout(() => {
          monster.destroyed = true;
        }, 1000);
      }
    }
  }
  
  handleMonsterDamage(data: any) {
    // Deprecated — mob damage is now handled via host model (mob_state_batch + mob_damage_request)
  }
  
  handleChatMessage(data: any) {
    const chatMessage = data.message;
    
    // Skip messages in other maps
    if (Number(chatMessage.mapId) !== Number(MapleMap.id)) return;
    
    // Find the player
    if (chatMessage.playerId === this.playerId) {
      // It's our own message, handled directly
      return;
    }
    
    // Display chat message above other player
    const player = this.otherPlayers.get(chatMessage.playerId);
    if (player) {
      try {
        // Show chat balloon — reset timer to 0 (elapsed time, not timestamp)
        player.chatMessage = chatMessage.message;
        player.showChatBalloon = true;
        player.chatBalloonTimer = 0;
        player.chatBalloonDuration = 5000;
      } catch (error) {
        console.error("Error displaying chat message:", error);
      }
    }

    // Chat log line for everyone in the map
    import('./UI/UIChatLog').then(({ default: UIChatLog }) => {
      const name = player?.name || chatMessage.playerName || 'Player';
      UIChatLog.addMessage(`${name} : ${chatMessage.message}`, 'player');
    }).catch(() => {});
  }
  
  // --- Item Drop Sync ---

  // Broadcast a drop to other players
  sendItemDrop(itemId: number, amount: number, x: number, y: number, vx: number, vy: number, dropId: number) {
    this.sendMessage({
      type: 'item_drop',
      data: {
        dropId,
        itemId,
        amount,
        x, y, vx, vy,
        mapId: Number(MapleMap.id),
      }
    });
  }

  // Broadcast that we picked up a drop
  sendItemPickup(dropId: number) {
    this.sendMessage({
      type: 'item_pickup',
      data: {
        dropId,
        mapId: Number(MapleMap.id),
      }
    });
  }

  // Receive a drop from another player
  async handleItemDrop(data: any) {
    if (Number(data.mapId) !== Number(MapleMap.id)) return;

    try {
      const dropItem = await DropItemSprite.fromOpts({
        id: data.itemId,
        amount: data.amount,
        monster: {
          pos: { x: data.x, y: data.y, vx: data.vx || 0, vy: data.vy || 0 }
        }
      });

      if (!dropItem.destroyed) {
        (dropItem as any)._netDropId = data.dropId;
        MapleMap.addItemDrop(dropItem);
      }
    } catch (e) {
      console.error('Error creating networked drop:', e);
    }
  }

  // Receive a pickup event from another player — remove the drop locally
  handleItemPickup(data: any) {
    if (Number(data.mapId) !== Number(MapleMap.id)) return;

    const drop = MapleMap.itemDrops.find(
      (d: DropItemSprite) => (d as any)._netDropId === data.dropId && !d.isAlreadyPickedUp
    );
    if (drop) {
      drop.goToPlayer(0, 0);  // goToPlayer sets isAlreadyPickedUp internally
    }
  }

  // --- Player Effects Sync ---

  sendPlayerLevelUp() {
    this.sendMessage({
      type: 'player_level_up',
      data: { mapId: Number(MapleMap.id) }
    });
  }

  handlePlayerLevelUp(data: any) {
    if (Number(data.mapId) !== Number(MapleMap.id)) return;
    const player = this.otherPlayers.get(data.playerId);
    if (player) {
      player.playLevelUp();
    }
  }

  // --- Reactor Sync ---

  sendReactorHit(reactorOId: number) {
    this.sendMessage({
      type: 'reactor_hit',
      data: { oId: reactorOId, mapId: Number(MapleMap.id) }
    });
  }

  handleReactorHit(data: any) {
    if (Number(data.mapId) !== Number(MapleMap.id)) return;
    const reactor = MapleMap.reactors?.find((r: any) => r.oId === data.oId);
    if (reactor && !reactor.destroyed) {
      reactor.hit(true); // Remote hit — plays animation, skips drops
    }
  }

  sendReactorRespawn(reactorOId: number) {
    this.sendMessage({
      type: 'reactor_respawn',
      data: { oId: reactorOId, mapId: Number(MapleMap.id) }
    });
  }

  handleReactorRespawn(data: any) {
    if (Number(data.mapId) !== Number(MapleMap.id)) return;
    const reactor = MapleMap.reactors?.find((r: any) => r.oId === data.oId);
    if (reactor) {
      reactor.reset();
    }
  }

  // --- Mob Sync ---

  // Last time a mob_state_batch arrived; drives the stuck-host watchdog
  _lastMobStateAt: number = 0;
  _lastMobStateSig: string = '';
  _lastHostCheckAt: number = 0;
  _lastHeartbeatAt: number = 0;

  /**
   * Called once per rendered frame from Gameloop, throttled to 1/s.
   *
   * The server used to infer liveness from player_update, which the client
   * only sends when the player actually moves — so standing still looked
   * identical to a crashed tab, and an idle host had mob hosting taken away
   * from it. A frame-driven heartbeat distinguishes the two: a backgrounded
   * tab stops rendering and goes quiet, an idle player keeps ticking.
   */
  notifyFrame() {
    if (!this.isConnected || !this.playerId) return;
    const now = Date.now();
    if (now - this._lastHeartbeatAt < 1000) return;
    this._lastHeartbeatAt = now;
    this.sendMessage({ type: 'heartbeat' });
  }

  handleMobHostAssign(data: any) {
    this.isMobHost = data.isHost;
    this._lastMobStateAt = Date.now();
    console.log(`[MOB] I am ${data.isHost ? '' : 'NOT '}the mob host`);
    MapleMap.setMobHostMode(data.isHost);
  }

  /**
   * Recover from a lost host assignment.
   *
   * A client that thinks it is not the host disables local mob AI and waits
   * for mob_state_batch. If that assignment was wrong or never arrived, the
   * wait never ends: mobs stand frozen and ignore attacks (damage requests
   * are relayed to a host that isn't broadcasting) while still dealing
   * contact damage, which is computed locally. That used to need a reload.
   *
   * So: if we are a non-host on a map that has mobs and none have reported
   * in for a while, ask the server to restate who the host is.
   */
  checkMobHostAlive() {
    if (!this.isConnected || this.isMobHost || !this.playerId) return;
    if (!MapleMap.doneLoading || !MapleMap.monsters?.length) return;

    const now = Date.now();
    if (now - this._lastMobStateAt < 5000) return;
    if (now - this._lastHostCheckAt < 5000) return;

    this._lastHostCheckAt = now;
    const mobs = MapleMap.monsters || [];
    const remote = mobs.filter((m: any) => m.isRemote).length;
    console.warn(
      `[MOB] mob state stale for ${Math.round((now - this._lastMobStateAt) / 1000)}s ` +
        `while not host — requesting re-check. ` +
        `player=${this.playerId} map=${MapleMap.id} mobs=${mobs.length} remote=${remote}`
    );
    this.sendMessage({ type: 'request_host_check' });
  }

  // Host broadcasts mob state every ~66ms
  sendMobStateBatch() {
    if (!this.isMobHost || !this.isConnected) return;
    const mobs = MapleMap.monsters
      .filter((m: any) => !m.destroyed)
      .map((m: any) => ({
        oId: m.oId,
        x: m.pos.x,
        y: m.pos.y,
        stance: typeof m.stance === 'string' ? m.stance : (m.stance?.name || 'stand'),
        frame: m.frame,
        flipped: m.flipped,
        hp: m.hp,
        maxHp: m.maxHp,
        dying: m.dying,
      }));
    if (mobs.length === 0) return;
    this.sendMessage({
      type: 'mob_state_batch',
      data: { mapId: Number(MapleMap.id), mobs }
    });
  }

  // Non-host receives mob state batch — lerp positions, update stance
  handleMobStateBatch(data: any) {
    // Only a batch whose contents actually CHANGED counts as the host being
    // alive. A host whose game loop stalled keeps broadcasting through
    // setInterval (which survives tab backgrounding, unlike rAF) and so
    // keeps sending byte-identical frozen state — the watchdog used to see
    // those arriving and conclude all was well while mobs stood still.
    const sig = data.mobs
      .map((m: any) => `${m.oId}:${Math.round(m.x)}:${Math.round(m.y)}:${m.stance}:${m.hp}`)
      .join('|');
    if (sig !== this._lastMobStateSig) {
      this._lastMobStateSig = sig;
      this._lastMobStateAt = Date.now();
    }

    if (this.isMobHost) return;
    if (Number(data.mapId) !== Number(MapleMap.id)) return;
    for (const mobState of data.mobs) {
      const mob = MapleMap.findMonsterByOId(mobState.oId);
      if (!mob || mob.destroyed) continue;

      // Ensure this mob is in remote mode
      if (!mob.isRemote) {
        mob.isRemote = true;
      }

      // Teleport if too far, else lerp
      const dx = mobState.x - mob.pos.x;
      const dy = mobState.y - mob.pos.y;
      if (Math.abs(dx) > 300 || Math.abs(dy) > 300) {
        mob.pos.x = mobState.x;
        mob.pos.y = mobState.y;
      }
      mob._targetX = mobState.x;
      mob._targetY = mobState.y;

      // Update stance if changed (compare strings)
      const stanceName = mobState.stance;
      if (stanceName && mob.stances[stanceName] && mob.stance !== stanceName) {
        mob.setStance(stanceName);
      }
      mob.flipped = mobState.flipped;
      mob.hp = mobState.hp;
      mob.maxHp = mobState.maxHp;

      // Sync dying state
      if (mobState.dying && !mob.dying) {
        mob.hp = 0;
        mob.dying = true;
        mob.isMovementEnabled = false;
        mob.setStance(mob.stances['die'] ? 'die' : 'die1');
      }
    }
  }

  // Host receives damage request from non-host
  handleMobDamageRequest(data: any) {
    if (!this.isMobHost) return;
    const mob = MapleMap.findMonsterByOId(data.oId);
    if (!mob || mob.destroyed || mob.dying) return;
    // Aggro the mob onto the remote attacker (EXP attribution stays null so
    // the host doesn't award itself EXP for a remote player's kill)
    const attacker = data.sourcePlayerId
      ? this.otherPlayers.get(data.sourcePlayerId)
      : null;
    if (attacker) mob.aggroTarget = attacker;
    // Apply damage on host — hit() handles HP, death, drops
    mob.hit(data.damage, data.knockbackDir || 1, null);
  }

  // Non-host sends damage request to host (via server)
  sendMobDamageRequest(oId: number, damage: number, knockbackDir: number) {
    this.sendMessage({
      type: 'mob_damage_request',
      data: { oId, damage, knockbackDir, mapId: Number(MapleMap.id) }
    });
  }

  // Host broadcasts mob death
  sendMobDeath(oId: number) {
    this.sendMessage({
      type: 'mob_death',
      data: { oId, mapId: Number(MapleMap.id) }
    });
  }

  // Non-host receives mob death
  handleMobDeath(data: any) {
    if (this.isMobHost) return;
    if (Number(data.mapId) !== Number(MapleMap.id)) return;
    const mob = MapleMap.findMonsterByOId(data.oId);
    if (!mob || mob.destroyed || mob.dying) return;
    mob.hp = 0;
    mob.dying = true;
    mob.isMovementEnabled = false;
    // Play death animation — die() without drops/EXP for remote
    if (mob.stances['die1'] || mob.stances['die']) {
      mob.setStance(mob.stances['die'] ? 'die' : 'die1');
    }
  }

  // Host broadcasts mob respawn
  sendMobRespawn(oId: number) {
    this.sendMessage({
      type: 'mob_respawn',
      data: { oId, mapId: Number(MapleMap.id) }
    });
  }

  // Non-host receives mob respawn
  async handleMobRespawn(data: any) {
    if (this.isMobHost) return;
    if (Number(data.mapId) !== Number(MapleMap.id)) return;
    const spawnDefs = MapleMap.getMonsterSpawnDefs();
    const spawnDef = spawnDefs.find((s: any) => s.oId === data.oId);
    if (spawnDef) {
      await MapleMap.spawnMonster({ ...spawnDef, fadeIn: true });
      // Mark newly spawned mob as remote
      const mob = MapleMap.findMonsterByOId(data.oId);
      if (mob) {
        mob.isRemote = true;
        mob._targetX = mob.pos.x;
        mob._targetY = mob.pos.y;
      }
    }
  }

  // Broadcast when local player gets hit by mob
  sendPlayerHitByMob(mobOId: number, damage: number, isMiss: boolean) {
    this.sendMessage({
      type: 'player_hit_by_mob',
      data: { mobOId, damage, isMiss, mapId: Number(MapleMap.id) }
    });
  }

  // Show damage indicator on remote player hit by mob
  handlePlayerHitByMob(data: any) {
    if (Number(data.mapId) !== Number(MapleMap.id)) return;
    const player = this.otherPlayers.get(data.playerId);
    if (player && player.DamageIndicator) {
      const pos = { x: player.pos.x, y: player.pos.y - 40 };
      player.DamageIndicator.addDamageIndicator(1, pos, data.isMiss ? 0 : data.damage);
    }
  }

  startUpdateLoop() {
    // Send position updates at regular intervals
    const updateInterval = 33; // ~30 updates per second
    
    // Store previous position to only send updates when something changed
    let lastPosX = 0;
    let lastPosY = 0;
    let lastStance = '';
    let lastFrame = 0;
    let lastFlipped = false;
    
    setInterval(() => {
      try {
        if (!this.isConnected || !this.playerId || !MyCharacter) return;

        // Deferred registration retries HERE, unconditionally — not inside
        // sendPlayerUpdate, which only runs when the player moves. Gated
        // behind movement, a player who reconnected mid-map-load stayed
        // unregistered until they happened to jump: the server had no
        // player.info for them, silently dropped their request_host_check
        // watchdog pleas, and every mob sat frozen in remote mode. This was
        // the "mobs frozen until I restart the backend and jump" bug — the
        // jump was the part that fixed it.
        if (this._needsRegistration) {
          this.sendPlayerInfo();
        }
        
        // Only send updates when the position or state has changed
        const posChanged = (
          Math.abs(MyCharacter.pos.x - lastPosX) > 1 || 
          Math.abs(MyCharacter.pos.y - lastPosY) > 1
        );
        
        const stateChanged = (
          MyCharacter.stance !== lastStance ||
          MyCharacter.frame !== lastFrame ||
          MyCharacter.flipped !== lastFlipped ||
          MyCharacter.isInAttack
        );
        
        if (posChanged || stateChanged) {
          this.sendPlayerUpdate();
          
          // Update last known position and state
          lastPosX = MyCharacter.pos.x;
          lastPosY = MyCharacter.pos.y;
          lastStance = MyCharacter.stance;
          lastFrame = MyCharacter.frame;
          lastFlipped = MyCharacter.flipped;
        }
      } catch (error) {
        console.error("Error in update loop:", error);
      }
    }, updateInterval);

    // Mob state broadcast (host only, ~15/s)
    setInterval(() => {
      try {
        if (this.isMobHost && this.isConnected) {
          // A mob left in remote mode while we're the host never moves and
          // never will — nothing is broadcasting to it. Cheap to re-assert.
          for (const mob of MapleMap.monsters || []) {
            if ((mob as any).isRemote) (mob as any).isRemote = false;
          }
          this.sendMobStateBatch();
        } else {
          // Non-host: make sure we're not waiting on a host that will never
          // broadcast (self-throttled to one request per 5s)
          this.checkMobHostAlive();
        }
      } catch (error) {
        console.error("Error in mob broadcast loop:", error);
      }
    }, 66);

    // Auto-save character every 30 seconds
    setInterval(() => {
      try {
        if (this.isConnected && this.isLoggedIn) {
          this.saveCharacterToServer();
        }
      } catch (error) {
        console.error("Error in auto-save:", error);
      }
    }, 30000);
  }
}

// Export a singleton instance
const mySocketInstance = new MySocket();
(window as any).__mySocket = mySocketInstance;
export default mySocketInstance;