import { ActivityType, Client, Events, GatewayIntentBits } from 'discord.js';
import { buildCommands } from './commands.js';
import { loadConfig } from './config.js';
import './services/mysql-ledger-admin.js';
import { MySqlLedger } from './services/mysql-ledger.js';
import { YerbasRpc } from './services/yerbas-rpc.js';
import { WalletWorker } from './services/wallet-worker.js';

const config = loadConfig();
const ledger = new MySqlLedger(config.mysql);
await ledger.migrate();
const dbInfo = await ledger.healthCheck();
console.log(`Connected to MySQL database ${dbInfo.db}`);

const rpc = new YerbasRpc(config.rpc);
const walletWorker = new WalletWorker({ config, ledger, rpc });
const commands = buildCommands({ config, ledger, rpc });
const commandMap = new Map(commands.map((command) => [command.data.name, command]));
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, (readyClient) => {
  readyClient.user.setPresence({ activities: [{ name: config.botStatus, type: ActivityType.Watching }], status: 'online' });
  walletWorker.start();
  console.log(`Yerbas Tip Bot v2 connected as ${readyClient.user.tag}`);
  console.log(`Wallet: ${config.walletEnabled ? 'enabled' : 'disabled'}; withdrawals: ${config.withdrawalsEnabled ? 'enabled' : 'disabled'}`);
  console.log(`Assets: ${config.assetsEnabled ? 'enabled' : 'disabled'}; asset withdrawals: ${config.assetWithdrawalsEnabled ? 'enabled' : 'disabled'}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  // BOT_CHANNEL_ID restricts guild usage only. Direct messages remain available
  // for private account commands such as balance, deposit, history, and withdraw.
  if (interaction.inGuild() && config.allowedChannelId && interaction.channelId !== config.allowedChannelId) {
    await interaction.reply({ content: 'This bot can only be used in the configured Yerbas bot channel.', ephemeral: true });
    return;
  }

  const command = commandMap.get(interaction.commandName);
  if (!command) return interaction.reply({ content: 'Unknown command.', ephemeral: true });
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
  walletWorker.stop();
  client.destroy();
  await ledger.close();
  process.exit(0);
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
client.login(config.discordToken).catch(async (error) => {
  console.error('Discord login failed:', error);
  walletWorker.stop();
  await ledger.close();
  process.exit(1);
});
