require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Events
} = require('discord.js');

// Variables de entorno
const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;

// Creamos el cliente con intents mínimos para slash commands
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

// Lista de actividades (raids/mazmorras)
const RAIDS_MAZMORRAS = [
  "Último deseo",
  "Jardin de la salvación",
  "Cripta de la piedra profunda",
  "Cámara de cristal",
  "Voto del testiculo",
  "Caida del rey",
  "Raiz de las quesadillas",
  "Borde de la salvación"
];

// Mapa para raids activas:
// clave = messageId
// valor = {
//   activity: string,
//   finishTime: Date,        // Momento en que inicia la actividad
//   interval: NodeJS.Timer,  // Intervalo para actualizar cada minuto
//   participants: string[],  // IDs de usuarios que se unieron
//   creator: string          // ID del creador del evento
// }
const activeRaids = new Map();

/**
 * Definimos /raid con 3 opciones:
 *  - actividad (string, autocompletado)
 *  - horas (integer)
 *  - minutos (integer)
 */
const raidCommand = new SlashCommandBuilder()
  .setName('raid')
  .setDescription('Crear una actividad de Destiny 2 que comienza en X horas y Y minutos')
  .addStringOption(opt =>
    opt
      .setName('actividad')
      .setDescription('Escribe o selecciona la actividad')
      .setAutocomplete(true)
      .setRequired(true)
  )
  .addIntegerOption(opt =>
    opt
      .setName('horas')
      .setDescription('Ingresa la cantidad de horas (0-23)')
      .setRequired(true)
  )
  .addIntegerOption(opt =>
    opt
      .setName('minutos')
      .setDescription('Ingresa la cantidad de minutos (0-59)')
      .setRequired(true)
  );

// Al iniciar el bot, registramos /raid en la guild
client.once(Events.ClientReady, async () => {
  console.log(`Bot listo como: ${client.user.tag}`);

  const rest = new REST({ version: '10' }).setToken(token);
  try {
    await rest.put(
      Routes.applicationGuildCommands(clientId, guildId),
      { body: [raidCommand.toJSON()] }
    );
    console.log('Comando "/raid" registrado correctamente.');
  } catch (error) {
    console.error('Error al registrar comando:', error);
  }
});

// Manejo de interacciones
client.on(Events.InteractionCreate, async interaction => {
  // a) Autocompletado de "actividad"
  if (interaction.isAutocomplete()) {
    if (interaction.commandName === 'raid') {
      const focused = interaction.options.getFocused(true);
      if (focused.name === 'actividad') {
        const query = focused.value.toLowerCase();
        const filtered = RAIDS_MAZMORRAS.filter(item =>
          item.toLowerCase().includes(query)
        );
        // Máx 25 sugerencias
        await interaction.respond(
          filtered.slice(0, 25).map(act => ({ name: act, value: act }))
        );
      }
    }
  }

  // b) Slash command /raid
  else if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'raid') {
      // Verificar que el usuario no tenga ya una raid activa
      const userHasActiveRaid = Array.from(activeRaids.values()).some(
        raid => raid.creator === interaction.user.id
      );
      if (userHasActiveRaid) {
        return interaction.reply({
          content: 'Ya tienes una raid activa. Cancela la anterior para crear una nueva.',
          ephemeral: true
        });
      }

      const actividad = interaction.options.getString('actividad');
      const horas = interaction.options.getInteger('horas');
      const minutos = interaction.options.getInteger('minutos');

      // Validamos los valores
      if (horas < 0 || minutos < 0 || minutos > 59) {
        return interaction.reply('Valores de horas/minutos inválidos.');
      }
      const totalMin = horas * 60 + minutos;

      // Calculamos el momento en que inicia la actividad
      const now = new Date();
      const finishTime = new Date(now.getTime() + totalMin * 60_000);

      // Botones "Unirme", "Salir" y "Cancelar"
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('joinRaid')
          .setLabel('Unirme')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('leaveRaid')
          .setLabel('Salir')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId('cancelRaid')
          .setLabel('Cancelar')
          .setStyle(ButtonStyle.Danger)
      );

      // Mensaje inicial
      const message = await interaction.reply({
        content: generarMensaje(actividad, finishTime, []),
        components: [row],
        fetchReply: true,
      });

      // Guardamos en el mapa incluyendo el ID del creador
      activeRaids.set(message.id, {
        activity: actividad,
        finishTime,
        interval: null,
        participants: [],
        creator: interaction.user.id,
      });

      // Configuramos un intervalo que actualiza el mensaje cada minuto
      const raidData = activeRaids.get(message.id);
      raidData.interval = setInterval(() => {
        // Si ya no existe en el mapa, paramos
        if (!activeRaids.has(message.id)) {
          clearInterval(raidData.interval);
          return;
        }
        // Si falla (mensaje borrado), paramos
        updateRaidMessage(message, raidData).catch(() => {
          clearInterval(raidData.interval);
          activeRaids.delete(message.id);
        });
      }, 60_000);
    }
  }

  // c) Botones
  else if (interaction.isButton()) {
    const raidData = activeRaids.get(interaction.message.id);
    if (!raidData) {
      return interaction.deferUpdate();
    }

    // Botón "Unirme"
    if (interaction.customId === 'joinRaid') {
      if (raidData.participants.includes(interaction.user.id)) {
        return interaction.deferUpdate();
      }
      // Ahora el cupo máximo es de 3
      if (raidData.participants.length >= 3) {
        return interaction.deferUpdate();
      }
      raidData.participants.push(interaction.user.id);
      await updateRaidMessage(interaction.message, raidData);
      return interaction.deferUpdate();
    }

    // Botón "Salir"
    if (interaction.customId === 'leaveRaid') {
      if (!raidData.participants.includes(interaction.user.id)) {
        return interaction.deferUpdate();
      }
      raidData.participants = raidData.participants.filter(u => u !== interaction.user.id);
      await updateRaidMessage(interaction.message, raidData);
      return interaction.deferUpdate();
    }

    // Botón "Cancelar" (solo para el creador)
    if (interaction.customId === 'cancelRaid') {
      if (interaction.user.id !== raidData.creator) {
        return interaction.reply({
          content: 'Solo el creador del evento puede cancelar el raid.',
          ephemeral: true
        });
      }
      // Cancelamos el raid
      clearInterval(raidData.interval);
      activeRaids.delete(interaction.message.id);

      // Deshabilitamos todos los botones y actualizamos el mensaje
      const disabledRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('joinRaid')
          .setLabel('Unirme')
          .setStyle(ButtonStyle.Primary)
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId('leaveRaid')
          .setLabel('Salir')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId('cancelRaid')
          .setLabel('Cancelar')
          .setStyle(ButtonStyle.Danger)
          .setDisabled(true)
      );
      await interaction.message.edit({
        content: 'La raid ha sido cancelado por el creador.',
        components: [disabledRow]
      });
      return interaction.reply({ content: 'Has cancelado el raid.', ephemeral: true });
    }
  }
});

/**
 * Genera el texto del mensaje mientras la raid está pendiente:
 * - Muestra la actividad.
 * - Indica "Comienza en X horas y Y minutos".
 * - Lista de participantes.
 */
function generarMensaje(actividad, finishTime, participants) {
  const now = new Date();
  let diffMs = finishTime - now;
  if (diffMs < 0) diffMs = 0; // si ya se pasó, 0

  const diffMin = Math.floor(diffMs / 60_000);
  const hrs = Math.floor(diffMin / 60);
  const mins = diffMin % 60;

  let status = '';
  if (diffMin === 0) {
    // Nota: esta función se usa solo para el estado pendiente.
    status = '¡La actividad ha comenzado!';
  } else {
    const partes = [];
    if (hrs > 0) partes.push(`${hrs} horas`);
    if (mins > 0) partes.push(`${mins} minutos`);
    status = `Comienza en ${partes.join(' y ')}.`;
  }

  let content = `**${actividad}**\n${status}\n`;
  if (participants.length > 0) {
    // Ajustado el máximo a 3
    content += `Participantes (${participants.length}/6):\n`;
    content += participants.map((u, i) => `${i + 1}. <@${u}>`).join('\n');
  } else {
    content += 'Aún no hay participantes.';
  }
  return content;
}

/**
 * Actualiza el mensaje principal cada minuto.
 * Al alcanzar finishTime se actúa de la siguiente forma:
 * - Si hay menos de 3 participantes, se cancela la raid y se muestra un mensaje de cancelación.
 * - Si hay 3 participantes, se envía un mensaje al canal mencionándolos y se envían notificaciones DM.
 */
async function updateRaidMessage(message, raidData) {
  const now = new Date();
  if (now >= raidData.finishTime) {
    clearInterval(raidData.interval);
    raidData.interval = null;

    let content = "";
    // Ajustamos el mínimo a 3
    if (raidData.participants.length < 3) {
      // Cancelamos la raid por falta de participantes
      content = `**${raidData.activity}**\n\n**Cancelado:** La raid fue cancelada por falta de participantes (${raidData.participants.length}/6).`;
    } else {
      // Raid válida: enviamos notificaciones
      content = generarMensaje(raidData.activity, raidData.finishTime, raidData.participants);

      // 1) Mensaje público mencionando a los participantes
      await message.channel.send(
        `¡La raid **${raidData.activity}** ha comenzado! ` +
        raidData.participants.map(id => `<@${id}>`).join(' ')
      );

      // 2) DM a cada participante
      for (const participantId of raidData.participants) {
        client.users.fetch(participantId)
          .then(user => {
            return user.send(`¡La raid **${raidData.activity}** ha comenzado!`);
          })
          .catch(err => console.error(`Error enviando DM a ${participantId}: `, err));
      }

      // 3) DM al creador (si no está en la lista de participantes)
      if (!raidData.participants.includes(raidData.creator)) {
        client.users.fetch(raidData.creator)
          .then(user => {
            return user.send(`¡La raid **${raidData.activity}** ha comenzado!`);
          })
          .catch(err => console.error(`Error enviando DM al creador ${raidData.creator}: `, err));
      }
    }

    // Actualizamos el mensaje final (sin botones) y removemos la raid del mapa
    await message.edit({
      content,
      components: []
    });
    activeRaids.delete(message.id);
    return;
  }

  // Si aún no llega la hora, se sigue actualizando el conteo
  const content = generarMensaje(raidData.activity, raidData.finishTime, raidData.participants);
  await message.edit({
    content,
    components: message.components,
  });
}

client.login(token);
