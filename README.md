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

| Comando | Descrição | Quem pode usar |
|--------|-----------|----------------|
| **/setup** | Configura o nome da guilda e a chave de API do Guild Wars 2 para este servidor. Abre um modal com: nome da guilda, chave de API (de líder da guilda), opção de enviar notificação via DM, seleção do canal de notificações e das roles do Discord para notificações. Valida na API do GW2 e sincroniza os membros. | Quem tiver **Gerenciar Cargos**, **Gerenciar Canais**, **Gerenciar Servidor** ou **Administrador**. |
| **/join** | Informe ou atualize seu ID de jogo (Guild Wars 2) para este servidor. Abre um modal com o ID atual (se houver) para criar ou atualizar. Só funciona se o servidor já tiver uma guilda configurada via `/setup`. | Qualquer membro (com guilda configurada). |
| **/sync** | Sincroniza os membros da guilda com a API do Guild Wars 2 (mesmo processo do job `job:sync-members`). Exibe quantos membros estão pendentes de dados da guilda, pendentes de Discord ou confirmados. | Quem tiver **Gerenciar Cargos**, **Gerenciar Canais**, **Gerenciar Servidor** ou **Administrador**. |

## Jobs

Scripts para rodar fora do bot (ex.: via cron).

### Sincronizar membros das guilds

Conecta no MongoDB, busca todas as guilds, consulta a API do GW2 para cada uma e faz upsert na collection `guild_members` (mesmo fluxo do `/setup`).

```bash
npm run job:sync-members
```

**Requer:** `MONGODB_URI` no `.env`. Guildas com API key inválida ou restrita aparecem no resumo com erro.

### Notificar membros sem WvW

Notifica membros que têm `discord_user` preenchido mas **não** marcaram a guilda como WvW no jogo (`wvw_member: false`).

- Se a guilda tiver **canal de notificações** configurado no `/setup`: envia uma mensagem nesse canal marcando os usuários.
- Caso contrário: envia **DM** para cada um.

**Agendamento:** O job só executa de fato no **sábado** e na **segunda-feira** que antecedem a **primeira sexta-feira do mês**. Em qualquer outra data, termina sem fazer nada (útil para rodar todo dia via cron e só notificar nas datas certas).

```bash
npm run job:notify-wvw
```

**Requer:** `DISCORD_TOKEN` e `MONGODB_URI` no `.env`. Usuários com DMs desativadas ou que bloquearam o bot aparecem como falha no resumo.

## Regras e comportamento

### Status do membro

Cada vínculo guilda + Discord é guardado com um status:

| Status | Significado |
|--------|-------------|
| **Aguardando dados da guilda** (`PENDING_GUILD_DATA`) | Jogador ainda não consta na API da guilda ou dados da guilda ainda não foram sincronizados. |
| **Aguardando dados do Discord** (`PENDING_DISCORD_DATA`) | Jogador está na guilda no GW2, mas ainda não vinculou o Discord (não informou o ID de jogo aqui). |
| **Confirmado** (`CONFIRMED`) | ID de jogo e Discord vinculados e consistentes com a guilda. |

### ID de jogo

- Formato aceito: **Nome.1234** (ex.: `SeuNome.1234`). O bot valida com o padrão `[\w\s.-]+\.\d{4}`.
- Pode ser informado via **/join** (modal no servidor) ou por **DM** quando o bot pedir (após ganhar uma das roles configuradas no `/setup`).

### Quando o bot envia DM

1. **Ao ganhar uma role da guilda:** Se o servidor tem guilda configurada e roles definidas no `/setup`, ao receber **pela primeira vez** uma dessas roles o usuário recebe uma DM pedindo o ID de jogo. A resposta na DM (formato Nome.1234) é gravada em `guild_members` com o status adequado.
2. **Notificação WvW:** Se a guilda não tiver canal de notificações ou o job `job:notify-wvw` estiver configurado para DM, o bot pode enviar DM avisando que o jogador não atribuiu a guilda como WvW no jogo.

### Permissões

- **/setup** e **/sync:** Exigem pelo menos uma das permissões: **Gerenciar Cargos**, **Gerenciar Canais**, **Gerenciar Servidor** ou **Administrador**.
- **/join:** Qualquer membro do servidor, desde que a guilda já esteja configurada.

### Outras regras

- Um **ID de jogo** não pode estar vinculado a mais de um usuário Discord na mesma guilda.
- Um **usuário Discord** não pode vincular mais de um ID de jogo na mesma guilda (pode atualizar o mesmo ID via `/join` ou DM).
- Se o ID já estiver com status **Confirmado**, o bot não permite alteração por outro usuário.

## Docker

Build da imagem:

```bash
docker build -t gw2-wvw-discord-bot .
```

Execução (variáveis de ambiente via arquivo ou `-e`):

```bash
docker run --env-file .env gw2-wvw-discord-bot
```

Ou com variáveis explícitas:

```bash
docker run -e DISCORD_TOKEN=... -e MONGODB_URI=... gw2-wvw-discord-bot
```

Imagens publicadas no GitHub Container Registry (GHCR) podem ser usadas assim:

```bash
docker run --env-file .env ghcr.io/SEU_USUARIO/gw2-wvw-discord-bot:latest
```

## Estrutura do projeto

- `src/commands/` — Comandos slash: **join**, **setup**, **sync** (modais e selects do setup).
- `src/events/` — **guildMemberUpdate** (DM ao ganhar role da guilda), **messageCreate** (resposta em DM com ID de jogo).
- `src/jobs/` — **sync-guild-members** (sincronizar membros com a API), **notify-wvw-members** (avisar quem não atribuiu a guilda como WvW).
- `src/models/` — Schemas Mongoose: **Guild** (`guild_id`, `discord_server_id`, `name`, `api_key`, `notify_channel`, `roles`, `dm_notify_player`), **GuildMember**.
- `src/services/` — Chamadas à API do Guild Wars 2 (busca de guilda, lista de membros) e sincronização de membros.
- `src/constants/` — Rótulos de status em português.
- `src/database/` — Conexão MongoDB.
