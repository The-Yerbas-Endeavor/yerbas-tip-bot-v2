const CUSTOM_EMOJI_PATTERN = /^<(?<animated>a?):(?<name>[A-Za-z0-9_]{2,32}):(?<id>\d{17,20})>$/;

export async function resolveReactionEmoji(interaction, input, fallback = '🌿') {
  const raw = String(input || fallback).trim();
  if (!raw) throw new Error('Reaction emoji cannot be empty');

  const custom = raw.match(CUSTOM_EMOJI_PATTERN);
  if (!custom) {
    return {
      display: raw,
      reaction: raw,
      matches: (reaction) => reaction.emoji.id === null && reaction.emoji.name === raw
    };
  }

  const emojiId = custom.groups.id;
  let guildEmoji = interaction.guild.emojis.cache.get(emojiId);
  if (!guildEmoji) {
    try {
      guildEmoji = await interaction.guild.emojis.fetch(emojiId);
    } catch {
      guildEmoji = null;
    }
  }

  if (!guildEmoji || !guildEmoji.available) {
    throw new Error('That server emoji is unavailable or does not belong to this server');
  }

  return {
    display: guildEmoji.toString(),
    reaction: guildEmoji,
    matches: (reaction) => reaction.emoji.id === guildEmoji.id
  };
}
