const { getClient } = require('./vrchat');
const db = require('./database');

let trackerInterval = null;
let isRunning = false;

const POLL_INTERVAL = Math.max(2, parseInt(process.env.POLL_INTERVAL || '5', 10)) * 60 * 1000;
const REQUEST_DELAY = 1500; // 1.5s between API calls to respect rate limits

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function pollUsers() {
  if (isRunning) {
    console.log('[Tracker] Previous poll still running, skipping...');
    return;
  }

  isRunning = true;
  const client = getClient();

  if (!client.isAuthenticated) {
    console.log('[Tracker] VRChat client not authenticated, skipping poll...');
    isRunning = false;
    return;
  }

  const trackedUsers = db.getTrackedUsers();
  if (trackedUsers.length === 0) {
    isRunning = false;
    return;
  }

  const intervalMinutes = Math.round(POLL_INTERVAL / 60000);
  console.log(`[Tracker] Polling ${trackedUsers.length} tracked user(s)...`);

  let onlineCount = 0;

  for (const user of trackedUsers) {
    try {
      const vrcUser = await client.getUserById(user.id);
      if (!vrcUser) continue;

      // Update user profile data
      db.upsertUser(vrcUser);

      // Check if online
      const online = client.isOnline(vrcUser.state);
      if (online) {
        db.logPlaytime(user.id, intervalMinutes);
        db.updateLastOnline(user.id);
        onlineCount++;
      }

      // Rate limit: wait between requests
      await sleep(REQUEST_DELAY);
    } catch (err) {
      console.error(`[Tracker] Error polling user ${user.displayName}:`, err.message);

      // If auth expired, try to re-authenticate
      if (err.message.includes('401') || err.message.includes('Not authenticated')) {
        console.log('[Tracker] Auth may have expired, will retry next cycle...');
        client.isAuthenticated = false;
        break;
      }
    }
  }

  console.log(`[Tracker] Poll complete. ${onlineCount}/${trackedUsers.length} users online.`);
  isRunning = false;
}

function startTracker() {
  if (trackerInterval) {
    console.log('[Tracker] Already running');
    return;
  }

  console.log(`[Tracker] Starting tracker (polling every ${POLL_INTERVAL / 60000} minutes)...`);

  // Run first poll after a short delay to let the server start
  setTimeout(() => pollUsers(), 5000);

  // Then poll on interval
  trackerInterval = setInterval(pollUsers, POLL_INTERVAL);
}

function stopTracker() {
  if (trackerInterval) {
    clearInterval(trackerInterval);
    trackerInterval = null;
    console.log('[Tracker] Stopped');
  }
}

module.exports = { startTracker, stopTracker, pollUsers };
