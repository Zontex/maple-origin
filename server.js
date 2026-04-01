// WebSocket server for MapleWeb multiplayer
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const http = require('http');
const express = require('express');
const path = require('path');

// Create an Express app for serving static files
const app = express();
app.use(express.static(path.join(__dirname, 'TypeScript-Client')));

// Create an HTTP server
const server = http.createServer(app);

// Create a WebSocket server
const wss = new WebSocket.Server({ server });

// Store connected players
const players = new Map();

// Store monster state
const monsters = new Map();

// Track mob host per map (mapId -> playerId)
const mapHosts = new Map();

// Message handling
wss.on('connection', (ws) => {
  // Set maximum payload size and add connection timeout
  ws.maxPayload = 65536; // 64KB max payload size
  ws.isAlive = true;
  
  const playerId = uuidv4();
  console.log(`New player connected: ${playerId}`);
  
  // Store player connection
  players.set(playerId, {
    id: playerId,
    ws,
    info: null,
    mapId: 0,
    lastUpdate: Date.now(),
    lastBroadcast: 0
  });
  
  // Send player their ID
  sendToPlayer(ws, {
    type: 'player_id',
    id: playerId
  });
  
  // Handle pings to keep connection alive
  ws.on('pong', () => {
    ws.isAlive = true;
  });
  
  // Handle messages from clients
  ws.on('message', (message) => {
    try {
      // Only process if message is a string or buffer
      if (typeof message === 'string' || Buffer.isBuffer(message)) {
        const messageStr = message.toString();
        
        // Handle empty messages
        if (!messageStr.trim()) {
          return;
        }
        
        const data = JSON.parse(messageStr);
        
        // Rate limit only high-frequency messages (position updates)
        // Important one-off events (drops, pickups, chat) must never be dropped
        const now = Date.now();
        const player = players.get(playerId);
        // Rate limit only player_update (high frequency position updates)
        // All other messages (mob batches, drops, pickups, damage) must always be processed
        if (data.type === 'player_update' && player && (now - (player.lastUpdateTime || 0) < 16)) {
          return;
        }
        if (data.type === 'player_update' && player) {
          player.lastUpdateTime = now;
        }

        // Process the message
        handleMessage(playerId, data);
      }
    } catch (error) {
      console.error(`Error handling message from ${playerId}:`, error);
      // Send error back to client
      sendToPlayer(ws, {
        type: 'error',
        message: 'Failed to process message'
      });
    }
  });
  
  // Handle errors
  ws.on('error', (error) => {
    console.error(`WebSocket error for player ${playerId}:`, error);
    
    // Clean up on error
    const player = players.get(playerId);
    if (player && player.info) {
      broadcastToMap(player.info.mapId, {
        type: 'player_left',
        id: playerId
      }, playerId);
    }
    
    players.delete(playerId);
  });
  
  // Handle client disconnect
  ws.on('close', () => {
    console.log(`Player disconnected: ${playerId}`);
    
    // Get player info before removing
    const player = players.get(playerId);
    
    // Remove player from list
    players.delete(playerId);
    
    // Notify other players about the disconnect
    if (player && player.info) {
      const playerMapId = Number(player.info.mapId);
      broadcastToMap(playerMapId, {
        type: 'player_left',
        id: playerId
      }, playerId);

      // Reassign mob host if this player was the host
      if (mapHosts.get(playerMapId) === playerId) {
        mapHosts.delete(playerMapId);
        assignMapHost(playerMapId);
      }
    }
  });
});

// Assign or reassign mob host for a map
function assignMapHost(mapId, newJoinerId) {
  mapId = Number(mapId);

  // Check if current host is still valid
  const currentHost = mapHosts.get(mapId);
  if (currentHost) {
    const hostPlayer = players.get(currentHost);
    if (hostPlayer && hostPlayer.ws.readyState === WebSocket.OPEN && Number(hostPlayer.mapId) === mapId) {
      // Host is valid — but if a new player just joined, tell them they're NOT the host
      if (newJoinerId && newJoinerId !== currentHost) {
        const joiner = players.get(newJoinerId);
        if (joiner) {
          sendToPlayer(joiner.ws, { type: 'mob_host_assign', isHost: false });
        }
      }
      return;
    }
  }

  // Find a new host — first player on this map
  let newHost = null;
  for (const [id, player] of players.entries()) {
    if (Number(player.mapId) === mapId && player.ws.readyState === WebSocket.OPEN && player.info) {
      newHost = id;
      break;
    }
  }

  if (newHost) {
    mapHosts.set(mapId, newHost);
    // Tell the new host they are the mob host
    const hostPlayer = players.get(newHost);
    if (hostPlayer) {
      sendToPlayer(hostPlayer.ws, { type: 'mob_host_assign', isHost: true });
    }
    // Tell all other players on this map they are NOT the host
    for (const [id, player] of players.entries()) {
      if (id !== newHost && Number(player.mapId) === mapId && player.ws.readyState === WebSocket.OPEN) {
        sendToPlayer(player.ws, { type: 'mob_host_assign', isHost: false });
      }
    }
    console.log(`Map ${mapId}: assigned mob host to ${newHost}`);
  } else {
    mapHosts.delete(mapId);
  }
}

// Handle incoming messages
function handleMessage(playerId, data) {
  const player = players.get(playerId);
  if (!player) return;
  
  switch (data.type) {
    case 'player_info':
      handlePlayerInfo(playerId, data.data);
      break;
    case 'player_update':
      handlePlayerUpdate(playerId, data.data);
      break;
    case 'monster_damage':
      handleMonsterDamage(playerId, data.data);
      break;
    case 'chat_message':
      handleChatMessage(playerId, data.data);
      break;
    case 'item_drop':
      handleItemDrop(playerId, data.data);
      break;
    case 'item_pickup':
      handleItemPickup(playerId, data.data);
      break;
    case 'mob_state_batch':
      handleMobStateBatch(playerId, data.data);
      break;
    case 'mob_damage_request':
      handleMobDamageRequest(playerId, data.data);
      break;
    case 'mob_death':
      handleMobDeath(playerId, data.data);
      break;
    case 'mob_respawn':
      handleMobRespawn(playerId, data.data);
      break;
    case 'player_hit_by_mob':
      handlePlayerHitByMob(playerId, data.data);
      break;
    case 'reactor_hit':
      handleReactorHit(playerId, data.data);
      break;
    case 'reactor_respawn':
      handleReactorRespawn(playerId, data.data);
      break;
    case 'player_level_up':
      handlePlayerLevelUp(playerId, data.data);
      break;
    case 'client_log':
      const short = playerId.slice(0, 6);
      console.log(`\x1b[36m[CLIENT ${short}]\x1b[0m ${data.data}`);
      break;
    case 'get_player_list':
      sendPlayerList(playerId);
      break;
    default:
      console.warn('Unknown message type:', data.type);
  }
}

// Handle player info update
function handlePlayerInfo(playerId, playerInfo) {
  const player = players.get(playerId);
  if (!player) return;
  
  // ALWAYS convert mapId to number
  playerInfo.mapId = Number(playerInfo.mapId);
  
  // Update player info
  player.info = {
    ...playerInfo,
    id: playerId
  };
  
  // Store map ID for filtering broadcasts
  player.mapId = playerInfo.mapId;
  
  // Notify other players in the same map about this player
  broadcastToMap(player.mapId, {
    type: 'player_joined',
    player: player.info
  }, playerId);
  
  // Send player list to the new player
  sendPlayerList(playerId);

  // Assign mob host for this map — pass playerId so new joiners get notified
  assignMapHost(player.mapId, playerId);
}

// Handle player position and state updates
function handlePlayerUpdate(playerId, updateData) {
  const player = players.get(playerId);
  if (!player || !player.info) return;
  
  // Ensure mapId is always a number
  if (updateData.mapId !== undefined) {
    updateData.mapId = Number(updateData.mapId);
  } else {
    updateData.mapId = Number(player.mapId || player.info.mapId);
  }
  
  // Update player info
  const updatedInfo = { ...player.info };
  
  // Update position
  if (updateData.x !== undefined) updatedInfo.x = updateData.x;
  if (updateData.y !== undefined) updatedInfo.y = updateData.y;
  
  // Update other properties
  if (updateData.stance) updatedInfo.stance = updateData.stance;
  if (updateData.frame !== undefined) updatedInfo.frame = updateData.frame;
  if (updateData.flipped !== undefined) updatedInfo.flipped = updateData.flipped;
  if (updateData.attacking !== undefined) updatedInfo.attacking = updateData.attacking;
  
  // Check if player changed maps
  const currentMapId = Number(player.mapId);
  const newMapId = updateData.mapId;
  
  if (currentMapId !== newMapId) {
    console.log(`Player ${playerId} changed maps: ${currentMapId} -> ${newMapId}`);
    
    // Notify players in old map that this player left
    broadcastToMap(currentMapId, {
      type: 'player_left',
      id: playerId
    }, playerId);
    
    // Update map ID
    player.mapId = newMapId;
    updatedInfo.mapId = newMapId;
    
    // Notify players in new map about this player
    broadcastToMap(newMapId, {
      type: 'player_joined',
      player: updatedInfo
    }, playerId);
    
    // Send updated player list to this player
    sendPlayerList(playerId);

    // Reassign mob host for old map, assign for new map
    assignMapHost(currentMapId);
    assignMapHost(newMapId, playerId);
  } else {
    // Rate limit broadcasts for position updates
    const now = Date.now();
    const timeSinceLastBroadcast = now - (player.lastBroadcast || 0);
    const broadcastInterval = 33; // ~30 broadcasts per second
    
    if (timeSinceLastBroadcast >= broadcastInterval) {
      // Broadcast update to players in same map
      broadcastToMap(player.mapId, {
        type: 'player_update',
        player: updatedInfo
      }, playerId);
      
      player.lastBroadcast = now;
    }
  }
  
  // Save updated info
  player.info = updatedInfo;
  player.lastUpdate = Date.now();
}

// Handle monster damage
function handleMonsterDamage(playerId, damageData) {
  const player = players.get(playerId);
  if (!player || !player.info) return;
  
  // Get monster state or create new one
  let monster = monsters.get(damageData.targetId);
  if (!monster) {
    // We don't know about this monster yet, create it
    monster = {
      id: damageData.targetId,
      hp: 100, // Default HP, will be overridden by client
      maxHp: 100,
      mapId: damageData.mapId,
      lastUpdate: Date.now()
    };
    monsters.set(damageData.targetId, monster);
  }
  
  // Update monster HP
  monster.hp -= damageData.damage;
  if (monster.hp < 0) monster.hp = 0;
  
  // Broadcast damage event and updated monster state
  broadcastToMap(damageData.mapId, {
    type: 'monster_damage',
    damage: damageData
  }, playerId);
  
  broadcastToMap(damageData.mapId, {
    type: 'monster_update',
    monster: monster
  });
  
  // If monster died, schedule it for cleanup
  if (monster.hp <= 0) {
    setTimeout(() => {
      monsters.delete(damageData.targetId);
    }, 5000);
  }
}

// Handle chat messages
function handleChatMessage(playerId, chatData) {
  const player = players.get(playerId);
  if (!player || !player.info) return;
  
  // Broadcast message to all players in the same map
  broadcastToMap(chatData.mapId, {
    type: 'chat_message',
    message: {
      playerId,
      message: chatData.message,
      mapId: chatData.mapId
    }
  });
}

// Relay reactor hit to all other players on same map
function handleReactorHit(playerId, hitData) {
  const player = players.get(playerId);
  if (!player || !player.info) return;
  const mapId = Number(hitData.mapId || player.mapId);
  broadcastToMap(mapId, { type: 'reactor_hit', data: hitData }, playerId);
}

// Relay reactor respawn to all other players on same map
function handleReactorRespawn(playerId, respawnData) {
  const player = players.get(playerId);
  if (!player || !player.info) return;
  const mapId = Number(respawnData.mapId || player.mapId);
  broadcastToMap(mapId, { type: 'reactor_respawn', data: respawnData }, playerId);
}

// Relay player level up to all other players on same map
function handlePlayerLevelUp(playerId, levelData) {
  const player = players.get(playerId);
  if (!player || !player.info) return;
  const mapId = Number(levelData.mapId || player.mapId);
  broadcastToMap(mapId, { type: 'player_level_up', data: { ...levelData, playerId } }, playerId);
}

// Relay mob state batch from host to all other players on same map
function handleMobStateBatch(playerId, batchData) {
  const player = players.get(playerId);
  if (!player || !player.info) return;
  const mapId = Number(batchData.mapId || player.mapId);
  // Only accept from the current host
  if (mapHosts.get(mapId) !== playerId) return;
  broadcastToMap(mapId, { type: 'mob_state_batch', data: batchData }, playerId);
}

// Forward damage request from non-host to host
function handleMobDamageRequest(playerId, reqData) {
  const player = players.get(playerId);
  if (!player || !player.info) return;
  const mapId = Number(reqData.mapId || player.mapId);
  const hostId = mapHosts.get(mapId);
  if (!hostId || hostId === playerId) return;
  const hostPlayer = players.get(hostId);
  if (hostPlayer && hostPlayer.ws.readyState === WebSocket.OPEN) {
    sendToPlayer(hostPlayer.ws, { type: 'mob_damage_request', data: { ...reqData, sourcePlayerId: playerId } });
  }
}

// Relay mob death from host to all other players
function handleMobDeath(playerId, deathData) {
  const player = players.get(playerId);
  if (!player || !player.info) return;
  const mapId = Number(deathData.mapId || player.mapId);
  if (mapHosts.get(mapId) !== playerId) return;
  broadcastToMap(mapId, { type: 'mob_death', data: deathData }, playerId);
}

// Relay mob respawn from host to all other players
function handleMobRespawn(playerId, respawnData) {
  const player = players.get(playerId);
  if (!player || !player.info) return;
  const mapId = Number(respawnData.mapId || player.mapId);
  if (mapHosts.get(mapId) !== playerId) return;
  broadcastToMap(mapId, { type: 'mob_respawn', data: respawnData }, playerId);
}

// Relay player-hit-by-mob to all other players on map
function handlePlayerHitByMob(playerId, hitData) {
  const player = players.get(playerId);
  if (!player || !player.info) return;
  const mapId = Number(hitData.mapId || player.mapId);
  broadcastToMap(mapId, { type: 'player_hit_by_mob', data: { ...hitData, playerId } }, playerId);
}

// Handle item drop — broadcast to all other players on same map
function handleItemDrop(playerId, dropData) {
  const player = players.get(playerId);
  if (!player || !player.info) return;

  const mapId = Number(dropData.mapId || player.mapId);
  broadcastToMap(mapId, {
    type: 'item_drop',
    data: { ...dropData, playerId }
  }, playerId);
}

// Handle item pickup — broadcast to all players on same map (including picker)
function handleItemPickup(playerId, pickupData) {
  const player = players.get(playerId);
  if (!player || !player.info) return;

  const mapId = Number(pickupData.mapId || player.mapId);
  broadcastToMap(mapId, {
    type: 'item_pickup',
    data: { ...pickupData, playerId }
  }, playerId);
}

// Send player list to specific player
function sendPlayerList(playerId) {
  const player = players.get(playerId);
  if (!player || !player.ws) return;
  
  // Get player's current map ID
  const playerMapId = Number(player.mapId);
  
  // Filter players in the same map
  const playerList = [];
  for (const [id, p] of players.entries()) {
    if (p.info && Number(p.mapId) === playerMapId) {
      playerList.push(p.info);
    }
  }
  
  // Send player list
  sendToPlayer(player.ws, {
    type: 'player_list',
    players: playerList
  });
}

// Send message to a specific player
function sendToPlayer(ws, message) {
  if (ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify(message));
    } catch (error) {
      console.error('Error sending message to player:', error);
    }
  }
}

// Broadcast message to all players in a map
// Key changes to fix in server.js

// 1. Fix the broadcastToMap function
function broadcastToMap(mapId, message, excludePlayerId = null) {
  // IMPORTANT: Convert mapId to number to ensure consistent comparison
  const numericMapId = Number(mapId);
  
  for (const [id, player] of players.entries()) {
    // Skip excluded player
    if (id === excludePlayerId) continue;
    
    // Get the player's current map ID and convert to number
    let playerMapId = player.mapId;
    if (player.info && player.info.mapId) {
      playerMapId = player.info.mapId;
    }
    
    // CRITICAL: Compare as numbers, not strings
    const playerMapIdNumeric = Number(playerMapId);
    
    // Only send to players in the same map
    if (playerMapIdNumeric === numericMapId && player.ws.readyState === WebSocket.OPEN) {
      try {
        player.ws.send(JSON.stringify(message));
      } catch (error) {
        console.error(`Error broadcasting to player ${id}:`, error);
      }
    }
  }
}

// Clean up inactive players
function cleanupInactivePlayers() {
  const now = Date.now();
  const inactiveTimeout = 60000; // 60 seconds
  
  for (const [id, player] of players.entries()) {
    if (now - player.lastUpdate > inactiveTimeout) {
      console.log(`Removing inactive player: ${id}`);
      
      // Notify other players
      if (player.info) {
        broadcastToMap(player.mapId, {
          type: 'player_left',
          id
        });
      }
      
      // Close connection
      if (player.ws.readyState === WebSocket.OPEN) {
        player.ws.close();
      }
      
      // Remove from list
      players.delete(id);
    }
  }
}

// Start inactive player cleanup task
setInterval(cleanupInactivePlayers, 30000);

// Health check ping - keep connections alive and detect dead clients
const pingInterval = 30000; // 30 seconds
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      // Connection is dead, terminate it
      return ws.terminate();
    }
    
    // Mark as potentially inactive until we get a pong response
    ws.isAlive = false;
    // Send ping
    try {
      ws.ping();
    } catch (error) {
      console.error('Error sending ping:', error);
      ws.terminate();
    }
  });
}, pingInterval);

// Start the server
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`WebSocket server is listening for connections`);
});