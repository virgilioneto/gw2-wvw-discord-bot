import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { joinCommand } from './commands/join';
import { setupCommand } from './commands/setup';
import { syncCommand } from './commands/sync';
import { pendingPlayersCommand } from './commands/pendingPlayers';
import { manualIncludeCommand } from './commands/manualInclude';

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

if (!DISCORD_TOKEN || !CLIENT_ID) {
  console.error('Defina DISCORD_TOKEN e CLIENT_ID no .env');
  process.exit(1);
}

const commands = [joinCommand, setupCommand, syncCommand, pendingPlayersCommand, manualIncludeCommand];
const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);

async function deploy() {
  try {
    console.log('Registrando comandos...');
    await rest.put(Routes.applicationCommands(CLIENT_ID as string), { body: commands });
    console.log('Comandos registrados com sucesso.');
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}

deploy();
