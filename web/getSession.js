// web/getSession.js
// Simple Express router that streams QR as server-sent events (SSE)
// and saves the session to DB when user completes login.
// NOTE: This is a minimal demo. Protect this route in production.

const express = require('express');
const router = express.Router();
const makeWASocket = require('@adiwajshing/baileys').default || require('@adiwajshing/baileys');
const { upsertSession } = require('../db/sessions');

const SESSION_ID = process.env.SESSION_ID || 'lux_main';

// GET /get-session -> returns an HTML page that opens the SSE
router.get('/get-session', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`
    <html>
      <body style="font-family: monospace;">
        <h2>Scan QR to create session</h2>
        <pre id="qr">Waiting for QR...</pre>
        <p id="status"></p>
        <script>
          const s = new EventSource('/get-session/stream');
          s.onmessage = (e) => {
            const d = e.data;
            if (d === 'AUTH_OK') {
              document.getElementById('status').innerText = 'Authenticated — session saved.';
              s.close();
            } else if (d.startsWith('QR:')) {
              document.getElementById('qr').innerText = d.slice(3);
            } else {
              document.getElementById('status').innerText = d;
            }
          };
          s.onerror = (e) => {
            document.getElementById('status').innerText = 'Stream closed or error';
            s.close();
          };
        </script>
      </body>
    </html>
  `);
});

// GET /get-session/stream -> SSE stream that spins temporary socket
router.get('/get-session/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  let tempSock = null;
  let resolved = false;

  // Helper to send SSE
  const send = (data) => {
    res.write(`data: ${data.replace(/\n/g, '\\n')}\n\n`);
  };

  (async () => {
    // Create a temporary Baileys socket that prints QR events to our SSE
    tempSock = makeWASocket({
      printQRInTerminal: false,
      auth: { creds: {}, keys: {} }
    });

    tempSock.ev.on('connection.update', async (update) => {
      try {
        if (update.qr) {
          // Send QR data (base64 or terminal chunk) prefixed so client knows
          send('QR:' + update.qr);
        }
        const conn = update.connection;
        if (conn === 'open') {
          // Save auth to DB
          // try extracting auth like in core/wa.js
          let authState = tempSock.authState || { creds: (tempSock.state && tempSock.state.creds) || {}, keys: (tempSock.state && tempSock.state.keys) || {} };
          await upsertSession(SESSION_ID, authState);
          send('AUTH_OK');
          resolved = true;
          // close socket after saving
          try { await tempSock.logout(); } catch (e) {}
          res.end();
        } else if (conn === 'close') {
          const err = update.lastDisconnect?.error?.message || 'closed';
          if (!resolved) send('ERROR: ' + err);
        }
      } catch (err) {
        console.error('Temp sock error', err);
        if (!resolved) send('ERROR: ' + (err.message || String(err)));
      }
    });

    // also forward generic errors
    tempSock.ev.on('creds.update', async () => {
      // can also forward partial updates if desired
    });

    // If the client disconnects, clean up
    req.on('close', async () => {
      try { if (tempSock) await tempSock.logout(); } catch (e) {}
      try { res.end(); } catch (e) {}
    });

  })().catch(err => {
    send('ERROR: ' + err.message);
    res.end();
  });
});

module.exports = router;
