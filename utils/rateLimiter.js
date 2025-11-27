const map = new Map();
function allow(jid, limit = 20, windowMs = 5*60*1000) {
const now = Date.now();
let state = map.get(jid) || { count: 0, start: now };
if (now - state.start > windowMs) state = { count: 0, start: now };
state.count++;
map.set(jid, state);
return state.count <= limit;
}
module.exports = { allow };