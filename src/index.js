import {
  ActivityType,
  Client,
  Events,
  GatewayIntentBits
} from 'discord.js';
import { buildCommands } from './commands.js';
import { loadConfig } from './config.js';
import { Ledger } from './services/ledger.js';
import { AssetLedger } from './services/asset-ledger.js';
import { YerbasRpc } from './services/yerbas-rpc.js';
import { WalletWorker } from './services/wallet-worker.js';

const config = loadConfig();
const ledger = new Ledger(config.databasePath);
const assetLedger = new AssetLedger(config.databasePath);
const rpc = new YerbasRpc(config.rpc);
const walletWorker = new WalletWorker({ config, ledger, assetLedger, rpc });
const commands = buildCommands({ config, ledger, assetLedger, rpc });
const commandMap = new Map(commands.map((command) => [command.data.name, command]));
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, (readyClient) => {
  readyClient.user.setPresence({
    activities: [{ name: config.botStatus, type: ActivityType.Watching }],
    status: 'online'
  });
  walletWorker.start();
  console.log(`Yerbas Tip Bot v2 connected as ${readyClient.user.tag}`);
  console.log(`Wallet features: ${config.walletEnabled ? 'enabled' : 'disabled'}`);
  console.log(`Withdrawals: ${config.withdrawalsEnabled ? 'enabled' : 'disabled'}`);
  console.log(`Assets: ${config.assetsEnabled ? 'enabled' : 'disabled'}`);
  console.log(`Asset withdrawals: ${config.assetWithdrawalsEnabled ? 'enabled' : 'disabled'}`);
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
  walletWorker.stop();
  client.destroy();
  assetLedger.close();
  ledger.close();
  process.exit(0);
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

client.login(config.discordToken).catch((error) => {
  console.error('Discord login failed:', error);
  walletWorker.stop();
  assetLedger.close();
  ledger.close();
  process.exit(1);
});
