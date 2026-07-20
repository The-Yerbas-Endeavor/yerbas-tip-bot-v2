# Yerbas Tip Bot v2

Official Discord wallet and community tipping bot for the Yerbas (YERB) network.

> **Development status:** pre-release. Do not use production funds until deposit reconciliation, withdrawal recovery, backups, and operator procedures have been tested on a dedicated wallet.

## Features

- Node.js 22 and Discord.js v14
- Guild or global slash-command registration
- Optional single-channel restriction
- Yerbas Core JSON-RPC client
- SQLite WAL accounting ledger
- Exact 8-decimal atomic-unit balances
- Transactional internal tips
- Idempotent confirmed-deposit credits
- Queued withdrawal processing with failure refunds
- Administrator audit credits
- GitHub Actions checks and Node tests

No Docker setup is used or required.

## Commands

- `/help`
- `/ping`
- `/version`
- `/network`
- `/deposit`
- `/balance`
- `/tip user amount`
- `/withdraw address amount`
- `/history`
- `/admin-credit user amount reference`

## Install

```bash
git clone https://github.com/The-Yerbas-Endeavor/yerbas-tip-bot-v2.git
cd yerbas-tip-bot-v2
nvm install
nvm use
cp .env.example .env
npm install
npm test
npm run check
npm run register-commands
npm start
```

## Discord configuration

Set these in `.env`:

- `DISCORD_TOKEN` — secret bot token
- `DISCORD_CLIENT_ID` — Discord application ID
- `DISCORD_GUILD_ID` — test server ID; omit for global commands
- `BOT_CHANNEL_ID` — optional channel where commands are allowed
- `ADMIN_ROLE_ID` — optional role allowed to use administrative commands

## Yerbas Core configuration

Yerbas Core must expose JSON-RPC only to the bot host. Do not expose the RPC port publicly.

```env
YERBAS_RPC_URL=http://127.0.0.1:9998
YERBAS_RPC_USER=replace-with-a-long-random-user
YERBAS_RPC_PASSWORD=replace-with-a-long-random-password
```

The RPC wallet should be dedicated to the tip bot. Back it up before accepting deposits.

## Safe activation sequence

Start with:

```env
WALLET_ENABLED=false
WITHDRAWALS_ENABLED=false
```

Then:

1. Verify `/ping`, `/version`, and `/network`.
2. Back up the dedicated Yerbas wallet and SQLite database.
3. Enable `WALLET_ENABLED=true` with withdrawals still disabled.
4. Test deposits and confirm each transaction credits exactly once.
5. Test internal tips and ledger history.
6. Fund the hot wallet only with the amount needed for operations.
7. Enable `WITHDRAWALS_ENABLED=true` only after withdrawal and recovery testing.

## Accounting model

Discord balances are internal liabilities recorded in SQLite. Deposits create positive ledger entries only after the configured confirmation count. Tips create equal debit and credit entries in one SQL transaction. Withdrawals place the requested amount and fee on hold before RPC broadcast. Failed broadcasts are refunded through a separate ledger entry.

## Operations

Back up both of these together:

- the Yerbas Core wallet
- `data/yerbas-tip-bot.sqlite`

For production, run the bot as a restricted Linux user through systemd or another direct process supervisor. Keep `.env`, wallet files, and database files outside public web directories.

## License

MIT
