const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'maple.db');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema();
  }
  return db;
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS characters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      world_id INTEGER NOT NULL DEFAULT 0,
      name TEXT NOT NULL COLLATE NOCASE,
      level INTEGER DEFAULT 1,
      exp INTEGER DEFAULT 0,
      str INTEGER DEFAULT 12,
      dex INTEGER DEFAULT 5,
      int INTEGER DEFAULT 4,
      luk INTEGER DEFAULT 4,
      ap INTEGER DEFAULT 0,
      hp INTEGER DEFAULT 50,
      max_hp INTEGER DEFAULT 50,
      mp INTEGER DEFAULT 5,
      max_mp INTEGER DEFAULT 5,
      job_id INTEGER DEFAULT 0,
      map_id INTEGER DEFAULT 10000,
      pos_x INTEGER DEFAULT 0,
      pos_y INTEGER DEFAULT 0,
      mesos INTEGER DEFAULT 0,
      hair INTEGER DEFAULT 30030,
      face INTEGER DEFAULT 20000,
      skin INTEGER DEFAULT 0,
      fame INTEGER DEFAULT 0,
      gender INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(world_id, name),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS inventory_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      character_id INTEGER NOT NULL,
      tab TEXT NOT NULL CHECK(tab IN ('equip','use','setup','etc','cash')),
      slot INTEGER NOT NULL,
      item_id INTEGER NOT NULL,
      quantity INTEGER DEFAULT 1,
      UNIQUE(character_id, tab, slot),
      FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS equipped_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      character_id INTEGER NOT NULL,
      slot INTEGER NOT NULL,
      item_id INTEGER NOT NULL,
      UNIQUE(character_id, slot),
      FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS quests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      character_id INTEGER NOT NULL,
      quest_id INTEGER NOT NULL,
      state INTEGER DEFAULT 0,
      UNIQUE(character_id, quest_id),
      FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_characters_user_world ON characters(user_id, world_id);
    CREATE INDEX IF NOT EXISTS idx_inventory_character ON inventory_items(character_id);
    CREATE INDEX IF NOT EXISTS idx_equipped_character ON equipped_items(character_id);
    CREATE INDEX IF NOT EXISTS idx_quests_character ON quests(character_id);
  `);

  console.log('[DB] SQLite schema initialized');
}

function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = { getDb, closeDb };
