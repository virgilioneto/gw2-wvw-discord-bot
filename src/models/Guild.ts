import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IGuild extends Document {
  guild_id: string;
  discord_server_id: string;
  name: string;
  api_key: string;
  recruitment_channel: string;
  notify_channel: string;
  notification_roles: string[];
}

const GuildSchema: Schema = new Schema({
  guild_id: { type: String, required: true, unique: true },
  discord_server_id: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  api_key: { type: String, required: true },
  recruitment_channel: { type: String, default: '' },
  notify_channel: { type: String, default: '' },
  notification_roles: { type: [String], default: [] },
});

export const Guild: Model<IGuild> = mongoose.model<IGuild>('Guild', GuildSchema);
