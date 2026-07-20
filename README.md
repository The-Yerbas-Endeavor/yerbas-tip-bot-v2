# Yerbas Tip Bot v2

Official Discord wallet and community tipping bot for the Yerbas (YERB) network.

> **Development status:** pre-release. Do not use with production funds until wallet accounting, withdrawal safety, and recovery procedures are fully tested.

## Foundation

- Node.js 22 LTS
- Discord.js v14
- Slash-command-first architecture
- Environment-based configuration
- MySQL-ready service layer
- Yerbas Core JSON-RPC integration planned

## Current commands

- `/help`
- `/version`
- `/ping`

Wallet commands such as `/balance`, `/deposit`, `/tip`, and `/withdraw` will be enabled only after the database and Yerbas RPC layers are implemented and tested.

## Setup

```bash
git clone https://github.com/The-Yerbas-Endeavor/yerbas-tip-bot-v2.git
cd yerbas-tip-bot-v2
cp .env.example .env
npm install
npm test
npm run register-commands
npm start
```

## Required Discord configuration

Create a Discord application and bot, then set these values in `.env`:

- `DISCORD_TOKEN`
- `DISCORD_CLIENT_ID`
- `DISCORD_GUILD_ID` for fast development command registration

## Safety model

The bot will not expose financial commands until the following exist:

- Integer atomic-unit accounting
- SQL transactions and row locking
- Idempotent deposit processing
- Withdrawal state tracking
- RPC timeout and retry handling
- Audit logging
- Automated tests

## License

MIT
