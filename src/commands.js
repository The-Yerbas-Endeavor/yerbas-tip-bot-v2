import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import packageJson from '../package.json' with { type: 'json' };
import { fromUnits, toUnits } from './services/ledger.js';

function requireWallet(ctx) {
  if (!ctx.config.walletEnabled) throw new Error('Wallet features are disabled by WALLET_ENABLED=false');
}

function requireAdmin(interaction, ctx) {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return;
  if (ctx.config.adminRoleId && interaction.member?.roles?.cache?.has(ctx.config.adminRoleId)) return;
  throw new Error('Administrator permission required');
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
      data: new SlashCommandBuilder().setName('deposit').setDescription('Get your personal YERB deposit address.'),
      async execute(interaction) {
        requireWallet(ctx);
        const user = ctx.ledger.getUser(interaction.user.id);
        let address = user.deposit_address;
        if (!address) {
          address = await ctx.rpc.getNewAddress(`discord:${interaction.user.id}`);
          ctx.ledger.setDepositAddress(interaction.user.id, address);
        }
        await interaction.reply({ content: `Your YERB deposit address:\n\`${address}\`\nDeposits are credited after ${ctx.config.confirmations} confirmations.`, ephemeral: true });
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
        const reference = `tip:${interaction.id}`;
        ctx.ledger.transfer(interaction.user.id, recipient.id, amount, reference);
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
        await interaction.reply({ content: `Withdrawal #${id} queued for review. Amount: ${fromUnits(amount)} YERB`, ephemeral: true });
      }
    },
    {
      data: new SlashCommandBuilder().setName('history').setDescription('Show your latest ledger activity.'),
      async execute(interaction) {
        requireWallet(ctx);
        const rows = ctx.ledger.history(interaction.user.id, 10);
        const text = rows.length ? rows.map((r) => `${r.created_at} — ${r.entry_type}: ${fromUnits(r.amount_units)} YERB`).join('\n') : 'No ledger activity yet.';
        await interaction.reply({ content: text, ephemeral: true });
      }
    },
    {
      data: new SlashCommandBuilder().setName('admin-credit').setDescription('Credit a user ledger balance (administrators only).')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addUserOption((o) => o.setName('user').setDescription('User').setRequired(true))
        .addStringOption((o) => o.setName('amount').setDescription('Amount in YERB').setRequired(true))
        .addStringOption((o) => o.setName('reference').setDescription('Audit reference').setRequired(true)),
      async execute(interaction) {
        requireAdmin(interaction, ctx);
        const user = interaction.options.getUser('user', true);
        const amount = toUnits(interaction.options.getString('amount', true));
        const reference = `admin:${interaction.options.getString('reference', true)}`;
        ctx.ledger.addEntry(user.id, amount, 'admin_credit', reference, { admin: interaction.user.id });
        await interaction.reply({ content: `Credited ${user.tag} ${fromUnits(amount)} YERB.`, ephemeral: true });
      }
    },
    {
      data: new SlashCommandBuilder().setName('help').setDescription('Show available bot commands.'),
      async execute(interaction) {
        await interaction.reply({ content: [
          '**Yerbas Tip Bot v2**',
          '`/network` — Yerbas node status',
          '`/deposit` — Personal deposit address',
          '`/balance` — Internal balance',
          '`/tip user amount` — Tip another member',
          '`/withdraw address amount` — Queue a withdrawal',
          '`/history` — Recent account activity',
          '`/ping` and `/version` — Runtime status'
        ].join('\n'), ephemeral: true });
      }
    }
  ];
}
