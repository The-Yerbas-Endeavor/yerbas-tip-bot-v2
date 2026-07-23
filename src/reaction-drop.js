import { InteractionContextType, SlashCommandBuilder } from 'discord.js';
import { fromUnits, toUnits } from './services/ledger.js';
import { resolveReactionEmoji } from './utils/reaction-emoji.js';

const DEFAULT_EMOJI = '🌿';
const DEFAULT_ACTIVITY_MINUTES = 30;
const DEFAULT_DROP_DURATION = 21600;
const MAX_MESSAGE_LENGTH = 200;
const MAX_PUBLIC_MENTIONS = 25;

function amountString(units) { return fromUnits(BigInt(units)); }
function clean(value, max = MAX_MESSAGE_LENGTH) {
  if (!value) return null;
  const text = String(value).replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  return text ? text.slice(0, max) : null;
}
function shuffle(values) {
  const copy = [...values];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

async function notifyRecipients(channel, recipients, label = 'Recipients') {
  const unique = [...new Map(recipients.map((user) => [String(user.id), user])).values()];
  if (!unique.length) return;
  const shown = unique.slice(0, MAX_PUBLIC_MENTIONS);
  const remaining = unique.length - shown.length;
  const mentions = shown.map((user) => `<@${user.id}>`).join(' ');
  await channel.send({
    content: [`🌿 **${label}:**`, mentions, remaining > 0 ? `…and **${remaining} more**.` : null].filter(Boolean).join('\n'),
    allowedMentions: { parse: [], users: shown.map((user) => String(user.id)) }
  });
}

async function databaseUsers(ledger, creatorId) {
  const [rows] = await ledger.pool.execute(
    `SELECT discord_id, username FROM user
     WHERE discord_id IS NOT NULL AND discord_id <> '' AND discord_id <> ?`,
    [creatorId]
  );
  return rows.map((row) => ({ id: String(row.discord_id), username: String(row.username || 'unknown'), bot: false }));
}

function onlineGuildUsers(interaction) {
  return [...interaction.guild.members.cache.values()]
    .filter((member) => !member.user.bot && member.id !== interaction.user.id)
    .filter((member) => member.presence?.status && member.presence.status !== 'offline')
    .map((member) => member.user);
}

async function validateAmount(interaction, ctx) {
  if (!ctx.config.walletEnabled) throw new Error('Wallet features are disabled by WALLET_ENABLED=false');
  const amountUnits = toUnits(interaction.options.getString('amount', true));
  const assetName = clean(interaction.options.getString('asset'), 64);
  if (amountUnits <= 0n) throw new Error('Amount must be greater than zero');

  if (assetName) {
    if (!ctx.config.assetsEnabled) throw new Error('Asset features are disabled by ASSETS_ENABLED=false');
    const metadata = await ctx.rpc.getAssetData(assetName);
    if (!metadata) throw new Error(`Unknown Yerbas asset: ${assetName}`);
    const units = Number(metadata.units ?? 8);
    const increment = 10n ** BigInt(8 - units);
    if (amountUnits % increment !== 0n) throw new Error(`${assetName} supports no more than ${units} decimal places`);
    const balance = await ctx.ledger.assetBalanceUnits(interaction.user.id, assetName);
    if (balance < amountUnits) throw new Error(`Insufficient ${assetName} balance`);
    return { amountUnits, assetName };
  }

  if (amountUnits < toUnits(ctx.config.minimumTip)) throw new Error(`Minimum rain is ${ctx.config.minimumTip} YERB`);
  const balance = await ctx.ledger.balanceUnits(interaction.user.id, interaction.user.username);
  if (balance < amountUnits) throw new Error('Insufficient YERB balance');
  return { amountUnits, assetName: null };
}

async function distribute({ ledger, creator, participants, amountUnits, assetName, reference, paymentType }) {
  const unique = [...new Map(participants.map((user) => [String(user.id), user])).values()]
    .filter((user) => !user.bot && String(user.id) !== creator.id);
  if (!unique.length) return { participantCount: 0, paidUnits: 0n, recipients: [] };

  const count = BigInt(unique.length);
  const baseShare = amountUnits / count;
  const remainder = amountUnits % count;
  if (baseShare <= 0n) throw new Error('Amount is too small for the number of recipients');

  const connection = await ledger.pool.getConnection();
  try {
    await connection.beginTransaction();
    const eventType = assetName ? 'asset_rain' : 'yerb_rain';
    const [processed] = await connection.execute(
      'INSERT IGNORE INTO v2_processed_events (event_type, event_key) VALUES (?, ?)',
      [eventType, reference]
    );
    if (processed.affectedRows !== 1) {
      await connection.rollback();
      return { participantCount: 0, paidUnits: 0n, duplicate: true, recipients: [] };
    }

    await connection.execute(
      `INSERT INTO user (username, discord_id) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE username=VALUES(username)`,
      [String(creator.username).slice(0, 60), creator.id]
    );

    if (assetName) {
      await connection.execute(
        'INSERT IGNORE INTO v2_asset_balances (discord_id, asset_name, balance) VALUES (?, ?, 0)',
        [creator.id, assetName]
      );
      const [rows] = await connection.execute(
        'SELECT balance FROM v2_asset_balances WHERE discord_id=? AND asset_name=? FOR UPDATE',
        [creator.id, assetName]
      );
      if (!rows[0] || Number(rows[0].balance) < Number(amountString(amountUnits))) throw new Error(`Insufficient ${assetName} balance`);
      await connection.execute(
        'UPDATE v2_asset_balances SET balance=balance-? WHERE discord_id=? AND asset_name=?',
        [amountString(amountUnits), creator.id, assetName]
      );
    } else {
      const [rows] = await connection.execute('SELECT balance FROM user WHERE discord_id=? FOR UPDATE', [creator.id]);
      if (!rows[0] || Number(rows[0].balance) < Number(amountString(amountUnits))) throw new Error('Insufficient YERB balance');
      await connection.execute('UPDATE user SET balance=balance-? WHERE discord_id=?', [amountString(amountUnits), creator.id]);
    }

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

      if (assetName) {
        await connection.execute(
          `INSERT INTO v2_asset_balances (discord_id, asset_name, balance) VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE balance=balance+VALUES(balance)`,
          [String(recipient.id), assetName, share]
        );
        await connection.execute(
          `INSERT INTO v2_asset_payments
           (asset_name, amount, from_discord_id, to_discord_id, type, reference)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [assetName, share, creator.id, String(recipient.id), paymentType, `${reference}:${recipient.id}`]
        );
      } else {
        await connection.execute('UPDATE user SET balance=balance+? WHERE discord_id=?', [share, String(recipient.id)]);
        await connection.execute(
          'INSERT INTO payments (amount, from_discord_id, to_discord_id, type) VALUES (?, ?, ?, ?)',
          [share, creator.id, String(recipient.id), paymentType]
        );
      }
    }

    await connection.commit();
    return { participantCount: unique.length, paidUnits, shareUnits: baseShare, recipients: unique };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function runImmediate(interaction, ctx, participants, payout, label, paymentType) {
  const result = await distribute({
    ledger: ctx.ledger,
    creator: interaction.user,
    participants,
    ...payout,
    reference: `${paymentType}:${interaction.id}`,
    paymentType
  });
  const symbol = payout.assetName || 'YERB';
  if (!result.participantCount) {
    await interaction.reply({ content: `No eligible users were found for ${label}. Nothing was deducted.`, ephemeral: true });
    return;
  }
  const customMessage = clean(interaction.options.getString('message'));
  await interaction.reply({
    content: [
      `🌧️ **${label}!**`,
      `${interaction.user} shared **${fromUnits(result.paidUnits)} ${symbol}** among **${result.participantCount} users**.`,
      `Each received approximately **${fromUnits(result.shareUnits)} ${symbol}**.`,
      customMessage ? `> ${customMessage}` : null
    ].filter(Boolean).join('\n'),
    allowedMentions: { parse: [], users: [interaction.user.id] }
  });
  await notifyRecipients(interaction.channel, result.recipients);
}

async function startDrop(interaction, ctx, payout, mode) {
  const duration = interaction.options.getInteger('duration') ?? DEFAULT_DROP_DURATION;
  const winnersRequested = interaction.options.getInteger('winners') ?? 1;
  const notify = interaction.options.getString('notify') ?? 'here';
  const audience = notify === 'none' ? null : `@${notify}`;
  const phrase = clean(interaction.options.getString('phrase'), 80);
  const answer = clean(interaction.options.getString('answer'), 80);
  const emojiInput = clean(interaction.options.getString('emoji'), 100) || DEFAULT_EMOJI;
  const reactionEmoji = (mode === 'reaction' || mode === 'lottery')
    ? await resolveReactionEmoji(interaction, emojiInput, DEFAULT_EMOJI)
    : null;
  const maxNumber = interaction.options.getInteger('max-number') ?? 100;
  const targetNumber = mode === 'lucky' ? Math.floor(Math.random() * maxNumber) + 1 : null;
  if (mode === 'phrase' && !phrase) throw new Error('Phrase mode requires the phrase option');
  if (mode === 'trivia' && !answer) throw new Error('Trivia mode requires the answer option');

  const endsAt = Math.floor(Date.now() / 1000) + duration;
  const symbol = payout.assetName || 'YERB';
  let instruction;
  if (mode === 'reaction' || mode === 'lottery') instruction = `React with ${reactionEmoji.display} before <t:${endsAt}:R>.`;
  else if (mode === 'phrase') instruction = `Type **${phrase}** before <t:${endsAt}:R>.`;
  else if (mode === 'trivia') instruction = `First correct answer before <t:${endsAt}:R> wins. Question: **${phrase || 'Answer the host question'}**`;
  else instruction = `Guess a number from **1-${maxNumber}** before <t:${endsAt}:R>. Closest guess wins.`;

  const customMessage = clean(interaction.options.getString('message'));
  const message = await interaction.reply({
    content: [
      audience,
      `🌧️ **${mode.toUpperCase()} DROP**`,
      `${interaction.user} is dropping **${fromUnits(payout.amountUnits)} ${symbol}**.`,
      customMessage ? `> ${customMessage}` : null,
      instruction,
      winnersRequested > 1 ? `Up to **${winnersRequested} winners** will split the total.` : null
    ].filter(Boolean).join('\n'),
    allowedMentions: { parse: audience ? ['everyone'] : [], users: [interaction.user.id] },
    fetchReply: true
  });

  const entrants = new Map();
  let collector;
  if (mode === 'reaction' || mode === 'lottery') {
    await message.react(reactionEmoji.reaction);
    collector = message.createReactionCollector({
      filter: (reaction, user) => reactionEmoji.matches(reaction) && !user.bot && user.id !== interaction.user.id,
      time: duration * 1000
    });
    collector.on('collect', (_reaction, user) => entrants.set(user.id, { user }));
    collector.on('remove', (_reaction, user) => entrants.delete(user.id));
  } else {
    collector = interaction.channel.createMessageCollector({
      filter: (candidate) => !candidate.author.bot && candidate.author.id !== interaction.user.id,
      time: duration * 1000
    });
    collector.on('collect', (candidate) => {
      const text = candidate.content.trim();
      if (mode === 'phrase' && text.toLowerCase() === phrase.toLowerCase()) entrants.set(candidate.author.id, { user: candidate.author });
      if (mode === 'trivia' && text.toLowerCase() === answer.toLowerCase() && entrants.size === 0) entrants.set(candidate.author.id, { user: candidate.author });
      if (mode === 'lucky' && /^\d+$/.test(text)) {
        const guess = Number(text);
        if (guess >= 1 && guess <= maxNumber) entrants.set(candidate.author.id, { user: candidate.author, guess });
      }
    });
  }

  collector.once('end', async () => {
    try {
      let pool = [...entrants.values()];
      if (mode === 'lucky') pool.sort((a, b) => Math.abs(a.guess - targetNumber) - Math.abs(b.guess - targetNumber));
      else pool = shuffle(pool);
      const winners = pool.slice(0, Math.min(winnersRequested, pool.length)).map((entry) => entry.user);
      const result = await distribute({
        ledger: ctx.ledger,
        creator: interaction.user,
        participants: winners,
        ...payout,
        reference: `rain-${mode}:${interaction.id}`,
        paymentType: `rain${mode[0].toUpperCase()}${mode.slice(1)}`
      });
      if (!result.participantCount) {
        await message.reply('Drop ended with no eligible winners. Nothing was deducted.');
        return;
      }
      const luckyText = mode === 'lucky' ? ` The winning number was **${targetNumber}**.` : '';
      await message.reply(`🌿 Drop complete! **${fromUnits(result.paidUnits)} ${symbol}** was shared among **${result.participantCount} winner(s)**.${luckyText}`);
      await notifyRecipients(interaction.channel, result.recipients, 'Winners');
    } catch (error) {
      console.error(`Drop ${interaction.id} failed:`, error);
      await message.reply(`Drop canceled: ${error.message || 'unexpected payout error'}`);
    }
  });
}

function addCommonOptions(subcommand) {
  return subcommand
    .addStringOption((o) => o.setName('amount').setDescription('Total amount to distribute').setRequired(true))
    .addStringOption((o) => o.setName('asset').setDescription('Optional Yerbas Asset name; omit for YERB').setMaxLength(64))
    .addStringOption((o) => o.setName('message').setDescription('Optional rain message').setMaxLength(MAX_MESSAGE_LENGTH));
}

export function buildReactionDropCommand(ctx) {
  return {
    data: new SlashCommandBuilder()
      .setName('rain')
      .setDescription('Rain YERB or Yerbas Assets using multiple distribution modes.')
      .setContexts(InteractionContextType.Guild)
      .addSubcommand((s) => addCommonOptions(s.setName('all').setDescription('Rain every registered database member.')))
      .addSubcommand((s) => addCommonOptions(s.setName('online').setDescription('Rain members whose Discord presence is online.')))
      .addSubcommand((s) => addCommonOptions(s.setName('active').setDescription('Rain members active in this channel recently.'))
        .addIntegerOption((o) => o.setName('activity-minutes').setDescription('Recent activity window').setMinValue(1).setMaxValue(10080)))
      .addSubcommand((s) => addCommonOptions(s.setName('drop').setDescription('Start an interactive drop.'))
        .addStringOption((o) => o.setName('mode').setDescription('How winners enter').setRequired(true).addChoices(
          { name: 'Reaction', value: 'reaction' },
          { name: 'Phrase', value: 'phrase' },
          { name: 'Lottery', value: 'lottery' },
          { name: 'Trivia', value: 'trivia' },
          { name: 'Lucky number', value: 'lucky' }
        ))
        .addIntegerOption((o) => o.setName('duration').setDescription('Entry time in seconds').setMinValue(10).setMaxValue(600))
        .addIntegerOption((o) => o.setName('winners').setDescription('Number of winners').setMinValue(1).setMaxValue(25))
        .addStringOption((o) => o.setName('phrase').setDescription('Claim phrase or trivia question').setMaxLength(80))
        .addStringOption((o) => o.setName('answer').setDescription('Correct trivia answer').setMaxLength(80))
        .addStringOption((o) => o.setName('emoji').setDescription('Unicode or server emoji; default 🌿').setMaxLength(100))
        .addStringOption((o) => o.setName('notify').setDescription('Who to notify when the drop starts; default @here').addChoices(
          { name: '@here', value: 'here' },
          { name: '@everyone', value: 'everyone' },
          { name: 'No mass mention', value: 'none' }
        ))
        .addIntegerOption((o) => o.setName('max-number').setDescription('Lucky-number upper bound').setMinValue(2).setMaxValue(100000))),
    async execute(interaction) {
      const subcommand = interaction.options.getSubcommand(true);
      const payout = await validateAmount(interaction, ctx);
      if (subcommand === 'all') {
        await runImmediate(interaction, ctx, await databaseUsers(ctx.ledger, interaction.user.id), payout, 'Rain All', 'rainAll');
        return;
      }
      if (subcommand === 'online') {
        await interaction.guild.members.fetch({ withPresences: true });
        await runImmediate(interaction, ctx, onlineGuildUsers(interaction), payout, 'Online Rain', 'rainOnline');
        return;
      }
      if (subcommand === 'active') {
        const minutes = interaction.options.getInteger('activity-minutes') ?? DEFAULT_ACTIVITY_MINUTES;
        const users = ctx.activityTracker.activeUsers(interaction.guildId, interaction.channelId, minutes);
        await runImmediate(interaction, ctx, users, payout, 'Active Rain', 'rainActive');
        return;
      }
      await startDrop(interaction, ctx, payout, interaction.options.getString('mode', true));
    }
  };
}
