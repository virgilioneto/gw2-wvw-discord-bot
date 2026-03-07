import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IGuild extends Document {
  guild_id: string;
  discord_server_id: string;
  name: string;
  api_key: string;
  notify_channel: string;
}

const GuildSchema: Schema = new Schema({
  guild_id: { type: String, required: true, unique: true },
  discord_server_id: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  api_key: { type: String, required: true },
  notify_channel: { type: String, default: '' },
});

export const Guild: Model<IGuild> = mongoose.model<IGuild>('Guild', GuildSchema);
