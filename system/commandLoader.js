const fs = require('fs');
const path = require('path');


function loadCommands(dir) {
const commands = new Map();
if (!fs.existsSync(dir)) return commands;
const files = fs.readdirSync(dir, { withFileTypes: true });
for (const f of files) {
if (f.isDirectory()) {
const sub = path.join(dir, f.name);
const subCommands = loadCommands(sub);
for (const [k, v] of subCommands) commands.set(k, v);
continue;
}
if (!f.name.endsWith('.js')) continue;
const mod = require(path.join(dir, f.name));
if (!mod?.name || !mod?.run) continue;
commands.set(mod.name, mod);
}
return commands;
}


module.exports = { loadCommands };