// generate-session.js
// Drops in a small web UI at / to start session creation easily.
// Usage: node generate-session.js
// Visit: http://localhost:3001/  (or your forwarded host)

const express = require('express');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@adiwajshing/baileys');
const { uploadSessionToS3 } = require('./s3');

const app = express();
const PORT = process.env.SESSION_PORT ? Number(process.env.SESSION_PORT) : 3001;
const SESSIONS_DIR = path.join(__dirname, 'sessions');

if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });

// Simple homepage so "GET /" doesn't show "Cannot GET /"
app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!doctype html>
  <html>
    <head><meta charset="utf-8"><title>Lux Session Generator</title></head>
    <body style="font-family: system-ui, sans-serif; padding: 20px;">
      <h1>Lux — Session Generator</h1>
      <p>To create a session, click the button below or open <code>/generate-session/&lt;name&gt;</code>.</p>
      <form id="frm" action="/generate-session/default" method="get">
        <label>Session name: <input type="text" name="name" id="name" value="default" /></label>
        <button type="submit">Generate session</button>
      </form>
      <p>If you run the script locally and can see the terminal, the QR will also be printed there.</p>
      <p>When the server responds, you'll receive JSON with a <code>qr</code> field (scan it with WhatsApp).</p>
    </body>
  </html>`);
});

/**
 * GET /generate-session/:sessionName?
 * Starts a temporary Baileys socket and returns JSON lines while waiting.
 * - The browser will receive JSON lines with {status: 'qr', qr: '...'} then {status:'ok'}
 *
 * Note: the QR is also printed in the terminal (qrcode-terminal) so scan from there if easier.
 */
app.get('/generate-session/:sessionName?', async (req, res) => {
  const rawName = req.params.sessionName || req.query.name || process.env.SESSION_NAME || 'default';
  const sessionName = String(rawName).replace(/[^a-z0-9\-_]/gi, '');
  const sessionFolder = path.join(SESSIONS_DIR, sessionName);
  if (!fs.existsSync(sessionFolder)) fs.mkdirSync(sessionFolder, { recursive: true });

  try {
    const { state, saveCreds } = await useMultiFileAuthState(sessionFolder);
    const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [4, 0, 0] }));

    const sock = makeWASocket({
      auth: state,
      version,
      printQRInTerminal: false
    });

    let finished = false;

    // make response JSON and keep it open for streaming QR update(s)
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.flushHeaders();

    const timer = setTimeout(async () => {
      if (!finished) {
        finished = true;
        try { await sock.logout(); } catch (e) {}
        if (!res.writableEnded) res.write(JSON.stringify({ status: 'timeout' }) + '\n');
        if (!res.writableEnded) res.end();
      }
    }, 2 * 60 * 1000); // 2 minutes timeout

    sock.ev.on('connection.update', async (update) => {
      const { connection, qr, lastDisconnect } = update;

      if (qr) {
        // print in the terminal and send the raw qr string to client
        qrcode.generate(qr, { small: true });
        if (!res.writableEnded) {
          res.write(JSON.stringify({ status: 'qr', qr }) + '\n');
        }
      }

      if (connection === 'open') {
        try { await saveCreds(); } catch (e) { console.error('saveCreds error', e); }

        finished = true;
        clearTimeout(timer);

        // upload to S3 if configured (optional)
        if (process.env.S3_BUCKET && process.env.AWS_REGION) {
          try {
            await uploadSessionToS3(sessionFolder, sessionName);
            console.log('Uploaded session to S3');
          } catch (e) {
            console.error('S3 upload failed:', e);
          }
        }

        if (!res.writableEnded) {
          res.write(JSON.stringify({ status: 'ok', session: sessionName }) + '\n');
          res.end();
        }

        // shut down temporary socket
        setTimeout(() => sock.logout().catch(() => {}), 500);
      }

      if (connection === 'close') {
        if (lastDisconnect && !finished) {
          console.log('Connection closed while generating:', lastDisconnect.error);
        }
      }
    });

    sock.ev.on('creds.update', saveCreds);
  } catch (err) {
    console.error('generate-session error', err);
    if (!res.headersSent) res.status(500).json({ error: String(err) });
    else {
      if (!res.writableEnded) res.write(JSON.stringify({ error: String(err) }) + '\n');
      if (!res.writableEnded) res.end();
    }
  }
});

app.get('/sessions', (req, res) => {
  const items = fs.readdirSync(SESSIONS_DIR).filter(n => {
    try { return fs.statSync(path.join(SESSIONS_DIR, n)).isDirectory(); } catch { return false; }
  });
  res.json(items);
});

app.listen(PORT, () => {
  console.log(`Session generator running on port ${PORT}`);
  console.log(`Open: http://localhost:${PORT}/ or http://localhost:${PORT}/generate-session/<name>`);
});
