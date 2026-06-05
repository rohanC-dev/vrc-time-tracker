# 🎮 VRC Time Tracker

Track your VRChat playtime with a beautiful GitHub-style contribution calendar.

![VRC Time Tracker](https://img.shields.io/badge/VRChat-Time%20Tracker-1de9b6?style=for-the-badge)

## Features

- 🔍 **Search** — Find any VRChat user by username
- 📊 **GitHub-style Calendar** — Visualize daily playtime as a contribution grid
- 📈 **Stats Dashboard** — Total hours, streaks, daily averages
- 🤖 **Auto-Tracking** — Background polling detects when users are online
- 🌙 **Dark Theme** — VRChat-inspired design with teal accents

## How It Works

1. Search for a VRChat username on the site
2. Click "Track" to start monitoring their online status
3. The server checks every 5 minutes if the user is online
4. Playtime data builds up over time and fills in the calendar
5. Anyone can visit the site and view any tracked user's playtime

## Quick Start

```bash
# Clone the repo
git clone https://github.com/YOUR_USERNAME/vrc-time-tracker.git
cd vrc-time-tracker

# Install dependencies
npm install

# Configure VRChat credentials
cp .env.example .env
# Edit .env with your VRChat username and password

# Start the server
npm start
```

Then open [http://localhost:3000](http://localhost:3000)

## Configuration

Copy `.env.example` to `.env` and fill in:

| Variable | Description |
|----------|-------------|
| `VRCHAT_USERNAME` | Your VRChat account username |
| `VRCHAT_PASSWORD` | Your VRChat account password |
| `PORT` | Server port (default: 3000) |
| `POLL_INTERVAL` | Minutes between status checks (default: 5) |

> **Note:** The VRChat API requires authentication to search users and check online status. Consider creating a dedicated bot account.

## Deploy

### Render (Recommended, Free Tier)

1. Push your repo to GitHub
2. Go to [render.com](https://render.com) → New Web Service
3. Connect your GitHub repo
4. Set build command: `npm install`
5. Set start command: `npm start`
6. Add your `.env` variables in the Render dashboard

### Railway / Fly.io

Works with any Node.js hosting platform. Just set the environment variables and deploy.

## Tech Stack

- **Frontend:** Vanilla HTML/CSS/JS
- **Backend:** Node.js + Express
- **Database:** SQLite (via sql.js)
- **API:** VRChat Community API

## License

MIT
