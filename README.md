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

## Jobs

Scripts que podem ser executados fora do bot (ex.: via cron):

- **Sincronizar membros das guilds** — Conecta no MongoDB, busca todas as guilds, consulta a API do GW2 para cada uma e faz upsert na collection `guild_members` (mesmo fluxo do `/setup`):

  ```bash
  npm run job:sync-members
  ```

  Requer `MONGODB_URI` no `.env`. Guildas com API key inválida ou restrita aparecem no resumo com erro.

- **Notificar membros sem WvW** — Busca todas as guilds, filtra em `guild_members` os que têm `discord_user` preenchido e `wvw_member: false`, e envia uma DM para cada um avisando que não atribuíram a guilda como guilda de WvW:

  ```bash
  npm run job:notify-wvw
  ```

  Requer `DISCORD_TOKEN` e `MONGODB_URI` no `.env`. Usuários com DMs desativadas ou que bloquearam o bot aparecem como falha no resumo.

## Comandos

- **/setup** — Configura o nome da guilda e a chave de API do Guild Wars 2 para o servidor. Primeiro é exibido um **dropdown com todos os canais de texto** para escolher o canal de notificações; em seguida abre o modal para nome da guilda e chave de API. Só funciona com chave de líder da guilda. Cria/atualiza a guilda (incluindo `notify_channel`) e sincroniza os membros da API.
- **/join** — Abre um modal para informar ou atualizar seu ID de jogo (ex.: Nome.1234) neste servidor. Só funciona se o servidor já tiver uma guilda configurada via `/setup`.

## Comportamento

- **Ao entrar no servidor**: Se existir uma guilda configurada para aquele servidor Discord, o bot envia uma DM pedindo o ID de jogo. Quando o usuário responde no privado com o ID (formato Nome.1234), o bot grava em `guild_members` com status PENDING.
- **/join**: Abre um modal com o ID de jogo atual (se houver) e permite criar ou atualizar, deixando o status como PENDING.
- **/setup**: Ao usar o comando, primeiro aparece um **dropdown com todos os canais de texto** do servidor para selecionar o canal de notificações. Após escolher o canal, abre o modal com nome da guilda e chave de API. Valida na API do GW2 (busca guilda e lista de membros). Em caso de “access restricted to guild leaders”, exibe o erro. Em sucesso, salva a guilda (com **notify_channel**) e faz batch upsert dos membros em `guild_members`.

## Estrutura

- `src/jobs/` — Jobs (sync-guild-members para sincronizar membros com a API; notify-wvw-members para avisar quem não atribuiu a guilda como WvW).
- `src/models/` — Schemas Mongoose (Guild com `guild_id`, `discord_server_id`, `name`, `api_key`, `notify_channel`; GuildMember).
- `src/events/` — guildMemberAdd, messageCreate (DM para receber ID do jogo).
- `src/commands/` — join, setup (slash + modals + dropdown de canal de notificações).
- `src/services/` — Chamadas à API do Guild Wars 2 (busca de guilda, lista de membros).
- `src/database/` — Conexão MongoDB.
