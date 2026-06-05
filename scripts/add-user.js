const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const { CookieJar } = require('tough-cookie');

const ROOT = path.join(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'data', 'config.json');
const USERS_PATH = path.join(ROOT, 'public', 'data', 'users.json');
const BASE_URL = 'https://api.vrchat.cloud/api/1';
const USER_AGENT = 'VRCTimeTracker/1.0.0 (https://github.com/vrc-time-tracker)';

function ensureDirs() {
  fs.mkdirSync(path.join(ROOT, 'data'), { recursive: true });
  fs.mkdirSync(path.join(ROOT, 'public', 'data'), { recursive: true });
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
  const username = process.env.VRCHAT_USERNAME;
  const password = process.env.VRCHAT_PASSWORD;
  const targetUsername = process.env.TARGET_USERNAME;

  if (!username || !password || !targetUsername) {
    console.error('Missing required environment variables.');
    process.exit(1);
  }

  ensureDirs();

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

    const response = await fetch(url, { ...options, headers });
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

  // Login
  try { await vrcFetch('/config'); } catch(e){}
  const authHeader = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
  const loginRes = await vrcFetch('/auth/user', { headers: { Authorization: authHeader } });
  
  if (!loginRes.ok) {
    console.error('Login failed');
    process.exit(1);
  }

  // Search user
  console.log(`Searching for user: ${targetUsername}`);
  const searchRes = await vrcFetch(`/users?search=${encodeURIComponent(targetUsername)}&n=1`);
  if (!searchRes.ok) {
    console.error('Search failed');
    process.exit(1);
  }

  const results = await searchRes.json();
  if (results.length === 0) {
    console.error(`User "${targetUsername}" not found.`);
    process.exit(1);
  }

  const target = results[0];
  console.log(`Found: ${target.displayName} (${target.id})`);

  // Update config
  let config = { trackedUsers: [] };
  if (fs.existsSync(CONFIG_PATH)) {
    config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  }

  if (!config.trackedUsers.includes(target.id)) {
    config.trackedUsers.push(target.id);
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    console.log(`Added ${target.id} to config.json`);
  } else {
    console.log('User is already tracked in config.');
  }

  // Update public/users.json
  let users = [];
  if (fs.existsSync(USERS_PATH)) {
    users = JSON.parse(fs.readFileSync(USERS_PATH, 'utf-8'));
  }

  const existingIdx = users.findIndex(u => u.id === target.id);
  const userData = {
    id: target.id,
    displayName: target.displayName,
    bio: target.bio || '',
    avatarUrl: target.currentAvatarThumbnailImageUrl || '',
    profilePicUrl: target.profilePicOverride || target.currentAvatarThumbnailImageUrl || '',
    statusDescription: target.statusDescription || '',
    status: target.status || 'offline',
    trustRank: extractTrustRank(target.tags),
    trackedSince: existingIdx !== -1 ? users[existingIdx].trackedSince : new Date().toISOString()
  };

  if (existingIdx !== -1) {
    users[existingIdx] = userData;
  } else {
    users.push(userData);
  }

  fs.writeFileSync(USERS_PATH, JSON.stringify(users, null, 2));
  console.log('Successfully updated users.json');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
