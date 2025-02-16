// events/interactionCreate.js

const { Events } = require('discord.js');

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction) {
    // Verifica si es un slash command
    if (!interaction.isChatInputCommand()) return;

    // Busca el comando en la colección
    const command = interaction.client.commands.get(interaction.commandName);
    if (!command) return;

    try {
      // Ejecuta la lógica del comando
      await command.execute(interaction);
    } catch (error) {
      console.error(error);
      await interaction.reply({
        content: 'Hubo un error al ejecutar el comando.',
        ephemeral: true
      });
    }
  },
};
