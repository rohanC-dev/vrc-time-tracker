/**
 * Standalone VRChat tracker for GitHub Actions.
 * Runs for ~5h55m, polling tracked users every 5 minutes.
 * Writes playtime data to public/data/ as JSON files.
 * At the end, the GitHub Action commits and pushes the updated data.
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
const REQUEST_DELAY_MS = 1500; // 1.5s between API calls
const SAVE_INTERVAL_MS = 30 * 60 * 1000; // Save and commit every 30 minutes

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
    try {
      await this._fetch('/config');
    } catch (e) { /* ignore */ }

    const authHeader = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
    const res = await this._fetch('/auth/user', { headers: { Authorization: authHeader } });

    if (!res.ok) throw new Error(`Login failed (${res.status}): ${await res.text()}`);

    const data = await res.json();
    if (data.requiresTwoFactorAuth) {
      throw new Error('2FA required — set VRCHAT_2FA_SECRET for automated 2FA, or disable 2FA on the bot account');
    }

    this.isAuthenticated = true;
    console.log(`[VRC] Logged in as: ${data.displayName}`);
    return data;
  }

  async searchUsers(query, n = 10) {
    const res = await this._fetch(`/users?search=${encodeURIComponent(query)}&n=${n}`);
    if (!res.ok) throw new Error(`Search failed (${res.status})`);
    return res.json();
  }

  async getUserById(userId) {
    const res = await this._fetch(`/users/${encodeURIComponent(userId)}`);
    if (!res.ok) {
      if (res.status === 404) return null;
      throw new Error(`Get user failed (${res.status})`);
    }
    return res.json();
  }
}

// ─── Data Management ────────────────────────────────────────
function ensureDirs() {
  fs.mkdirSync(path.join(ROOT, 'data'), { recursive: true });
  fs.mkdirSync(PLAYTIME_DIR, { recursive: true });
  fs.mkdirSync(path.dirname(USERS_PATH), { recursive: true });
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    const defaultConfig = { trackedUsers: [] };
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(defaultConfig, null, 2));
    return defaultConfig;
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
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

  const config = loadConfig();

  if (config.trackedUsers.length === 0) {
    console.log('[Track] No users to track. Add user IDs to data/config.json');
    process.exit(0);
  }

  console.log(`[Track] Tracking ${config.trackedUsers.length} user(s)`);
  console.log(`[Track] Poll interval: ${POLL_INTERVAL_MS / 60000}m, Max runtime: ${MAX_RUNTIME_MS / 3600000}h`);

  const startTime = Date.now();
  let pollCount = 0;
  let lastSaveTime = Date.now();

  // Initial resolve: fetch user profiles for all tracked users
  const usersIndex = loadUsersIndex();
  const usersMap = {};
  for (const u of usersIndex) usersMap[u.id] = u;

  async function poll() {
    pollCount++;
    const elapsed = ((Date.now() - startTime) / 60000).toFixed(1);
    console.log(`\n[Track] Poll #${pollCount} (${elapsed}m elapsed)`);

    let onlineCount = 0;
    const today = todayStr();
    const intervalMinutes = Math.round(POLL_INTERVAL_MS / 60000);

    for (const userId of config.trackedUsers) {
      try {
        const user = await client.getUserById(userId);
        if (!user) {
          console.log(`  ⚠ ${userId}: not found`);
          continue;
        }

        // Update user index
        usersMap[user.id] = {
          id: user.id,
          displayName: user.displayName,
          bio: user.bio || '',
          avatarUrl: user.currentAvatarThumbnailImageUrl || '',
          profilePicUrl: user.profilePicOverride || user.currentAvatarThumbnailImageUrl || '',
          statusDescription: user.statusDescription || '',
          status: user.status || 'offline',
          state: user.state || 'offline',
          trustRank: extractTrustRank(user.tags),
          lastChecked: new Date().toISOString(),
        };

        const isOnline = user.state === 'online' || user.state === 'active';
        const statusIcon = isOnline ? '🟢' : '⚫';
        console.log(`  ${statusIcon} ${user.displayName}: ${user.state}`);

        if (isOnline) {
          onlineCount++;
          // Load playtime data and add today's minutes
          const playtime = loadPlaytime(userId);
          const todayEntry = playtime.find(p => p.date === today);
          if (todayEntry) {
            todayEntry.minutes += intervalMinutes;
          } else {
            playtime.push({ date: today, minutes: intervalMinutes });
          }
          savePlaytime(userId, playtime);
        }

        // Rate limit between requests
        await sleep(REQUEST_DELAY_MS);
      } catch (err) {
        console.error(`  ❌ ${userId}: ${err.message}`);
        if (err.message.includes('401')) {
          console.log('[Track] Auth expired, attempting re-login...');
          try {
            await client.login(username, password);
          } catch (loginErr) {
            console.error('[Track] Re-login failed:', loginErr.message);
          }
        }
      }
    }

    // Save users index
    saveUsersIndex(Object.values(usersMap));

    console.log(`[Track] ${onlineCount}/${config.trackedUsers.length} users online`);

    // Periodic save (commit signal for the workflow)
    if (Date.now() - lastSaveTime > SAVE_INTERVAL_MS) {
      console.log('[Track] Periodic save checkpoint');
      lastSaveTime = Date.now();
    }
  }

  // Run first poll immediately
  await poll();

  // Then poll on interval until max runtime
  return new Promise((resolve) => {
    const interval = setInterval(async () => {
      const elapsed = Date.now() - startTime;
      if (elapsed >= MAX_RUNTIME_MS) {
        console.log('\n[Track] Max runtime reached. Shutting down gracefully...');
        clearInterval(interval);
        // Final save
        saveUsersIndex(Object.values(usersMap));
        resolve();
        return;
      }
      await poll();
    }, POLL_INTERVAL_MS);

    // Also handle graceful shutdown
    process.on('SIGTERM', () => {
      console.log('\n[Track] SIGTERM received. Saving and shutting down...');
      clearInterval(interval);
      saveUsersIndex(Object.values(usersMap));
      resolve();
    });

    process.on('SIGINT', () => {
      console.log('\n[Track] SIGINT received. Saving and shutting down...');
      clearInterval(interval);
      saveUsersIndex(Object.values(usersMap));
      resolve();
    });
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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
