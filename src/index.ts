import 'dotenv/config';
import {
  Client,
  Events,
  GatewayIntentBits,
  InteractionType,
} from 'discord.js';
import { connectDatabase } from './database/connection';
import { handleGuildMemberUpdate } from './events/guildMemberUpdate';
import { handleDirectMessage, handleRecruitmentChannelMessage } from './events/messageCreate';
import { handleJoinCommand, handleJoinModalSubmit } from './commands/join';
import { handleSetupCommand, handleSetupModalSubmit, handleSetupSelectMenu } from './commands/setup';
import { handleSyncCommand } from './commands/sync';
import { handlePendingPlayersCommand } from './commands/pendingPlayers';
import { handleManualIncludeCommand } from './commands/manualInclude';

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
    GatewayIntentBits.MessageContent,
  ],
});

client.once(Events.ClientReady, async (c) => {
  console.log(`Bot conectado como ${c.user.tag} (Esgoto do WvW)`);
  await c.user.setUsername('Esgoto do WvW').catch(() => {});
});

client.on(Events.GuildMemberUpdate, (oldMember, newMember) => {
  handleGuildMemberUpdate(oldMember, newMember).catch(console.error);
});

client.on(Events.MessageCreate, (message) => {
  handleDirectMessage(message).catch(console.error);
  handleRecruitmentChannelMessage(message).catch(console.error);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'entrar') {
      await handleJoinCommand(interaction);
      return;
    }
    if (interaction.commandName === 'configurar') {
      await handleSetupCommand(interaction);
      return;
    }
    if (interaction.commandName === 'atualizar') {
      await handleSyncCommand(interaction);
      return;
    }
    if (interaction.commandName === 'jogadores-pendente') {
      await handlePendingPlayersCommand(interaction);
      return;
    }
    if (interaction.commandName === 'inclusão-manual') {
      await handleManualIncludeCommand(interaction);
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
  if (interaction.isStringSelectMenu()) {
    const handled = await handleSetupSelectMenu(interaction);
    if (handled) return;
  }
});

async function main() {
  await connectDatabase(MONGODB_URI);
  await client.login(DISCORD_TOKEN);
}

main().catch(console.error);
