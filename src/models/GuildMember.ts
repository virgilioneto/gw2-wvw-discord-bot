import mongoose, { Schema, Document, Model } from 'mongoose';

export type GuildMemberStatus = 'PENDING_GUILD_DATA' | 'PENDING_DISCORD_DATA' | 'CONFIRMED';

export interface IGuildMember extends Document {
  account_id: string;
  discord_user: string;
  guild_id: string;
  wvw_member: boolean;
  joined_at: Date;
  status: GuildMemberStatus;
  roles: string[];
}

const GuildMemberSchema: Schema = new Schema({
  account_id: { type: String, required: true },
  discord_user: { type: String, required: false },
  guild_id: { type: String, required: true },
  wvw_member: { type: Boolean, default: false },
  joined_at: { type: Date },
  status: { type: String, enum: ['PENDING_GUILD_DATA', 'PENDING_DISCORD_DATA', 'CONFIRMED'] },
  roles: { type: [String], default: [] },
});

// Índice composto para upsert por guild_id + account_id
GuildMemberSchema.index({ guild_id: 1, account_id: 1 }, { unique: true });

export const GuildMember: Model<IGuildMember> = mongoose.model<IGuildMember>('GuildMember', GuildMemberSchema);
