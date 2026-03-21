/**
 * Reconstrói opções de envio (embeds, anexos) a partir de payloads salvos
 * em recruitment_message / notification_message (Guild).
 */
import { AttachmentBuilder, EmbedBuilder, type APIEmbed } from 'discord.js';
import type { IRecruitmentMessagePayload } from '../models/Guild';

export function buildEmbedsFromStoredPayload(
  payload?: IRecruitmentMessagePayload | null
): EmbedBuilder[] | undefined {
  const raw = payload?.embeds;
  if (!raw?.length) return undefined;
  return raw.map((e) => EmbedBuilder.from(e as APIEmbed));
}

export type PreparedAttachment = { buffer: Buffer; name: string };

/**
 * Baixa URLs salvas em attachment_urls (uma vez). Use `toAttachmentBuilders` por envio
 * para não reutilizar o mesmo AttachmentBuilder em várias mensagens.
 */
export async function fetchPreparedAttachmentsFromUrls(
  attachment_urls?: { url: string; name?: string }[]
): Promise<PreparedAttachment[]> {
  if (!attachment_urls?.length) return [];
  const out: PreparedAttachment[] = [];
  for (const a of attachment_urls) {
    if (!a?.url?.trim()) continue;
    try {
      const res = await fetch(a.url);
      if (!res.ok) continue;
      const buffer = Buffer.from(await res.arrayBuffer());
      const pathPart = a.url.split(/[#?]/)[0] ?? '';
      const extFromUrl = pathPart.includes('.') ? pathPart.split('.').pop() : undefined;
      const safeExt =
        extFromUrl && extFromUrl.length > 0 && extFromUrl.length <= 8 && /^[a-z0-9]+$/i.test(extFromUrl)
          ? extFromUrl
          : 'bin';
      const name = a.name?.trim() || `attachment.${safeExt}`;
      out.push({ buffer, name });
    } catch {
      // ignora download falho
    }
  }
  return out;
}

export function toAttachmentBuilders(prepared: PreparedAttachment[]): AttachmentBuilder[] {
  return prepared.map((p) => new AttachmentBuilder(p.buffer, { name: p.name }));
}

/** Há algo para enviar além de texto vazio? */
export function hasRenderableMessagePayload(payload?: IRecruitmentMessagePayload | null): boolean {
  const c = payload?.content?.trim();
  const hasEmbeds = Boolean(payload?.embeds?.length);
  const hasFiles = Boolean(payload?.attachment_urls?.length);
  return Boolean(c || hasEmbeds || hasFiles);
}
