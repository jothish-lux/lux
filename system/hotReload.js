const chokidar = require('chokidar');
const path = require('path');


function watchFolder(folder, onChange) {
const watcher = chokidar.watch(folder, { ignoreInitial: true });
watcher.on('add', (f) => onChange('add', f));
watcher.on('change', (f) => onChange('change', f));
watcher.on('unlink', (f) => onChange('unlink', f));
return watcher;
}


function clearRequire(file) {
try {
const resolved = require.resolve(file);
delete require.cache[resolved];
} catch (e) {}
}


module.exports = { watchFolder, clearRequire };