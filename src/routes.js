const express = require('express');
const { getClient } = require('./vrchat');
const db = require('./database');

const router = express.Router();

// ─── Search VRChat Users ────────────────────────────────────
router.get('/search', async (req, res) => {
  const query = req.query.q;
  if (!query || query.length < 2) {
    return res.status(400).json({ error: 'Query must be at least 2 characters' });
  }

  try {
    const client = getClient();
    if (!client.isAuthenticated) {
      return res.status(503).json({ error: 'VRChat API not connected. Configure credentials in .env' });
    }

    const users = await client.searchUsers(query, 10);
    return res.json(users.map(u => ({
      id: u.id,
      displayName: u.displayName,
      bio: u.bio || '',
      avatarUrl: u.currentAvatarThumbnailImageUrl || '',
      profilePicUrl: u.profilePicOverride || u.currentAvatarThumbnailImageUrl || '',
      statusDescription: u.statusDescription || '',
      status: u.status || 'offline',
      state: u.state || 'offline',
      isTracked: !!db.getUser(u.id),
    })));
  } catch (err) {
    console.error('[API] Search error:', err.message);
    return res.status(500).json({ error: 'Search failed' });
  }
});

// ─── Get User Profile + Playtime ─────────────────────────────
router.get('/user/:userId', (req, res) => {
  const { userId } = req.params;
  const user = db.getUser(userId);

  if (!user) {
    return res.status(404).json({ error: 'User not found. Search and track them first.' });
  }

  const playtime = db.getPlaytimeForUser(userId, 365);
  const totalMinutes = db.getTotalPlaytime(userId);

  // Compute stats
  const stats = computeStats(playtime, totalMinutes);

  return res.json({
    user,
    playtime,
    stats,
  });
});

// ─── Get Calendar Data ───────────────────────────────────────
router.get('/user/:userId/calendar', (req, res) => {
  const { userId } = req.params;
  const days = parseInt(req.query.days || '365', 10);
  const user = db.getUser(userId);

  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  const playtime = db.getPlaytimeForUser(userId, days);
  return res.json(playtime);
});

// ─── Track a User ────────────────────────────────────────────
router.post('/track/:userId', async (req, res) => {
  const { userId } = req.params;

  try {
    const client = getClient();
    if (!client.isAuthenticated) {
      return res.status(503).json({ error: 'VRChat API not connected' });
    }

    // Fetch user data from VRChat
    const vrcUser = await client.getUserById(userId);
    if (!vrcUser) {
      return res.status(404).json({ error: 'VRChat user not found' });
    }

    // Save to database and enable tracking
    db.upsertUser(vrcUser);
    db.setTracking(userId, true);

    return res.json({ success: true, message: `Now tracking ${vrcUser.displayName}` });
  } catch (err) {
    console.error('[API] Track error:', err.message);
    return res.status(500).json({ error: 'Failed to track user' });
  }
});

// ─── Untrack a User ──────────────────────────────────────────
router.post('/untrack/:userId', (req, res) => {
  const { userId } = req.params;
  const user = db.getUser(userId);

  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  db.setTracking(userId, false);
  return res.json({ success: true, message: `Stopped tracking ${user.displayName}` });
});

// ─── Get Status / Stats ─────────────────────────────────────
router.get('/status', (req, res) => {
  const client = getClient();
  return res.json({
    authenticated: client.isAuthenticated,
    trackedUsers: db.getTrackedUserCount(),
  });
});

// ─── Helper: Compute Stats ──────────────────────────────────
function computeStats(playtimeData, totalMinutes) {
  if (!playtimeData || playtimeData.length === 0) {
    return {
      totalHours: 0,
      totalMinutes: 0,
      currentStreak: 0,
      longestStreak: 0,
      dailyAverage: 0,
      mostActiveDay: null,
      daysPlayed: 0,
    };
  }

  const totalHours = Math.round((totalMinutes / 60) * 10) / 10;

  // Build a set of dates with playtime
  const playDates = new Set(playtimeData.map(p => p.date));
  const daysPlayed = playDates.size;

  // Daily average (over days played, not total days)
  const dailyAverage = daysPlayed > 0
    ? Math.round((totalMinutes / daysPlayed) * 10) / 10
    : 0;

  // Most active day
  let mostActiveDay = null;
  let maxMinutes = 0;
  for (const p of playtimeData) {
    if (p.minutes > maxMinutes) {
      maxMinutes = p.minutes;
      mostActiveDay = { date: p.date, minutes: p.minutes };
    }
  }

  // Current streak
  let currentStreak = 0;
  const today = new Date();
  const checkDate = new Date(today);
  // Start from today, go backwards
  while (true) {
    const dateStr = checkDate.toISOString().slice(0, 10);
    if (playDates.has(dateStr)) {
      currentStreak++;
      checkDate.setDate(checkDate.getDate() - 1);
    } else if (currentStreak === 0) {
      // If today hasn't been logged yet, check yesterday
      checkDate.setDate(checkDate.getDate() - 1);
      const yesterdayStr = checkDate.toISOString().slice(0, 10);
      if (playDates.has(yesterdayStr)) {
        currentStreak++;
        checkDate.setDate(checkDate.getDate() - 1);
      } else {
        break;
      }
    } else {
      break;
    }
  }

  // Longest streak
  let longestStreak = 0;
  let streak = 0;
  const sortedDates = [...playDates].sort();
  for (let i = 0; i < sortedDates.length; i++) {
    if (i === 0) {
      streak = 1;
    } else {
      const prev = new Date(sortedDates[i - 1]);
      const curr = new Date(sortedDates[i]);
      const diffDays = Math.round((curr - prev) / (1000 * 60 * 60 * 24));
      if (diffDays === 1) {
        streak++;
      } else {
        streak = 1;
      }
    }
    longestStreak = Math.max(longestStreak, streak);
  }

  return {
    totalHours,
    totalMinutes,
    currentStreak,
    longestStreak,
    dailyAverage,
    dailyAverageHours: Math.round((dailyAverage / 60) * 10) / 10,
    mostActiveDay,
    daysPlayed,
  };
}

module.exports = router;
