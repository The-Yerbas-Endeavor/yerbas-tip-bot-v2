import { InteractionContextType, SlashCommandBuilder } from 'discord.js';
import { fromUnits, toUnits } from './services/ledger.js';

const RAIN_EMOJI = '🌿';
const MAX_RAIN_MESSAGE_LENGTH = 200;
const DEFAULT_ACTIVITY_MINUTES = 30;
const DEFAULT_DROP_DURATION = 60;

function amountString(units) {
  return fromUnits(BigInt(units));
}

function normalizeText(value, maxLength = MAX_RAIN_MESSAGE_LENGTH) {
  if (!value) return null;
  const text = String(value).replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  return text ? text.slice(0, maxLength) : null;
}

async function databaseUsers(ledger, creatorId) {
  const [rows] = await ledger.pool.execute(
    `SELECT discord_id, username FROM user
     WHERE discord_id IS NOT NULL AND discord_id <> '' AND discord_id <> ?`,
    [creatorId]
  );
  return rows.map((row) => ({
    id: String(row.discord_id),
    username: String(row.username || 'unknown'),
    bot: false
  }));
}

async function distributeRain({ ledger, creator, participants, amountUnits, reference, paymentType }) {
  const unique = [...new Map(participants.map((user) => [String(user.id), user])).values()]
    .filter((user) => !user.bot && String(user.id) !== creator.id);
  if (unique.length === 0) return { participantCount: 0, paidUnits: 0n };

  const count = BigInt(unique.length);
  const baseShare = amountUnits / count;
  const remainder = amountUnits % count;
  if (baseShare <= 0n) throw new Error('Rain amount is too small for the number of recipients');

  const connection = await ledger.pool.getConnection();
  try {
    await connection.beginTransaction();
    const [processed] = await connection.execute(
      'INSERT IGNORE INTO v2_processed_events (event_type, event_key) VALUES (?, ?)',
      ['yerb_rain', reference]
    );
    if (processed.affectedRows !== 1) {
      await connection.rollback();
      return { participantCount: 0, paidUnits: 0n, duplicate: true };
    }

    await connection.execute(
      `INSERT INTO user (username, discord_id) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE username=VALUES(username)`,
      [String(creator.username).slice(0, 60), creator.id]
    );
    const [rows] = await connection.execute(
      'SELECT balance FROM user WHERE discord_id=? FOR UPDATE',
      [creator.id]
    );
    if (!rows[0] || Number(rows[0].balance) < Number(amountString(amountUnits))) {
      throw new Error('The rain creator no longer has enough available YERB');
    }

    await connection.execute('UPDATE user SET balance=balance-? WHERE discord_id=?', [amountString(amountUnits), creator.id]);

    let paidUnits = 0n;
    for (let index = 0; index < unique.length; index += 1) {
      const recipient = unique[index];
      const shareUnits = baseShare + (BigInt(index) < remainder ? 1n : 0n);
      const share = amountString(shareUnits);
      paidUnits += shareUnits;

      await connection.execute(
        `INSERT INTO user (username, discord_id) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE username=VALUES(username)`,
        [String(recipient.username || 'unknown').slice(0, 60), String(recipient.id)]
      );
      await connection.execute('UPDATE user SET balance=balance+? WHERE discord_id=?', [share, String(recipient.id)]);
      await connection.execute(
        'INSERT INTO payments (amount, from_discord_id, to_discord_id, type) VALUES (?, ?, ?, ?)',
        [share, creator.id, String(recipient.id), paymentType]
      );
      await connection.execute(
        'INSERT INTO log (discord_id, description, value) VALUES (?, ?, ?)',
        [String(recipient.id), `Received ${paymentType} from ${creator.id} [${reference}]`, share]
      );
    }

    await connection.execute(
      'INSERT INTO log (discord_id, description, value) VALUES (?, ?, ?)',
      [creator.id, `Created ${paymentType} for ${unique.length} users [${reference}]`, amountString(amountUnits)]
    );
    await connection.commit();
    return { participantCount: unique.length, paidUnits, shareUnits: baseShare };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function validateAmount(interaction, ctx) {
  if (!ctx.config.walletEnabled) throw new Error('Wallet features are disabled by WALLET_ENABLED=false');
  const amountUnits = toUnits(interaction.options.getString('amount', true));
  if (amountUnits < toUnits(ctx.config.minimumTip)) throw new Error(`Minimum rain is ${ctx.config.minimumTip} YERB`);
  const currentBalance = await ctx.ledger.balanceUnits(interaction.user.id, interaction.user.username);
  if (currentBalance < amountUnits) throw new Error('Insufficient balance');
  return amountUnits;
}

async function runImmediateRain(interaction, ctx, participants, amountUnits, label, paymentType, customMessage) {
  const result = await distributeRain({
    ledger: ctx.ledger,
    creator: interaction.user,
    participants,
    amountUnits,
    reference: `${paymentType}:${interaction.id}`,
    paymentType
  });
  if (result.participantCount === 0) {
    await interaction.reply({ content: `No eligible users were found for ${label}. No YERB was deducted.`, ephemeral: true });
    return;
  }
  const message = normalizeText(customMessage);
  await interaction.reply({
    content: [
      `🌧️ **YERB ${label}!**`,
      `${interaction.user} shared **${fromUnits(result.paidUnits)} YERB** among **${result.participantCount} users**.`,
      `Each user received approximately **${fromUnits(result.shareUnits)} YERB**.`,
      message ? `> ${message}` : null
    ].filter(Boolean).join('\n'),
    allowedMentions: { parse: [], users: [interaction.user.id] }
  });
}

async function startDrop(interaction, ctx, amountUnits, durationSeconds, claimMode, phrase, customMessage) {
  const endsAt = Math.floor(Date.now() / 1000) + durationSeconds;
  const displayPhrase = normalizeText(phrase, 50);
  const normalizedPhrase = displayPhrase?.toLowerCase();
  if (claimMode === 'phrase' && !normalizedPhrase) throw new Error('A claim phrase is required for phrase mode');

  const instructions = claimMode === 'phrase'
    ? `Type **${displayPhrase}** in this channel before <t:${endsAt}:R> to enter.`
    : `React with ${RAIN_EMOJI} before <t:${endsAt}:R> to enter.`;

  const rainMessage = normalizeText(customMessage);
  const message = await interaction.reply({
    content: [
      '🌧️ **YERB Rain Drop!** 🌿',
      `${interaction.user} is dropping **${fromUnits(amountUnits)} YERB**!`,
      rainMessage ? `> ${rainMessage}` : null,
      instructions,
      'The total will be split evenly among valid claimants.'
    ].filter(Boolean).join('\n'),
    allowedMentions: { parse: [], users: [interaction.user.id] },
    fetchReply: true
  });

  const participants = new Map();
  let collector;
  if (claimMode === 'phrase') {
    collector = interaction.channel.createMessageCollector({
      filter: (candidate) => !candidate.author.bot
        && candidate.author.id !== interaction.user.id
        && candidate.content.trim().toLowerCase() === normalizedPhrase,
      time: durationSeconds * 1000
    });
    collector.on('collect', (candidate) => participants.set(candidate.author.id, candidate.author));
  } else {
    await message.react(RAIN_EMOJI);
    collector = message.createReactionCollector({
      filter: (reaction, user) => reaction.emoji.name === RAIN_EMOJI && !user.bot && user.id !== interaction.user.id,
      time: durationSeconds * 1000
    });
    collector.on('collect', (_reaction, user) => participants.set(user.id, user));
    collector.on('remove', (_reaction, user) => participants.delete(user.id));
  }

  collector.once('end', async () => {
    try {
      const result = await distributeRain({
        ledger: ctx.ledger,
        creator: interaction.user,
        participants: [...participants.values()],
        amountUnits,
        reference: `rain-drop:${interaction.id}`,
        paymentType: 'rainDrop'
      });
      if (result.participantCount === 0) {
        await message.reply('The rain drop ended with no eligible claimants. No YERB was deducted.');
        return;
      }
      await message.reply(`🌧️ Rain drop complete! **${fromUnits(result.paidUnits)} YERB** was shared among **${result.participantCount} claimants**.`);
    } catch (error) {
      console.error(`Rain drop ${interaction.id} failed:`, error);
      await message.reply(`Rain drop canceled: ${error.message || 'unexpected payout error'}`);
    }
  });
}

function addAmountOption(subcommand) {
  return subcommand.addStringOption((option) => option
    .setName('amount')
    .setDescription('Total YERB to distribute')
    .setRequired(true));
}

function addMessageOption(subcommand) {
  return subcommand.addStringOption((option) => option
    .setName('message')
    .setDescription('Optional message shown with the rain')
    .setMaxLength(MAX_RAIN_MESSAGE_LENGTH));
}

export function buildReactionDropCommand(ctx) {
  return {
    data: new SlashCommandBuilder()
      .setName('rain')
      .setDescription('Distribute YERB using several rain modes.')
      .setContexts(InteractionContextType.Guild)
      .addSubcommand((subcommand) => addMessageOption(addAmountOption(subcommand
        .setName('all')
        .setDescription('Split YERB among every user in the bot database.'))))
      .addSubcommand((subcommand) => addMessageOption(addAmountOption(subcommand
        .setName('online')
        .setDescription('Split YERB among recently active channel users.'))
        .addIntegerOption((option) => option
          .setName('activity-minutes')
          .setDescription('How recently users must have chatted (default: 30)')
          .setMinValue(1)
          .setMaxValue(1440))))
      .addSubcommand((subcommand) => addMessageOption(addAmountOption(subcommand
        .setName('drop')
        .setDescription('Open a timed reaction or phrase claim drop.'))
        .addIntegerOption((option) => option
          .setName('duration')
          .setDescription('Seconds to accept claims (default: 60)')
          .setMinValue(10)
          .setMaxValue(600))
        .addStringOption((option) => option
          .setName('claim-mode')
          .setDescription('How users enter the drop')
          .addChoices(
            { name: 'Reaction icon', value: 'reaction' },
            { name: 'Drop phrase', value: 'phrase' }
          ))
        .addStringOption((option) => option
          .setName('phrase')
          .setDescription('Exact phrase users must type in phrase mode')
          .setMaxLength(50)))),
    async execute(interaction) {
      const subcommand = interaction.options.getSubcommand(true);
      const amountUnits = await validateAmount(interaction, ctx);
      const customMessage = interaction.options.getString('message');

      if (subcommand === 'all') {
        const participants = await databaseUsers(ctx.ledger, interaction.user.id);
        await runImmediateRain(interaction, ctx, participants, amountUnits, 'Rain All', 'rainAll', customMessage);
        return;
      }

      if (subcommand === 'online') {
        const activityMinutes = interaction.options.getInteger('activity-minutes') ?? DEFAULT_ACTIVITY_MINUTES;
        const participants = ctx.activityTracker.activeUsers(interaction.guildId, interaction.channelId, activityMinutes);
        await runImmediateRain(interaction, ctx, participants, amountUnits, 'Online Rain', 'rainOnline', customMessage);
        return;
      }

      const durationSeconds = interaction.options.getInteger('duration') ?? DEFAULT_DROP_DURATION;
      const claimMode = interaction.options.getString('claim-mode') ?? 'reaction';
      const phrase = interaction.options.getString('phrase');
      await startDrop(interaction, ctx, amountUnits, durationSeconds, claimMode, phrase, customMessage);
    }
  };
}