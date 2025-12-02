// session-server.js
// Creates a single-file Baileys auth (auth.json), serves QR page, and
// when connected uploads auth.json to S3 and/or POSTs base64 to webhook(s).
//
// Env:
// PORT (default 3000)
// AUTH_FILE (default ./auth.json)
// UPLOAD_TO_S3 ("true"/"false")
// S3_BUCKET, S3_KEY_PREFIX (optional)
// AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
// SESSION_WEBHOOK (optional) - URL to POST {"authBase64": "..."} (use HTTPS)
// ALLOW_DOWNLOAD (optional "true") - if true, provides /download-auth to download auth.json

import express from 'express'
import makeWASocket, { fetchLatestBaileysVersion, useSingleFileAuthState } from '@whiskeysockets/baileys'
import pino from 'pino'
import fs from 'fs'
import path from 'path'
import QRCode from 'qrcode'
import qrcodeTerminal from 'qrcode-terminal'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import fetch from 'node-fetch'

const PORT = process.env.PORT || 3000
const AUTH_FILE = process.env.AUTH_FILE || path.resolve('./auth.json')
const UPLOAD_TO_S3 = (process.env.UPLOAD_TO_S3 || 'true') === 'true'
const S3_BUCKET = process.env.S3_BUCKET || ''
const S3_KEY_PREFIX = process.env.S3_KEY_PREFIX || 'wa-sessions'
const SESSION_WEBHOOK = process.env.SESSION_WEBHOOK || ''
const ALLOW_DOWNLOAD = (process.env.ALLOW_DOWNLOAD || 'false') === 'true'

const logger = pino({ level: 'info' })

// S3 client (if used)
let s3client = null
if (UPLOAD_TO_S3) {
  if (!S3_BUCKET) {
    logger.error('UPLOAD_TO_S3 is true but S3_BUCKET not set. Disable or set S3_BUCKET.')
    process.exit(1)
  }
  s3client = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
  })
}

async function uploadAuthToS3(localFilePath) {
  if (!s3client) throw new Error('S3 client not configured')
  const data = fs.readFileSync(localFilePath)
  const timestamp = Date.now()
  const key = `${S3_KEY_PREFIX}/auth-${timestamp}.json`
  const cmd = new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
    Body: data,
    ContentType: 'application/json',
    ACL: 'private'
  })
  await s3client.send(cmd)
  logger.info({ key }, 'uploaded auth.json to S3')
  // return the object key so you can generate presigned URL externally if desired
  return key
}

async function postAuthToWebhook(localFilePath) {
  if (!SESSION_WEBHOOK) return
  const data = fs.readFileSync(localFilePath, 'utf8')
  const b64 = Buffer.from(data).toString('base64')
  logger.info('Posting base64 session to webhook...')
  try {
    const res = await fetch(SESSION_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ authBase64: b64 })
    })
    logger.info({ status: res.status }, 'webhook result')
    if (!res.ok) {
      const text = await res.text()
      logger.warn({ text }, 'webhook returned non-ok')
    }
  } catch (err) {
    logger.error({ err }, 'failed to post to webhook')
  }
}

async function startWA() {
  // use single-file auth state so it's easy to move around
  const { state, saveCreds } = await useSingleFileAuthState(AUTH_FILE)

  let version = undefined
  try {
    const res = await fetchLatestBaileysVersion()
    version = res.version
    logger.info({ version, isLatest: res.isLatest }, 'fetched baileys version')
  } catch (e) {
    logger.warn('could not fetch latest baileys version')
  }

  const sock = makeWASocket({
    logger,
    auth: state,
    version
  })

  sock.ev.on('creds.update', saveCreds)

  let latestQR = null
  let connected = false

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update
    logger.info({ connection, lastDisconnect: !!lastDisconnect, hasQR: !!qr }, 'connection.update')

    if (qr) {
      latestQR = qr
      // print QR to terminal
      qrcodeTerminal.generate(qr, { small: true })
    }

    if (connection === 'open') {
      connected = true
      logger.info('WA Connected — auth file created at', AUTH_FILE)

      // upload or post the auth file (if present)
      if (fs.existsSync(AUTH_FILE)) {
        if (UPLOAD_TO_S3) {
          try {
            const s3key = await uploadAuthToS3(AUTH_FILE)
            logger.info({ s3key }, 'session uploaded to s3')
          } catch (err) {
            logger.error({ err }, 'upload to s3 failed')
          }
        }
        if (SESSION_WEBHOOK) {
          try {
            await postAuthToWebhook(AUTH_FILE)
          } catch (err) {
            logger.error({ err }, 'postAuthToWebhook failed')
          }
        }
      } else {
        logger.warn('auth file does not exist yet')
      }
    }

    if (connection === 'close') {
      connected = false
      logger.warn('connection closed', lastDisconnect?.error?.message ?? lastDisconnect)
    }
  })

  return {
    sock,
    getLatestQR: () => latestQR,
    isConnected: () => connected
  }
}

// --- HTTP server to display QR and allow download ---
const app = express()

app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.write('<h2>WhatsApp Session Generator</h2>')
  res.write('<p>Scan the QR to create a session. After scanning, this server will upload the session somewhere you configure.</p>')
  res.write('<div id="qr"></div>')
  res.write('<script>setInterval(()=>location.reload(),3000)</script>')
  res.end()
})

app.get('/qr.png', async (req, res) => {
  // startWA may set qr later; simple check on disk if auth exists
  if (fs.existsSync(AUTH_FILE)) {
    return res.status(404).send('Session created — no QR')
  }
  // we rely on startWA to set latestQR via closure; we'll expose it via a variable
  try {
    const latest = global.__LATEST_QR__ || null
    if (!latest) return res.status(404).send('No QR yet')
    const png = await QRCode.toBuffer(latest, { margin: 2 })
    res.setHeader('Content-Type', 'image/png')
    res.send(png)
  } catch (err) {
    logger.error({ err }, 'qr.png err')
    res.status(500).send('qr gen error')
  }
})

if (ALLOW_DOWNLOAD) {
  app.get('/download-auth', (req, res) => {
    if (!fs.existsSync(AUTH_FILE)) return res.status(404).send('No auth file yet.')
    res.download(AUTH_FILE, 'auth.json')
  })
}

// Start WA and set global pointer for QR
startWA().then(({ getLatestQR, isConnected }) => {
  // poll the latest QR and store on global for /qr.png to use
  setInterval(() => {
    global.__LATEST_QR__ = getLatestQR()
    global.__IS_CONNECTED__ = isConnected()
  }, 500)
}).catch((err) => {
  console.error('startWA failed', err)
  process.exit(1)
})

const port = PORT
app.listen(port, () => logger.info({ port }, 'session-server listening'))
