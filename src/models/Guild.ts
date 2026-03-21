import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../database/sequelize';

/** Payload serializado de uma mensagem para o bot poder reenviá-la (ex.: mensagem de recrutamento). */
export interface IRecruitmentMessagePayload {
  content?: string;
  embeds?: Record<string, unknown>[];
  components?: Record<string, unknown>[];
  attachment_urls?: { url: string; name?: string }[];
}

/** Payload completo da mensagem de notificação (mesmo formato de recruitment_message). */
export type INotificationMessagePayload = IRecruitmentMessagePayload;

export interface IGuildAttributes {
  id: number;
  guild_id: string;
  discord_server_id: string;
  name: string;
  api_key: string;
  recruitment_channel: string;
  notify_channel: string;
  notification_roles: string[];
  member_role: string | null;
  recruitment_message: IRecruitmentMessagePayload | null;
  notification_message: INotificationMessagePayload | null;
  created_at?: Date;
  updated_at?: Date;
}

export type IGuild = IGuildAttributes;

type GuildCreationAttributes = Optional<
  IGuildAttributes,
  | 'id'
  | 'recruitment_channel'
  | 'notify_channel'
  | 'notification_roles'
  | 'member_role'
  | 'recruitment_message'
  | 'notification_message'
  | 'created_at'
  | 'updated_at'
>;

export class Guild extends Model<IGuildAttributes, GuildCreationAttributes> implements IGuildAttributes {
  declare id: number;
  declare guild_id: string;
  declare discord_server_id: string;
  declare name: string;
  declare api_key: string;
  declare recruitment_channel: string;
  declare notify_channel: string;
  declare notification_roles: string[];
  declare member_role: string | null;
  declare recruitment_message: IRecruitmentMessagePayload | null;
  declare notification_message: INotificationMessagePayload | null;
  declare readonly created_at: Date;
  declare readonly updated_at: Date;
}

Guild.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    guild_id: { type: DataTypes.STRING, allowNull: false, unique: true },
    discord_server_id: { type: DataTypes.STRING, allowNull: false, unique: true },
    name: { type: DataTypes.STRING, allowNull: false },
    api_key: { type: DataTypes.STRING(512), allowNull: false },
    recruitment_channel: { type: DataTypes.STRING, allowNull: false, defaultValue: '' },
    notify_channel: { type: DataTypes.STRING, allowNull: false, defaultValue: '' },
    notification_roles: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    member_role: { type: DataTypes.STRING, allowNull: true },
    recruitment_message: { type: DataTypes.JSONB, allowNull: true },
    notification_message: { type: DataTypes.JSONB, allowNull: true },
  },
  {
    sequelize,
    tableName: 'guilds',
    modelName: 'Guild',
  }
);
