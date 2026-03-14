import {
  Message,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type MessageComponentInteraction,
} from 'discord.js';
import { Guild, type IGuild } from '../models/Guild';
import { GuildMember, type GuildMemberStatus } from '../models/GuildMember';
import { pendingGameIdByUser } from '../utils/pendingDm';
import { getStatusLabel } from '../constants/statusLabels';

/** Pending "replace game ID?" data keyed by the reply message id. */
const pendingReplaceByMessageId = new Map<
  string,
  {
    guildDoc: IGuild;
    newGameId: string;
    memberRoles: string[];
    authorId: string;
    oldAccountId: string;
  }
>();

const REPLACE_BUTTON_YES = 'replace_game_id_yes';
const REPLACE_BUTTON_NO = 'replace_game_id_no';
const REPLACE_COLLECTOR_TIMEOUT_MS = 60_000;

/** GW2 account names look like "Name.1234" */
export const GAME_ID_REGEX = /([\w.-]+\.\d{4})/i;

export async function handleDirectMessage(message: Message): Promise<void> {
  if (message.author.bot) return;
  if (!message.guildId && message.channel.isDMBased()) {
    const {discordServerId, roles} = pendingGameIdByUser.get(message.author.id) || {};
    if (!discordServerId) return;

    const gameId = message.content.trim();
    if (!GAME_ID_REGEX.test(gameId)) {
      await message.reply("O ID informado não parece válido. Use o formato: **Nome.1234** (ex.: SeuNome.1234).");
      return;
    }

    const guildDoc = await Guild.findOne({ discord_server_id: discordServerId }).exec();
    if (!guildDoc) {
      pendingGameIdByUser.delete(message.author.id);
      return;
    }
    const existingMember = await GuildMember.findOne({ guild_id: guildDoc.guild_id, account_id: gameId }).exec();

    let status: GuildMemberStatus = 'PENDING_GUILD_DATA'
    if (existingMember) {
      status = existingMember.status === 'PENDING_DISCORD_DATA' ? 'CONFIRMED' : existingMember.status;
    }
    const guildRoleIds = Array.isArray(guildDoc.roles) ? guildDoc.roles : [];
    const memberRoles = guildRoleIds.filter((roleId) => roles?.includes(roleId) ?? false);
    await GuildMember.findOneAndUpdate(
      { guild_id: guildDoc.guild_id, account_id: gameId },
      {
        $set: {
          discord_user: message.author.id,
          status,
          roles: memberRoles,
        },
      },
      { upsert: true, new: true }
    ).exec();

    pendingGameIdByUser.delete(message.author.id);
    await message.reply(`Seu ID de jogo foi registrado com sucesso. Status: **${getStatusLabel(status)}**.`);
  }
}

/**
 * Handles messages in the guild's recruitment_channel: if the message content
 * matches GAME_ID_REGEX, registers the author using the same logic as the join command.
 */
export async function handleRecruitmentChannelMessage(message: Message): Promise<void> {
  if (message.author.bot) return;
  if (!message.guildId) return;

  const guildDoc = await Guild.findOne({ discord_server_id: message.guildId }).exec();
  if (!guildDoc?.recruitment_channel || guildDoc.recruitment_channel !== message.channelId) return;

  const match = message.content.trim().match(GAME_ID_REGEX);
  if (!match) return;
  const gameId = match[0];

  const member = message.member ?? (await message.guild?.members.fetch(message.author.id).catch(() => null));
  const guildRoleIds = Array.isArray(guildDoc.roles) ? guildDoc.roles : [];
  const memberRoles = member ? guildRoleIds.filter((roleId) => member.roles.cache.has(roleId)) : [];

  const existingDiscordUser = await GuildMember.findOne({
    guild_id: guildDoc.guild_id,
    discord_user: message.author.id,
  }).exec();
  if (existingDiscordUser && existingDiscordUser.account_id !== gameId) {
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(REPLACE_BUTTON_YES)
        .setLabel('Sim')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(REPLACE_BUTTON_NO)
        .setLabel('Não')
        .setStyle(ButtonStyle.Secondary)
    );
    const reply = await message
      .reply({
        content: `Você já está vinculado a outro ID de jogo (**${existingDiscordUser.account_id}**). Deseja substituir pelo novo ID **${gameId}**?`,
        components: [row],
      })
      .catch(() => null);
    if (!reply) return;

    pendingReplaceByMessageId.set(reply.id, {
      guildDoc,
      newGameId: gameId,
      memberRoles,
      authorId: message.author.id,
      oldAccountId: existingDiscordUser.account_id,
    });

    const collector = reply.createMessageComponentCollector({
      filter: (i: MessageComponentInteraction) => i.user.id === message.author.id,
      time: REPLACE_COLLECTOR_TIMEOUT_MS,
      maxComponents: 1,
    });

    collector.on('collect', async (interaction) => {
      const pending = pendingReplaceByMessageId.get(reply.id);
      pendingReplaceByMessageId.delete(reply.id);
      if (!pending || pending.authorId !== interaction.user.id) {
        await interaction.reply({ content: 'Esta confirmação expirou ou não é sua.', ephemeral: true }).catch(() => {});
        return;
      }

      await reply.edit({ components: [] }).catch(() => {});

      if (interaction.customId === REPLACE_BUTTON_NO) {
        await interaction.reply({ content: 'Nenhuma alteração feita. Seu vínculo atual foi mantido.', ephemeral: true }).catch(() => {});
        return;
      }

      await interaction.deferReply({ ephemeral: true });

      try {
        await GuildMember.deleteOne({
          guild_id: pending.guildDoc.guild_id,
          account_id: pending.oldAccountId,
        }).exec();

        const existingMember = await GuildMember.findOne({
          guild_id: pending.guildDoc.guild_id,
          account_id: pending.newGameId,
        }).exec();
        let status: GuildMemberStatus = 'PENDING_GUILD_DATA';
        if (existingMember) {
          status = existingMember.status === 'PENDING_DISCORD_DATA' ? 'CONFIRMED' : existingMember.status;
        }
        await GuildMember.findOneAndUpdate(
          { guild_id: pending.guildDoc.guild_id, account_id: pending.newGameId },
          {
            $set: {
              discord_user: pending.authorId,
              status,
              roles: pending.memberRoles,
            },
          },
          { upsert: true, new: true }
        ).exec();

        await interaction.editReply(`ID de jogo substituído com sucesso. Novo vínculo: **${pending.newGameId}**. Status: **${getStatusLabel(status)}**.`);
      } catch (err) {
        console.error(err);
        await interaction.editReply({ content: 'Ocorreu um erro ao atualizar. Tente novamente.' }).catch(() => {});
      }
    });

    collector.on('end', () => {
      pendingReplaceByMessageId.delete(reply.id);
    });

    return;
  }

  const existingMember = await GuildMember.findOne({ guild_id: guildDoc.guild_id, account_id: gameId }).exec();
  if (existingMember?.discord_user && existingMember.discord_user !== message.author.id) {
    await message.reply('ID do jogo já está vinculado a outro usuário.').catch(() => {});
    return;
  }
  if (existingMember?.status === 'CONFIRMED') {
    await message.reply('ID do jogo já está confirmado.').catch(() => {});
    return;
  }

  let status: GuildMemberStatus = 'PENDING_GUILD_DATA';
  if (existingMember) {
    status = existingMember.status === 'PENDING_DISCORD_DATA' ? 'CONFIRMED' : existingMember.status;
  }
  await GuildMember.findOneAndUpdate(
    { guild_id: guildDoc.guild_id, account_id: gameId },
    {
      $set: {
        discord_user: message.author.id,
        status,
        roles: memberRoles,
      },
    },
    { upsert: true, new: true }
  ).exec();

  await message.reply(`ID de jogo registrado com sucesso. Status: **${getStatusLabel(status)}**.`).catch(() => {});
}
