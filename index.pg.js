const { Client, GatewayIntentBits, Partials, EmbedBuilder } = require('discord.js');
const { Pool } = require('pg');
require('dotenv').config();

const STATUS_FILE = './status.json';

const submissionChannelId = process.env.SUBMISSION_CHANNEL_ID;
const confirmationChannelId = process.env.CONFIRMATION_CHANNEL_ID;
const countdownChannelId = process.env.COUNTDOWN_CHANNEL_ID;

const ADMIN_ID = '103524746192248832';
const VOTE_EMOJI = 'bappotech';
const VOTE_EMOJI_ID = '1256552383631331449';

// === PostgreSQL Setup ===
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// === Submission/Voting Deadlines ===
const launchDate = new Date(); // starts now
const submissionDeadline = new Date(launchDate.getTime() + 7 * 24 * 60 * 60 * 1000);
const votingDeadline = new Date(launchDate.getTime() + 10 * 24 * 60 * 60 * 1000);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions
  ],
  partials: [Partials.Channel, Partials.Message, Partials.Reaction]
});

// === PostgreSQL Functions ===
async function loadSubmissions() {
  const result = await pool.query('SELECT * FROM submissions');
  return result.rows;
}

async function saveSubmission(userId, outfitData) {
  await pool.query(
    'INSERT INTO submissions (user_id, outfit_data) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET outfit_data = $2',
    [userId, outfitData]
  );
}

// === Bot Event Handlers ===
client.on('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  if (message.channel.type !== 1 || message.author.bot) return;

  const now = new Date();
  if (now > submissionDeadline) {
    return message.reply('❌ Submissions are closed.');
  }

  const outfitData = {
    userId: message.author.id,
    content: message.content,
    attachments: message.attachments.map(a => a.url),
    timestamp: new Date().toISOString()
  };

  await saveSubmission(message.author.id, outfitData);
  message.reply('✅ Submission received!');
});

// === Login Bot ===
client.login(process.env.TOKEN);
