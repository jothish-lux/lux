// db/sessions.js
// Postgres helper to store Baileys auth state as JSONB
// Requires: npm install pg

const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.warn('WARNING: DATABASE_URL not set — sessions will not be saved to DB.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // optional SSL for some providers:
  // ssl: { rejectUnauthorized: false }
});

async function upsertSession(id, authState) {
  if (!process.env.DATABASE_URL) return;
  const text = `
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );
    INSERT INTO sessions (id, data)
    VALUES ($1, $2::jsonb)
    ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now();
  `;
  const values = [id, JSON.stringify(authState)];
  await pool.query(text, values);
}

async function getSession(id) {
  if (!process.env.DATABASE_URL) return null;
  const res = await pool.query('SELECT data FROM sessions WHERE id = $1', [id]);
  return res.rows[0] ? res.rows[0].data : null;
}

module.exports = { upsertSession, getSession };
