// db/json.js
// Tiny file-based JSON DB adapter. Not for heavy production use.
// Usage: const db = new JsonDB('./data.json'); await db.get('users.123'); await db.set('settings.debug', true);

const fs = require('fs');
const path = require('path');

class JsonDB {
  constructor(file = path.join(__dirname, '..', 'data', 'db.json')) {
    this.file = file;
    this.data = {};
    this._ensureFile();
    this._load();
  }

  _ensureFile() {
    const dir = path.dirname(this.file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(this.file)) fs.writeFileSync(this.file, JSON.stringify({}));
  }

  _load() {
    try {
      this.data = JSON.parse(fs.readFileSync(this.file, 'utf8') || '{}');
    } catch (e) {
      console.error('Failed to read DB file, starting with empty DB.', e);
      this.data = {};
    }
  }

  _save() {
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
  }

  // path like 'users.1234'
  _resolvePath(keyPath) {
    if (!keyPath) return null;
    return keyPath.split('.');
  }

  get(keyPath) {
    const parts = this._resolvePath(keyPath);
    if (!parts) return undefined;
    let cur = this.data;
    for (const p of parts) {
      if (cur == null) return undefined;
      cur = cur[p];
    }
    return cur;
  }

  set(keyPath, value) {
    const parts = this._resolvePath(keyPath);
    if (!parts) return;
    let cur = this.data;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i];
      if (!cur[p] || typeof cur[p] !== 'object') cur[p] = {};
      cur = cur[p];
    }
    cur[parts[parts.length - 1]] = value;
    this._save();
  }

  delete(keyPath) {
    const parts = this._resolvePath(keyPath);
    if (!parts) return;
    let cur = this.data;
    for (let i = 0; i < parts.length - 1; i++) {
      cur = cur[parts[i]];
      if (!cur) return;
    }
    delete cur[parts[parts.length - 1]];
    this._save();
  }
}

module.exports = JsonDB;
