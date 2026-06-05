/**
 * Add a VRChat user to the tracking config.
 * Usage: node scripts/add-user.js "DisplayName"
 *
 * Searches the VRChat API, shows matches, and adds the first result
 * (or the best match) to data/config.json and public/data/users.json.
 */

const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const { CookieJar } = require('tough-cookie');

const ROOT = path.join(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'data', 'config.json');
const USERS_PATH = path.join(ROOT, 'public', 'data', 'users.json');
const PLAYTIME_DIR = path.join(ROOT, 'public', 'data', 'playtime');

const BASE_URL = 'https://api.vrchat.cloud/api/1';
const USER_AGENT = 'VRCTimeTracker/1.0.0';

// ─── Minimal VRChat client ──────────────────────────────────
const cookieJar = new CookieJar();
let authCookie = null;

async function vrcFetch(urlPath, options = {}) {
  const url = `${BASE_URL}${urlPath}`;
  const cookies = await cookieJar.getCookieString(url);
  const headers = {
    'User-Agent': USER_AGENT,
    'Content-Type': 'application/json',
    ...(cookies ? { Cookie: cookies } : {}),
    ...(authCookie ? { Cookie: `auth=${authCookie}; ${cookies}` } : {}),
    ...options.headers,
  };
  const response = await fetch(url, { ...options, headers, redirect: 'manual' });
  const setCookies = response.headers.raw()['set-cookie'];
  if (setCookies) {
    for (const cookie of setCookies) {
      try {
        await cookieJar.setCookie(cookie, url);
        if (cookie.startsWith('auth=')) {
          authCookie = cookie.split('auth=')[1].split(';')[0];
        }
      } catch (e) { /* ignore */ }
    }
  }
  return response;
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

async function main() {
  const searchQuery = process.argv[2];
  if (!searchQuery) {
    console.error('Usage: node scripts/add-user.js "VRChat Display Name"');
    process.exit(1);
  }

  const username = process.env.VRCHAT_USERNAME;
  const password = process.env.VRCHAT_PASSWORD;
  if (!username || !password) {
    console.error('Missing VRCHAT_USERNAME or VRCHAT_PASSWORD env vars');
    process.exit(1);
  }

  // Login
  console.log('[AddUser] Logging in...');
  try { await vrcFetch('/config'); } catch (e) { /* ignore */ }

  const authHeader = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
  const loginRes = await vrcFetch('/auth/user', { headers: { Authorization: authHeader } });
  if (!loginRes.ok) throw new Error(`Login failed: ${loginRes.status}`);
  const loginData = await loginRes.json();
  if (loginData.requiresTwoFactorAuth) {
    throw new Error('2FA required on bot account');
  }
  console.log(`[AddUser] Logged in as: ${loginData.displayName}`);

  // Search
  console.log(`[AddUser] Searching for "${searchQuery}"...`);
  const searchRes = await vrcFetch(`/users?search=${encodeURIComponent(searchQuery)}&n=5`);
  if (!searchRes.ok) throw new Error(`Search failed: ${searchRes.status}`);
  const results = await searchRes.json();

  if (results.length === 0) {
    console.error('[AddUser] No users found');
    process.exit(1);
  }

  // Pick best match (exact display name match, or first result)
  const exactMatch = results.find(u =>
    u.displayName.toLowerCase() === searchQuery.toLowerCase()
  );
  const user = exactMatch || results[0];

  console.log(`[AddUser] Found: ${user.displayName} (${user.id})`);
  if (results.length > 1) {
    console.log('[AddUser] Other matches:');
    results.forEach((u, i) => {
      if (u.id !== user.id) console.log(`  ${i + 1}. ${u.displayName} (${u.id})`);
    });
  }

  // Ensure directories
  fs.mkdirSync(path.join(ROOT, 'data'), { recursive: true });
  fs.mkdirSync(path.dirname(USERS_PATH), { recursive: true });
  fs.mkdirSync(PLAYTIME_DIR, { recursive: true });

  // Update config
  let config = { trackedUsers: [] };
  if (fs.existsSync(CONFIG_PATH)) {
    config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  }
  if (config.trackedUsers.includes(user.id)) {
    console.log('[AddUser] User already tracked');
    process.exit(0);
  }
  config.trackedUsers.push(user.id);
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));

  // Update users index
  let usersIndex = [];
  if (fs.existsSync(USERS_PATH)) {
    usersIndex = JSON.parse(fs.readFileSync(USERS_PATH, 'utf-8'));
  }
  // Remove old entry if exists
  usersIndex = usersIndex.filter(u => u.id !== user.id);
  usersIndex.push({
    id: user.id,
    displayName: user.displayName,
    bio: user.bio || '',
    avatarUrl: user.currentAvatarThumbnailImageUrl || '',
    profilePicUrl: user.profilePicOverride || user.currentAvatarThumbnailImageUrl || '',
    statusDescription: user.statusDescription || '',
    status: user.status || 'offline',
    state: user.state || 'offline',
    trustRank: extractTrustRank(user.tags),
    trackedSince: new Date().toISOString(),
  });
  fs.writeFileSync(USERS_PATH, JSON.stringify(usersIndex, null, 2));

  // Create empty playtime file
  const playtimePath = path.join(PLAYTIME_DIR, `${user.id}.json`);
  if (!fs.existsSync(playtimePath)) {
    fs.writeFileSync(playtimePath, '[]');
  }

  console.log(`[AddUser] ✅ Now tracking: ${user.displayName}`);
}

main().catch(err => {
  console.error('[AddUser] Error:', err.message);
  process.exit(1);
});
