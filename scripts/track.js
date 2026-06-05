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

  async acceptFriendRequests() {
    // 1. Get notifications
    const res = await this._fetch('/auth/user/notifications?type=friendRequest');
    if (!res.ok) return;
    const notifications = await res.json();

    const friendRequests = notifications.filter(n => n.type === 'friendRequest');
    for (const req of friendRequests) {
      console.log(`[VRC] Accepting friend request from ${req.senderUsername} (${req.senderUserId})`);
      await this._fetch(`/auth/user/notifications/${req.id}/accept`, { method: 'PUT' });
      // Mark as seen so it doesn't clutter
      await this._fetch(`/auth/user/notifications/${req.id}`, { method: 'PUT' });
      await sleep(1000);
    }
  }

  async getAllFriends() {
    let friends = [];
    let offset = 0;
    while (true) {
      const res = await this._fetch(`/auth/user/friends?offline=true&n=100&offset=${offset}`);
      if (!res.ok) break;
      const batch = await res.json();
      if (batch.length === 0) break;
      friends = friends.concat(batch);
      offset += 100;
      await sleep(500);
    }
    return friends;
  }

  async getOnlineFriends() {
    let friends = [];
    let offset = 0;
    while (true) {
      const res = await this._fetch(`/auth/user/friends?offline=false&n=100&offset=${offset}`);
      if (!res.ok) break;
      const batch = await res.json();
      if (batch.length === 0) break;
      friends = friends.concat(batch);
      offset += 100;
      await sleep(500);
    }
    return friends;
  }
}

// ─── Data Management ────────────────────────────────────────
function ensureDirs() {
  fs.mkdirSync(PLAYTIME_DIR, { recursive: true });
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

  // Refresh full user list at start
  console.log('[Track] Syncing full friend list...');
  await client.acceptFriendRequests();
  const allFriends = await client.getAllFriends();
  
  let usersMap = {};
  for (const f of allFriends) {
    usersMap[f.id] = {
      id: f.id,
      displayName: f.displayName,
      bio: f.bio || '',
      avatarUrl: f.currentAvatarThumbnailImageUrl || '',
      profilePicUrl: f.profilePicOverride || f.currentAvatarThumbnailImageUrl || '',
      statusDescription: f.statusDescription || '',
      status: f.status || 'offline',
      trustRank: extractTrustRank(f.tags),
      trackedSince: trackedSinceMap[f.id] || new Date().toISOString(),
    };
  }
  saveUsersIndex(Object.values(usersMap));
  console.log(`[Track] Tracking ${Object.keys(usersMap).length} total friends.`);

  async function poll() {
    pollCount++;
    const elapsed = ((Date.now() - startTime) / 60000).toFixed(1);
    console.log(`\n[Track] Poll #${pollCount} (${elapsed}m elapsed)`);

    try {
      // Accept any new friend requests
      await client.acceptFriendRequests();

      // Get only online friends
      const onlineFriends = await client.getOnlineFriends();
      console.log(`[Track] ${onlineFriends.length} friends online.`);

      const today = todayStr();
      const intervalMinutes = Math.round(POLL_INTERVAL_MS / 60000);

      for (const friend of onlineFriends) {
        // Ensure user is in our local map
        if (!usersMap[friend.id]) {
          console.log(`[Track] New friend detected: ${friend.displayName}`);
          usersMap[friend.id] = {
            id: friend.id,
            displayName: friend.displayName,
            bio: friend.bio || '',
            avatarUrl: friend.currentAvatarThumbnailImageUrl || '',
            profilePicUrl: friend.profilePicOverride || friend.currentAvatarThumbnailImageUrl || '',
            statusDescription: friend.statusDescription || '',
            status: friend.status || 'online',
            trustRank: extractTrustRank(friend.tags),
            trackedSince: new Date().toISOString(),
          };
        } else {
          // Update volatile fields
          usersMap[friend.id].statusDescription = friend.statusDescription || '';
          usersMap[friend.id].status = friend.status || 'online';
        }

        // Log Playtime
        const playtime = loadPlaytime(friend.id);
        const todayEntry = playtime.find(p => p.date === today);
        if (todayEntry) {
          todayEntry.minutes += intervalMinutes;
        } else {
          playtime.push({ date: today, minutes: intervalMinutes });
        }
        savePlaytime(friend.id, playtime);
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
