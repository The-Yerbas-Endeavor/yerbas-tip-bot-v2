import { InteractionContextType, SlashCommandBuilder } from 'discord.js';
import { fromUnits, toUnits } from './services/ledger.js';

const RAIN_EMOJI = '🌿';
const MAX_RAIN_MESSAGE_LENGTH = 200;
const DEFAULT_ACTIVITY_MINUTES = 30;

function amountString(units) {
  return fromUnits(BigInt(units));
}

function normalizeRainMessage(value) {
  if (!value) return null;
  const message = String(value).replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  if (!message) return null;
  return message.slice(0, MAX_RAIN_MESSAGE_LENGTH);
}

async function distributeRain({ ledger, creator, participants, amountUnits, reference }) {
  const unique = [...new Map(participants.map((user) => [user.id, user])).values()]
    .filter((user) => !user.bot && user.id !== creator.id);
  if (unique.length === 0) return { participantCount: 0, paidUnits: 0n };

  const count = BigInt(unique.length);
  const baseShare = amountUnits / count;
  const remainder = amountUnits % count;
  if (baseShare <= 0n) throw new Error('Rain amount is too small for the number of participants');

  const connection = await ledger.pool.getConnection();
  try {
    await connection.beginTransaction();
    const [processed] = await connection.execute(
      'INSERT IGNORE INTO v2_processed_events (event_type, event_key) VALUES (?, ?)',
      ['reaction_rain', reference]
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

    await connection.execute(
      'UPDATE user SET balance=balance-? WHERE discord_id=?',
      [amountString(amountUnits), creator.id]
    );

    let paidUnits = 0n;
    for (let index = 0; index < unique.length; index += 1) {
      const recipient = unique[index];
      const shareUnits = baseShare + (BigInt(index) < remainder ? 1n : 0n);
      const share = amountString(shareUnits);
      paidUnits += shareUnits;

      await connection.execute(
        `INSERT INTO user (username, discord_id) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE username=VALUES(username)`,
        [String(recipient.username).slice(0, 60), recipient.id]
      );
      await connection.execute('UPDATE user SET balance=balance+? WHERE discord_id=?', [share, recipient.id]);
      await connection.execute(
        'INSERT INTO payments (amount, from_discord_id, to_discord_id, type) VALUES (?, ?, ?, ?)',
        [share, creator.id, recipient.id, 'reactionRain']
      );
      await connection.execute(
        'INSERT INTO log (discord_id, description, value) VALUES (?, ?, ?)',
        [recipient.id, `Received YERB rain from ${creator.id} [${reference}]`, share]
      );
    }

    await connection.execute(
      'INSERT INTO log (discord_id, description, value) VALUES (?, ?, ?)',
      [creator.id, `Created YERB rain for ${unique.length} users [${reference}]`, amountString(amountUnits)]
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

export async function startReactionRain(interaction, ctx, amountUnits, durationSeconds, customMessage, activityMinutes) {
  const currentBalance = await ctx.ledger.balanceUnits(interaction.user.id, interaction.user.username);
  if (currentBalance < amountUnits) throw new Error('Insufficient balance');

  const endsAt = Math.floor(Date.now() / 1000) + durationSeconds;
  const rainMessage = normalizeRainMessage(customMessage);
  const content = [
    '🌧️ **YERB Rain!** 🌿',
    `${interaction.user} is making it rain **${fromUnits(amountUnits)} YERB**!`,
    rainMessage ? `> ${rainMessage}` : null,
    `React with ${RAIN_EMOJI} before <t:${endsAt}:R> to participate.`,
    `Only users who posted in this channel within the last **${activityMinutes} minutes** are eligible.`,
    'The total will be split evenly among eligible participants.'
  ].filter(Boolean).join('\n');

  const message = await interaction.reply({
    content,
    allowedMentions: { parse: [], users: [interaction.user.id] },
    fetchReply: true
  });

  await message.react(RAIN_EMOJI);
  const collector = message.createReactionCollector({
    filter: (reaction, user) => reaction.emoji.name === RAIN_EMOJI && !user.bot && user.id !== interaction.user.id,
    time: durationSeconds * 1000
  });

  const participants = new Map();
  collector.on('collect', (_reaction, user) => participants.set(user.id, user));
  collector.on('remove', (_reaction, user) => participants.delete(user.id));

  collector.once('end', async () => {
    try {
      const eligibleParticipants = [...participants.values()].filter((user) =>
        ctx.activityTracker.isActive(
          interaction.guildId,
          interaction.channelId,
          user.id,
          activityMinutes
        )
      );

      const result = await distributeRain({
        ledger: ctx.ledger,
        creator: interaction.user,
        participants: eligibleParticipants,
        amountUnits,
        reference: `reaction-rain:${interaction.id}`
      });
      if (result.participantCount === 0) {
        await message.reply('The rain ended with no eligible active participants. No YERB was deducted.');
        return;
      }
      await message.reply(
        `🌧️ Rain complete! **${fromUnits(result.paidUnits)} YERB** was shared among **${result.participantCount} active participants**.`
      );
    } catch (error) {
      console.error(`Reaction rain ${interaction.id} failed:`, error);
      await message.reply(`Rain canceled: ${error.message || 'unexpected payout error'}`);
    }
  });
}

export function buildReactionDropCommand(ctx) {
  return {
    data: new SlashCommandBuilder()
      .setName('rain')
      .setDescription('Make it rain YERB on active users who react in chat.')
      .setContexts(InteractionContextType.Guild)
      .addStringOption((option) => option
        .setName('amount')
        .setDescription('Total YERB to split among participants')
        .setRequired(true))
      .addIntegerOption((option) => option
        .setName('duration')
        .setDescription('Seconds to accept reactions (10-600)')
        .setMinValue(10)
        .setMaxValue(600)
        .setRequired(true))
      .addIntegerOption((option) => option
        .setName('activity-minutes')
        .setDescription('How recently users must have chatted (default: 30)')
        .setMinValue(1)
        .setMaxValue(1440)
        .setRequired(false))
      .addStringOption((option) => option
        .setName('message')
        .setDescription('Optional message shown with your rain')
        .setMaxLength(MAX_RAIN_MESSAGE_LENGTH)
        .setRequired(false)),
    async execute(interaction) {
      if (!ctx.config.walletEnabled) throw new Error('Wallet features are disabled by WALLET_ENABLED=false');
      const amountUnits = toUnits(interaction.options.getString('amount', true));
      if (amountUnits < toUnits(ctx.config.minimumTip)) {
        throw new Error(`Minimum rain is ${ctx.config.minimumTip} YERB`);
      }
      const durationSeconds = interaction.options.getInteger('duration', true);
      const activityMinutes = interaction.options.getInteger('activity-minutes') ?? DEFAULT_ACTIVITY_MINUTES;
      const customMessage = interaction.options.getString('message');
      await startReactionRain(interaction, ctx, amountUnits, durationSeconds, customMessage, activityMinutes);
    }
  };
}
