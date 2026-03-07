# Visão Geral
Crie um bot no discord cujo nome seja "Esgoto do WvW" e implemente-o da seguinte maneira
## Tecnologia
- NodeJS (typescript)
- MongoDB (Com mongoose)

## Schemas
guilds
```json
{
    "guild_id": string,
    "discord_server_id": string,
    "name:" string,
    "api_key": string
}
```

guild_members
```json
{
    "account_id": string, // from field name
    "discord_user": string,
    "guild_id": string,
    "wvw_member": bool,
    "joined_at": date, // from field joined
}
```

## Ao usuário entrar no server
- Envie uma mensagem para o usuário no privado pedindo para ele informar o ID dele no jogo
- Só dispare caso exista um registro de guild para o discord server id que o usuário entrou, se não ouver, ignore
- Ao usuário digitar o id, salve na collection guild_members o id do jogo e o id do discord do usuário com status PENDING.

## Comandos
/register abre uma modal pedindo para o usuário informar o ID do jogo dele, caso o username do discord já tenha uma informação salva no banco, traga essa informação na modal e permita ele atualizar, ao atualizar coloque status PENDING
- Só execute esse comando se existir uma guild registrada para este discord server id
- Cria ou atualiza os dados da tabela guild_members
/setup abre uma modal para o usuário digitar o nome da guilda e a chave de api do guildwars. Caso já tenha sido feito um setup, traga as informações salvas (chave de api deve ser um campo do tipo password) e permita o usuário fazer alterações.
- Cria ou atualiza os dados da tabela guilds
- Deve se realizar o seguinte fluxo
  - Consulte nesta api https://api.guildwars2.com/v2/guild/search?name=<GUILD_NAME>
  - Pegue o id que virá no array[0]
  - Consulte nesta api https://api.guildwars2.com/v2/guild/<GUILD_-_ID>/members?access_token=<API_KEY>
  - O retorno deve ser uma lista de objetos
  - Caso o retorno seja um objeto com propriedade text "access restricted to guild leaders" exiba este erro na modal.
  - Ao retornar sucesso, salve na tabela guilds o nome da guild e a api key
  - Itere os dados retornados e faça um batch upsert pelo campo account_id salvando os já modificados de acordo com o mapping do schema guild_members e adicione também o guild_id
