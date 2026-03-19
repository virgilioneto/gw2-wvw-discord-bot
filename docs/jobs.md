## Jobs

Os jobs são scripts executados via linha de comando, fora do processo principal do bot, para tarefas periódicas ou em lote.

Jobs existentes:
- `jobs/notify-wvw-members.ts` → `npm run job:notify-wvw`
- `jobs/sync-guild-members.ts` → `npm run job:sync-members`

---

### Job `notify-wvw-members`

- **Arquivo**: `src/jobs/notify-wvw-members.ts`
- **Uso**: `npm run job:notify-wvw`

**Objetivo**  
Notificar membros que:
- Têm `discord_user` definido.
- Estão com `status = CONFIRMED`.
- Estão com `wvw_member = false`.
- Têm pelo menos uma das roles configuradas em `Guild.notification_roles`.

As notificações são feitas:
- Preferencialmente em um canal de notificação (`Guild.notify_channel`), mencionando os usuários.
- Sempre via DM individual também.

**Regras de agendamento (`shouldRunToday`)**
- O job **só executa trabalho** em duas datas específicas por mês:
  - No **sábado** que antecede a **primeira sexta-feira do mês**.
  - Na **segunda-feira** que antecede a **primeira sexta-feira do mês**.
- Em qualquer outra data, o job:
  - Loga uma mensagem explicando que não está agendado para hoje.
  - Encerra com `process.exit(0)`.

**Fluxo**
1. Carrega variáveis de ambiente (`MONGODB_URI`, `DISCORD_TOKEN`).
2. Se `DISCORD_TOKEN` estiver ausente, encerra com erro.
3. Cria um `Client` Discord com intents mínimas para DMs e guilds.
4. Funções auxiliares:
   - `getFirstFridayDayOfMonth(year, month)`:
     - Calcula a data da primeira sexta-feira do mês.
   - `shouldRunToday()`:
     - Usa a primeira sexta para calcular o sábado e a segunda anteriores.
5. `run()`:
   - Verifica `shouldRunToday()`; se `false`, apenas loga e sai.
   - Conecta ao MongoDB (Mongoose) e ao Discord.
   - Carrega todas as `Guild` da base.
   - Para cada guilda:
     - Obtém `guildRoleIds` de `notification_roles`.
     - Usa `findPendingWvwMembers(guild_id, guildRoleIds)` (service) para obter membros pendentes.
     - Se não houver membros, loga e continua.
     - Se houver `notify_channel`:
       - Busca o servidor e o canal no Discord.
       - Envia uma mensagem mencionando os usuários e explicando que precisam marcar a guilda como WvW no jogo.
     - Para cada membro:
       - Tenta enviar DM com texto explicando que a guilda não foi definida como WvW.
       - Conta sucessos (`totalSent`) e falhas (`totalSkipped`), armazenando erros.
   - Ao final:
     - Loga um resumo com:
       - Guildas processadas.
       - Mensagens de canal enviadas.
       - DMs enviadas.
       - Falhas e detalhes de erros.
   - Desconecta do Discord e do MongoDB, encerrando o processo.

**Relações (Mermaid)**

```mermaid
flowchart LR
  CLI[npm run job:notify-wvw] --> RUN[run()]
  RUN --> CHECK[shouldRunToday()]
  RUN --> DB[MongoDB (mongoose.connect)]
  RUN --> DCLIENT[Discord Client login]

  RUN --> M_GUILD[Model Guild]
  RUN --> S_GMS_PEND[findPendingWvwMembers]
  S_GMS_PEND --> M_GMEMB[Model GuildMember]

  RUN --> CH_MSG[Mensagens em notify_channel]
  RUN --> DM[DM para membros]
```

---

### Job `sync-guild-members`

- **Arquivo**: `src/jobs/sync-guild-members.ts`
- **Uso**: `npm run job:sync-members`

**Objetivo**  
Sincronizar membros de todas as guildas cadastradas na base com a API GW2, da mesma forma que o comando `/atualizar`, porém em lote para todas as `Guild`.

**Fluxo**
1. Carrega variáveis de ambiente (`MONGODB_URI`, `DISCORD_TOKEN`).
2. Conecta ao MongoDB.
3. Cria um `Client` Discord com intent `Guilds`.
4. Se `DISCORD_TOKEN` existir:
   - Faz login no Discord.
   - Aguarda o evento `ready` ou `error`.
5. Se `DISCORD_TOKEN` não existir:
   - Loga um aviso de que as mensagens de recrutamento **não** serão marcadas com ✅, mas a sincronização ainda ocorrerá.
6. Busca todas as `Guild` no banco.
7. Para cada guilda:
   - Chama `syncMembersForGuild(guild.guild_id, guild.api_key)`:
     - Atualiza `guild_members` com base na API GW2.
     - Retorna contagens de pendentes e confirmados, e mensagens de recrutamento a confirmar.
   - Se `ok`:
     - Soma estatísticas globais de pendentes/confirmados.
     - Se o client do Discord estiver pronto e houver `recruitmentMessagesToConfirm`:
       - Busca o servidor no Discord e chama `reactRecruitmentMessageConfirmed` para cada mensagem.
   - Se erro:
     - Loga e guarda em uma lista de erros.
8. Ao final:
   - Loga um resumo com totais.
   - Lista os erros por guilda, se existirem.
9. Destroi o client Discord (se criado) e desconecta do MongoDB.

**Relações (Mermaid)**

```mermaid
flowchart LR
  CLI[npm run job:sync-members] --> RUN[run()]
  RUN --> DB[MongoDB (mongoose.connect)]
  RUN --> DCLIENT[Discord Client login (opcional)]

  RUN --> M_GUILD[Model Guild]
  RUN --> S_SYNC[syncMembersForGuild]
  S_SYNC --> M_GMEMB[Model GuildMember]
  S_SYNC --> S_GW2MEM[getGuildMembers]

  RUN --> U_RECR[reactRecruitmentMessageConfirmed]
  RUN --> LOG[Logs e resumo]
```

