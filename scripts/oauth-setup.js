/* ============================================================
   One-time OAuth setup — get a Google Calendar refresh token
   ============================================================
   Usage:
     1. Download OAuth credentials from Google Cloud Console
        (APIs & Services → Credentials → Create OAuth 2.0 Client ID
         → type: Desktop app → Download JSON)
     2. Save as ./credentials.json (gitignored)
     3. node scripts/oauth-setup.js
     4. The script writes GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
        and GOOGLE_REFRESH_TOKEN directly into ./.env (never stdout)
   ============================================================ */

import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'fs';
import { createServer } from 'http';
import { google } from 'googleapis';

const REDIRECT_PORT = 3001;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/oauth2callback`;
const SCOPES = ['https://www.googleapis.com/auth/calendar'];
const ENV_FILE = './.env';

import { exec } from 'child_process';

function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open'
    : process.platform === 'win32' ? 'start'
    : 'xdg-open';
  exec(`${cmd} "${url}"`, (err) => {
    if (err) console.error('Could not auto-open browser. Open this URL manually:\n');
  });
}

/**
 * Write or update a key=value pair in .env without printing secrets.
 */
function upsertEnv(key, value) {
  const line = `${key}=${value}`;
  let env = '';
  if (existsSync(ENV_FILE)) {
    env = readFileSync(ENV_FILE, 'utf-8');
  }
  const lines = env.split('\n');
  let found = false;
  const updated = lines.map(l => {
    if (l.startsWith(`${key}=`)) {
      found = true;
      return line;
    }
    return l;
  });
  if (!found) {
    updated.push(line);
  }
  writeFileSync(ENV_FILE, updated.filter(l => l !== '').join('\n') + '\n', { mode: 0o600 });
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

  console.log('✅ Loaded credentials from credentials.json');

  // Write client ID and secret to .env immediately
  upsertEnv('GOOGLE_CLIENT_ID', client_id);
  upsertEnv('GOOGLE_CLIENT_SECRET', client_secret);
  console.log('📝 GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET written to .env');

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

      if (!tokens.refresh_token) {
        console.warn('\n⚠️  No refresh token returned! You may have already authorized this app.');
        console.warn('   Go to https://myaccount.google.com/permissions, revoke access, and try again.');
        server.close();
        process.exit(1);
      }

      // Write refresh token directly to .env — never to stdout
      upsertEnv('GOOGLE_REFRESH_TOKEN', tokens.refresh_token);

      console.log('\n🎉 Authorization successful!\n');
      console.log('✅ All credentials written to .env (file mode 0600)');
      console.log('   GOOGLE_CLIENT_ID      ✓');
      console.log('   GOOGLE_CLIENT_SECRET  ✓');
      console.log('   GOOGLE_REFRESH_TOKEN  ✓');
      console.log('\n   You can now run: node server.js\n');

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
