## Visão geral da arquitetura

Este documento descreve a visão geral do bot **GW2 WvW Discord Bot**, seus componentes principais e como eles se relacionam.

- **Cliente Discord (`index.ts`)**: ponto de entrada do bot. Conecta no Discord, configura intents e registra handlers de eventos e interações.
- **Comandos (`src/commands`)**: comandos *slash* que administradores e membros utilizam para configurar a guilda, vincular IDs de jogo e sincronizar dados.
- **Eventos (`src/events`)**: reagem a eventos do Discord (mensagens, atualização de membros) e direcionam o fluxo para serviços.
- **Jobs (`src/jobs`)**: scripts executados via CLI (por exemplo, `npm run job:...`) para tarefas agendadas, independentes do processo principal do bot.
- **Services (`src/services`)**: camada de regras de negócio e integração com API do Guild Wars 2 e com a coleção `guild_members`.
- **Utils (`src/utils`)**: funções auxiliares reutilizáveis (checagem de roles, reação em mensagens de recrutamento, controle de DMs pendentes).
- **Models (`src/models`)**: esquemas Mongoose para persistência de dados (`Guild`, `GuildMember`).

### Diagrama de alto nível (Mermaid)

```mermaid
flowchart TD
  subgraph Discord
    A[Usuário / Admin] -->|Slash Commands| B[Bot - index.ts]
    A -->|Mensagens / DM| C[Eventos de mensagem]
    A -->|Mudança de roles| D[Evento GuildMemberUpdate]
  end

  B -->|/entrar, /configurar, /atualizar, /jogadores-pendente, /inclusão-manual| CMD[Handlers de comandos]
  B --> EVT[Handlers de eventos]

  subgraph Commands
    CMD_JOIN[commands/join.ts]
    CMD_SETUP[commands/setup.ts]
    CMD_SYNC[commands/sync.ts]
    CMD_PENDING[commands/pendingPlayers.ts]
    CMD_MANUAL[commands/manualInclude.ts]
  end

  subgraph Events
    EVT_MSG[events/messageCreate.ts]
    EVT_GMEMB[events/guildMemberUpdate.ts]
  end

  subgraph Jobs
    JOB_NOTIFY[jobs/notify-wvw-members.ts]
    JOB_SYNC[jobs/sync-guild-members.ts]
  end

  subgraph Services
    S_GMS[guildMemberService.ts]
    S_SYNC[syncGuildMembers.ts]
    S_GW2API[gw2Api.ts]
    S_GW2MEM[gw2GuildMembers.ts]
  end

  subgraph Utils
    U_ROLE[roleCheck.ts]
    U_RECR[recruitmentMessage.ts]
    U_PEND[pendingDm.ts]
  end

  subgraph Models
    M_GUILD[Guild.ts]
    M_GMEMB[GuildMember.ts]
  end

  B --> CMD_JOIN & CMD_SETUP & CMD_SYNC & CMD_PENDING & CMD_MANUAL
  B --> EVT_MSG & EVT_GMEMB

  CMD_JOIN --> M_GUILD
  CMD_SETUP --> M_GUILD & S_GW2API & S_GW2MEM & S_GMS & U_ROLE
  CMD_SYNC --> M_GUILD & S_SYNC & U_RECR & U_ROLE
  CMD_PENDING --> M_GUILD & S_GMS & U_ROLE
  CMD_MANUAL --> M_GUILD & S_GMS & U_RECR & U_ROLE

  EVT_MSG --> M_GUILD & S_GMS & U_PEND & U_RECR & U_ROLE
  EVT_GMEMB --> M_GUILD & S_GMS & U_PEND

  JOB_NOTIFY --> M_GUILD & S_GMS
  JOB_SYNC --> M_GUILD & S_SYNC & U_RECR

  S_SYNC --> S_GW2MEM & S_GMS & M_GMEMB
  S_GW2MEM -->|HTTP| GW2_API[API Guild Wars 2]
  S_GW2API -->|HTTP| GW2_API

  S_GMS --> M_GMEMB

  U_ROLE --> Discord
  U_RECR --> Discord
  U_PEND --> Discord

