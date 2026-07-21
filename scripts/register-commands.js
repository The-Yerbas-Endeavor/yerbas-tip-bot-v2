import { REST, Routes } from 'discord.js';
import { buildCommands } from '../src/commands.js';
import { loadConfig } from '../src/config.js';
import { buildReactionDropCommand } from '../src/reaction-drop.js';

const config = loadConfig();
const rest = new REST({ version: '10' }).setToken(config.discordToken);
const context = { config, ledger: null, rpc: null };
const commands = [...buildCommands(context), buildReactionDropCommand(context)];
const body = commands.map((command) => command.data.toJSON());

try {
  // Direct-message commands must be global. Guild-scoped commands are never
  // available in a bot DM, even when their command contexts include BotDM.
  await rest.put(Routes.applicationCommands(config.discordClientId), { body });
  console.log(`Registered ${body.length} global commands with DM contexts.`);

  // Remove stale guild-scoped copies to avoid duplicate command entries after
  // switching an existing installation from guild registration to global.
  if (config.discordGuildId) {
    await rest.put(
      Routes.applicationGuildCommands(config.discordClientId, config.discordGuildId),
      { body: [] }
    );
    console.log(`Removed stale guild commands for ${config.discordGuildId}.`);
  }
} catch (error) {
  console.error('Slash-command registration failed:', error);
  process.exit(1);
}
