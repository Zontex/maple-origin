const { getDb } = require('../db');
const NAME_REGEX = /^[a-zA-Z0-9]{3,12}$/;
const MAX_CHARACTERS_PER_WORLD = 3;

// Default beginner equipment
const DEFAULT_EQUIPS = [
  { slot: 4, itemId: 1040002 },   // White undershirt
  { slot: 5, itemId: 1060002 },   // Blue pants
  { slot: 6, itemId: 1072001 },   // Red Sneakers
  { slot: 10, itemId: 1302000 },  // Sword
];

// New characters start with empty inventory
const DEFAULT_ITEMS = [];

class Character {
  static isNameTaken(worldId, name) {
    const db = getDb();
    if (!NAME_REGEX.test(name)) {
      return { valid: false, error: 'Name must be 3-12 characters (letters and numbers only)' };
    }
    const existing = db.prepare(
      'SELECT id FROM characters WHERE world_id = ? AND name = ?'
    ).get(worldId, name);
    return { valid: true, taken: !!existing };
  }

  static create(userId, { worldId, name, hair, face, skin, gender, equips }) {
    if (typeof worldId !== 'number') {
      return { success: false, error: 'Invalid world' };
    }
    if (!NAME_REGEX.test(name)) {
      return { success: false, error: 'Name must be 3-12 characters (letters and numbers only)' };
    }

    const db = getDb();

    // Check character limit per world
    const count = db.prepare(
      'SELECT COUNT(*) as cnt FROM characters WHERE user_id = ? AND world_id = ?'
    ).get(userId, worldId);
    if (count.cnt >= MAX_CHARACTERS_PER_WORLD) {
      return { success: false, error: `Maximum ${MAX_CHARACTERS_PER_WORLD} characters per world` };
    }

    // Check name uniqueness within world
    const existing = db.prepare(
      'SELECT id FROM characters WHERE world_id = ? AND name = ?'
    ).get(worldId, name);
    if (existing) {
      return { success: false, error: 'Character name already taken in this world' };
    }

    const insertChar = db.prepare(`
      INSERT INTO characters (user_id, world_id, name, hair, face, skin, gender)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const insertEquip = db.prepare(`
      INSERT INTO equipped_items (character_id, slot, item_id) VALUES (?, ?, ?)
    `);

    const insertItem = db.prepare(`
      INSERT INTO inventory_items (character_id, tab, slot, item_id, quantity) VALUES (?, ?, ?, ?, ?)
    `);

    const createTransaction = db.transaction(() => {
      const result = insertChar.run(
        userId, worldId, name,
        hair || 30030, face || 20000, skin || 0, gender || 0
      );
      const charId = result.lastInsertRowid;

      // Add equipment — use player-selected equips if provided, otherwise defaults
      const charEquips = (Array.isArray(equips) && equips.length > 0) ? equips : DEFAULT_EQUIPS;
      for (const eq of charEquips) {
        insertEquip.run(charId, eq.slot, eq.itemId);
      }

      // Add default inventory
      for (const item of DEFAULT_ITEMS) {
        insertItem.run(charId, item.tab, item.slot, item.itemId, item.quantity);
      }

      return charId;
    });

    try {
      const characterId = createTransaction();
      return { success: true, characterId };
    } catch (err) {
      if (err.message.includes('UNIQUE constraint')) {
        return { success: false, error: 'Character name already taken in this world' };
      }
      throw err;
    }
  }

  static delete(userId, characterId) {
    const db = getDb();
    const char = db.prepare('SELECT id FROM characters WHERE id = ? AND user_id = ?').get(characterId, userId);
    if (!char) {
      return { success: false, error: 'Character not found' };
    }

    // CASCADE deletes inventory, equipped, quests
    db.prepare('DELETE FROM characters WHERE id = ?').run(characterId);
    return { success: true };
  }

  static getByUserAndWorld(userId, worldId) {
    const db = getDb();
    const chars = db.prepare(`
      SELECT id, name, level, job_id, hair, face, skin, gender, map_id,
             str, dex, int, luk, fame
      FROM characters WHERE user_id = ? AND world_id = ?
      ORDER BY created_at ASC
    `).all(userId, worldId);

    // Attach equipped items for each character (needed for preview)
    const getEquipped = db.prepare(
      'SELECT slot, item_id FROM equipped_items WHERE character_id = ?'
    );
    for (const c of chars) {
      c.equipped = getEquipped.all(c.id);
    }
    return chars;
  }

  static getFullCharacter(characterId, userId) {
    const db = getDb();

    const char = db.prepare(`
      SELECT * FROM characters WHERE id = ? AND user_id = ?
    `).get(characterId, userId);
    if (!char) return null;

    const equipped = db.prepare(
      'SELECT slot, item_id FROM equipped_items WHERE character_id = ?'
    ).all(characterId);

    const inventory = db.prepare(
      'SELECT tab, slot, item_id, quantity FROM inventory_items WHERE character_id = ?'
    ).all(characterId);

    const quests = db.prepare(
      'SELECT quest_id, state, mob_progress FROM quests WHERE character_id = ?'
    ).all(characterId);

    return {
      id: char.id,
      name: char.name,
      worldId: char.world_id,
      level: char.level,
      exp: char.exp,
      stats: {
        str: char.str,
        dex: char.dex,
        int: char.int,
        luk: char.luk,
        ap: char.ap,
        maxHp: char.max_hp,
        maxMp: char.max_mp,
        jobId: char.job_id,
        level: char.level,
      },
      hp: char.hp,
      maxHp: char.max_hp,
      mp: char.mp,
      maxMp: char.max_mp,
      mapId: char.map_id,
      posX: char.pos_x,
      posY: char.pos_y,
      mesos: char.mesos,
      hair: char.hair,
      face: char.face,
      skin: char.skin,
      gender: char.gender,
      fame: char.fame,
      equipped,
      inventory: groupInventory(inventory),
      quests,
    };
  }

  static saveCharacter(characterId, data) {
    const db = getDb();

    const updateChar = db.prepare(`
      UPDATE characters SET
        level = ?, exp = ?, str = ?, dex = ?, int = ?, luk = ?, ap = ?,
        hp = ?, max_hp = ?, mp = ?, max_mp = ?,
        job_id = ?, map_id = ?, pos_x = ?, pos_y = ?,
        mesos = ?, fame = ?
      WHERE id = ?
    `);

    const deleteEquipped = db.prepare('DELETE FROM equipped_items WHERE character_id = ?');
    const insertEquipped = db.prepare(
      'INSERT INTO equipped_items (character_id, slot, item_id) VALUES (?, ?, ?)'
    );

    const deleteInventory = db.prepare('DELETE FROM inventory_items WHERE character_id = ?');
    const insertInventory = db.prepare(
      'INSERT INTO inventory_items (character_id, tab, slot, item_id, quantity) VALUES (?, ?, ?, ?, ?)'
    );

    const deleteQuests = db.prepare('DELETE FROM quests WHERE character_id = ?');
    const insertQuest = db.prepare(
      'INSERT INTO quests (character_id, quest_id, state, mob_progress) VALUES (?, ?, ?, ?)'
    );

    const saveTransaction = db.transaction(() => {
      // Update character stats
      updateChar.run(
        data.level ?? 1, data.exp ?? 0,
        data.str ?? 12, data.dex ?? 5, data.int ?? 4, data.luk ?? 4, data.ap ?? 0,
        data.hp ?? 50, data.maxHp ?? 50, data.mp ?? 5, data.maxMp ?? 5,
        data.jobId ?? 0, data.mapId ?? 10000, data.posX ?? 0, data.posY ?? 0,
        data.mesos ?? 0, data.fame ?? 0,
        characterId
      );

      // Replace equipped items
      deleteEquipped.run(characterId);
      if (data.equipped) {
        for (const eq of data.equipped) {
          insertEquipped.run(characterId, eq.slot, eq.itemId || eq.item_id);
        }
      }

      // Replace inventory
      deleteInventory.run(characterId);
      if (data.inventory) {
        for (const [tab, items] of Object.entries(data.inventory)) {
          for (let slot = 0; slot < items.length; slot++) {
            const item = items[slot];
            if (item && item.itemId && item.quantity > 0) {
              insertInventory.run(characterId, tab, slot, item.itemId, item.quantity);
            }
          }
        }
      }

      // Replace quests
      deleteQuests.run(characterId);
      if (data.quests) {
        for (const q of data.quests) {
          insertQuest.run(characterId, q.questId, q.state, q.mobProgress || '{}');
        }
      }
    });

    try {
      saveTransaction();
      return { success: true };
    } catch (err) {
      console.error('[DB] Save character error:', err);
      return { success: false, error: 'Failed to save character' };
    }
  }
}

function groupInventory(rows) {
  const inv = { equip: [], use: [], setup: [], etc: [], cash: [] };
  for (const row of rows) {
    if (!inv[row.tab]) inv[row.tab] = [];
    // Ensure slot index is filled
    while (inv[row.tab].length <= row.slot) inv[row.tab].push(null);
    inv[row.tab][row.slot] = { itemId: row.item_id, quantity: row.quantity };
  }
  return inv;
}

module.exports = Character;
