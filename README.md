# Yerbas Tip Bot v2

Official Discord wallet, asset, and community tipping bot for the Yerbas (YERB) network.

> **Development status:** pre-release. Do not use production funds until deposit reconciliation, withdrawal recovery, backups, and operator procedures have been tested on a dedicated wallet.

## Features

- Node.js 22 and Discord.js v14
- Guild or global slash-command registration
- Optional single-channel restriction
- Yerbas Core JSON-RPC client
- SQLite WAL accounting ledgers for YERB and Yerbas Assets
- Exact 8-decimal atomic-unit balances
- Per-asset decimal-unit validation from `getassetdata`
- Transactional internal YERB and asset tips
- Idempotent confirmed YERB deposit credits
- Queued YERB and asset withdrawals with failure refunds
- Administrator audit credits
- GitHub Actions checks and Node tests

No Docker setup is used or required.

## Commands

### YERB

- `/deposit`
- `/balance`
- `/tip user amount`
- `/withdraw address amount`

### Yerbas Assets

- `/asset-balance [asset]`
- `/asset-tip user asset amount`
- `/asset-withdraw asset address amount`
- `/asset-wallet [filter]` — administrator only
- `/admin-asset-credit user asset amount reference` — administrator only

### General

- `/help`
- `/ping`
- `/version`
- `/network`
- `/history`
- `/admin-credit user amount reference`

## Install

```bash
git clone https://github.com/The-Yerbas-Endeavor/yerbas-tip-bot-v2.git
cd yerbas-tip-bot-v2
git checkout feature/full-tip-bot
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

The RPC wallet must have Yerbas Assets enabled and should be dedicated to the tip bot. Back it up before accepting funds.

The implementation uses these Yerbas Asset RPC calls:

- `getassetdata`
- `listmyassets`
- `listassetbalancesbyaddress`
- `transfer`
- `transferfromaddress`

## Safe activation sequence

Start with every financial feature disabled:

```env
WALLET_ENABLED=false
WITHDRAWALS_ENABLED=false
ASSETS_ENABLED=false
ASSET_WITHDRAWALS_ENABLED=false
```

Then:

1. Verify `/ping`, `/version`, and `/network`.
2. Back up the dedicated Yerbas wallet and SQLite database.
3. Enable `WALLET_ENABLED=true` with withdrawals disabled.
4. Test YERB deposits and confirm each transaction credits exactly once.
5. Enable `ASSETS_ENABLED=true` and test administrator asset credits and internal asset tips.
6. Send a small test asset into the bot wallet and credit it with `/admin-asset-credit` using the deposit txid as the unique reference.
7. Test an external asset send with a disposable asset and address.
8. Enable `ASSET_WITHDRAWALS_ENABLED=true` only after successful recovery testing.
9. Enable YERB withdrawals separately with `WITHDRAWALS_ENABLED=true`.

## Asset deposit status

The same `/deposit` address can receive YERB and Yerbas Assets. Automatic YERB deposit reconciliation is implemented. Automatic asset deposit reconciliation is intentionally not enabled yet because Yerbas Core asset transaction decoding must be verified against real wallet transaction payloads. Until then, confirmed asset deposits are credited by an administrator with `/admin-asset-credit` and a unique transaction reference.

## Accounting model

Discord balances are internal liabilities recorded in SQLite. YERB and asset tips create equal debit and credit entries inside SQL transactions. Withdrawals place balances on hold before RPC broadcast. Failed broadcasts create refund entries. Asset amounts are stored in eight-decimal atomic units and checked against each asset's configured `units` value before transfer.

## Operations

Back up both of these together:

- the Yerbas Core wallet
- `data/yerbas-tip-bot.sqlite`

For production, run the bot as a restricted Linux user through systemd or another direct process supervisor. Keep `.env`, wallet files, and database files outside public web directories.

## License

MIT
