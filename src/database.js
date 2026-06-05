const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'vrc-tracker.db');

let db = null;
let SQL = null;

async function getDb() {
  if (db) return db;

  SQL = await initSqlJs();

  // Load existing database or create new
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  initialize();
  return db;
}

function initialize() {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      displayName TEXT NOT NULL,
      bio TEXT DEFAULT '',
      avatarUrl TEXT DEFAULT '',
      profilePicUrl TEXT DEFAULT '',
      statusDescription TEXT DEFAULT '',
      trustRank TEXT DEFAULT '',
      lastOnline TEXT,
      trackedSince TEXT NOT NULL DEFAULT (datetime('now')),
      isTracking INTEGER NOT NULL DEFAULT 1
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS playtime (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId TEXT NOT NULL,
      date TEXT NOT NULL,
      minutes INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (userId) REFERENCES users(id),
      UNIQUE(userId, date)
    )
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_playtime_user_date ON playtime(userId, date)`);

  saveToFile();
}

function saveToFile() {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

// Auto-save every 30 seconds
setInterval(() => {
  if (db) saveToFile();
}, 30000);

// ─── User Operations ────────────────────────────────────────

function extractTrustRank(tags) {
  if (!tags) return 'Visitor';
  if (tags.includes('system_legend')) return 'Legendary User';
  if (tags.includes('system_trust_legend')) return 'Veteran';
  if (tags.includes('system_trust_veteran')) return 'Trusted';
  if (tags.includes('system_trust_trusted')) return 'Known';
  if (tags.includes('system_trust_known')) return 'User';
  if (tags.includes('system_trust_basic')) return 'New User';
  return 'Visitor';
}

function upsertUser(user) {
  const params = {
    ':id': user.id,
    ':displayName': user.displayName || 'Unknown',
    ':bio': user.bio || '',
    ':avatarUrl': user.currentAvatarThumbnailImageUrl || user.currentAvatarImageUrl || '',
    ':profilePicUrl': user.profilePicOverride || user.currentAvatarThumbnailImageUrl || '',
    ':statusDescription': user.statusDescription || '',
    ':trustRank': extractTrustRank(user.tags),
  };

  db.run(`
    INSERT OR REPLACE INTO users (id, displayName, bio, avatarUrl, profilePicUrl, statusDescription, trustRank, trackedSince, isTracking)
    VALUES (
      :id, :displayName, :bio, :avatarUrl, :profilePicUrl, :statusDescription, :trustRank,
      COALESCE((SELECT trackedSince FROM users WHERE id = :id), datetime('now')),
      COALESCE((SELECT isTracking FROM users WHERE id = :id), 1)
    )
  `, params);

  saveToFile();
}

function getUser(userId) {
  const stmt = db.prepare('SELECT * FROM users WHERE id = :id');
  stmt.bind({ ':id': userId });
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return row;
  }
  stmt.free();
  return null;
}

function getTrackedUsers() {
  const results = [];
  const stmt = db.prepare('SELECT * FROM users WHERE isTracking = 1');
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

function setTracking(userId, isTracking) {
  db.run('UPDATE users SET isTracking = :val WHERE id = :id', {
    ':val': isTracking ? 1 : 0,
    ':id': userId,
  });
  saveToFile();
}

function updateLastOnline(userId) {
  db.run("UPDATE users SET lastOnline = datetime('now') WHERE id = :id", { ':id': userId });
}

// ─── Playtime Operations ────────────────────────────────────

function logPlaytime(userId, minutes) {
  const today = new Date().toISOString().slice(0, 10);
  // Try insert first, then update on conflict
  try {
    db.run('INSERT INTO playtime (userId, date, minutes) VALUES (:userId, :date, :minutes)', {
      ':userId': userId,
      ':date': today,
      ':minutes': minutes,
    });
  } catch {
    // Row exists, update it
    db.run('UPDATE playtime SET minutes = minutes + :minutes WHERE userId = :userId AND date = :date', {
      ':minutes': minutes,
      ':userId': userId,
      ':date': today,
    });
  }
  saveToFile();
}

function getPlaytimeForUser(userId, days = 365) {
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceStr = since.toISOString().slice(0, 10);

  const results = [];
  const stmt = db.prepare('SELECT date, minutes FROM playtime WHERE userId = :userId AND date >= :since ORDER BY date ASC');
  stmt.bind({ ':userId': userId, ':since': sinceStr });
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

function getTotalPlaytime(userId) {
  const stmt = db.prepare('SELECT COALESCE(SUM(minutes), 0) as total FROM playtime WHERE userId = :id');
  stmt.bind({ ':id': userId });
  let total = 0;
  if (stmt.step()) {
    total = stmt.getAsObject().total;
  }
  stmt.free();
  return total;
}

function getTrackedUserCount() {
  const stmt = db.prepare('SELECT COUNT(*) as count FROM users WHERE isTracking = 1');
  let count = 0;
  if (stmt.step()) {
    count = stmt.getAsObject().count;
  }
  stmt.free();
  return count;
}

module.exports = {
  getDb,
  upsertUser,
  getUser,
  getTrackedUsers,
  setTracking,
  updateLastOnline,
  logPlaytime,
  getPlaytimeForUser,
  getTotalPlaytime,
  getTrackedUserCount,
  saveToFile,
};
