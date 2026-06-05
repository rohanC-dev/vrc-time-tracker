const fetch = require('node-fetch');
const { CookieJar } = require('tough-cookie');

const BASE_URL = 'https://api.vrchat.cloud/api/1';
const USER_AGENT = 'VRCTimeTracker/1.0.0 (https://github.com/vrc-time-tracker)';

class VRChatClient {
  constructor() {
    this.cookieJar = new CookieJar();
    this.authCookie = null;
    this.twoFactorAuth = null;
    this.isAuthenticated = false;
    this.apiKey = '';
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

    const response = await fetch(url, {
      ...options,
      headers,
      redirect: 'manual',
    });

    // Capture set-cookie headers
    const setCookies = response.headers.raw()['set-cookie'];
    if (setCookies) {
      for (const cookie of setCookies) {
        try {
          await this.cookieJar.setCookie(cookie, url);
          // Extract auth cookie
          if (cookie.startsWith('auth=')) {
            this.authCookie = cookie.split('auth=')[1].split(';')[0];
          }
        } catch (e) {
          // Ignore cookie parse errors
        }
      }
    }

    return response;
  }

  async login(username, password) {
    console.log('[VRChat] Attempting login...');

    // First, get the API key from the config endpoint
    try {
      const configRes = await this._fetch('/config');
      if (configRes.ok) {
        const config = await configRes.json();
        this.apiKey = config.apiKey || '';
      }
    } catch (e) {
      console.warn('[VRChat] Could not fetch config, continuing anyway...');
    }

    // Login with basic auth
    const authHeader = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
    const res = await this._fetch('/auth/user', {
      headers: {
        Authorization: authHeader,
      },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Login failed (${res.status}): ${body}`);
    }

    const data = await res.json();

    // Check if 2FA is required
    if (data.requiresTwoFactorAuth) {
      console.log('[VRChat] 2FA required. Types:', data.requiresTwoFactorAuth);
      this.twoFactorAuth = data.requiresTwoFactorAuth;
      return { requires2FA: true, methods: data.requiresTwoFactorAuth };
    }

    this.isAuthenticated = true;
    console.log(`[VRChat] Logged in as: ${data.displayName}`);
    return { requires2FA: false, user: data };
  }

  async verify2FA(code, method = 'totp') {
    const endpoint = method === 'totp'
      ? '/auth/twofactorauth/totp/verify'
      : method === 'emailotp'
        ? '/auth/twofactorauth/emailotp/verify'
        : '/auth/twofactorauth/otp/verify';

    const res = await this._fetch(endpoint, {
      method: 'POST',
      body: JSON.stringify({ code }),
    });

    if (!res.ok) {
      throw new Error(`2FA verification failed (${res.status})`);
    }

    this.isAuthenticated = true;
    console.log('[VRChat] 2FA verified successfully');
    return true;
  }

  async searchUsers(query, n = 10) {
    if (!this.isAuthenticated) throw new Error('Not authenticated');

    const res = await this._fetch(`/users?search=${encodeURIComponent(query)}&n=${n}`);
    if (!res.ok) {
      throw new Error(`Search failed (${res.status})`);
    }

    return res.json();
  }

  async getUserById(userId) {
    if (!this.isAuthenticated) throw new Error('Not authenticated');

    const res = await this._fetch(`/users/${encodeURIComponent(userId)}`);
    if (!res.ok) {
      if (res.status === 404) return null;
      throw new Error(`Get user failed (${res.status})`);
    }

    return res.json();
  }

  async getCurrentUser() {
    const res = await this._fetch('/auth/user');
    if (!res.ok) return null;
    return res.json();
  }

  isOnline(userState) {
    return userState === 'online' || userState === 'active';
  }
}

// Singleton
let client = null;

function getClient() {
  if (!client) {
    client = new VRChatClient();
  }
  return client;
}

module.exports = { VRChatClient, getClient };
