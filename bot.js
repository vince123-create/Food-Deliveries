const { Client, GatewayIntentBits, EmbedBuilder, REST, Routes, SlashCommandBuilder } = require('discord.js');
const fs = require('fs');

const SCHEDULE_FILE = './schedule.json';
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

function loadSchedule() {
  if (!fs.existsSync(SCHEDULE_FILE)) return null;
  return JSON.parse(fs.readFileSync(SCHEDULE_FILE));
}

function saveSchedule(schedule) {
  fs.writeFileSync(SCHEDULE_FILE, JSON.stringify(schedule, null, 2));
}

function toMins(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function fmt12(t) {
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return m === 0 ? `${h12}:00 ${ampm}` : `${h12}:${String(m).padStart(2,'0')} ${ampm}`;
}

function isOpenNow(schedule) {
  const now = new Date();
  const day = now.getDay();
  const mins = now.getHours() * 60 + now.getMinutes();
  const s = schedule[day];
  return s.open && mins >= toMins(s.start) && mins < toMins(s.end);
}

function buildStatusEmbed(schedule) {
  const now = new Date();
  const day = now.getDay();
  const mins = now.getHours() * 60 + now.getMinutes();
  const open = isOpenNow(schedule);
  const today = schedule[day];

  let nextEvent = '';
  if (open) {
    nextEvent = `Closes at **${fmt12(today.end)}**`;
  } else {
    for (let i = 1; i <= 7; i++) {
      const di = (day + i) % 7;
      if (schedule[di].open) {
        const label = i === 1 ? 'Tomorrow' : DAYS[di];
        nextEvent = `Opens **${label}** at **${fmt12(schedule[di].start)}**`;
        break;
      }
    }
    if (!nextEvent) nextEvent = 'No upcoming hours set';
  }

  const weekSchedule = schedule.map(s => {
    if (!s.open) return `${s.day}: Closed`;
    return `${s.day}: ${fmt12(s.start)} – ${fmt12(s.end)}`;
  }).join('\n');

  const embed = new EmbedBuilder()
    .setTitle(open ? '🟢 Delivery Service — OPEN' : '🔴 Delivery Service — CLOSED')
    .setColor(open ? 0x1a7a4a : 0xc0392b)
    .setDescription(open
      ? `Deliveries are **available now!**\n${nextEvent}`
      : `Deliveries are currently **unavailable**.\n${nextEvent}`)
    .addFields({ name: 'Weekly Schedule', value: '```\n' + weekSchedule + '\n```' })
    .setFooter({ text: 'Delivery Service • Updates automatically' })
    .setTimestamp();

  return embed;
}

async function notifyDiscord(isOpen, schedule) {
  try {
    const channel = await client.channels.fetch(process.env.DISCORD_CHANNEL_ID);
    if (!channel) return;
    const embed = buildStatusEmbed(schedule);
    await channel.send({ embeds: [embed] });
  } catch (err) {
    console.error('Discord notify error:', err);
  }
}

let lastOpenState = null;

function startScheduleWatcher() {
  setInterval(() => {
    const schedule = loadSchedule();
    if (!schedule) return;
    const open = isOpenNow(schedule);
    if (lastOpenState === null) { lastOpenState = open; return; }

    if (open !== lastOpenState) {
      lastOpenState = open;
      notifyDiscord(open, schedule);

      if (!open) return;
      const now = new Date();
      const day = now.getDay();
      const today = schedule[day];
      const minsLeft = toMins(today.end) - (now.getHours() * 60 + now.getMinutes());
      if (minsLeft <= 30 && minsLeft > 0) {
        setTimeout(async () => {
          try {
            const channel = await client.channels.fetch(process.env.DISCORD_CHANNEL_ID);
            if (channel) {
              await channel.send({
                embeds: [new EmbedBuilder()
                  .setTitle('⏰ Closing Soon')
                  .setColor(0xf39c12)
                  .setDescription(`Deliveries closing in **${minsLeft} minutes** at **${fmt12(today.end)}**`)
                  .setTimestamp()]
              });
            }
          } catch(e) {}
        }, (minsLeft - 30) * 60 * 1000);
      }
    }
  }, 60 * 1000);
}

const commands = [
  new SlashCommandBuilder()
    .setName('status')
    .setDescription('Check current delivery status'),
  new SlashCommandBuilder()
    .setName('schedule')
    .setDescription('Show this week\'s delivery schedule'),
  new SlashCommandBuilder()
    .setName('sethours')
    .setDescription('Set delivery hours for a day')
    .addStringOption(o => o.setName('day').setDescription('Day (mon, tue, wed...)').setRequired(true))
    .addStringOption(o => o.setName('open').setDescription('Open time (e.g. 08:00)').setRequired(true))
    .addStringOption(o => o.setName('close').setDescription('Close time (e.g. 18:00)').setRequired(true)),
  new SlashCommandBuilder()
    .setName('close')
    .setDescription('Mark a day as closed')
    .addStringOption(o => o.setName('day').setDescription('Day (mon, tue, wed...)').setRequired(true)),
].map(c => c.toJSON());

client.once('ready', async () => {
  console.log(`Bot logged in as ${client.user.tag}`);
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('Slash commands registered');
  } catch (err) {
    console.error('Error registering commands:', err);
  }
  startScheduleWatcher();
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const schedule = loadSchedule();

  if (interaction.commandName === 'status') {
    const embed = buildStatusEmbed(schedule);
    await interaction.reply({ embeds: [embed] });
  }

  if (interaction.commandName === 'schedule') {
    const lines = schedule.map(s => {
      if (!s.open) return `**${s.day}**: Closed`;
      return `**${s.day}**: ${fmt12(s.start)} – ${fmt12(s.end)}`;
    }).join('\n');
    const embed = new EmbedBuilder()
      .setTitle('📅 Weekly Delivery Schedule')
      .setColor(0x378add)
      .setDescription(lines)
      .setTimestamp();
    await interaction.reply({ embeds: [embed] });
  }

  if (interaction.commandName === 'sethours') {
    const dayInput = interaction.options.getString('day').toLowerCase();
    const openTime = interaction.options.getString('open');
    const closeTime = interaction.options.getString('close');
    const idx = DAYS.findIndex(d => d.toLowerCase().startsWith(dayInput));
    if (idx === -1) return interaction.reply({ content: 'Invalid day. Use: sun, mon, tue, wed, thu, fri, sat', ephemeral: true });
    schedule[idx].open = true;
    schedule[idx].start = openTime;
    schedule[idx].end = closeTime;
    saveSchedule(schedule);
    await interaction.reply({
      embeds: [new EmbedBuilder()
        .setTitle('✅ Schedule Updated')
        .setColor(0x1a7a4a)
        .setDescription(`**${DAYS[idx]}** set to ${fmt12(openTime)} – ${fmt12(closeTime)}`)
        .setTimestamp()]
    });
  }

  if (interaction.commandName === 'close') {
    const dayInput = interaction.options.getString('day').toLowerCase();
    const idx = DAYS.findIndex(d => d.toLowerCase().startsWith(dayInput));
    if (idx === -1) return interaction.reply({ content: 'Invalid day. Use: sun, mon, tue, wed, thu, fri, sat', ephemeral: true });
    schedule[idx].open = false;
    saveSchedule(schedule);
    await interaction.reply({
      embeds: [new EmbedBuilder()
        .setTitle('🔴 Day Closed')
        .setColor(0xc0392b)
        .setDescription(`**${DAYS[idx]}** marked as closed`)
        .setTimestamp()]
    });
  }
});

client.login(process.env.DISCORD_TOKEN);

module.exports = { notifyDiscord };
