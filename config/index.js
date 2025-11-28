// config/index.js
require('dotenv').config();

const OWNER_RAW = process.env.OWNER || '';
const OWNER = OWNER_RAW.split(',').map(s => s.trim()).filter(Boolean); // e.g. "12345@s.whatsapp.net,other@s.whatsapp.net"

module.exports = {
  PREFIX: process.env.PREFIX || '!',
  OWNER,
  SESSION_FILE: process.env.SESSION_FILE || './session.json',
  PORT: parseInt(process.env.PORT || '3000', 10),
};
