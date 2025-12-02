#!/usr/bin/env bash
set -euo pipefail

BOT_DIR="${BOT_DIR:-$HOME/wa-bot}"
REPO_URL="${REPO_URL:-https://github.com/youruser/your-bot-repo.git}"
NODE_SETUP_URL="https://deb.nodesource.com/setup_20.x"
PM2_USER="${PM2_USER:-$(whoami)}"

echo "Installing WhatsApp bot to ${BOT_DIR}"
sudo apt update && sudo apt install -y git curl ffmpeg build-essential

# install node 20
curl -fsSL ${NODE_SETUP_URL} | sudo -E bash -
sudo apt install -y nodejs

# install yarn or npm (choose)
if ! command -v yarn >/dev/null 2>&1; then
  sudo npm install -g yarn
fi

# clone repo
if [ -d "$BOT_DIR" ]; then
  echo "Bot dir exists, pulling latest"
  cd "$BOT_DIR" && git pull
else
  git clone "$REPO_URL" "$BOT_DIR"
  cd "$BOT_DIR"
fi

# install deps
yarn install --production

# optional: create .env from example
if [ ! -f ".env" ] && [ -f "config.env.example" ]; then
  cp config.env.example .env
  echo "Please edit .env (or config.env) to set required env variables, then re-run the script."
fi

# global pm2 (process manager)
if ! command -v pm2 >/dev/null 2>&1; then
  sudo npm install -g pm2
fi

# start the bot with pm2 (will restart on crash)
pm2 start npm --name "wa-bot" -- start
pm2 save

echo "Installed. View logs: pm2 logs wa-bot"
