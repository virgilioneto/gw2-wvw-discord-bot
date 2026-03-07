import mongoose, { Schema, Document, Model } from 'mongoose';

export type GuildMemberStatus = 'PENDING' | 'CONFIRMED';

export interface IGuildMember extends Document {
  account_id: string;
  discord_user: string;
  guild_id: string;
  wvw_member: boolean;
  joined_at: Date;
  status: GuildMemberStatus;
  base_discord_role: boolean;
  wvw_discord_role: boolean;
}

const GuildMemberSchema: Schema = new Schema({
  account_id: { type: String, required: true },
  discord_user: { type: String, required: true },
  guild_id: { type: String, required: true },
  wvw_member: { type: Boolean, default: false },
  joined_at: { type: Date, default: Date.now },
  status: { type: String, enum: ['PENDING', 'CONFIRMED'], default: 'PENDING' },
  base_discord_role: { type: Boolean, default: false },
  wvw_discord_role: { type: Boolean, default: false },
});

// Índice composto para upsert por guild_id + account_id
GuildMemberSchema.index({ guild_id: 1, account_id: 1 }, { unique: true });

export const GuildMember: Model<IGuildMember> = mongoose.model<IGuildMember>('GuildMember', GuildMemberSchema);
