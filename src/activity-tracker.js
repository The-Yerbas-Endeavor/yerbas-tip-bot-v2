export class ActivityTracker {
  constructor() {
    this.lastMessageAt = new Map();
  }

  key(guildId, channelId, userId) {
    return `${guildId}:${channelId}:${userId}`;
  }

  record(message) {
    if (!message.inGuild() || message.author.bot) return;
    this.lastMessageAt.set(
      this.key(message.guildId, message.channelId, message.author.id),
      Date.now()
    );
  }

  isActive(guildId, channelId, userId, withinMinutes, now = Date.now()) {
    const timestamp = this.lastMessageAt.get(this.key(guildId, channelId, userId));
    if (!timestamp) return false;
    return now - timestamp <= withinMinutes * 60_000;
  }
}
