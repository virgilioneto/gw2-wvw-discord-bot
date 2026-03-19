import mongoose, { Schema, Document, Model } from 'mongoose';

/** Payload serializado de uma mensagem para o bot poder reenviá-la (ex.: mensagem de recrutamento). */
export interface IRecruitmentMessagePayload {
  content?: string;
  embeds?: Record<string, unknown>[];
  components?: Record<string, unknown>[];
  attachment_urls?: { url: string; name?: string }[];
}

/** Payload completo da mensagem de notificação (mesmo formato de recruitment_message). */
export type INotificationMessagePayload = IRecruitmentMessagePayload;

export interface IGuild extends Document {
  guild_id: string;
  discord_server_id: string;
  name: string;
  api_key: string;
  recruitment_channel: string;
  notify_channel: string;
  notification_roles: string[];
  recruitment_message?: IRecruitmentMessagePayload;
  /** Conteúdo completo da mensagem de notificação (para reenvio). */
  notification_message?: INotificationMessagePayload;
}

const recruitmentMessageSchema = new Schema(
  {
    content: { type: String, default: '' },
    embeds: { type: [Schema.Types.Mixed], default: undefined },
    components: { type: [Schema.Types.Mixed], default: undefined },
    attachment_urls: [{ url: String, name: String }],
  },
  { _id: false }
);

const GuildSchema: Schema = new Schema({
  guild_id: { type: String, required: true, unique: true },
  discord_server_id: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  api_key: { type: String, required: true },
  recruitment_channel: { type: String, default: '' },
  notify_channel: { type: String, default: '' },
  notification_roles: { type: [String], default: [] },
  recruitment_message: { type: recruitmentMessageSchema, default: undefined },
  notification_message: { type: recruitmentMessageSchema, default: undefined },
});

export const Guild: Model<IGuild> = mongoose.model<IGuild>('Guild', GuildSchema);
