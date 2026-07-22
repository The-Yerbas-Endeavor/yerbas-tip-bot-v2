import { InteractionContextType, SlashCommandBuilder } from 'discord.js';

export function buildHelpCommand() {
  return {
    data: new SlashCommandBuilder()
      .setName('help')
      .setDescription('Show available bot commands.')
      .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM),
    async execute(interaction) {
      await interaction.reply({
        content: [
          '**Yerbas Tip Bot v2**',
          '`/deposit`, `/balance`, `/withdraw`, `/history` — wallet commands available in DMs and server channels',
          '`/tip` — public server-only YERB tip',
          '`/asset-balance`, `/asset-withdraw` — asset wallet commands available in DMs and server channels',
          '`/asset-tip` — public server-only Yerbas Asset tip',
          '`/rain all`, `/rain online`, `/rain active`, `/rain drop` — YERB rain and interactive drops',
          '`/asset-rain all` — split a Yerbas Asset among registered database members',
          '`/asset-rain online` — split a Yerbas Asset among online, idle, or do-not-disturb members',
          '`/asset-rain active` — split a Yerbas Asset among recently active channel members',
          '`/asset-rain drop` — asset reaction, phrase, lottery, trivia, or lucky-number drop',
          '`/network`, `/ping`, `/version` — status commands',
          'Administrator commands are server-only.'
        ].join('\n'),
        ephemeral: true
      });
    }
  };
}
