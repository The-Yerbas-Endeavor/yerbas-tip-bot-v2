import { REST, Routes } from 'discord.js';
import { buildCommands } from '../src/commands.js';
import { loadConfig } from '../src/config.js';
import { buildReactionDropCommand } from '../src/reaction-drop.js';

const config = loadConfig();
const rest = new REST({ version: '10' }).setToken(config.discordToken);
const context = { config, ledger: null, rpc: null };
const commands = [...buildCommands(context), buildReactionDropCommand(context)];

function normalizeOptionOrder(options = []) {
  return options.map((option) => ({
    ...option,
    options: option.options ? normalizeOptionOrder(option.options) : undefined
  })).sort((a, b) => Number(Boolean(b.required)) - Number(Boolean(a.required)));
}

const body = commands.map((command) => {
  const json = command.data.toJSON();
  if (json.options) json.options = normalizeOptionOrder(json.options);
  return json;
});

try {
  // Keep global commands for direct-message support.
  await rest.put(Routes.applicationCommands(config.discordClientId), { body });
  console.log(`Registered ${body.length} global commands with DM contexts.`);

  // Also register the same command set directly in the configured server.
  // Guild registrations update immediately and avoid waiting for Discord's
  // global command cache to refresh after adding commands such as /rain.
  if (config.discordGuildId) {
    await rest.put(
      Routes.applicationGuildCommands(config.discordClientId, config.discordGuildId),
      { body }
    );
    console.log(`Registered ${body.length} guild commands for ${config.discordGuildId}.`);
  } else {
    console.warn('DISCORD_GUILD_ID is not configured; only global commands were registered.');
  }
} catch (error) {
  console.error('Slash-command registration failed:', error);
  process.exit(1);
}
