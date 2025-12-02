// core/commands.js
const fs = require('fs');
const path = require('path');

function loadCommands(dir = path.join(__dirname, '..', 'commands')) {
  const map = new Map();
  if (!fs.existsSync(dir)) return map;
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.js'));
  for (const f of files) {
    try {
      const full = path.join(dir, f);
      delete require.cache[require.resolve(full)];
      const cmd = require(full);
      if (!cmd || !cmd.name || typeof cmd.execute !== 'function') {
        console.warn(`Skipping invalid command file: ${f}`);
        continue;
      }
      map.set(cmd.name, cmd);
      if (Array.isArray(cmd.aliases)) {
        for (const a of cmd.aliases) map.set(a, cmd);
      }
    } catch (e) {
      console.error(`Failed to load command ${f}:`, e);
    }
  }
  return map;
}

module.exports = { loadCommands };
