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

    const skills = db.prepare(
      'SELECT skill_id, skill_level, master_level FROM skills WHERE character_id = ?'
    ).all(characterId);

    const keymap = db.prepare(
      'SELECT key_code, bind_type, action_id FROM keymap WHERE character_id = ?'
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
        sp: char.sp || 0,
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
      skills: skills.map(s => ({ skillId: s.skill_id, skillLevel: s.skill_level, masterLevel: s.master_level })),
      keymap: keymap.map(k => ({ keyCode: k.key_code, bindType: k.bind_type, actionId: k.action_id })),
    };
  }

  static saveCharacter(characterId, data) {
    const db = getDb();

    const updateChar = db.prepare(`
      UPDATE characters SET
        level = ?, exp = ?, str = ?, dex = ?, int = ?, luk = ?, ap = ?, sp = ?,
        hp = ?, max_hp = ?, mp = ?, max_mp = ?,
        job_id = ?, map_id = ?, pos_x = ?, pos_y = ?,
        mesos = ?, fame = ?, hair = ?, face = ?, skin = ?
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
      'INSERT INTO quests (character_id, quest_id, state, mob_progress, completed_at) VALUES (?, ?, ?, ?, ?)'
    );

    const deleteSkills = db.prepare('DELETE FROM skills WHERE character_id = ?');
    const insertSkill = db.prepare(
      'INSERT INTO skills (character_id, skill_id, skill_level, master_level) VALUES (?, ?, ?, ?)'
    );

    const deleteKeymap = db.prepare('DELETE FROM keymap WHERE character_id = ?');
    const insertKeymap = db.prepare(
      'INSERT INTO keymap (character_id, key_code, bind_type, action_id) VALUES (?, ?, ?, ?)'
    );

    // Partial saves (e.g. disconnect fallback from positional data) must not
    // reset fields they don't carry — fall back to the stored row, not defaults
    const current = db.prepare('SELECT * FROM characters WHERE id = ?').get(characterId);
    if (!current) {
      return { success: false, error: 'Character not found' };
    }

    const saveTransaction = db.transaction(() => {
      // Update character stats
      updateChar.run(
        data.level ?? current.level, data.exp ?? current.exp,
        data.str ?? current.str, data.dex ?? current.dex, data.int ?? current.int,
        data.luk ?? current.luk, data.ap ?? current.ap, data.sp ?? current.sp,
        data.hp ?? current.hp, data.maxHp ?? current.max_hp,
        data.mp ?? current.mp, data.maxMp ?? current.max_mp,
        data.jobId ?? current.job_id, data.mapId ?? current.map_id,
        data.posX ?? current.pos_x, data.posY ?? current.pos_y,
        data.mesos ?? current.mesos, data.fame ?? current.fame,
        data.hair ?? current.hair, data.face ?? current.face, data.skin ?? current.skin,
        characterId
      );

      // Replace equipped items — only when the payload carries them, so a
      // partial save doesn't delete rows it has no data to re-insert
      if (data.equipped) {
        deleteEquipped.run(characterId);
        for (const eq of data.equipped) {
          insertEquipped.run(characterId, eq.slot, eq.itemId || eq.item_id);
        }
      }

      // Replace inventory
      if (data.inventory) {
        deleteInventory.run(characterId);
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
      if (data.quests) {
        deleteQuests.run(characterId);
        for (const q of data.quests) {
          insertQuest.run(characterId, q.questId, q.state, q.mobProgress || '{}', q.completedAt ?? null);
        }
      }

      // Replace skills
      if (data.skills) {
        deleteSkills.run(characterId);
        for (const s of data.skills) {
          if (s.skillLevel > 0) {
            insertSkill.run(characterId, s.skillId, s.skillLevel, s.masterLevel || 0);
          }
        }
      }

      // Replace keymap
      if (data.keymap) {
        deleteKeymap.run(characterId);
        for (const k of data.keymap) {
          insertKeymap.run(characterId, k.keyCode, k.bindType || 1, k.actionId);
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
