import {
  ActivityType,
  Client,
  Events,
  GatewayIntentBits
} from 'discord.js';
import { buildCommands } from './commands.js';
import { loadConfig } from './config.js';
import { Ledger } from './services/ledger.js';
import { YerbasRpc } from './services/yerbas-rpc.js';

const config = loadConfig();
const ledger = new Ledger(config.databasePath);
const rpc = new YerbasRpc(config.rpc);
const commands = buildCommands({ config, ledger, rpc });
const commandMap = new Map(commands.map((command) => [command.data.name, command]));
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, (readyClient) => {
  readyClient.user.setPresence({
    activities: [{ name: config.botStatus, type: ActivityType.Watching }],
    status: 'online'
  });
  console.log(`Yerbas Tip Bot v2 connected as ${readyClient.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (config.allowedChannelId && interaction.channelId !== config.allowedChannelId) {
    await interaction.reply({ content: 'This bot can only be used in the configured Yerbas bot channel.', ephemeral: true });
    return;
  }

  const command = commandMap.get(interaction.commandName);
  if (!command) {
    await interaction.reply({ content: 'Unknown command.', ephemeral: true });
    return;
  }

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(`Command ${interaction.commandName} failed:`, error);
    const response = { content: error.message || 'The command failed unexpectedly.', ephemeral: true };
    if (interaction.replied || interaction.deferred) await interaction.followUp(response);
    else await interaction.reply(response);
  }
});

async function shutdown(signal) {
  console.log(`Received ${signal}; shutting down.`);
  client.destroy();
  ledger.close();
  process.exit(0);
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

client.login(config.discordToken).catch((error) => {
  console.error('Discord login failed:', error);
  ledger.close();
  process.exit(1);
});
