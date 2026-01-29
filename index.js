const { Client, GatewayIntentBits, Partials, EmbedBuilder } = require('discord.js');
const fs = require('fs');
require('dotenv').config();

// ================= CONFIG =================

const SUBMISSIONS_FILE = './submissions.json';
const STATUS_FILE = './status.json';

const submissionChannelId = process.env.SUBMISSION_CHANNEL_ID;
const confirmationChannelId = process.env.CONFIRMATION_CHANNEL_ID;

const ADMIN_ID = '103524746192248832';

// Custom emoji
const VOTE_EMOJI = 'bappotech';
const VOTE_EMOJI_ID = '1256552383631331449';

// ==========================================

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

// ================= FILE HELPERS =================

function loadSubmissions() {
  if (!fs.existsSync(SUBMISSIONS_FILE)) fs.writeFileSync(SUBMISSIONS_FILE, '[]');
  return JSON.parse(fs.readFileSync(SUBMISSIONS_FILE));
}

function saveSubmissions(data) {
  fs.writeFileSync(SUBMISSIONS_FILE, JSON.stringify(data, null, 2));
}

function loadStatus() {
  if (!fs.existsSync(STATUS_FILE)) {
    fs.writeFileSync(STATUS_FILE, JSON.stringify({ open: true }, null, 2));
  }
  return JSON.parse(fs.readFileSync(STATUS_FILE));
}

function saveStatus(data) {
  fs.writeFileSync(STATUS_FILE, JSON.stringify(data, null, 2));
}

// ================= ON READY =================

client.on('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

// ================= DM SUBMISSION HANDLER =================

client.on('messageCreate', async (message) => {
  if (message.channel.type !== 1 || message.author.bot) return;

  const status = loadStatus();
  if (!status.open) return message.reply('❌ Submissions are currently closed.');

  const imgurRegex = /(https?:\/\/)?(www\.)?(i\.)?imgur\.com\/[a-zA-Z0-9]+(\.jpg|\.png|\.gif|\.jpeg)?/;
  let imageUrl = null;

  const matches = message.content.match(imgurRegex);
  if (matches) {
    imageUrl = matches[0];
    if (!imageUrl.match(/\.(jpeg|jpg|png|gif)$/)) {
      imageUrl += '.jpeg';
    }
  }

  if (!imageUrl && message.attachments.size > 0) {
    const img = message.attachments.find(a => a.contentType?.startsWith('image'));
    if (img) imageUrl = img.url;
  }

  if (!imageUrl) return message.reply('❌ Please send a valid image.');

  const submissions = loadSubmissions();
  const submissionChannel = await client.channels.fetch(submissionChannelId);

  let existing = submissions.find(s => s.userId === message.author.id);

  if (existing) {
    try {
      const msg = await submissionChannel.messages.fetch(existing.messageId);
      const updatedEmbed = EmbedBuilder.from(msg.embeds[0]).setImage(imageUrl);
      await msg.edit({ embeds: [updatedEmbed] });

      existing.imageUrl = imageUrl;
      saveSubmissions(submissions);

      await message.reply('🔁 Submission updated!');
      const confirmationChannel = await client.channels.fetch(confirmationChannelId);
      await confirmationChannel.send(`🔁 <@${message.author.id}> updated #${existing.id}\n${imageUrl}`);
      return;
    } catch (err) {
      console.error('Update failed:', err);
      return message.reply('❌ Failed to update.');
    }
  }

  const submissionId = submissions.length + 1;
  const embed = new EmbedBuilder()
    .setTitle(`📸 Submission #${submissionId}`)
    .setImage(imageUrl)
    .setColor(0x2f3136)
    .setFooter({ text: 'Vote with :bappotech:' });

  const sent = await submissionChannel.send({ embeds: [embed] });
  await sent.react(`<:${VOTE_EMOJI}:${VOTE_EMOJI_ID}>`);

  submissions.push({
    id: submissionId,
    userId: message.author.id,
    imageUrl,
    messageId: sent.id,
    votes: 0
  });

  saveSubmissions(submissions);
  await message.reply('✅ Submission received!');

  try {
    const confirmationChannel = await client.channels.fetch(confirmationChannelId);
    await confirmationChannel.send(`✅ <@${message.author.id}> submitted #${submissionId}\n${imageUrl}`);
  } catch (err) {
    console.error('Confirmation error:', err);
  }
});

// ================= ONLY ALLOW BAPPOTECH REACTIONS =================

client.on('messageReactionAdd', async (reaction, user) => {
  if (user.bot) return;
  if (reaction.partial) await reaction.fetch();
  if (reaction.message.partial) await reaction.message.fetch();
  if (reaction.message.channel.id !== submissionChannelId) return;

  if (reaction.emoji.id !== VOTE_EMOJI_ID) {
    try {
      await reaction.users.remove(user.id);
    } catch (err) {
      console.error('Failed to remove bad reaction:', err);
    }
  }
});

// ================= !tally =================

client.on('messageCreate', async (message) => {
  if (!message.content.startsWith('!tally') || message.author.bot) return;

  const submissions = loadSubmissions();
  const updated = [];

  for (const sub of submissions) {
    try {
      const msg = await client.channels.fetch(submissionChannelId)
        .then(ch => ch.messages.fetch(sub.messageId));

      const reaction = msg.reactions.cache.find(r => r.emoji.id === VOTE_EMOJI_ID);
      const count = reaction ? reaction.count - 1 : 0;

      sub.votes = count;
      updated.push(sub);
    } catch (err) {
      console.error('Tally error:', err.message);
    }
  }

  saveSubmissions(updated);

  const sorted = [...updated].sort((a, b) => b.votes - a.votes);
  const results = sorted.map(s => `#${s.id}: ${s.votes} vote(s)`).join('\n');

  message.channel.send(`📊 **Vote Results:**\n${results}`);
});

// ================= !winner =================

client.on('messageCreate', async (message) => {
  if (!message.content.startsWith('!winner') || message.author.bot) return;
  if (message.author.id !== ADMIN_ID) return message.reply('❌ Not authorized.');

  const submissions = loadSubmissions();
  if (submissions.length === 0) return message.reply('⚠️ No submissions yet.');

  const sorted = [...submissions].sort((a, b) => b.votes - a.votes);
  const parts = message.content.trim().split(' ');
  const count = parseInt(parts[1]) || 1;

  const winners = sorted.slice(0, count);
  const result = winners.map(w => `🥇 #${w.id} — ${w.votes} votes`).join('\n');

  message.channel.send(`🏆 **Winner${count > 1 ? 's' : ''}:**\n${result}`);

  try {
    const confirm = await client.channels.fetch(confirmationChannelId);
    for (const w of winners) {
      await confirm.send(`🎉 Winner: <@${w.userId}> with Submission #${w.id} (${w.votes} votes)`);
    }
  } catch (err) {
    console.error('Winner notify failed:', err);
  }
});

// ================= !votes =================

client.on('messageCreate', (message) => {
  if (!message.content.startsWith('!votes') || message.author.bot) return;

  const parts = message.content.trim().split(' ');
  const subId = parseInt(parts[1]);
  if (isNaN(subId)) return message.channel.send('❌ Usage: `!votes <submission number>`');

  const submissions = loadSubmissions();
  const sub = submissions.find(s => s.id === subId);
  if (!sub) return message.channel.send(`❌ No submission with ID #${subId}`);

  message.channel.send(`📊 Submission #${subId} has **${sub.votes}** vote(s).`);
});

// ================= !reset =================

client.on('messageCreate', async (message) => {
  if (!message.content.startsWith('!reset') || message.author.bot) return;
  if (message.author.id !== ADMIN_ID) return message.reply('❌ Not authorized.');

  saveSubmissions([]);
  message.channel.send('🧹 Submissions cleared.');
});

// ================= !close =================

client.on('messageCreate', async (message) => {
  if (!message.content.startsWith('!close') || message.author.bot) return;
  if (message.author.id !== ADMIN_ID) return message.reply('❌ Not authorized.');

  saveStatus({ open: false });
  message.channel.send('🔒 Submissions are now CLOSED.');
});

// ================= !open =================

client.on('messageCreate', async (message) => {
  if (!message.content.startsWith('!open') || message.author.bot) return;
  if (message.author.id !== ADMIN_ID) return message.reply('❌ Not authorized.');

  saveStatus({ open: true });
  message.channel.send('🔓 Submissions are now OPEN.');
});

client.login(process.env.DISCORD_TOKEN);
