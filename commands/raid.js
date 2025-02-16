// commands/raid.js

const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('raid')
    .setDescription('Crear un grupo para una raid de Destiny 2')
    .addStringOption(option =>
      option
        .setName('nombre')
        .setDescription('Nombre de la raid')
        .setRequired(true)
    ),

  async execute(interaction) {
    const nombreRaid = interaction.options.getString('nombre');
    await interaction.reply(
      `¡Se ha creado un grupo para la raid: **${nombreRaid}**!\n` +
      'Reacciona o responde a este mensaje para unirte.'
    );
  },
};
