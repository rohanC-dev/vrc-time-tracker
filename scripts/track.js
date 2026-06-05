/**
 * VRChat Auto-Friending Tracker for GitHub Actions
 * Runs for ~5h55m, polling online friends every 5 minutes.
 * Automatically accepts incoming friend requests to start tracking.
 */

const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const { CookieJar } = require('tough-cookie');

// ─── Config ─────────────────────────────────────────────────
const ROOT = path.join(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'data', 'config.json');
const USERS_PATH = path.join(ROOT, 'public', 'data', 'users.json');
const PLAYTIME_DIR = path.join(ROOT, 'public', 'data', 'playtime');

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_RUNTIME_MS = 5 * 60 * 60 * 1000 + 55 * 60 * 1000; // 5h55m
const SAVE_INTERVAL_MS = 30 * 60 * 1000; // Save checkpoint

const BASE_URL = 'https://api.vrchat.cloud/api/1';
const USER_AGENT = 'VRCTimeTracker/1.0.0 (https://github.com/vrc-time-tracker)';

// ─── VRChat API Client ──────────────────────────────────────
class VRChatClient {
  constructor() {
    this.cookieJar = new CookieJar();
    this.authCookie = null;
    this.isAuthenticated = false;
  }

  async _fetch(urlPath, options = {}) {
    const url = `${BASE_URL}${urlPath}`;
    const cookies = await this.cookieJar.getCookieString(url);

    const headers = {
      'User-Agent': USER_AGENT,
      'Content-Type': 'application/json',
      ...(cookies ? { Cookie: cookies } : {}),
      ...(this.authCookie ? { Cookie: `auth=${this.authCookie}; ${cookies}` } : {}),
      ...options.headers,
    };

    const response = await fetch(url, { ...options, headers, redirect: 'manual' });

    const setCookies = response.headers.raw()['set-cookie'];
    if (setCookies) {
      for (const cookie of setCookies) {
        try {
          await this.cookieJar.setCookie(cookie, url);
          if (cookie.startsWith('auth=')) {
            this.authCookie = cookie.split('auth=')[1].split(';')[0];
          }
        } catch (e) { /* ignore */ }
      }
    }

    return response;
  }

  async login(username, password) {
    console.log('[VRC] Logging in...');
    try { await this._fetch('/config'); } catch (e) { /* ignore */ }

    const authHeader = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
    const res = await this._fetch('/auth/user', { headers: { Authorization: authHeader } });

    if (!res.ok) throw new Error(`Login failed (${res.status})`);
    const data = await res.json();
    if (data.requiresTwoFactorAuth) throw new Error('2FA required on bot account');

    this.isAuthenticated = true;
    console.log(`[VRC] Logged in as: ${data.displayName}`);
    return data;
  }

  async getUserInfo(userId) {
    const res = await this._fetch(`/users/${userId}`);
    if (!res.ok) {
      if (res.status === 404) return null;
      throw new Error(`Failed to fetch user ${userId}`);
    }
    return await res.json();
  }
}

// ─── Data Management ────────────────────────────────────────
function ensureDirs() {
  fs.mkdirSync(PLAYTIME_DIR, { recursive: true });
  fs.mkdirSync(path.join(ROOT, 'data'), { recursive: true });
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return { trackedUsers: [] };
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
}

function loadUsersIndex() {
  if (!fs.existsSync(USERS_PATH)) return [];
  return JSON.parse(fs.readFileSync(USERS_PATH, 'utf-8'));
}

function saveUsersIndex(users) {
  fs.writeFileSync(USERS_PATH, JSON.stringify(users, null, 2));
}

function loadPlaytime(userId) {
  const filePath = path.join(PLAYTIME_DIR, `${userId}.json`);
  if (!fs.existsSync(filePath)) return [];
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function savePlaytime(userId, data) {
  const filePath = path.join(PLAYTIME_DIR, `${userId}.json`);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

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

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Main Tracker Loop ──────────────────────────────────────
async function main() {
  const username = process.env.VRCHAT_USERNAME;
  const password = process.env.VRCHAT_PASSWORD;

  if (!username || !password) {
    console.error('[Track] Missing VRCHAT_USERNAME or VRCHAT_PASSWORD');
    process.exit(1);
  }

  ensureDirs();

  const client = new VRChatClient();
  await client.login(username, password);

  console.log(`[Track] Tracker started. Poll interval: 5m, Max runtime: ~6h`);

  const startTime = Date.now();
  let pollCount = 0;
  let lastSaveTime = Date.now();

  // Load existing users to preserve 'trackedSince'
  const existingUsers = loadUsersIndex();
  const trackedSinceMap = {};
  for (const u of existingUsers) {
    trackedSinceMap[u.id] = u.trackedSince || new Date().toISOString();
  }

  let usersMap = {};
  for (const u of existingUsers) {
    usersMap[u.id] = u;
  }

  async function poll() {
    pollCount++;
    const elapsed = ((Date.now() - startTime) / 60000).toFixed(1);
    console.log(`\n[Track] Poll #${pollCount} (${elapsed}m elapsed)`);

    try {
      const config = loadConfig();
      const targetIds = config.trackedUsers || [];
      console.log(`[Track] Polling ${targetIds.length} users...`);

      const today = todayStr();
      const intervalMinutes = Math.round(POLL_INTERVAL_MS / 60000);

      for (const userId of targetIds) {
        // Individual polling (RISKY - easily rate limited)
        const user = await client.getUserInfo(userId);
        if (!user) continue;

        usersMap[userId] = {
          id: user.id,
          displayName: user.displayName,
          bio: user.bio || '',
          avatarUrl: user.currentAvatarThumbnailImageUrl || '',
          profilePicUrl: user.profilePicOverride || user.currentAvatarThumbnailImageUrl || '',
          statusDescription: user.statusDescription || '',
          status: user.status || 'offline',
          trustRank: extractTrustRank(user.tags),
          trackedSince: trackedSinceMap[userId] || new Date().toISOString(),
        };

        // If they are online (or actively playing in a private world if status exposes it), increment playtime
        // Note: For non-friends, status may just be 'offline' if in a private world.
        if (user.status !== 'offline') {
          const playtime = loadPlaytime(userId);
          const todayEntry = playtime.find(p => p.date === today);
          if (todayEntry) {
            todayEntry.minutes += intervalMinutes;
          } else {
            playtime.push({ date: today, minutes: intervalMinutes });
          }
          savePlaytime(userId, playtime);
        }

        // Sleep to avoid blasting the API and getting insta-banned
        await sleep(2000); 
      }

      saveUsersIndex(Object.values(usersMap));

    } catch (err) {
      console.error(`[Track] Poll error: ${err.message}`);
      if (err.message.includes('401')) {
        console.log('[Track] Auth expired, attempting re-login...');
        try { await client.login(username, password); } catch (e) {}
      }
    }

    if (Date.now() - lastSaveTime > SAVE_INTERVAL_MS) {
      console.log('[Track] Periodic save checkpoint');
      lastSaveTime = Date.now();
    }
  }

  await poll();

  return new Promise((resolve) => {
    const interval = setInterval(async () => {
      if (Date.now() - startTime >= MAX_RUNTIME_MS) {
        console.log('\n[Track] Max runtime reached. Shutting down gracefully...');
        clearInterval(interval);
        resolve();
        return;
      }
      await poll();
    }, POLL_INTERVAL_MS);

    process.on('SIGTERM', () => { clearInterval(interval); resolve(); });
    process.on('SIGINT', () => { clearInterval(interval); resolve(); });
  });
}

main()
  .then(() => {
    console.log('[Track] Done.');
    process.exit(0);
  })
  .catch(err => {
    console.error('[Track] Fatal error:', err);
    process.exit(1);
  });
