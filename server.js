require('dotenv').config();

const express = require('express');
const path = require('path');
const { getClient } = require('./src/vrchat');
const { startTracker } = require('./src/tracker');
const routes = require('./src/routes');
const { getDb } = require('./src/database');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// API routes
app.use('/api', routes);

// SPA fallback — serve index.html for all non-API routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
async function start() {
  // Initialize database first
  await getDb();
  console.log('[Server] Database initialized');

  app.listen(PORT, async () => {
    console.log(`\n🎮 VRC Time Tracker running at http://localhost:${PORT}\n`);

    // Authenticate with VRChat API
    const username = process.env.VRCHAT_USERNAME;
    const password = process.env.VRCHAT_PASSWORD;

    if (username && password && username !== 'your_vrchat_username') {
      try {
        const client = getClient();
        const result = await client.login(username, password);

        if (result.requires2FA) {
          console.log('[Server] ⚠️  2FA required. The tracker will not poll until 2FA is completed.');
          console.log('[Server] To complete 2FA, send a POST to /api/verify-2fa with { "code": "123456" }');
        } else {
          console.log('[Server] ✅ VRChat API authenticated');
          startTracker();
        }
      } catch (err) {
        console.error('[Server] ❌ VRChat login failed:', err.message);
        console.log('[Server] The app will still serve the frontend, but tracking is disabled.');
      }
    } else {
      console.log('[Server] ⚠️  No VRChat credentials configured.');
      console.log('[Server] Copy .env.example to .env and add your VRChat credentials.');
      console.log('[Server] The app will run in demo mode with sample data.\n');
    }
  });
}

start().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
