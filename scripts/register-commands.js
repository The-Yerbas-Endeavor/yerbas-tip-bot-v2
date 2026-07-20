import { REST, Routes } from 'discord.js';
import { buildCommands } from '../src/commands.js';
import { loadConfig } from '../src/config.js';

const config = loadConfig();
const rest = new REST({ version: '10' }).setToken(config.discordToken);
const commands = buildCommands({ config, ledger: null, rpc: null });
const body = commands.map((command) => command.data.toJSON());

try {
  if (config.discordGuildId) {
    await rest.put(
      Routes.applicationGuildCommands(config.discordClientId, config.discordGuildId),
      { body }
    );
    console.log(`Registered ${body.length} guild commands.`);
  } else {
    await rest.put(Routes.applicationCommands(config.discordClientId), { body });
    console.log(`Registered ${body.length} global commands.`);
  }
} catch (error) {
  console.error('Slash-command registration failed:', error);
  process.exit(1);
}
