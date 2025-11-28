// index.js
// Main bot - loads session from ./sessions/<SESSION_NAME> and runs socket
const fs = require('fs');
const path = require('path');
const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@adiwajshing/baileys');
const { downloadSessionFromS3 } = require('./s3');

const SESSION_NAME = process.env.SESSION_NAME || 'default';
const SESSIONS_DIR = path.join(__dirname, 'sessions');
const sessionFolder = path.join(SESSIONS_DIR, SESSION_NAME);

async function ensureSessionFromS3IfNeeded() {
  // If S3 configured and local session missing, try download
  if (!fs.existsSync(sessionFolder) || fs.readdirSync(sessionFolder).length === 0) {
    if (process.env.S3_BUCKET && process.env.AWS_REGION) {
      console.log('Local session not found — attempting to download from S3...');
      try {
        await downloadSessionFromS3(sessionFolder, SESSION_NAME);
        console.log('Downloaded session from S3 (if it existed).');
      } catch (e) {
        console.warn('S3 download failed or no session present:', e.message || e);
      }
    }
  }
}

(async () => {
  try {
    await ensureSessionFromS3IfNeeded();

    if (!fs.existsSync(sessionFolder)) fs.mkdirSync(sessionFolder, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(sessionFolder);
    const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [4, 0, 0] }));

    const sock = makeWASocket({
      auth: state,
      version,
      printQRInTerminal: false
    });

    // make sure creds are saved whenever updated
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect } = update;
      console.log('connection.update', connection);
      if (connection === 'close') {
        console.log('Connection closed:', lastDisconnect?.error?.output?.statusCode, lastDisconnect?.error?.message);
        // optionally add reconnection/backoff logic here
      }
      if (connection === 'open') {
        console.log('Bot connected (session):', SESSION_NAME);
      }
    });

    // ---- YOUR MESSAGE HANDLERS / BOT LOGIC ----
    sock.ev.on('messages.upsert', async (msg) => {
      try {
        const messages = msg.messages || [];
        for (const m of messages) {
          if (!m.message) continue;
          const from = m.key.remoteJid;
          const text = (m.message.conversation || m.message.extendedTextMessage?.text || '').toString();
          console.log('received', from, text);

          // example reply (echo)
          if (text && !m.key.fromMe) {
            await sock.sendMessage(from, { text: `Echo: ${text}` });
          }
        }
      } catch (err) {
        console.error('message handler error', err);
      }
    });
    // -------------------------------------------

    // optional: on startup upload session to S3 periodically or on creds.update
    // e.g. sock.ev.on('creds.update', () => { uploadSessionToS3(sessionFolder, SESSION_NAME) })

  } catch (err) {
    console.error('Fatal error starting bot:', err);
    process.exit(1);
  }
})();
