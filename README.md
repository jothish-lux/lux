LUX WHATSAPP BOT
=================

Lux is a WhatsApp automation bot built using the Baileys (WhatsApp Web API) library.
It supports basic utility commands and can be extended with more features.

--------------------------------------------------
FEATURES
--------------------------------------------------
- WhatsApp Multi-Device support
- Command-based interaction
- Persistent session handling
- Easy to extend and customize
- Lightweight and fast

--------------------------------------------------
REQUIREMENTS
--------------------------------------------------
- Node.js v18 or higher
- npm or yarn
- A WhatsApp account for pairing

--------------------------------------------------
INSTALLATION
--------------------------------------------------
1. Clone the repository:

   git clone https://github.com/jothish-lux/lux.git
   cd lux

2. Install dependencies:

   npm install

--------------------------------------------------
SESSION SETUP
--------------------------------------------------
Run the session generator to link your WhatsApp account:

   node generate-session.js

Scan the QR code from WhatsApp:
Settings > Linked Devices > Link a device

Session files will be saved locally for future runs.

--------------------------------------------------
START THE BOT
--------------------------------------------------
To start the bot:

   npm start
   or
   node index.js

--------------------------------------------------
AVAILABLE COMMANDS
--------------------------------------------------
.help
  Shows the list of available commands and usage.

.alive
  Checks if the bot is running and responsive.

.ping
  Returns the bot latency / response time.

.sticker
  Reply to an image or video with .sticker to convert it into a WhatsApp sticker.

--------------------------------------------------
PROJECT STRUCTURE
--------------------------------------------------
- index.js              Main entry point
- commands/             Command handlers
- auth_info_baileys/    WhatsApp session data
- package.json          Project metadata

--------------------------------------------------
DISCLAIMER
--------------------------------------------------
This project uses an unofficial WhatsApp API (Baileys).
Use at your own risk. Excessive automation or spam may
lead to account restrictions or bans.

--------------------------------------------------
LICENSE
--------------------------------------------------
MIT License
© jothish-lux
