import {
  ActivityType,
  Client,
  Events,
  GatewayIntentBits
} from 'discord.js';
import { commandMap } from './commands.js';
import { loadConfig } from './config.js';

const config = loadConfig();
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

  const command = commandMap.get(interaction.commandName);
  if (!command) {
    await interaction.reply({ content: 'Unknown command.', ephemeral: true });
    return;
  }

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(`Command ${interaction.commandName} failed:`, error);
    const response = { content: 'The command failed unexpectedly.', ephemeral: true };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(response);
    } else {
      await interaction.reply(response);
    }
  }
});

async function shutdown(signal) {
  console.log(`Received ${signal}; shutting down.`);
  client.destroy();
  process.exit(0);
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

client.login(config.discordToken).catch((error) => {
  console.error('Discord login failed:', error);
  process.exit(1);
});
