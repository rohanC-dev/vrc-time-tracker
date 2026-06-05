// ─── DOM Elements ───────────────────────────────────────────
const searchInput = document.getElementById('searchInput');
const searchResults = document.getElementById('searchResults');
const searchSpinner = document.getElementById('searchSpinner');
const heroSection = document.getElementById('heroSection');
const profileSection = document.getElementById('profileSection');
const backBtn = document.getElementById('backBtn');
const calendarGrid = document.getElementById('calendarGrid');
const calendarMonths = document.getElementById('calendarMonths');
const tooltip = document.getElementById('tooltip');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const trackBtn = document.getElementById('trackBtn');
const trackBtnText = document.getElementById('trackBtnText');

let currentUserId = null;
let searchTimeout = null;

// ─── Initialize ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  checkApiStatus();
  setupSearch();
  setupNavigation();

  // Check for URL hash navigation
  const hash = window.location.hash;
  if (hash && hash.startsWith('#/u/')) {
    const userId = hash.slice(4);
    if (userId) loadUserProfile(userId);
  }
});

// ─── API Status Check ───────────────────────────────────────
async function checkApiStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    if (data.authenticated) {
      statusDot.className = 'status-dot online';
      statusText.textContent = `Tracking ${data.trackedUsers} user${data.trackedUsers !== 1 ? 's' : ''}`;
    } else {
      statusDot.className = 'status-dot offline';
      statusText.textContent = 'API not connected';
    }
  } catch {
    statusDot.className = 'status-dot offline';
    statusText.textContent = 'Offline';
  }
}

// ─── Search ─────────────────────────────────────────────────
function setupSearch() {
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    const query = searchInput.value.trim();

    if (query.length < 2) {
      hideSearchResults();
      return;
    }

    searchSpinner.classList.add('active');
    searchTimeout = setTimeout(() => performSearch(query), 400);
  });

  searchInput.addEventListener('focus', () => {
    if (searchInput.value.trim().length >= 2) {
      searchResults.classList.add('visible');
    }
  });

  // Close results on outside click
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-container')) {
      hideSearchResults();
    }
  });

  // Keyboard navigation
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      hideSearchResults();
      searchInput.blur();
    }
  });
}

async function performSearch(query) {
  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    const users = await res.json();

    searchSpinner.classList.remove('active');

    if (res.ok && users.length > 0) {
      renderSearchResults(users);
    } else if (res.ok && users.length === 0) {
      searchResults.innerHTML = '<div class="search-no-results">No users found</div>';
      searchResults.classList.add('visible');
    } else {
      const errMsg = users.error || 'Search failed';
      searchResults.innerHTML = `<div class="search-no-results">${escapeHtml(errMsg)}</div>`;
      searchResults.classList.add('visible');
    }
  } catch (err) {
    searchSpinner.classList.remove('active');
    searchResults.innerHTML = '<div class="search-no-results">Search unavailable — check API connection</div>';
    searchResults.classList.add('visible');
  }
}

function renderSearchResults(users) {
  searchResults.innerHTML = users.map(user => `
    <div class="search-result-item" data-user-id="${escapeHtml(user.id)}" onclick="selectUser('${escapeHtml(user.id)}')">
      <img class="search-result-avatar" src="${escapeHtml(user.avatarUrl || user.profilePicUrl)}" alt="" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><rect fill=%22%23161b22%22 width=%22100%22 height=%22100%22/><text x=%2250%22 y=%2255%22 text-anchor=%22middle%22 fill=%22%238b949e%22 font-size=%2240%22>?</text></svg>'">
      <div class="search-result-info">
        <div class="search-result-name">${escapeHtml(user.displayName)}</div>
        <div class="search-result-status">${escapeHtml(user.statusDescription || user.status || '')}</div>
      </div>
      ${user.isTracked ? '<span class="search-result-badge tracked">Tracked</span>' : ''}
      ${user.state === 'online' ? '<span class="search-result-badge online">Online</span>' : ''}
    </div>
  `).join('');
  searchResults.classList.add('visible');
}

function hideSearchResults() {
  searchResults.classList.remove('visible');
}

// ─── User Selection & Profile ───────────────────────────────
async function selectUser(userId) {
  hideSearchResults();
  searchInput.value = '';
  await loadUserProfile(userId);
}

// Make selectUser globally accessible for onclick handlers
window.selectUser = selectUser;

async function loadUserProfile(userId) {
  currentUserId = userId;
  window.location.hash = `/u/${userId}`;

  // Switch view
  heroSection.style.display = 'none';
  profileSection.style.display = 'block';
  profileSection.scrollIntoView({ behavior: 'smooth', block: 'start' });

  try {
    const res = await fetch(`/api/user/${encodeURIComponent(userId)}`);

    if (res.status === 404) {
      // User not tracked yet — track them first
      await trackUser(userId);
      // Retry
      const retryRes = await fetch(`/api/user/${encodeURIComponent(userId)}`);
      if (!retryRes.ok) throw new Error('Failed to load user');
      const data = await retryRes.json();
      renderProfile(data);
    } else if (res.ok) {
      const data = await res.json();
      renderProfile(data);
    } else {
      throw new Error('Failed to load user');
    }
  } catch (err) {
    console.error('Profile load error:', err);
    document.getElementById('userName').textContent = 'Error loading profile';
  }
}

function renderProfile(data) {
  const { user, playtime, stats } = data;

  // User card
  const avatarUrl = user.profilePicUrl || user.avatarUrl;
  document.getElementById('userAvatar').src = avatarUrl || '';
  document.getElementById('userName').textContent = user.displayName;
  document.getElementById('userTrust').textContent = user.trustRank || '';
  document.getElementById('userBio').textContent = user.bio || '';

  // Track button state
  if (user.isTracking) {
    trackBtn.classList.add('tracking');
    trackBtnText.textContent = 'Tracking';
  } else {
    trackBtn.classList.remove('tracking');
    trackBtnText.textContent = 'Track User';
  }

  // Stats
  document.getElementById('statTotalHours').textContent = stats.totalHours || 0;
  document.getElementById('statCurrentStreak').textContent = `${stats.currentStreak || 0}d`;
  document.getElementById('statLongestStreak').textContent = `${stats.longestStreak || 0}d`;
  document.getElementById('statDailyAvg').textContent = stats.dailyAverageHours || 0;

  // Calendar
  document.getElementById('calendarTotalLabel').textContent =
    `${stats.totalHours || 0} hours in the last year`;

  renderCalendar(playtime);

  // Tracking info
  if (user.trackedSince) {
    const since = new Date(user.trackedSince + 'Z');
    document.getElementById('trackingSince').textContent =
      `Tracked since ${since.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} — data builds up over time`;
  }
}

// ─── Track / Untrack ────────────────────────────────────────
async function trackUser(userId) {
  try {
    const res = await fetch(`/api/track/${encodeURIComponent(userId)}`, { method: 'POST' });
    const data = await res.json();
    if (res.ok) {
      trackBtn.classList.add('tracking');
      trackBtnText.textContent = 'Tracking';
      checkApiStatus(); // Update header count
    }
    return data;
  } catch (err) {
    console.error('Track error:', err);
  }
}

trackBtn.addEventListener('click', async () => {
  if (!currentUserId) return;

  if (trackBtn.classList.contains('tracking')) {
    // Untrack
    try {
      await fetch(`/api/untrack/${encodeURIComponent(currentUserId)}`, { method: 'POST' });
      trackBtn.classList.remove('tracking');
      trackBtnText.textContent = 'Track User';
      checkApiStatus();
    } catch (err) {
      console.error('Untrack error:', err);
    }
  } else {
    await trackUser(currentUserId);
  }
});

// ─── Calendar Rendering ─────────────────────────────────────
function renderCalendar(playtimeData) {
  // Build a map of date → minutes
  const dataMap = {};
  if (playtimeData) {
    for (const entry of playtimeData) {
      dataMap[entry.date] = entry.minutes;
    }
  }

  // Generate 53 weeks (371 days back from today)
  const today = new Date();
  const weeks = [];
  const months = [];

  // Start from the nearest past Sunday to ~1 year ago
  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - 364);
  // Align to Sunday
  while (startDate.getDay() !== 0) {
    startDate.setDate(startDate.getDate() - 1);
  }

  let currentDate = new Date(startDate);
  let currentWeek = [];
  let lastMonth = -1;

  // Find max minutes for level calculation
  const allMinutes = Object.values(dataMap);
  const maxMinutes = allMinutes.length > 0 ? Math.max(...allMinutes) : 60;

  while (currentDate <= today) {
    const dateStr = formatDate(currentDate);
    const minutes = dataMap[dateStr] || 0;
    const level = getLevel(minutes, maxMinutes);
    const dayOfWeek = currentDate.getDay();

    // Track months
    const month = currentDate.getMonth();
    if (month !== lastMonth) {
      months.push({
        name: currentDate.toLocaleDateString('en-US', { month: 'short' }),
        weekIndex: weeks.length,
      });
      lastMonth = month;
    }

    currentWeek.push({
      date: dateStr,
      minutes,
      level,
      dayOfWeek,
    });

    if (dayOfWeek === 6 || currentDate.getTime() === today.getTime()) {
      weeks.push(currentWeek);
      currentWeek = [];
    }

    currentDate.setDate(currentDate.getDate() + 1);
  }

  if (currentWeek.length > 0) {
    weeks.push(currentWeek);
  }

  // Render month labels
  calendarMonths.innerHTML = '';
  const weekWidth = 16; // 13px + 3px gap
  let lastMonthEnd = 0;

  for (let i = 0; i < months.length; i++) {
    const m = months[i];
    const nextStart = i + 1 < months.length ? months[i + 1].weekIndex : weeks.length;
    const span = nextStart - m.weekIndex;

    const label = document.createElement('span');
    label.className = 'calendar-month-label';
    label.style.width = `${span * weekWidth}px`;
    label.textContent = span >= 2 ? m.name : ''; // Hide if too narrow
    calendarMonths.appendChild(label);
  }

  // Render weeks
  calendarGrid.innerHTML = '';

  for (const week of weeks) {
    const weekEl = document.createElement('div');
    weekEl.className = 'calendar-week';

    // Pad week start (if first week doesn't start on Sunday)
    for (let d = 0; d < week[0].dayOfWeek; d++) {
      const empty = document.createElement('div');
      empty.className = 'calendar-day';
      empty.style.visibility = 'hidden';
      weekEl.appendChild(empty);
    }

    for (const day of week) {
      const dayEl = document.createElement('div');
      dayEl.className = 'calendar-day';
      dayEl.setAttribute('data-level', day.level);
      dayEl.setAttribute('data-date', day.date);
      dayEl.setAttribute('data-minutes', day.minutes);

      // Tooltip events
      dayEl.addEventListener('mouseenter', showTooltip);
      dayEl.addEventListener('mouseleave', hideTooltip);

      weekEl.appendChild(dayEl);
    }

    calendarGrid.appendChild(weekEl);
  }
}

function getLevel(minutes, maxMinutes) {
  if (minutes === 0) return 0;
  if (maxMinutes <= 0) return 1;
  const ratio = minutes / maxMinutes;
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5) return 2;
  if (ratio <= 0.75) return 3;
  return 4;
}

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// ─── Tooltip ────────────────────────────────────────────────
function showTooltip(e) {
  const el = e.target;
  const date = el.getAttribute('data-date');
  const minutes = parseInt(el.getAttribute('data-minutes') || '0', 10);

  if (!date) return;

  const dateObj = new Date(date + 'T00:00:00');
  const dateStr = dateObj.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  let timeStr;
  if (minutes === 0) {
    timeStr = 'No playtime';
  } else if (hours > 0) {
    timeStr = `${hours}h ${mins}m playtime`;
  } else {
    timeStr = `${mins}m playtime`;
  }

  tooltip.innerHTML = `
    <div class="tooltip-date">${dateStr}</div>
    <div class="tooltip-value">${timeStr}</div>
  `;

  const rect = el.getBoundingClientRect();
  tooltip.style.left = `${rect.left + rect.width / 2}px`;
  tooltip.style.top = `${rect.top - 8}px`;
  tooltip.style.transform = 'translate(-50%, -100%)';
  tooltip.classList.add('visible');
}

function hideTooltip() {
  tooltip.classList.remove('visible');
}

// ─── Navigation ─────────────────────────────────────────────
function setupNavigation() {
  backBtn.addEventListener('click', goBack);

  document.getElementById('logoLink').addEventListener('click', (e) => {
    e.preventDefault();
    goBack();
  });

  window.addEventListener('hashchange', () => {
    const hash = window.location.hash;
    if (!hash || hash === '#/' || hash === '#') {
      goBack();
    }
  });
}

function goBack() {
  heroSection.style.display = '';
  profileSection.style.display = 'none';
  window.location.hash = '';
  currentUserId = null;
  searchInput.focus();
}

// ─── Utilities ──────────────────────────────────────────────
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
