// bootstrap-auth.js
// Fetch auth.json from S3 or from a URL and write to disk if not present.
// Usage: set envs (see README below) then run: node bootstrap-auth.js
//
// Env variables used:
// - AUTH_FILE (default ./auth.json)
// - FETCH_FROM_URL (optional) -> presigned URL or raw URL that returns JSON or base64
// - USE_S3 (default "true") -> "true" or "false"
// - S3_BUCKET, S3_KEY (optional), S3_KEY_PREFIX (default "wa-sessions")
// - AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
// If S3_KEY is not provided, the script will list objects under S3_KEY_PREFIX and pick the latest.
//

import fs from 'fs'
import path from 'path'
import { S3Client, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3'
import fetch from 'node-fetch'

const AUTH_FILE = process.env.AUTH_FILE || path.resolve('./auth.json')
const FETCH_FROM_URL = process.env.FETCH_FROM_URL || ''     // optional direct URL (presigned)
const USE_S3 = (process.env.USE_S3 || 'true') === 'true'
const S3_BUCKET = process.env.S3_BUCKET || ''
const S3_KEY = process.env.S3_KEY || '' // optional: if you know exact key
const S3_KEY_PREFIX = process.env.S3_KEY_PREFIX || 'wa-sessions'
const AWS_REGION = process.env.AWS_REGION || ''
const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID || ''
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY || ''

async function fetchFromUrl(url) {
  console.log('Fetching auth from URL:', url)
  const res = await fetch(url)
  if (!res.ok) throw new Error('fetch failed status ' + res.status)
  const txt = await res.text()
  // try parse as JSON
  try {
    JSON.parse(txt)
    fs.writeFileSync(AUTH_FILE, txt, 'utf8')
    console.log('Wrote auth.json from URL (raw JSON)')
    return
  } catch {}
  // treat as base64
  try {
    const buf = Buffer.from(txt, 'base64')
    // small sanity check: should be JSON after decode
    const parsed = JSON.parse(buf.toString('utf8'))
    fs.writeFileSync(AUTH_FILE, buf)
    console.log('Wrote auth.json from URL (base64)')
    return
  } catch (err) {
    throw new Error('Fetched content is not JSON nor base64-encoded JSON')
  }
}

async function fetchFromS3() {
  if (!S3_BUCKET) throw new Error('S3_BUCKET not set')
  if (!AWS_REGION || !AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY) {
    throw new Error('AWS credentials (AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY) must be set')
  }

  const s3 = new S3Client({
    region: AWS_REGION,
    credentials: {
      accessKeyId: AWS_ACCESS_KEY_ID,
      secretAccessKey: AWS_SECRET_ACCESS_KEY
    }
  })

  let keyToGet = S3_KEY
  if (!keyToGet) {
    console.log('Listing S3 objects under prefix:', S3_KEY_PREFIX)
    const listRes = await s3.send(new ListObjectsV2Command({ Bucket: S3_BUCKET, Prefix: S3_KEY_PREFIX }))
    if (!listRes.Contents || listRes.Contents.length === 0) {
      throw new Error('no objects found in S3 prefix')
    }
    // pick latest by LastModified
    const latest = listRes.Contents.reduce((a,b)=> (new Date(a.LastModified) > new Date(b.LastModified) ? a : b))
    keyToGet = latest.Key
    console.log('Selected latest S3 key:', keyToGet)
  } else {
    console.log('Using provided S3 key:', keyToGet)
  }

  const getRes = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: keyToGet }))
  const stream = getRes.Body
  const chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  const data = Buffer.concat(chunks)
  // data should be raw JSON (auth.json)
  fs.writeFileSync(AUTH_FILE, data)
  console.log('Wrote auth.json from S3 key', keyToGet)
}

async function main() {
  try {
    if (fs.existsSync(AUTH_FILE)) {
      console.log('auth.json already exists at', AUTH_FILE, '— skipping fetch.')
      return
    }

    if (FETCH_FROM_URL) {
      await fetchFromUrl(FETCH_FROM_URL)
      return
    }

    if (USE_S3) {
      await fetchFromS3()
      return
    }

    console.log('No method configured to fetch auth.json. Set FETCH_FROM_URL or USE_S3 + S3_BUCKET.')
  } catch (err) {
    console.error('bootstrap-auth error:', err)
    process.exit(1)
  }
}

main()
