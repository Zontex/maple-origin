const bcrypt = require('bcryptjs');
const { getDb } = require('../db');

const SALT_ROUNDS = 10;
const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,12}$/;
const PASSWORD_MIN_LENGTH = 4;

class User {
  static register(username, password) {
    if (!USERNAME_REGEX.test(username)) {
      return { success: false, error: 'Username must be 3-12 characters (letters, numbers, underscore)' };
    }
    if (!password || password.length < PASSWORD_MIN_LENGTH) {
      return { success: false, error: `Password must be at least ${PASSWORD_MIN_LENGTH} characters` };
    }

    const db = getDb();

    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existing) {
      return { success: false, error: 'Username already taken' };
    }

    const hash = bcrypt.hashSync(password, SALT_ROUNDS);
    const result = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username, hash);

    return { success: true, userId: result.lastInsertRowid };
  }

  static login(username, password) {
    if (!username || !password) {
      return { success: false, error: 'Username and password required' };
    }

    const db = getDb();
    const user = db.prepare('SELECT id, username, password_hash FROM users WHERE username = ?').get(username);

    if (!user) {
      return { success: false, error: 'Invalid username or password' };
    }

    if (!bcrypt.compareSync(password, user.password_hash)) {
      return { success: false, error: 'Invalid username or password' };
    }

    return { success: true, userId: user.id, username: user.username };
  }

  static getById(userId) {
    const db = getDb();
    return db.prepare('SELECT id, username, created_at FROM users WHERE id = ?').get(userId);
  }
}

module.exports = User;
