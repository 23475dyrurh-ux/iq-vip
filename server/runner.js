// ==============================================================================
// IQ VIP Platform - Master Runner with Permanent Fixed Subdomain & Auto-Healing
// ==============================================================================

const localtunnel = require('localtunnel');
const http = require('http');

// 1. Start Platform Server
const server = require('./index.js');
const PORT = process.env.PORT || 3000;

if (!server.listening) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[Server] IQ VIP Server listening on port ${PORT}`);
  });
}

// 2. Start Persistent Localtunnel with Fixed Subdomain
const SUBDOMAIN = 'iq-vip-platform';
let activeTunnel = null;
let reconnecting = false;

async function connectTunnel() {
  if (reconnecting) return;
  reconnecting = true;

  try {
    if (activeTunnel) {
      try { activeTunnel.close(); } catch (e) {}
      activeTunnel = null;
    }

    console.log(`[Tunnel] Connecting to fixed subdomain: https://${SUBDOMAIN}.loca.lt ...`);
    activeTunnel = await localtunnel({ port: 3000, subdomain: SUBDOMAIN });

    console.log('\n=======================================================');
    console.log(' 🌐 FIXED PERMANENT PUBLIC URLS:');
    console.log(`    User App:     ${activeTunnel.url}`);
    console.log(`    Admin Portal: ${activeTunnel.url}/admin`);
    console.log('=======================================================\n');

    activeTunnel.on('close', () => {
      console.warn('[Tunnel] Connection closed, auto-reconnecting in 3s...');
      reconnecting = false;
      setTimeout(connectTunnel, 3000);
    });

    activeTunnel.on('error', (err) => {
      console.error('[Tunnel] Error:', err.message);
      reconnecting = false;
      setTimeout(connectTunnel, 4000);
    });

    reconnecting = false;
  } catch (err) {
    console.error('[Tunnel] Connect error:', err.message, '- Retrying in 5s...');
    reconnecting = false;
    setTimeout(connectTunnel, 5000);
  }
}

// Keep-alive heartbeat every 60 seconds
setInterval(() => {
  if (activeTunnel && activeTunnel.url) {
    http.get('http://127.0.0.1:3000/api/payment-methods', () => {}).on('error', () => {});
  } else {
    connectTunnel();
  }
}, 60000);

// 3. Start Cloudflare Tunnel as Secondary Backup
const { spawn } = require('child_process');
const fs = require('fs');
const cloudflaredPath = 'C:\\Users\\mohmed\\.gemini\\antigravity\\scratch\\cloudflared.exe';

if (fs.existsSync(cloudflaredPath)) {
  function startCloudflared() {
    try {
      const cf = spawn(cloudflaredPath, ['tunnel', '--url', 'http://127.0.0.1:3000']);
      cf.stderr.on('data', d => {
        const text = d.toString();
        const m = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
        if (m) console.log(' 🌐 Cloudflare Fallback URL:', m[0]);
      });
      cf.on('close', () => {
        setTimeout(startCloudflared, 5000);
      });
    } catch (e) {
      console.error('Cloudflared spawn error:', e.message);
    }
  }
  startCloudflared();
}

connectTunnel();
