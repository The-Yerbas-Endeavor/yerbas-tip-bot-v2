import 'dotenv/config';

const required = ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID'];

export function loadConfig(env = process.env) {
  const missing = required.filter((key) => !env[key]?.trim());
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  return Object.freeze({
    nodeEnv: env.NODE_ENV ?? 'development',
    discordToken: env.DISCORD_TOKEN.trim(),
    discordClientId: env.DISCORD_CLIENT_ID.trim(),
    discordGuildId: env.DISCORD_GUILD_ID?.trim() || null,
    botStatus: env.BOT_STATUS?.trim() || 'Yerbas Tip Bot v2',
    logLevel: env.LOG_LEVEL?.trim() || 'info'
  });
}
