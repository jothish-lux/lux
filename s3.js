// s3.js
// Optional helper to upload/download the session folder to S3
const fs = require('fs');
const path = require('path');
const mime = require('mime-types');
const { S3Client, PutObjectCommand, ListObjectsV2Command, GetObjectCommand } = require('@aws-sdk/client-s3');

const S3_BUCKET = process.env.S3_BUCKET;
const S3_PREFIX = process.env.S3_PREFIX || 'lux-sessions';
const REGION = process.env.AWS_REGION;

function s3Client() {
  if (!S3_BUCKET || !REGION) throw new Error('S3_BUCKET and AWS_REGION env vars required for S3 operations');
  return new S3Client({ region: REGION });
}

async function uploadSessionToS3(localSessionFolder, sessionName) {
  if (!S3_BUCKET || !REGION) return;
  const client = s3Client();
  if (!fs.existsSync(localSessionFolder)) return;
  const files = fs.readdirSync(localSessionFolder);
  for (const file of files) {
    const full = path.join(localSessionFolder, file);
    if (!fs.statSync(full).isFile()) continue;
    const body = fs.readFileSync(full);
    const key = `${S3_PREFIX}/${sessionName}/${file}`;
    const contentType = mime.lookup(file) || 'application/octet-stream';
    await client.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType
    }));
  }
}

async function downloadSessionFromS3(localSessionFolder, sessionName) {
  if (!S3_BUCKET || !REGION) return;
  const client = s3Client();
  const prefix = `${S3_PREFIX}/${sessionName}/`;
  const list = await client.send(new ListObjectsV2Command({ Bucket: S3_BUCKET, Prefix: prefix }));
  if (!list.Contents || list.Contents.length === 0) {
    throw new Error('No session files in S3 for ' + sessionName);
  }
  if (!fs.existsSync(localSessionFolder)) fs.mkdirSync(localSessionFolder, { recursive: true });
  for (const obj of list.Contents) {
    const key = obj.Key;
    if (!key) continue;
    const fileName = key.replace(prefix, '');
    if (!fileName) continue;
    const outPath = path.join(localSessionFolder, fileName);
    const get = await client.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }));
    // get.Body is a stream in AWS SDK v3 - convert to file
    await streamToFile(get.Body, outPath);
  }
}

// utility to write stream to file
function streamToFile(stream, outPath) {
  return new Promise((resolve, reject) => {
    const writable = fs.createWriteStream(outPath);
    stream.pipe(writable);
    stream.on('error', reject);
    writable.on('finish', resolve);
    writable.on('error', reject);
  });
}

module.exports = {
  uploadSessionToS3,
  downloadSessionFromS3
};
