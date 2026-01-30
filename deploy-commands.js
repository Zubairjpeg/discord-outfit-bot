const { REST, Routes, SlashCommandBuilder } = require('discord.js');
require('dotenv').config();

const commands = [
  new SlashCommandBuilder()
    .setName('submissions')
    .setDescription('View all submissions (admin only)')
    .toJSON()
];

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log('Registering commands...');
    await rest.put(Routes.applicationCommands('1115411428589969408'), { body: commands });
    console.log('✅ Registered!');
  } catch (error) {
    console.error('❌ Error:', error);
  }
})();
