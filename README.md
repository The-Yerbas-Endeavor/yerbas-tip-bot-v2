# Yerbas Tip Bot v2

Discord wallet, asset, tipping, rain, and interactive drop bot for the Yerbas (YERB) network.

## Features

- Node.js 22 and Discord.js v14
- MySQL-backed YERB balances and transaction history
- Transactional YERB tips and rain distributions
- Idempotent confirmed-deposit credits
- Queued YERB withdrawals with automatic failure refunds
- Yerbas Asset balances, tips, rain, drops, and queued external sends
- Asset decimal validation using `getassetdata`
- Reaction, phrase, lottery, trivia, and lucky-number drops
- Unicode and Discord server emoji support
- Optional `@here` and `@everyone` drop announcements
- Optional single-channel restriction
- Separate safety switches for YERB, withdrawals, assets, and asset withdrawals
- No Docker required

## Commands

### Wallet

- `/deposit`
- `/balance`
- `/withdraw address amount`
- `/history`

### YERB tipping and rain

- `/tip user amount`
- `/rain all amount`
- `/rain online amount`
- `/rain active amount [activity-minutes]`
- `/rain drop amount mode [duration] [winners] [emoji] [notify]`

Active rain recipients must send at least two messages in the current channel during the selected activity window.

### Yerbas Assets

- `/asset-balance [asset]`
- `/asset-tip user asset amount`
- `/asset-withdraw asset address amount`
- `/asset-rain all asset amount`
- `/asset-rain online asset amount`
- `/asset-rain active asset amount [activity-minutes]`
- `/asset-rain drop asset amount mode [duration] [winners] [emoji] [notify]`

### General

- `/help`
- `/ping`
- `/version`
- `/network`

### Administrator

- `/asset-wallet [filter]`
- `/admin-credit user amount reference`
- `/admin-asset-credit user asset amount reference`

## Install

```bash
git clone https://github.com/The-Yerbas-Endeavor/yerbas-tip-bot-v2.git
cd yerbas-tip-bot-v2
git checkout feature/reaction-drops
nvm install
nvm use
cp .env.example .env
npm install
npm run check
npm run register-commands
```

Configure `.env` with the Discord bot token, MySQL credentials, Yerbas RPC credentials, and desired feature switches.

## MySQL

Example configuration:

```env
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=yerbas_tip_bot
MYSQL_PASSWORD=replace-with-a-long-random-password
MYSQL_DATABASE=yerbas_tip_bot
```

Create a restricted database account:

```sql
CREATE DATABASE yerbas_tip_bot CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'yerbas_tip_bot'@'127.0.0.1' IDENTIFIED BY 'replace-with-a-long-random-password';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX
ON yerbas_tip_bot.* TO 'yerbas_tip_bot'@'127.0.0.1';
FLUSH PRIVILEGES;
```

The bot automatically runs its required database migrations during startup.

## Yerbas Core

```env
YERBAS_RPC_URL=http://127.0.0.1:9998
YERBAS_RPC_USER=replace-with-a-long-random-user
YERBAS_RPC_PASSWORD=replace-with-a-long-random-password
```

Do not expose the Yerbas RPC or MySQL ports publicly.

## Feature switches

```env
WALLET_ENABLED=true
WITHDRAWALS_ENABLED=true
ASSETS_ENABLED=true
ASSET_WITHDRAWALS_ENABLED=true
```

Disable any feature that is not ready for use.

## Discord permissions

Recommended bot permissions:

- View Channels
- Send Messages
- Send Messages in Threads
- Embed Links
- Read Message History
- Add Reactions
- Use Application Commands
- Use External Emojis
- Mention `@everyone`, `@here`, and All Roles

Do not grant Administrator unless it is required for a separate feature.

## Run with systemd

```bash
sudo systemctl restart yerbas-tip-bot
sudo systemctl status yerbas-tip-bot --no-pager
sudo journalctl -u yerbas-tip-bot -f
```

## Updating

```bash
cd ~/yerbas-tip-bot-v2
git pull origin feature/reaction-drops
npm install
npm run check
npm run register-commands
sudo systemctl restart yerbas-tip-bot
```

## License

MIT
