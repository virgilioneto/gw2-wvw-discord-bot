import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IGuild extends Document {
  guild_id: string;
  discord_server_id: string;
  name: string;
  api_key: string;
  notify_channel: string;
  base_discord_role: string;
  wvw_discord_role: string;
  dm_notify_player: boolean;
}

const GuildSchema: Schema = new Schema({
  guild_id: { type: String, required: true, unique: true },
  discord_server_id: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  api_key: { type: String, required: true },
  notify_channel: { type: String, default: '' },
  base_discord_role: { type: String, default: '' },
  wvw_discord_role: { type: String, default: '' },
  dm_notify_player: { type: Boolean, default: false },
});

export const Guild: Model<IGuild> = mongoose.model<IGuild>('Guild', GuildSchema);
