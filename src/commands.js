import {
  InteractionContextType,
  PermissionFlagsBits,
  SlashCommandBuilder
} from 'discord.js';
import packageJson from '../package.json' with { type: 'json' };
import { fromUnits, toUnits } from './services/ledger.js';

const GUILD_AND_DM = [InteractionContextType.Guild, InteractionContextType.BotDM];
const GUILD_ONLY = [InteractionContextType.Guild];

function inGuildAndDm(builder) {
  return builder.setContexts(...GUILD_AND_DM);
}

function guildOnly(builder) {
  return builder.setContexts(...GUILD_ONLY);
}

function requireWallet(ctx) {
  if (!ctx.config.walletEnabled) throw new Error('Wallet features are disabled by WALLET_ENABLED=false');
}

function requireAssets(ctx) {
  requireWallet(ctx);
  if (!ctx.config.assetsEnabled) throw new Error('Asset features are disabled by ASSETS_ENABLED=false');
}

function requireAdmin(interaction, ctx) {
  if (!interaction.inGuild()) throw new Error('Administrator commands can only be used in a server');
  if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return;
  if (ctx.config.adminRoleId && interaction.member?.roles?.cache?.has(ctx.config.adminRoleId)) return;
  throw new Error('Administrator permission required');
}

async function validatedAssetAmount(ctx, assetName, amountText) {
  const metadata = await ctx.rpc.getAssetData(assetName);
  if (!metadata) throw new Error(`Unknown Yerbas asset: ${assetName}`);
  const units = Number(metadata.units ?? 8);
  const amount = toUnits(amountText);
  const increment = 10n ** BigInt(8 - units);
  if (amount <= 0n || amount % increment !== 0n) throw new Error(`${assetName} supports no more than ${units} decimal places`);
  return amount;
}

export function buildCommands(ctx) {
  return [
    {
      data: inGuildAndDm(new SlashCommandBuilder().setName('ping').setDescription('Check whether the bot is online.')),
      async execute(interaction) { await interaction.reply({ content: `Pong! ${interaction.client.ws.ping}ms`, ephemeral: true }); }
    },
    {
      data: inGuildAndDm(new SlashCommandBuilder().setName('version').setDescription('Show bot version information.')),
      async execute(interaction) { await interaction.reply({ content: `Yerbas Tip Bot ${packageJson.version}\nNode.js ${process.version}`, ephemeral: true }); }
    },
    {
      data: inGuildAndDm(new SlashCommandBuilder().setName('network').setDescription('Show Yerbas network status.')),
      async execute(interaction) {
        const [height, info] = await Promise.all([ctx.rpc.getBlockCount(), ctx.rpc.getNetworkInfo()]);
        await interaction.reply(`**Yerbas Network**\nBlock: ${height}\nConnections: ${info.connections ?? 'unknown'}\nProtocol: ${info.protocolversion ?? 'unknown'}`);
      }
    },
    {
      data: inGuildAndDm(new SlashCommandBuilder().setName('deposit').setDescription('Get your existing or new Yerbas deposit address.')),
      async execute(interaction) {
        requireWallet(ctx);
        const user = await ctx.ledger.getUser(interaction.user.id, interaction.user.username);
        let address = user.deposit_address;
        if (!address) {
          address = await ctx.rpc.getNewAddress(`discord:${interaction.user.id}`);
          await ctx.ledger.setDepositAddress(interaction.user.id, address);
        }
        await interaction.reply({ content: `Your Yerbas deposit address:\n\`${address}\`\nExisting legacy addresses are preserved.`, ephemeral: true });
      }
    },
    {
      data: inGuildAndDm(new SlashCommandBuilder().setName('balance').setDescription('Show your legacy MySQL YERB balance.')),
      async execute(interaction) {
        requireWallet(ctx);
        const balance = await ctx.ledger.balanceUnits(interaction.user.id, interaction.user.username);
        await interaction.reply({ content: `Balance: **${fromUnits(balance)} YERB**`, ephemeral: true });
      }
    },
    {
      data: guildOnly(new SlashCommandBuilder().setName('tip').setDescription('Tip YERB to another Discord member.')
        .addUserOption((o) => o.setName('user').setDescription('Recipient').setRequired(true))
        .addStringOption((o) => o.setName('amount').setDescription('Amount in YERB').setRequired(true))),
      async execute(interaction) {
        requireWallet(ctx);
        const recipient = interaction.options.getUser('user', true);
        if (recipient.bot || recipient.id === interaction.user.id) throw new Error('Choose another human member');
        const amount = toUnits(interaction.options.getString('amount', true));
        if (amount < toUnits(ctx.config.minimumTip)) throw new Error(`Minimum tip is ${ctx.config.minimumTip} YERB`);
        await ctx.ledger.transfer(interaction.user.id, recipient.id, amount, `tip:${interaction.id}`, {
          from: interaction.user.username,
          to: recipient.username
        });
        await interaction.reply(`${interaction.user} tipped ${recipient} **${fromUnits(amount)} YERB** 🌿`);
      }
    },
    {
      data: inGuildAndDm(new SlashCommandBuilder().setName('withdraw').setDescription('Withdraw YERB to an external address.')
        .addStringOption((o) => o.setName('address').setDescription('Yerbas address').setRequired(true))
        .addStringOption((o) => o.setName('amount').setDescription('Amount in YERB').setRequired(true))),
      async execute(interaction) {
        requireWallet(ctx);
        if (!ctx.config.withdrawalsEnabled) throw new Error('Withdrawals are currently disabled');
        const address = interaction.options.getString('address', true).trim();
        const validation = await ctx.rpc.validateAddress(address);
        if (!validation?.isvalid) throw new Error('Invalid Yerbas address');
        const amount = toUnits(interaction.options.getString('amount', true));
        if (amount < toUnits(ctx.config.minimumWithdrawal)) throw new Error(`Minimum withdrawal is ${ctx.config.minimumWithdrawal} YERB`);
        const id = await ctx.ledger.createWithdrawal(interaction.user.id, address, amount, toUnits(ctx.config.withdrawalFee));
        await interaction.reply({ content: `Withdrawal #${id} queued. Amount: ${fromUnits(amount)} YERB`, ephemeral: true });
      }
    },
    {
      data: inGuildAndDm(new SlashCommandBuilder().setName('asset-balance').setDescription('Show your Yerbas Asset balances.')
        .addStringOption((o) => o.setName('asset').setDescription('Optional asset name'))),
      async execute(interaction) {
        requireAssets(ctx);
        const asset = interaction.options.getString('asset')?.trim();
        if (asset) {
          const balance = await ctx.ledger.assetBalanceUnits(interaction.user.id, asset);
          await interaction.reply({ content: `Balance: **${fromUnits(balance)} ${asset}**`, ephemeral: true });
          return;
        }
        const rows = await ctx.ledger.assetBalances(interaction.user.id);
        const text = rows.length ? rows.map((row) => `**${row.balance} ${row.asset_name}**`).join('\n') : 'No asset balances.';
        await interaction.reply({ content: text, ephemeral: true });
      }
    },
    {
      data: guildOnly(new SlashCommandBuilder().setName('asset-tip').setDescription('Tip a Yerbas Asset to another Discord member.')
        .addUserOption((o) => o.setName('user').setDescription('Recipient').setRequired(true))
        .addStringOption((o) => o.setName('asset').setDescription('Asset name').setRequired(true))
        .addStringOption((o) => o.setName('amount').setDescription('Asset amount').setRequired(true))),
      async execute(interaction) {
        requireAssets(ctx);
        const recipient = interaction.options.getUser('user', true);
        if (recipient.bot || recipient.id === interaction.user.id) throw new Error('Choose another human member');
        const asset = interaction.options.getString('asset', true).trim();
        const amount = await validatedAssetAmount(ctx, asset, interaction.options.getString('amount', true));
        await ctx.ledger.transferAsset(interaction.user.id, recipient.id, asset, amount, `asset-tip:${interaction.id}`);
        await interaction.reply(`${interaction.user} tipped ${recipient} **${fromUnits(amount)} ${asset}** 🌿`);
      }
    },
    {
      data: inGuildAndDm(new SlashCommandBuilder().setName('asset-withdraw').setDescription('Send a Yerbas Asset to an external address.')
        .addStringOption((o) => o.setName('asset').setDescription('Asset name').setRequired(true))
        .addStringOption((o) => o.setName('address').setDescription('Yerbas address').setRequired(true))
        .addStringOption((o) => o.setName('amount').setDescription('Asset amount').setRequired(true))),
      async execute(interaction) {
        requireAssets(ctx);
        if (!ctx.config.assetWithdrawalsEnabled) throw new Error('Asset withdrawals are currently disabled');
        const asset = interaction.options.getString('asset', true).trim();
        const address = interaction.options.getString('address', true).trim();
        const validation = await ctx.rpc.validateAddress(address);
        if (!validation?.isvalid) throw new Error('Invalid Yerbas address');
        const amount = await validatedAssetAmount(ctx, asset, interaction.options.getString('amount', true));
        const id = await ctx.ledger.createAssetWithdrawal(interaction.user.id, asset, address, amount);
        await interaction.reply({ content: `Asset withdrawal #${id} queued: ${fromUnits(amount)} ${asset}`, ephemeral: true });
      }
    },
    {
      data: guildOnly(new SlashCommandBuilder().setName('asset-wallet').setDescription('List assets held by the bot wallet.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption((o) => o.setName('filter').setDescription('Asset filter'))),
      async execute(interaction) {
        requireAdmin(interaction, ctx);
        requireAssets(ctx);
        const assets = await ctx.rpc.listMyAssets(interaction.options.getString('filter') || '*');
        const entries = Object.entries(assets || {});
        await interaction.reply({ content: entries.length ? entries.slice(0, 25).map(([name, amount]) => `${name}: ${amount}`).join('\n') : 'No matching wallet assets.', ephemeral: true });
      }
    },
    {
      data: inGuildAndDm(new SlashCommandBuilder().setName('history').setDescription('Show recent legacy account activity.')),
      async execute(interaction) {
        requireWallet(ctx);
        const rows = await ctx.ledger.history(interaction.user.id, 10);
        const text = rows.length ? rows.map((r) => `${r.created_at} — ${r.entry_type}: ${r.amount ?? '0'} YERB`).join('\n') : 'No account activity yet.';
        await interaction.reply({ content: text, ephemeral: true });
      }
    },
    {
      data: guildOnly(new SlashCommandBuilder().setName('admin-credit').setDescription('Credit a legacy YERB balance.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addUserOption((o) => o.setName('user').setDescription('User').setRequired(true))
        .addStringOption((o) => o.setName('amount').setDescription('Amount').setRequired(true))
        .addStringOption((o) => o.setName('reference').setDescription('Unique audit reference').setRequired(true))),
      async execute(interaction) {
        requireAdmin(interaction, ctx);
        const user = interaction.options.getUser('user', true);
        const amount = toUnits(interaction.options.getString('amount', true));
        const reference = `admin:${interaction.options.getString('reference', true)}`;
        const result = await ctx.ledger.adminCredit(user.id, user.username, amount, reference, interaction.user.id);
        if (result.changes !== 1n) throw new Error('That credit reference was already used');
        await interaction.reply({ content: `Credited ${user.tag} ${fromUnits(amount)} YERB.`, ephemeral: true });
      }
    },
    {
      data: guildOnly(new SlashCommandBuilder().setName('admin-asset-credit').setDescription('Credit a user asset balance.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addUserOption((o) => o.setName('user').setDescription('User').setRequired(true))
        .addStringOption((o) => o.setName('asset').setDescription('Asset name').setRequired(true))
        .addStringOption((o) => o.setName('amount').setDescription('Asset amount').setRequired(true))
        .addStringOption((o) => o.setName('reference').setDescription('Deposit txid or audit reference').setRequired(true))),
      async execute(interaction) {
        requireAdmin(interaction, ctx);
        requireAssets(ctx);
        const user = interaction.options.getUser('user', true);
        const asset = interaction.options.getString('asset', true).trim();
        const amount = await validatedAssetAmount(ctx, asset, interaction.options.getString('amount', true));
        const reference = interaction.options.getString('reference', true);
        const result = await ctx.ledger.addAssetCredit(user.id, asset, amount, 'admin_asset_credit', reference, { admin: interaction.user.id });
        if (result.changes !== 1n) throw new Error('That asset credit reference was already used');
        await interaction.reply({ content: `Credited ${user.tag} ${fromUnits(amount)} ${asset}.`, ephemeral: true });
      }
    },
    {
      data: inGuildAndDm(new SlashCommandBuilder().setName('help').setDescription('Show available bot commands.')),
      async execute(interaction) {
        await interaction.reply({ content: [
          '**Yerbas Tip Bot v2 — MySQL drop-in**',
          '`/deposit`, `/balance`, `/withdraw`, `/history` — available here and in server channels',
          '`/tip` — server-only public YERB tip',
          '`/asset-balance`, `/asset-withdraw` — available here and in server channels',
          '`/asset-tip` — server-only public asset tip',
          '`/network`, `/ping`, `/version` — status',
          'Administrator commands are server-only.'
        ].join('\n'), ephemeral: true });
      }
    }
  ];
}
