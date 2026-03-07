import 'dotenv/config';
import {
  Client,
  Events,
  GatewayIntentBits,
  REST,
  Routes,
  Collection,
  InteractionType,
} from 'discord.js';
import { connectDatabase } from './database/connection';
import { handleGuildMemberAdd } from './events/guildMemberAdd';
import { handleDirectMessage } from './events/messageCreate';
import { joinCommand, handleJoinCommand, handleJoinModalSubmit } from './commands/join';
import { setupCommand, handleSetupCommand, handleSetupModalSubmit } from './commands/setup';

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/gw2-wvw-bot';

if (!DISCORD_TOKEN) {
  console.error('Defina DISCORD_TOKEN no .env');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMessages,
  ],
});

client.once(Events.ClientReady, async (c) => {
  console.log(`Bot conectado como ${c.user.tag} (Esgoto do WvW)`);
  await c.user.setUsername('Esgoto do WvW').catch(() => {});
});

client.on(Events.GuildMemberAdd, (member) => {
  handleGuildMemberAdd(member).catch(console.error);
});

client.on(Events.MessageCreate, (message) => {
  handleDirectMessage(message).catch(console.error);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'join') {
      await handleJoinCommand(interaction);
      return;
    }
    if (interaction.commandName === 'setup') {
      await handleSetupCommand(interaction);
      return;
    }
  }
  if (interaction.type === InteractionType.ModalSubmit) {
    if (interaction.customId === 'join_modal') {
      await handleJoinModalSubmit(interaction);
      return;
    }
    if (interaction.customId === 'setup_modal') {
      await handleSetupModalSubmit(interaction);
      return;
    }
  }
});

async function main() {
  await connectDatabase(MONGODB_URI);
  await client.login(DISCORD_TOKEN);
}

main().catch(console.error);
