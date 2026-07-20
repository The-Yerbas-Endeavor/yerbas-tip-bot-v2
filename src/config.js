import 'dotenv/config';

const required = ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID'];

function numberValue(env, key, fallback) {
  const value = env[key];
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${key} must be a number`);
  return parsed;
}

function booleanValue(env, key, fallback = false) {
  const value = env[key];
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

export function loadConfig(env = process.env) {
  const missing = required.filter((key) => !env[key]?.trim());
  if (missing.length > 0) throw new Error(`Missing required environment variables: ${missing.join(', ')}`);

  return Object.freeze({
    nodeEnv: env.NODE_ENV ?? 'development',
    discordToken: env.DISCORD_TOKEN.trim(),
    discordClientId: env.DISCORD_CLIENT_ID.trim(),
    discordGuildId: env.DISCORD_GUILD_ID?.trim() || null,
    allowedChannelId: env.BOT_CHANNEL_ID?.trim() || null,
    adminRoleId: env.ADMIN_ROLE_ID?.trim() || null,
    botStatus: env.BOT_STATUS?.trim() || 'Yerbas Tip Bot v2',
    logLevel: env.LOG_LEVEL?.trim() || 'info',
    mysql: Object.freeze({
      host: env.MYSQL_HOST?.trim() || '127.0.0.1',
      port: numberValue(env, 'MYSQL_PORT', 3306),
      user: env.MYSQL_USER?.trim() || '',
      password: env.MYSQL_PASSWORD ?? '',
      database: env.MYSQL_DATABASE?.trim() || '',
      connectionLimit: numberValue(env, 'MYSQL_CONNECTION_LIMIT', 10)
    }),
    rpc: Object.freeze({
      url: env.YERBAS_RPC_URL?.trim() || 'http://127.0.0.1:9998',
      username: env.YERBAS_RPC_USER?.trim() || '',
      password: env.YERBAS_RPC_PASSWORD?.trim() || '',
      timeoutMs: numberValue(env, 'YERBAS_RPC_TIMEOUT_MS', 15000)
    }),
    confirmations: numberValue(env, 'DEPOSIT_CONFIRMATIONS', 6),
    minimumTip: numberValue(env, 'MINIMUM_TIP_YERB', 0.01),
    minimumWithdrawal: numberValue(env, 'MINIMUM_WITHDRAWAL_YERB', 1),
    withdrawalFee: numberValue(env, 'WITHDRAWAL_FEE_YERB', 0.01),
    walletEnabled: booleanValue(env, 'WALLET_ENABLED', false),
    withdrawalsEnabled: booleanValue(env, 'WITHDRAWALS_ENABLED', false),
    assetsEnabled: booleanValue(env, 'ASSETS_ENABLED', false),
    assetWithdrawalsEnabled: booleanValue(env, 'ASSET_WITHDRAWALS_ENABLED', false)
  });
}
