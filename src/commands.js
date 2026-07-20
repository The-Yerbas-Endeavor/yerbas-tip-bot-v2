import { SlashCommandBuilder } from 'discord.js';
import packageJson from '../package.json' with { type: 'json' };

export const commands = [
  {
    data: new SlashCommandBuilder()
      .setName('ping')
      .setDescription('Check whether the Yerbas Tip Bot is online.'),
    async execute(interaction) {
      await interaction.reply({ content: `Pong! ${interaction.client.ws.ping}ms`, ephemeral: true });
    }
  },
  {
    data: new SlashCommandBuilder()
      .setName('version')
      .setDescription('Show Yerbas Tip Bot version information.'),
    async execute(interaction) {
      await interaction.reply({
        content: `Yerbas Tip Bot v2 ${packageJson.version}\nNode.js ${process.version}`,
        ephemeral: true
      });
    }
  },
  {
    data: new SlashCommandBuilder()
      .setName('help')
      .setDescription('Show the currently available bot commands.'),
    async execute(interaction) {
      await interaction.reply({
        content: [
          '**Yerbas Tip Bot v2**',
          '`/ping` — Check bot connectivity',
          '`/version` — Show runtime information',
          '`/help` — Show this help message',
          '',
          'Financial commands are disabled until the wallet and database safety layers are complete.'
        ].join('\n'),
        ephemeral: true
      });
    }
  }
];

export const commandMap = new Map(commands.map((command) => [command.data.name, command]));
