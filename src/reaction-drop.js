import { InteractionContextType, SlashCommandBuilder } from 'discord.js';
import { fromUnits, toUnits } from './services/ledger.js';

const DROP_EMOJI = '🌿';

function amountString(units) {
  return fromUnits(BigInt(units));
}

async function distributeDrop({ ledger, creator, participants, amountUnits, reference }) {
  const unique = [...new Map(participants.map((user) => [user.id, user])).values()]
    .filter((user) => !user.bot && user.id !== creator.id);
  if (unique.length === 0) return { participantCount: 0, paidUnits: 0n };

  const count = BigInt(unique.length);
  const baseShare = amountUnits / count;
  const remainder = amountUnits % count;
  if (baseShare <= 0n) throw new Error('Drop amount is too small for the number of participants');

  const connection = await ledger.pool.getConnection();
  try {
    await connection.beginTransaction();
    const [processed] = await connection.execute(
      'INSERT IGNORE INTO v2_processed_events (event_type, event_key) VALUES (?, ?)',
      ['reaction_drop', reference]
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
      throw new Error('The drop creator no longer has enough available YERB');
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
        [share, creator.id, recipient.id, 'reactionDrop']
      );
      await connection.execute(
        'INSERT INTO log (discord_id, description, value) VALUES (?, ?, ?)',
        [recipient.id, `Received reaction drop from ${creator.id} [${reference}]`, share]
      );
    }

    await connection.execute(
      'INSERT INTO log (discord_id, description, value) VALUES (?, ?, ?)',
      [creator.id, `Created reaction drop for ${unique.length} users [${reference}]`, amountString(amountUnits)]
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

export async function startReactionDrop(interaction, ctx, amountUnits, durationSeconds) {
  const currentBalance = await ctx.ledger.balanceUnits(interaction.user.id, interaction.user.username);
  if (currentBalance < amountUnits) throw new Error('Insufficient balance');

  const endsAt = Math.floor(Date.now() / 1000) + durationSeconds;
  const message = await interaction.reply({
    content: [
      '🌿 **YERB Reaction Drop!**',
      `${interaction.user} is dropping **${fromUnits(amountUnits)} YERB**.`,
      `React with ${DROP_EMOJI} before <t:${endsAt}:R> to participate.`,
      'The total will be split evenly among eligible participants.'
    ].join('\n'),
    fetchReply: true
  });

  await message.react(DROP_EMOJI);
  const collector = message.createReactionCollector({
    filter: (reaction, user) => reaction.emoji.name === DROP_EMOJI && !user.bot && user.id !== interaction.user.id,
    time: durationSeconds * 1000
  });

  const participants = new Map();
  collector.on('collect', (_reaction, user) => participants.set(user.id, user));
  collector.on('remove', (_reaction, user) => participants.delete(user.id));

  collector.once('end', async () => {
    try {
      const result = await distributeDrop({
        ledger: ctx.ledger,
        creator: interaction.user,
        participants: [...participants.values()],
        amountUnits,
        reference: `reaction-drop:${interaction.id}`
      });
      if (result.participantCount === 0) {
        await message.reply('Reaction drop ended with no eligible participants. No YERB was deducted.');
        return;
      }
      await message.reply(
        `🌿 Drop complete! **${fromUnits(result.paidUnits)} YERB** was shared among **${result.participantCount}** participants.`
      );
    } catch (error) {
      console.error(`Reaction drop ${interaction.id} failed:`, error);
      await message.reply(`Reaction drop canceled: ${error.message || 'unexpected payout error'}`);
    }
  });
}

export function buildReactionDropCommand(ctx) {
  return {
    data: new SlashCommandBuilder()
      .setName('drop')
      .setDescription('Start a YERB reaction drop for active chat participants.')
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
        .setRequired(true)),
    async execute(interaction) {
      if (!ctx.config.walletEnabled) throw new Error('Wallet features are disabled by WALLET_ENABLED=false');
      const amountUnits = toUnits(interaction.options.getString('amount', true));
      if (amountUnits < toUnits(ctx.config.minimumTip)) {
        throw new Error(`Minimum drop is ${ctx.config.minimumTip} YERB`);
      }
      const durationSeconds = interaction.options.getInteger('duration', true);
      await startReactionDrop(interaction, ctx, amountUnits, durationSeconds);
    }
  };
}
