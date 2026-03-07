# Esgoto do WvW

Bot do Discord para integração com guildas do Guild Wars 2 (WvW). Desenvolvido em Node.js com TypeScript, Discord.js e MongoDB (Mongoose).

## Requisitos

- Node.js 18+
- MongoDB
- Conta Discord com um Application/Bot

## Configuração

1. Clone o repositório e instale as dependências:

   ```bash
   npm install
   ```

2. Copie o arquivo de ambiente e preencha as variáveis:

   ```bash
   cp .env.example .env
   ```

   No `.env`:

   - **DISCORD_TOKEN**: Token do bot (Developer Portal → Application → Bot → Reset Token / Copy).
   - **CLIENT_ID**: Application ID do bot (Developer Portal → Application → Application ID).
   - **MONGODB_URI**: URI de conexão do MongoDB (ex.: `mongodb://localhost:27017/gw2-wvw-bot`).

3. No [Discord Developer Portal](https://discord.com/developers/applications), na sua Application:
   - Em **Bot**, ative **Privileged Gateway Intents** → **SERVER MEMBERS INTENT** (necessário para o evento “usuário entrou no servidor”).
   - Convide o bot ao servidor usando OAuth2 → URL Generator, escopo **bot**, permissões conforme necessário (ex.: Enviar mensagens, Gerenciar servidor se for admin).

4. Registre os comandos slash (execute uma vez ou após alterar comandos):

   ```bash
   npm run deploy
   ```

5. Inicie o bot:

   ```bash
   npm run dev
   ```

   Ou em produção:

   ```bash
   npm run build && npm start
   ```

## Comandos

- **/setup** — Configura o nome da guilda e a chave de API do Guild Wars 2 para o servidor. Só funciona com chave de líder da guilda. Cria/atualiza a guilda e sincroniza os membros da API.
- **/join** — Abre um modal para informar ou atualizar seu ID de jogo (ex.: Nome.1234) neste servidor. Só funciona se o servidor já tiver uma guilda configurada via `/setup`.

## Comportamento

- **Ao entrar no servidor**: Se existir uma guilda configurada para aquele servidor Discord, o bot envia uma DM pedindo o ID de jogo. Quando o usuário responde no privado com o ID (formato Nome.1234), o bot grava em `guild_members` com status PENDING.
- **/join**: Abre um modal com o ID de jogo atual (se houver) e permite criar ou atualizar, deixando o status como PENDING.
- **/setup**: Abre um modal com nome da guilda e chave de API. Valida na API do GW2 (busca guilda e lista de membros). Em caso de “access restricted to guild leaders”, exibe o erro. Em sucesso, salva a guilda e faz batch upsert dos membros em `guild_members`.

## Estrutura

- `src/models/` — Schemas Mongoose (Guild, GuildMember).
- `src/events/` — guildMemberAdd, messageCreate (DM para receber ID do jogo).
- `src/commands/` — join, setup (slash + modals).
- `src/services/` — Chamadas à API do Guild Wars 2 (busca de guilda, lista de membros).
- `src/database/` — Conexão MongoDB.
