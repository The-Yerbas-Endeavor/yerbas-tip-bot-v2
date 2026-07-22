# Yerbas Tip Bot v2

Drop-in Discord wallet, asset, and community tipping bot for the Yerbas (YERB) network.

> **Pre-release:** restore the legacy SQL dump into a test database and complete the cutover checklist before using production funds.

## Drop-in compatibility

The bot uses the existing legacy MySQL tables as the source of truth:

- `user` — existing Discord IDs, usernames, YERB balances, stake balances, and deposit addresses
- `payments` — internal YERB tips
- `deposits` — confirmed incoming YERB transactions
- `withdrawals` — completed outgoing YERB transactions
- `transactions` — legacy wallet transaction tracking
- `log` — user-facing and operator audit history
- `coin_price_history` — preserved unchanged

The migration does not delete, rename, or rewrite those tables. New queues, idempotency records, and asset balances use `v2_*` tables created by `migrations/001_mysql_drop_in.sql`.

## Features

- Node.js 22 and Discord.js v14
- Existing MySQL users, balances, and deposit addresses preserved
- Transactional YERB tips recorded in `payments` and `log`
- Idempotent confirmed-deposit credits
- Queued YERB withdrawals with automatic failure refunds
- Yerbas Asset balances, tips, and queued external sends
- Asset decimal validation from `getassetdata`
- Optional single-channel restriction
- Separate safety switches for YERB, withdrawals, assets, and asset withdrawals
- No Docker

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
git checkout feature/mysql-drop-in
nvm install
nvm use
cp .env.example .env
npm install
npm test
npm run check
```

## Restore and test the legacy database

Never test the first run against the only production copy.

```bash
mysql -u root -p -e "CREATE DATABASE yerbas_tip_bot_v2_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
mysql -u root -p yerbas_tip_bot_v2_test < backup2026_file.sql
mysql -u root -p yerbas_tip_bot_v2_test < migrations/001_mysql_drop_in.sql
```

Create a restricted database account:

```sql
CREATE USER 'yerbas_tip_bot'@'127.0.0.1' IDENTIFIED BY 'replace-with-a-long-random-password';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX
ON yerbas_tip_bot_v2_test.* TO 'yerbas_tip_bot'@'127.0.0.1';
FLUSH PRIVILEGES;
```

Configure `.env`:

```env
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=yerbas_tip_bot
MYSQL_PASSWORD=replace-with-a-long-random-password
MYSQL_DATABASE=yerbas_tip_bot_v2_test
```

## Yerbas Core

```env
YERBAS_RPC_URL=http://127.0.0.1:9998
YERBAS_RPC_USER=replace-with-a-long-random-user
YERBAS_RPC_PASSWORD=replace-with-a-long-random-password
```

Do not expose the RPC or MySQL ports publicly.

## Safe cutover

Start with:

```env
WALLET_ENABLED=false
WITHDRAWALS_ENABLED=false
ASSETS_ENABLED=false
ASSET_WITHDRAWALS_ENABLED=false
```

Then:

1. Stop the old bot so two processes cannot update balances simultaneously.
2. Back up the MySQL database and Yerbas wallet together.
3. Start v2 against a restored database copy and verify `/ping`, `/version`, and `/network`.
4. Compare several `/balance` results with the legacy `user.balance` rows.
5. Confirm `/deposit` returns the existing `user.deposit_address` without replacing it.
6. Enable `WALLET_ENABLED=true` and test a tiny internal tip.
7. Confirm both user balances, one `payments` row, and one `log` row changed atomically.
8. Test a confirmed YERB deposit and confirm it credits exactly once.
9. Test withdrawal failure and refund behavior before enabling successful sends.
10. Test assets with a disposable asset before enabling `ASSET_WITHDRAWALS_ENABLED=true`.
11. Repeat the process against production only after reconciling total liabilities with wallet holdings.

## Asset deposits

The existing deposit address can receive YERB and Yerbas Assets. Automatic YERB deposit reconciliation is enabled. Asset deposits remain administrator-credited with `/admin-asset-credit` until live Yerbas wallet asset transaction payloads are verified.

## Critical operational rule

Never run the old bot and v2 against the same writable database at the same time. Both use `user.balance`; concurrent operation would allow conflicting balance updates and duplicate deposit processing.

## License

MIT
