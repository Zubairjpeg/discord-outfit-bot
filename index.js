const { Client, GatewayIntentBits, Partials, EmbedBuilder } = require('discord.js');
const fs = require('fs');
require('dotenv').config();

const SUBMISSIONS_FILE = './submissions.json';
const STATUS_FILE = './status.json';

const submissionChannelId = process.env.SUBMISSION_CHANNEL_ID;
const confirmationChannelId = process.env.CONFIRMATION_CHANNEL_ID;
const countdownChannelId = process.env.COUNTDOWN_CHANNEL_ID;

const ADMIN_ID = '103524746192248832';
const VOTE_EMOJI = 'bappotech';
const VOTE_EMOJI_ID = '1256552383631331449';

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

function loadSubmissions() {
  if (!fs.existsSync(SUBMISSIONS_FILE)) fs.writeFileSync(SUBMISSIONS_FILE, '[]');
  return JSON.parse(fs.readFileSync(SUBMISSIONS_FILE));
}

function saveSubmissions(data) {
  fs.writeFileSync(SUBMISSIONS_FILE, JSON.stringify(data, null, 2));
}

function loadStatus() {
  if (!fs.existsSync(STATUS_FILE)) fs.writeFileSync(STATUS_FILE, JSON.stringify({ open: true }, null, 2));
  return JSON.parse(fs.readFileSync(STATUS_FILE));
}

function saveStatus(data) {
  fs.writeFileSync(STATUS_FILE, JSON.stringify(data, null, 2));
}

client.on('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  startCountdown();
});

client.on('messageCreate', async (message) => {
  if (message.channel.type !== 1 || message.author.bot) return;

  const status = loadStatus();
  if (!status.open || new Date() > submissionDeadline) {
    return message.reply('❌ Submissions are currently closed.');
  }

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

client.on('messageReactionAdd', async (reaction, user) => {
  if (user.bot) return;
  if (reaction.partial) await reaction.fetch();
  if (reaction.message.partial) await reaction.message.fetch();
  if (reaction.message.channel.id !== submissionChannelId) return;

  if (reaction.emoji.id !== VOTE_EMOJI_ID) {
    try {
      await reaction.users.remove(user.id);
    } catch (err) {
      console.error('Failed to remove reaction:', err);
    }
  }
});
// ========== BOT COMMANDS ==========

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const submissions = loadSubmissions();

  // !tally
  if (message.content.startsWith('!tally')) {
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
  }

  // !winner
  if (message.content.startsWith('!winner')) {
    if (message.author.id !== ADMIN_ID) return message.reply('❌ Not authorized.');
    const sorted = [...submissions].sort((a, b) => b.votes - a.votes);
    const count = parseInt(message.content.split(' ')[1]) || 1;
    const winners = sorted.slice(0, count);
    const result = winners.map(w => `🥇 #${w.id} — ${w.votes} votes`).join('\n');

    message.channel.send(`🏆 **Winner${count > 1 ? 's' : ''}:**\n${result}`);

    const confirm = await client.channels.fetch(confirmationChannelId);
    for (const w of winners) {
      await confirm.send(`🎉 Winner: <@${w.userId}> with Submission #${w.id} (${w.votes} votes)`);
    }
  }

  // !votes
  if (message.content.startsWith('!votes')) {
    const id = parseInt(message.content.split(' ')[1]);
    const sub = submissions.find(s => s.id === id);
    if (!sub) return message.channel.send(`❌ No submission with ID #${id}`);
    message.channel.send(`📊 Submission #${id} has **${sub.votes}** vote(s).`);
  }

  // !reset
  if (message.content.startsWith('!reset') && message.author.id === ADMIN_ID) {
    saveSubmissions([]);
    message.channel.send('🧹 Submissions cleared.');
  }

  // !close
  if (message.content.startsWith('!close') && message.author.id === ADMIN_ID) {
    saveStatus({ open: false });
    message.channel.send('🔒 Submissions are now CLOSED.');
  }

  // !open
  if (message.content.startsWith('!open') && message.author.id === ADMIN_ID) {
    saveStatus({ open: true });
    message.channel.send('🔓 Submissions are now OPEN.');
  }

  // !countdown - manual command
if (message.content.startsWith('!countdown') && message.author.id === ADMIN_ID) {
  const now = new Date();
  const subsOpen = now < submissionDeadline;
  const voteOpen = now < votingDeadline;

  const subDiff = Math.max(0, submissionDeadline - now);
  const voteDiff = Math.max(0, votingDeadline - now);

  const format = (ms) => {
    const d = Math.floor(ms / (1000 * 60 * 60 * 24));
    const h = Math.floor((ms / (1000 * 60 * 60)) % 24);
    const m = Math.floor((ms / (1000 * 60)) % 60);
    return `${d}d ${h}h ${m}m`;
  };

  const embed = new EmbedBuilder()
    .setTitle('⏳ Outfit Contest Countdown')
    .setColor(0x5865F2)
    .addFields(
      {
        name: '📥 Submissions',
        value: subsOpen
          ? `Closes in: **${format(subDiff)}**`
          : '❌ Closed',
      },
      {
        name: '🗳️ Voting',
        value: voteOpen
          ? `Closes in: **${format(voteDiff)}**`
          : '❌ Closed',
      },
      {
        name: 'Status',
        value: `${subsOpen ? '✅ Submissions Open' : '🔒 Submissions Closed'}\n${voteOpen ? '✅ Voting Open' : '🔒 Voting Closed'}`,
      }
    )
    .setFooter({ text: 'Manually requested' });

  message.channel.send({ embeds: [embed] });
}

});

// ========== COUNTDOWN LOGIC ==========

async function startCountdown() {
  const channel = await client.channels.fetch(countdownChannelId);
  const countdownMessage = await channel.send('⏳ Initializing contest countdown...');

  const interval = setInterval(async () => {
    const now = new Date();
    const subsOpen = now < submissionDeadline;
    const voteOpen = now < votingDeadline;

    const subDiff = Math.max(0, submissionDeadline - now);
    const voteDiff = Math.max(0, votingDeadline - now);

    const format = (ms) => {
      const d = Math.floor(ms / (1000 * 60 * 60 * 24));
      const h = Math.floor((ms / (1000 * 60 * 60)) % 24);
      const m = Math.floor((ms / (1000 * 60)) % 60);
      return `${d}d ${h}h ${m}m`;
    };

    const embed = new EmbedBuilder()
      .setTitle('⏳ Outfit Contest Countdown')
      .setColor(0x5865F2)
      .addFields(
        {
          name: '📥 Submissions',
          value: subsOpen
            ? `Closes in: **${format(subDiff)}**`
            : '❌ Closed',
        },
        {
          name: '🗳️ Voting',
          value: voteOpen
            ? `Closes in: **${format(voteDiff)}**`
            : '❌ Closed',
        },
        {
          name: 'Status',
          value: `${subsOpen ? '✅ Submissions Open' : '🔒 Submissions Closed'}\n${voteOpen ? '✅ Voting Open' : '🔒 Voting Closed'}`,
        }
      )
      .setFooter({ text: 'Updated every 10 minutes' });

    try {
      await countdownMessage.edit({ embeds: [embed] });
    } catch (e) {
      console.error('Countdown update failed:', e.message);
    }

    // Auto-close logic
    const status = loadStatus();
    if (!subsOpen && status.open) {
      saveStatus({ open: false });
      console.log('🔒 Auto-closed submissions (deadline reached)');
    }

    if (!subsOpen && !voteOpen) {
      clearInterval(interval); // stop timer once both phases are closed
      console.log('✅ Contest fully closed');
    }
  }, 10 * 60 * 1000); // every 10 minutes
}

client.login(process.env.DISCORD_TOKEN);
