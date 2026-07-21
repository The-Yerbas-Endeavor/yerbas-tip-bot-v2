export class ActivityTracker {
  constructor() {
    this.lastMessageAt = new Map();
    this.users = new Map();
  }

  key(guildId, channelId, userId) {
    return `${guildId}:${channelId}:${userId}`;
  }

  record(message) {
    if (!message.inGuild() || message.author.bot) return;
    const key = this.key(message.guildId, message.channelId, message.author.id);
    this.lastMessageAt.set(key, Date.now());
    this.users.set(key, message.author);
  }

  isActive(guildId, channelId, userId, withinMinutes, now = Date.now()) {
    const timestamp = this.lastMessageAt.get(this.key(guildId, channelId, userId));
    if (!timestamp) return false;
    return now - timestamp <= withinMinutes * 60_000;
  }

  activeUsers(guildId, channelId, withinMinutes, now = Date.now()) {
    const prefix = `${guildId}:${channelId}:`;
    const users = [];
    for (const [key, timestamp] of this.lastMessageAt.entries()) {
      if (!key.startsWith(prefix) || now - timestamp > withinMinutes * 60_000) continue;
      const user = this.users.get(key);
      if (user && !user.bot) users.push(user);
    }
    return users;
  }
}