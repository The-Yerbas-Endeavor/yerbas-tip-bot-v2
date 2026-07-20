import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import packageJson from '../package.json' with { type: 'json' };
import { fromUnits, toUnits } from './services/ledger.js';

function requireWallet(ctx) {
  if (!ctx.config.walletEnabled) throw new Error('Wallet features are disabled by WALLET_ENABLED=false');
}

function requireAssets(ctx) {
  requireWallet(ctx);
  if (!ctx.config.assetsEnabled) throw new Error('Asset features are disabled by ASSETS_ENABLED=false');
}

function requireAdmin(interaction, ctx) {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return;
  if (ctx.config.adminRoleId && interaction.member?.roles?.cache?.has(ctx.config.adminRoleId)) return;
  throw new Error('Administrator permission required');
}

async function validatedAssetAmount(ctx, assetName, amountText) {
  const metadata = await ctx.rpc.getAssetData(assetName);
  if (!metadata) throw new Error(`Unknown Yerbas asset: ${assetName}`);
  const units = Number(metadata.units ?? 8);
  if (!Number.isInteger(units) || units < 0 || units > 8) throw new Error('Invalid asset units returned by node');
  const amount = toUnits(amountText);
  const increment = 10n ** BigInt(8 - units);
  if (amount <= 0n || amount % increment !== 0n) {
    throw new Error(`${assetName} supports no more than ${units} decimal places`);
  }
  return amount;
}

export function buildCommands(ctx) {
  return [
    {
      data: new SlashCommandBuilder().setName('ping').setDescription('Check whether the bot is online.'),
      async execute(interaction) {
        await interaction.reply({ content: `Pong! ${interaction.client.ws.ping}ms`, ephemeral: true });
      }
    },
    {
      data: new SlashCommandBuilder().setName('version').setDescription('Show bot version information.'),
      async execute(interaction) {
        await interaction.reply({ content: `Yerbas Tip Bot ${packageJson.version}\nNode.js ${process.version}`, ephemeral: true });
      }
    },
    {
      data: new SlashCommandBuilder().setName('network').setDescription('Show Yerbas network status.'),
      async execute(interaction) {
        const [height, info] = await Promise.all([ctx.rpc.getBlockCount(), ctx.rpc.getNetworkInfo()]);
        await interaction.reply({ content: `**Yerbas Network**\nBlock: ${height}\nConnections: ${info.connections ?? 'unknown'}\nProtocol: ${info.protocolversion ?? 'unknown'}` });
      }
    },
    {
      data: new SlashCommandBuilder().setName('deposit').setDescription('Get your personal YERB and asset deposit address.'),
      async execute(interaction) {
        requireWallet(ctx);
        const user = ctx.ledger.getUser(interaction.user.id);
        let address = user.deposit_address;
        if (!address) {
          address = await ctx.rpc.getNewAddress(`discord:${interaction.user.id}`);
          ctx.ledger.setDepositAddress(interaction.user.id, address);
        }
        await interaction.reply({ content: `Your Yerbas deposit address:\n\`${address}\`\nYERB deposits are credited after ${ctx.config.confirmations} confirmations. Asset deposits require operator reconciliation until automatic asset scanning is enabled.`, ephemeral: true });
      }
    },
    {
      data: new SlashCommandBuilder().setName('balance').setDescription('Show your internal YERB balance.'),
      async execute(interaction) {
        requireWallet(ctx);
        await interaction.reply({ content: `Balance: **${fromUnits(ctx.ledger.balanceUnits(interaction.user.id))} YERB**`, ephemeral: true });
      }
    },
    {
      data: new SlashCommandBuilder().setName('tip').setDescription('Tip YERB to another Discord member.')
        .addUserOption((o) => o.setName('user').setDescription('Recipient').setRequired(true))
        .addStringOption((o) => o.setName('amount').setDescription('Amount in YERB').setRequired(true)),
      async execute(interaction) {
        requireWallet(ctx);
        const recipient = interaction.options.getUser('user', true);
        if (recipient.bot || recipient.id === interaction.user.id) throw new Error('Choose another human member');
        const amount = toUnits(interaction.options.getString('amount', true));
        if (amount < toUnits(ctx.config.minimumTip)) throw new Error(`Minimum tip is ${ctx.config.minimumTip} YERB`);
        ctx.ledger.transfer(interaction.user.id, recipient.id, amount, `tip:${interaction.id}`);
        await interaction.reply(`${interaction.user} tipped ${recipient} **${fromUnits(amount)} YERB** 🌿`);
      }
    },
    {
      data: new SlashCommandBuilder().setName('withdraw').setDescription('Withdraw YERB to an external address.')
        .addStringOption((o) => o.setName('address').setDescription('Yerbas address').setRequired(true))
        .addStringOption((o) => o.setName('amount').setDescription('Amount in YERB').setRequired(true)),
      async execute(interaction) {
        requireWallet(ctx);
        if (!ctx.config.withdrawalsEnabled) throw new Error('Withdrawals are currently disabled');
        const address = interaction.options.getString('address', true).trim();
        const validation = await ctx.rpc.validateAddress(address);
        if (!validation?.isvalid) throw new Error('Invalid Yerbas address');
        const amount = toUnits(interaction.options.getString('amount', true));
        if (amount < toUnits(ctx.config.minimumWithdrawal)) throw new Error(`Minimum withdrawal is ${ctx.config.minimumWithdrawal} YERB`);
        const id = ctx.ledger.createWithdrawal(interaction.user.id, address, amount, toUnits(ctx.config.withdrawalFee));
        await interaction.reply({ content: `Withdrawal #${id} queued. Amount: ${fromUnits(amount)} YERB`, ephemeral: true });
      }
    },
    {
      data: new SlashCommandBuilder().setName('asset-balance').setDescription('Show your internal Yerbas Asset balances.')
        .addStringOption((o) => o.setName('asset').setDescription('Optional asset name')),
      async execute(interaction) {
        requireAssets(ctx);
        const asset = interaction.options.getString('asset')?.trim();
        if (asset) {
          await interaction.reply({ content: `Balance: **${ctx.assetLedger.describeBalance(interaction.user.id, asset)}**`, ephemeral: true });
          return;
        }
        const rows = ctx.assetLedger.balances(interaction.user.id);
        const text = rows.length ? rows.map((row) => `**${fromUnits(row.balance_units)} ${row.asset_name}**`).join('\n') : 'No internal asset balances.';
        await interaction.reply({ content: text, ephemeral: true });
      }
    },
    {
      data: new SlashCommandBuilder().setName('asset-tip').setDescription('Tip a Yerbas Asset to another Discord member.')
        .addUserOption((o) => o.setName('user').setDescription('Recipient').setRequired(true))
        .addStringOption((o) => o.setName('asset').setDescription('Asset name').setRequired(true))
        .addStringOption((o) => o.setName('amount').setDescription('Asset amount').setRequired(true)),
      async execute(interaction) {
        requireAssets(ctx);
        const recipient = interaction.options.getUser('user', true);
        if (recipient.bot || recipient.id === interaction.user.id) throw new Error('Choose another human member');
        const asset = interaction.options.getString('asset', true).trim();
        const amount = await validatedAssetAmount(ctx, asset, interaction.options.getString('amount', true));
        ctx.assetLedger.transfer(interaction.user.id, recipient.id, asset, amount, `asset-tip:${interaction.id}`);
        await interaction.reply(`${interaction.user} tipped ${recipient} **${fromUnits(amount)} ${asset}** 🌿`);
      }
    },
    {
      data: new SlashCommandBuilder().setName('asset-withdraw').setDescription('Send a Yerbas Asset to an external address.')
        .addStringOption((o) => o.setName('asset').setDescription('Asset name').setRequired(true))
        .addStringOption((o) => o.setName('address').setDescription('Yerbas address').setRequired(true))
        .addStringOption((o) => o.setName('amount').setDescription('Asset amount').setRequired(true)),
      async execute(interaction) {
        requireAssets(ctx);
        if (!ctx.config.assetWithdrawalsEnabled) throw new Error('Asset withdrawals are currently disabled');
        const asset = interaction.options.getString('asset', true).trim();
        const address = interaction.options.getString('address', true).trim();
        const validation = await ctx.rpc.validateAddress(address);
        if (!validation?.isvalid) throw new Error('Invalid Yerbas address');
        const amount = await validatedAssetAmount(ctx, asset, interaction.options.getString('amount', true));
        const id = ctx.assetLedger.createWithdrawal(interaction.user.id, asset, address, amount);
        await interaction.reply({ content: `Asset withdrawal #${id} queued: ${fromUnits(amount)} ${asset}`, ephemeral: true });
      }
    },
    {
      data: new SlashCommandBuilder().setName('asset-wallet').setDescription('List assets held by the bot wallet (administrators only).')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption((o) => o.setName('filter').setDescription('Asset filter, such as * or TOKEN*')),
      async execute(interaction) {
        requireAdmin(interaction, ctx);
        requireAssets(ctx);
        const assets = await ctx.rpc.listMyAssets(interaction.options.getString('filter') || '*');
        const entries = Object.entries(assets || {});
        const text = entries.length ? entries.slice(0, 25).map(([name, amount]) => `${name}: ${amount}`).join('\n') : 'No matching wallet assets.';
        await interaction.reply({ content: text, ephemeral: true });
      }
    },
    {
      data: new SlashCommandBuilder().setName('history').setDescription('Show your latest YERB and asset activity.'),
      async execute(interaction) {
        requireWallet(ctx);
        const yerbRows = ctx.ledger.history(interaction.user.id, 5);
        const assetRows = ctx.config.assetsEnabled ? ctx.assetLedger.history(interaction.user.id, 5) : [];
        const lines = [
          ...yerbRows.map((r) => `${r.created_at} — ${r.entry_type}: ${fromUnits(r.amount_units)} YERB`),
          ...assetRows.map((r) => `${r.created_at} — ${r.entry_type}: ${fromUnits(r.amount_units)} ${r.asset_name}`)
        ].sort().reverse().slice(0, 10);
        await interaction.reply({ content: lines.length ? lines.join('\n') : 'No ledger activity yet.', ephemeral: true });
      }
    },
    {
      data: new SlashCommandBuilder().setName('admin-credit').setDescription('Credit a user YERB balance (administrators only).')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addUserOption((o) => o.setName('user').setDescription('User').setRequired(true))
        .addStringOption((o) => o.setName('amount').setDescription('Amount in YERB').setRequired(true))
        .addStringOption((o) => o.setName('reference').setDescription('Audit reference').setRequired(true)),
      async execute(interaction) {
        requireAdmin(interaction, ctx);
        const user = interaction.options.getUser('user', true);
        const amount = toUnits(interaction.options.getString('amount', true));
        ctx.ledger.addEntry(user.id, amount, 'admin_credit', `admin:${interaction.options.getString('reference', true)}`, { admin: interaction.user.id });
        await interaction.reply({ content: `Credited ${user.tag} ${fromUnits(amount)} YERB.`, ephemeral: true });
      }
    },
    {
      data: new SlashCommandBuilder().setName('admin-asset-credit').setDescription('Credit a user asset balance (administrators only).')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addUserOption((o) => o.setName('user').setDescription('User').setRequired(true))
        .addStringOption((o) => o.setName('asset').setDescription('Asset name').setRequired(true))
        .addStringOption((o) => o.setName('amount').setDescription('Asset amount').setRequired(true))
        .addStringOption((o) => o.setName('reference').setDescription('Deposit txid or audit reference').setRequired(true)),
      async execute(interaction) {
        requireAdmin(interaction, ctx);
        requireAssets(ctx);
        const user = interaction.options.getUser('user', true);
        const asset = interaction.options.getString('asset', true).trim();
        const amount = await validatedAssetAmount(ctx, asset, interaction.options.getString('amount', true));
        const reference = `admin-asset:${interaction.options.getString('reference', true)}`;
        const result = ctx.assetLedger.addEntry(user.id, asset, amount, 'admin_asset_credit', reference, { admin: interaction.user.id });
        if (result.changes !== 1) throw new Error('That asset credit reference was already used');
        await interaction.reply({ content: `Credited ${user.tag} ${fromUnits(amount)} ${asset}.`, ephemeral: true });
      }
    },
    {
      data: new SlashCommandBuilder().setName('help').setDescription('Show available bot commands.'),
      async execute(interaction) {
        await interaction.reply({ content: [
          '**Yerbas Tip Bot v2**',
          '`/deposit` — Personal YERB and asset address',
          '`/balance`, `/tip`, `/withdraw` — YERB wallet',
          '`/asset-balance` — Asset balances',
          '`/asset-tip user asset amount` — Internal asset tip',
          '`/asset-withdraw asset address amount` — External asset send',
          '`/history` — Recent account activity',
          '`/network`, `/ping`, `/version` — Runtime status'
        ].join('\n'), ephemeral: true });
      }
    }
  ];
}
