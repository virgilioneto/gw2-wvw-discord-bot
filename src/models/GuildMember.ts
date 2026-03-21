import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../database/sequelize';

export type GuildMemberStatus = 'PENDING_GUILD_DATA' | 'PENDING_DISCORD_DATA' | 'CONFIRMED';

export interface IGuildMemberAttributes {
  id: number;
  account_id: string;
  discord_user: string | null;
  guild_id: string;
  wvw_member: boolean;
  joined_at: Date | null;
  status: GuildMemberStatus | null;
  roles: string[];
  /** Discord message id of the recruitment channel message that matched this game id */
  recruitment_message_id: string | null;
  /** Discord channel id where the recruitment message was sent */
  recruitment_channel_id: string | null;
  created_at?: Date;
  updated_at?: Date;
}

export type IGuildMember = IGuildMemberAttributes;

type GuildMemberCreationAttributes = Optional<
  IGuildMemberAttributes,
  | 'id'
  | 'discord_user'
  | 'joined_at'
  | 'status'
  | 'roles'
  | 'recruitment_message_id'
  | 'recruitment_channel_id'
  | 'wvw_member'
  | 'created_at'
  | 'updated_at'
>;

export class GuildMember extends Model<IGuildMemberAttributes, GuildMemberCreationAttributes>
  implements IGuildMemberAttributes
{
  declare id: number;
  declare account_id: string;
  declare discord_user: string | null;
  declare guild_id: string;
  declare wvw_member: boolean;
  declare joined_at: Date | null;
  declare status: GuildMemberStatus | null;
  declare roles: string[];
  declare recruitment_message_id: string | null;
  declare recruitment_channel_id: string | null;
  declare readonly created_at: Date;
  declare readonly updated_at: Date;
}

GuildMember.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    account_id: { type: DataTypes.STRING, allowNull: false },
    discord_user: { type: DataTypes.STRING, allowNull: true },
    guild_id: { type: DataTypes.STRING, allowNull: false },
    wvw_member: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    joined_at: { type: DataTypes.DATE, allowNull: true },
    status: { type: DataTypes.STRING, allowNull: true },
    roles: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    recruitment_message_id: { type: DataTypes.STRING, allowNull: true },
    recruitment_channel_id: { type: DataTypes.STRING, allowNull: true },
  },
  {
    sequelize,
    tableName: 'guild_members',
    modelName: 'GuildMember',
  }
);
