// db/db.js
const { Low } = require('lowdb');
const { JSONFile } = require('lowdb/node');
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'data.json');

// Ensure db file exists
if (!fs.existsSync(file)) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({}, null, 2)); // empty object
}

// Create adapter
const adapter = new JSONFile(file);

// CORRECT lowdb v6 usage: defaults inside the constructor
const db = new Low(adapter, {
  users: {},
  groups: {},
  settings: {}
});

async function init() {
  await db.read();

  // If file was empty, data = defaults
  if (!db.data) {
    db.data = {
      users: {},
      groups: {},
      settings: {}
    };
    await db.write();
  }
}

module.exports = { db, init };
