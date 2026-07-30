/* ============================================================
   One-time OAuth setup — get a Google Calendar refresh token
   ============================================================
   Usage:
     1. Download OAuth credentials from Google Cloud Console
        (APIs & Services → Credentials → Create OAuth 2.0 Client ID
         → type: Desktop app → Download JSON)
     2. Save as ./credentials.json (gitignored)
     3. node scripts/oauth-setup.js
     4. Copy the printed refresh token into your .env as
        GOOGLE_REFRESH_TOKEN=<token>
   ============================================================ */

import { readFileSync } from 'fs';
import { createServer } from 'http';
import { google } from 'googleapis';

const REDIRECT_PORT = 3001;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/oauth2callback`;
const SCOPES = ['https://www.googleapis.com/auth/calendar'];

import { exec } from 'child_process';

function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open'
    : process.platform === 'win32' ? 'start'
    : 'xdg-open';
  exec(`${cmd} "${url}"`, (err) => {
    if (err) console.error('Could not auto-open browser. Open this URL manually:\n');
  });
}

async function main() {
  // Load credentials
  let creds;
  try {
    creds = JSON.parse(readFileSync('./credentials.json', 'utf-8'));
  } catch {
    console.error('❌ Could not read ./credentials.json');
    console.error('   Download it from Google Cloud Console → Credentials → OAuth 2.0 Client ID');
    console.error('   Save as ./credentials.json in the repo root');
    process.exit(1);
  }

  const key = creds.installed || creds.web;
  if (!key) {
    console.error('❌ credentials.json format not recognized. Expected "installed" or "web" key.');
    process.exit(1);
  }

  const { client_id, client_secret } = key;

  if (!client_id || !client_secret) {
    console.error('❌ credentials.json missing client_id or client_secret');
    process.exit(1);
  }

  console.log('✅ Loaded credentials for client:', client_id);

  // Create OAuth2 client
  const oauth2 = new google.auth.OAuth2(client_id, client_secret, REDIRECT_URI);

  // Generate auth URL — prompt: 'consent' forces a refresh token to be returned
  const authUrl = oauth2.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  });

  console.log('\n🔐 Opening your browser for Google Calendar authorization...');
  console.log('   If it doesn\'t open, visit this URL manually:\n');
  console.log(`   ${authUrl}\n`);

  await openBrowser(authUrl);

  // Start local server to catch the OAuth redirect
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${REDIRECT_PORT}`);

    if (url.pathname !== '/oauth2callback') {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    const code = url.searchParams.get('code');
    const error = url.searchParams.get('error');

    if (error) {
      res.writeHead(400, { 'Content-Type': 'text/html' });
      res.end(`<h1>Authorization denied</h1><p>${error}</p>`);
      console.error(`\n❌ Authorization denied: ${error}`);
      server.close();
      process.exit(1);
    }

    if (!code) {
      res.writeHead(400);
      res.end('No code received');
      return;
    }

    try {
      // Exchange code for tokens
      const { tokens } = await oauth2.getToken(code);

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`
        <h1>✅ Authorization successful!</h1>
        <p>You can close this tab and return to your terminal.</p>
      `);

      console.log('\n🎉 Authorization successful!\n');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('Add this to your .env file:\n');
      console.log(`GOOGLE_CLIENT_ID=${client_id}`);
      console.log(`GOOGLE_CLIENT_SECRET=${client_secret}`);
      console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

      if (!tokens.refresh_token) {
        console.warn('⚠️  No refresh token returned! You may have already authorized this app.');
        console.warn('   Go to https://myaccount.google.com/permissions, revoke access, and try again.');
      }

      server.close();
      process.exit(0);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/html' });
      res.end(`<h1>Token exchange failed</h1><pre>${err.message}</pre>`);
      console.error('\n❌ Token exchange failed:', err.message);
      server.close();
      process.exit(1);
    }
  });

  server.listen(REDIRECT_PORT, () => {
    console.log(`📍 Waiting for authorization callback on http://localhost:${REDIRECT_PORT}...`);
  });
}

// Handle top-level await (ESM)
main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
