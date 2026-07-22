const MIN_ACTIVE_MESSAGES = 2;

export class ActivityTracker {
  constructor() {
    this.messageTimes = new Map();
    this.users = new Map();
  }

  key(guildId, channelId, userId) {
    return `${guildId}:${channelId}:${userId}`;
  }

  record(message) {
    if (!message.inGuild() || message.author.bot) return;
    const key = this.key(message.guildId, message.channelId, message.author.id);
    const times = this.messageTimes.get(key) || [];
    times.push(Date.now());
    this.messageTimes.set(key, times);
    this.users.set(key, message.author);
  }

  recentMessageCount(guildId, channelId, userId, withinMinutes, now = Date.now()) {
    const key = this.key(guildId, channelId, userId);
    const cutoff = now - withinMinutes * 60_000;
    const recent = (this.messageTimes.get(key) || []).filter((timestamp) => timestamp >= cutoff);

    if (recent.length) this.messageTimes.set(key, recent);
    else this.messageTimes.delete(key);

    return recent.length;
  }

  isActive(guildId, channelId, userId, withinMinutes, now = Date.now()) {
    return this.recentMessageCount(guildId, channelId, userId, withinMinutes, now) >= MIN_ACTIVE_MESSAGES;
  }

  activeUsers(guildId, channelId, withinMinutes, now = Date.now()) {
    const prefix = `${guildId}:${channelId}:`;
    const users = [];

    for (const key of [...this.messageTimes.keys()]) {
      if (!key.startsWith(prefix)) continue;
      const userId = key.slice(prefix.length);
      if (this.recentMessageCount(guildId, channelId, userId, withinMinutes, now) < MIN_ACTIVE_MESSAGES) continue;
      const user = this.users.get(key);
      if (user && !user.bot) users.push(user);
    }

    return users;
  }
}
