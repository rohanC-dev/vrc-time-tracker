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
let allUsers = []; // Loaded from static JSON

// ─── Configuration ──────────────────────────────────────────
// 1. Enter your GitHub repository (e.g. rohanC-dev/vrc-time-tracker)
const GITHUB_REPO = 'rohanC-dev/vrc-time-tracker';

// 2. Base64 encode your GitHub PAT to hide it from simple scanners.
//    In your browser console, run: btoa('ghp_your_token_here') and paste the result below.
//    WARNING: This token is technically exposed to anyone who inspects the code.
//    Make sure it is a Fine-Grained PAT restricted ONLY to Action Read/Write on this specific repo!
const OBFUSCATED_GITHUB_TOKEN = 'YOUR_BASE64_ENCODED_TOKEN_HERE'; 

// ─── Initialize ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await loadUsersIndex();
  setupSearch();
  setupNavigation();

  // Check for URL hash navigation
  const hash = window.location.hash;
  if (hash && hash.startsWith('#/u/')) {
    const userId = hash.slice(4);
    if (userId) loadUserProfile(userId);
  }
});

// ─── Load Users Index ───────────────────────────────────────
async function loadUsersIndex() {
  try {
    const res = await fetch('/data/users.json');
    if (res.ok) {
      allUsers = await res.json();
      statusDot.className = 'status-dot online';
      statusText.textContent = `Tracking ${allUsers.length} user${allUsers.length !== 1 ? 's' : ''}`;
    } else {
      throw new Error('No data');
    }
  } catch {
    statusDot.className = 'status-dot offline';
    statusText.textContent = 'No users tracked yet';
    allUsers = [];
  }
}

// ─── Search (client-side filter) ────────────────────────────
function setupSearch() {
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    const query = searchInput.value.trim().toLowerCase();

    if (query.length < 1) {
      hideSearchResults();
      return;
    }

    searchSpinner.classList.add('active');
    searchTimeout = setTimeout(() => performSearch(query), 150);
  });

  searchInput.addEventListener('focus', () => {
    const query = searchInput.value.trim().toLowerCase();
    if (query.length >= 1) {
      performSearch(query);
    } else if (allUsers.length > 0) {
      // Show all users when focused with empty input
      renderSearchResults(allUsers.slice(0, 10));
    }
  });

  // Close results on outside click
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-container')) {
      hideSearchResults();
    }
  });

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      hideSearchResults();
      searchInput.blur();
    }
  });
}

function performSearch(query) {
  searchSpinner.classList.remove('active');

  if (allUsers.length === 0) {
    searchResults.innerHTML = `
      <div class="search-no-results">
        <p>No users tracked yet.</p>
        <button class="track-btn" style="margin-top: 12px; font-size: 0.8rem; padding: 8px 16px;" onclick="triggerTrackWorkflow('${escapeHtml(query)}')">
          Track "${escapeHtml(query)}"
        </button>
      </div>`;
    searchResults.classList.add('visible');
    return;
  }

  // Fuzzy filter by display name
  const matches = allUsers.filter(u =>
    u.displayName.toLowerCase().includes(query)
  );

  if (matches.length > 0) {
    // If there's no exact match, add a 'Track' button at the bottom
    const hasExactMatch = matches.some(u => u.displayName.toLowerCase() === query);
    
    let html = matches.slice(0, 10).map(user => `
      <div class="search-result-item" onclick="selectUser('${escapeHtml(user.id)}')">
        <img class="search-result-avatar"
             src="${escapeHtml(user.avatarUrl || user.profilePicUrl)}"
             alt=""
             onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><rect fill=%22%23161b22%22 width=%22100%22 height=%22100%22/><text x=%2250%22 y=%2255%22 text-anchor=%22middle%22 fill=%22%238b949e%22 font-size=%2240%22>?</text></svg>'">
        <div class="search-result-info">
          <div class="search-result-name">${escapeHtml(user.displayName)}</div>
          <div class="search-result-status">${escapeHtml(user.statusDescription || user.trustRank || '')}</div>
        </div>
        <span class="search-result-badge tracked">Tracked</span>
      </div>
    `).join('');

    if (!hasExactMatch) {
      html += `
        <div class="search-no-results" style="border-top: 1px solid var(--border-light);">
          <p>Don't see who you're looking for?</p>
          <button class="track-btn" style="margin-top: 8px; font-size: 0.8rem; padding: 6px 12px;" onclick="triggerTrackWorkflow('${escapeHtml(query)}')">
            Track "${escapeHtml(query)}"
          </button>
        </div>`;
    }

    searchResults.innerHTML = html;
    searchResults.classList.add('visible');
  } else {
    searchResults.innerHTML = `
      <div class="search-no-results">
        <p>No tracked users match "${escapeHtml(query)}"</p>
        <button class="track-btn" style="margin-top: 12px; font-size: 0.8rem; padding: 8px 16px;" onclick="triggerTrackWorkflow('${escapeHtml(query)}')">
          Track "${escapeHtml(query)}"
        </button>
      </div>`;
    searchResults.classList.add('visible');
  }
}

async function triggerTrackWorkflow(username) {
  if (OBFUSCATED_GITHUB_TOKEN === 'YOUR_BASE64_ENCODED_TOKEN_HERE') {
    alert('You must configure your OBFUSCATED_GITHUB_TOKEN in app.js first!');
    return;
  }

  const btn = event.currentTarget;
  btn.textContent = 'Triggering...';
  btn.style.pointerEvents = 'none';
  btn.style.opacity = '0.7';

  try {
    const token = atob(OBFUSCATED_GITHUB_TOKEN);
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/add-user.yml/dispatches`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        ref: 'master',
        inputs: { username: username }
      })
    });

    if (res.ok) {
      btn.textContent = 'Tracking Started!';
      btn.classList.add('tracking');
      alert(`Tracking started for "${username}". It may take up to 5 minutes to appear in search as data gathers.`);
      hideSearchResults();
      searchInput.value = '';
    } else {
      const err = await res.text();
      throw new Error(err);
    }
  } catch (e) {
    btn.textContent = 'Error';
    alert('Failed to trigger tracking. Is your token correct? Error: ' + e.message);
  }
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

window.selectUser = selectUser;

async function loadUserProfile(userId) {
  currentUserId = userId;
  window.location.hash = `/u/${userId}`;

  // Switch view
  heroSection.style.display = 'none';
  profileSection.style.display = 'block';
  profileSection.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // Find user in the index
  const user = allUsers.find(u => u.id === userId);
  if (!user) {
    document.getElementById('userName').textContent = 'User not found';
    renderCalendar([]);
    return;
  }

  // Load playtime data
  let playtime = [];
  try {
    const res = await fetch(`/data/playtime/${encodeURIComponent(userId)}.json`);
    if (res.ok) {
      playtime = await res.json();
    }
  } catch {
    playtime = [];
  }

  const stats = computeStats(playtime);
  renderProfile(user, playtime, stats);
}

function renderProfile(user, playtime, stats) {
  // User card
  const avatarUrl = user.profilePicUrl || user.avatarUrl;
  document.getElementById('userAvatar').src = avatarUrl || '';
  document.getElementById('userName').textContent = user.displayName;
  document.getElementById('userTrust').textContent = user.trustRank || '';
  document.getElementById('userBio').textContent = user.bio || '';

  // Track button — always "Tracking" since this is a static site
  trackBtn.classList.add('tracking');
  trackBtnText.textContent = 'Tracking';
  trackBtn.onclick = null;
  trackBtn.style.pointerEvents = 'none';

  // Stats
  document.getElementById('statTotalHours').textContent = stats.totalHours;
  document.getElementById('statCurrentStreak').textContent = `${stats.currentStreak}d`;
  document.getElementById('statLongestStreak').textContent = `${stats.longestStreak}d`;
  document.getElementById('statDailyAvg').textContent = stats.dailyAverageHours;

  // Calendar header
  document.getElementById('calendarTotalLabel').textContent =
    `${stats.totalHours} hours in the last year`;

  renderCalendar(playtime);

  // Tracking info
  if (user.trackedSince) {
    const since = new Date(user.trackedSince);
    document.getElementById('trackingSince').textContent =
      `Tracked since ${since.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} — data updates every 5 minutes via GitHub Actions`;
  }
}

// ─── Stats Computation ──────────────────────────────────────
function computeStats(playtimeData) {
  if (!playtimeData || playtimeData.length === 0) {
    return {
      totalHours: 0,
      totalMinutes: 0,
      currentStreak: 0,
      longestStreak: 0,
      dailyAverage: 0,
      dailyAverageHours: 0,
      daysPlayed: 0,
    };
  }

  const totalMinutes = playtimeData.reduce((sum, p) => sum + p.minutes, 0);
  const totalHours = Math.round((totalMinutes / 60) * 10) / 10;

  const playDates = new Set(playtimeData.map(p => p.date));
  const daysPlayed = playDates.size;
  const dailyAverage = daysPlayed > 0 ? Math.round((totalMinutes / daysPlayed) * 10) / 10 : 0;

  // Current streak
  let currentStreak = 0;
  const checkDate = new Date();
  while (true) {
    const dateStr = formatDate(checkDate);
    if (playDates.has(dateStr)) {
      currentStreak++;
      checkDate.setDate(checkDate.getDate() - 1);
    } else if (currentStreak === 0) {
      // Check yesterday if today hasn't logged yet
      checkDate.setDate(checkDate.getDate() - 1);
      if (playDates.has(formatDate(checkDate))) {
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
  let longestStreak = 0, streak = 0;
  const sortedDates = [...playDates].sort();
  for (let i = 0; i < sortedDates.length; i++) {
    if (i === 0) {
      streak = 1;
    } else {
      const prev = new Date(sortedDates[i - 1]);
      const curr = new Date(sortedDates[i]);
      const diff = Math.round((curr - prev) / (1000 * 60 * 60 * 24));
      streak = diff === 1 ? streak + 1 : 1;
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
    daysPlayed,
  };
}

// ─── Calendar Rendering ─────────────────────────────────────
function renderCalendar(playtimeData) {
  const dataMap = {};
  if (playtimeData) {
    for (const entry of playtimeData) {
      dataMap[entry.date] = entry.minutes;
    }
  }

  const today = new Date();
  const weeks = [];
  const months = [];

  // Start from ~1 year ago, aligned to Sunday
  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - 364);
  while (startDate.getDay() !== 0) {
    startDate.setDate(startDate.getDate() - 1);
  }

  let currentDate = new Date(startDate);
  let currentWeek = [];
  let lastMonth = -1;

  const allMinutes = Object.values(dataMap);
  const maxMinutes = allMinutes.length > 0 ? Math.max(...allMinutes) : 60;

  while (currentDate <= today) {
    const dateStr = formatDate(currentDate);
    const minutes = dataMap[dateStr] || 0;
    const level = getLevel(minutes, maxMinutes);
    const dayOfWeek = currentDate.getDay();

    const month = currentDate.getMonth();
    if (month !== lastMonth) {
      months.push({
        name: currentDate.toLocaleDateString('en-US', { month: 'short' }),
        weekIndex: weeks.length,
      });
      lastMonth = month;
    }

    currentWeek.push({ date: dateStr, minutes, level, dayOfWeek });

    if (dayOfWeek === 6) {
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
  const weekWidth = 16;
  for (let i = 0; i < months.length; i++) {
    const m = months[i];
    const nextStart = i + 1 < months.length ? months[i + 1].weekIndex : weeks.length;
    const span = nextStart - m.weekIndex;
    const label = document.createElement('span');
    label.className = 'calendar-month-label';
    label.style.width = `${span * weekWidth}px`;
    label.textContent = span >= 2 ? m.name : '';
    calendarMonths.appendChild(label);
  }

  // Render grid
  calendarGrid.innerHTML = '';
  for (const week of weeks) {
    const weekEl = document.createElement('div');
    weekEl.className = 'calendar-week';

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
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  });

  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  let timeStr;
  if (minutes === 0) timeStr = 'No playtime';
  else if (hours > 0) timeStr = `${hours}h ${mins}m playtime`;
  else timeStr = `${mins}m playtime`;

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
    if (!hash || hash === '#/' || hash === '#') goBack();
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
