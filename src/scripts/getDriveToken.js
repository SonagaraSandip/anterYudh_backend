import http from 'http';
import url from 'url';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import readline from 'readline';
import { google } from 'googleapis';
import dotenv from 'dotenv';

dotenv.config();

const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
const redirectUri = 'http://localhost:5000/oauth2callback';

if (!clientId || !clientSecret) {
  console.log('=======================================================');
  console.log('🔑 Google Drive OAuth2 Setup');
  console.log('=======================================================');
  console.log('Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in backend/.env:');
  console.log('1. Go to https://console.cloud.google.com/apis/credentials');
  console.log('2. Click "+ CREATE CREDENTIALS" > "OAuth client ID" > Application type: "Web application"');
  console.log('3. Add Authorized redirect URIs: http://localhost:5000/oauth2callback');
  console.log('4. Copy Client ID and Client Secret into your backend/.env');
  console.log('5. Run: npm run db:auth');
  console.log('=======================================================');
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

const scopes = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive'
];

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',
  scope: scopes
});

console.log('=======================================================');
console.log('🔗 Authorize Google Drive for Personal Gmail Account:');
console.log('=======================================================');
console.log('Opening authentication URL in your default browser...');
console.log('\nIf it does not open automatically, copy & open this link:\n');
console.log(authUrl);
console.log('\n=======================================================');

// Try to auto-open URL in browser
const startCmd = process.platform === 'win32' ? `start "" "${authUrl}"` : process.platform === 'darwin' ? `open "${authUrl}"` : `xdg-open "${authUrl}"`;
exec(startCmd, () => {});

console.log('Waiting for authorization callback on port 5000...\n');

const server = http.createServer(async (req, res) => {
  try {
    const reqUrl = url.parse(req.url, true);
    if (reqUrl.pathname === '/oauth2callback') {
      const code = reqUrl.query.code;
      if (code) {
        const { tokens } = await oauth2Client.getToken(code);
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <div style="font-family: sans-serif; text-align: center; margin-top: 60px;">
            <h1 style="color: #10b981;">✅ Google Drive Authorization Successful!</h1>
            <p style="color: #475569; font-size: 16px;">Refresh token has been automatically saved to your .env file.</p>
            <p style="color: #64748b; font-size: 14px;">You can close this browser tab now.</p>
          </div>
        `);

        // Automatically write/update GOOGLE_REFRESH_TOKEN in backend/.env
        try {
          const envPath = path.resolve(process.cwd(), '.env');
          if (fs.existsSync(envPath)) {
            let envContent = fs.readFileSync(envPath, 'utf8');
            if (envContent.includes('GOOGLE_REFRESH_TOKEN=')) {
              envContent = envContent.replace(/GOOGLE_REFRESH_TOKEN=.*/, `GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
            } else {
              envContent += `\nGOOGLE_REFRESH_TOKEN=${tokens.refresh_token}\n`;
            }
            fs.writeFileSync(envPath, envContent, 'utf8');
            console.log('💾 Successfully saved GOOGLE_REFRESH_TOKEN to backend/.env automatically!\n');
          }
        } catch (saveErr) {
          console.warn('Could not auto-write to .env:', saveErr.message);
        }

        console.log('=======================================================');
        console.log('🎉 SUCCESS! Your Google Refresh Token is:\n');
        console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}\n`);
        console.log('=======================================================');
        server.close();
        process.exit(0);
      }
    }
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Authentication failed: ' + err.message);
    console.error('Error getting tokens:', err.message);
    server.close();
    process.exit(1);
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.warn('\n⚠️ Port 5000 is currently in use (e.g. by your running dev server).');
    console.log('Please temporarily stop nodemon server in your other terminal (press Ctrl+C), then re-run:');
    console.log('  npm run db:auth\n');
    process.exit(1);
  } else {
    console.error('Server error:', err.message);
    process.exit(1);
  }
});

server.listen(5000, () => {});
