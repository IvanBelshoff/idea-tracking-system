import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';
import { MURAL_REACTIONS, REPORT_REASONS } from './mural-rules.js';

const uuid = z.uuid();

export const WithdrawSchema = z.object({ reason: z.string().trim().min(1, 'Informe o motivo.').max(500) });
export const MuralConsentSchema = z.object({ accept: z.boolean() });
export const ReactionSchema = z.object({ kind: z.enum(MURAL_REACTIONS) });
export const CommentSchema = z.object({
  body: z.string().trim().min(1, 'Escreva o comentário.').max(2000, 'No máximo 2000 caracteres.'),
  parentId: uuid.nullish(),
});
export const EditCommentSchema = z.object({
  body: z.string().trim().min(1, 'Escreva o comentário.').max(2000, 'No máximo 2000 caracteres.'),
});
export const ReportSchema = z.object({
  reason: z.enum(REPORT_REASONS),
  note: z.string().trim().max(500).nullish(),
});
export const HideCommentSchema = z.object({ reason: z.string().trim().min(1, 'Informe o motivo.').max(500) });
export const ShareSchema = z.object({
  recipientId: uuid,
  message: z.string().trim().max(300, 'No máximo 300 caracteres.').nullish(),
});
export const FeedQuerySchema = z.object({
  sort: z.enum(['recent', 'reactions']).default('recent'),
  status: z
    .union([z.enum(['in_progress', 'implemented']), z.array(z.enum(['in_progress', 'implemented']))])
    .optional()
    .transform((v) => (v === undefined ? [] : Array.isArray(v) ? v : [v])),
  categoryId: uuid.optional(),
  entityId: uuid.optional(),
  cursor: z.string().max(200).optional(),
});
export const ReactionsQuerySchema = z.object({ kind: z.enum(MURAL_REACTIONS).optional() });
export const PeopleQuerySchema = z.object({ search: z.string().trim().max(100).default('') });

export class WithdrawRequest {
  @ApiProperty({ maxLength: 500 }) reason!: string;
}
export class MuralConsentRequest {
  @ApiProperty({ description: 'Mostrar o nome no mural (true) ou continuar anônimo (false)' }) accept!: boolean;
}
export class ReactionRequest {
  @ApiProperty({ enum: MURAL_REACTIONS, enumName: 'MuralReaction' }) kind!: string;
}
export class MuralCommentRequest {
  @ApiProperty({ maxLength: 2000 }) body!: string;
  @ApiProperty({
    type: String,
    required: false,
    nullable: true,
    description: 'Responder a este comentário (um nível só)',
  })
  parentId?: string | null;
}
export class EditCommentRequest {
  @ApiProperty({ maxLength: 2000 }) body!: string;
}
export class ReportRequest {
  @ApiProperty({ enum: REPORT_REASONS, enumName: 'MuralReportReason' }) reason!: string;
  @ApiProperty({ type: String, required: false, nullable: true, maxLength: 500 }) note?: string | null;
}
export class HideCommentRequest {
  @ApiProperty({ maxLength: 500 }) reason!: string;
}
export class ShareRequest {
  @ApiProperty() recipientId!: string;
  @ApiProperty({ type: String, required: false, nullable: true, maxLength: 300 }) message?: string | null;
}

/** Estado da ideia no mural, para a página da ideia (RN-149, RN-151). */
export class MuralPublicationView {
  @ApiProperty({ enum: ['none', 'published', 'withdrawn'] }) status!: 'none' | 'published' | 'withdrawn';
  @ApiProperty({ description: 'A ideia pode ir ao mural agora (Em andamento ou Implementada, sem arquivar)' })
  publishable!: boolean;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' }) publishedAt!: string | null;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' }) withdrawnAt!: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Motivo da retirada; na automática, o código (`idea_rejected`, `idea_archived`)',
  })
  withdrawnReason!: string | null;
  @ApiProperty({ description: 'Retirada pelo sistema (RN-149)' }) withdrawnAutomatically!: boolean;
  @ApiProperty({ description: 'Pode publicar e retirar (mural.manage na entidade da ideia)' }) canManage!: boolean;
  @ApiProperty({
    enum: ['pending', 'accepted', 'declined'],
    nullable: true,
    description: 'O consentimento de quem pergunta, se participa da ideia (RN-151)',
  })
  myConsent!: 'pending' | 'accepted' | 'declined' | null;
}

/**
 * Uma pessoa no mural (RN-151, RN-152, RN-153). `label`: `author`/`co_author` = participante sem
 * consentimento (aparece como "Autor da ideia"); `former` = anonimizado ("Ex-colaborador").
 * Nome, id e foto só vêm quando podem aparecer, ou para a equipe (`revealed`).
 */
export class MuralPerson {
  @ApiProperty({ type: String, nullable: true }) name!: string | null;
  @ApiProperty({ type: String, nullable: true }) userId!: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Versão da foto (RN-142)' }) photoVersion!: string | null;
  @ApiProperty({ enum: ['author', 'co_author', 'former'], nullable: true })
  label!: 'author' | 'co_author' | 'former' | null;
  @ApiProperty({ description: 'Participante anônimo mostrado só à equipe (mural.manage)' }) revealed!: boolean;
}

export class MuralCardPerson {
  @ApiProperty() name!: string;
  @ApiProperty() userId!: string;
  @ApiProperty({ type: String, nullable: true }) photoVersion!: string | null;
  @ApiProperty({ enum: ['author', 'co_author'] }) role!: 'author' | 'co_author';
}
export class MuralCategory {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: String, nullable: true }) color!: string | null;
}
export class MuralEntity {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
}
export class ReactionCounts {
  @ApiProperty() like!: number;
  @ApiProperty() congrats!: number;
  @ApiProperty() support!: number;
  @ApiProperty() brilliant!: number;
  @ApiProperty() inspiring!: number;
}

/** O cartão do mural (RN-150): só isto sai. Nunca descrição, solução, etapas, ganho, anexos. */
export class MuralCard {
  @ApiProperty() code!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ enum: ['in_progress', 'implemented'] }) status!: string;
  @ApiProperty({ type: MuralCategory, nullable: true }) category!: MuralCategory | null;
  @ApiProperty({ type: MuralEntity }) entity!: MuralEntity;
  @ApiProperty({ format: 'date-time' }) publishedAt!: string;
  @ApiProperty({ type: [MuralCardPerson], description: 'Só quem consentiu (RN-151)' }) people!: MuralCardPerson[];
  @ApiProperty({ type: ReactionCounts }) reactions!: ReactionCounts;
  @ApiProperty() reactionTotal!: number;
  @ApiProperty({ enum: [...MURAL_REACTIONS], nullable: true }) myReaction!: string | null;
  @ApiProperty() commentCount!: number;
  @ApiProperty({ description: 'Quem pergunta já abre a ideia pela RN-01 (o botão "Abrir a ideia")' })
  canOpen!: boolean;
  @ApiProperty({ description: 'Pode reagir (participantes não reagem à própria ideia)' }) canReact!: boolean;
  @ApiProperty({ description: 'Pode retirar e moderar (mural.manage na entidade da ideia)' }) canManage!: boolean;
}

export class MuralFeed {
  @ApiProperty({ type: [MuralCard] }) items!: MuralCard[];
  @ApiProperty({ type: String, nullable: true, description: 'Passe em `cursor` para a próxima página' })
  nextCursor!: string | null;
}

export class MuralCommentView {
  @ApiProperty() id!: string;
  @ApiProperty({ type: String, nullable: true }) parentId!: string | null;
  @ApiProperty({ type: MuralPerson, nullable: true, description: 'Nulo quando removido' }) author!: MuralPerson | null;
  @ApiProperty({ type: String, nullable: true, description: 'Nulo quando removido ou oculto para quem pergunta' })
  body!: string | null;
  @ApiProperty({ enum: ['visible', 'deleted', 'hidden'] }) state!: 'visible' | 'deleted' | 'hidden';
  @ApiProperty({ type: String, nullable: true, description: 'Motivo, só para quem escreveu e para a equipe' })
  hiddenReason!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' }) editedAt!: string | null;
  @ApiProperty() mine!: boolean;
  @ApiProperty() canEdit!: boolean;
  @ApiProperty() canReport!: boolean;
  @ApiProperty() reportedByMe!: boolean;
  @ApiProperty({ description: 'Denúncias pendentes (só para a equipe; 0 para os outros)' }) pendingReports!: number;
  @ApiProperty({ type: () => [MuralCommentView] }) replies!: MuralCommentView[];
}

export class MuralPage {
  @ApiProperty({ type: MuralCard }) card!: MuralCard;
  @ApiProperty({ type: [MuralCommentView] }) comments!: MuralCommentView[];
  @ApiProperty({ description: 'Pode comentar (o módulo ligado e a ideia no mural)' }) canComment!: boolean;
}

export class ReactionResult {
  @ApiProperty({ type: ReactionCounts }) reactions!: ReactionCounts;
  @ApiProperty() reactionTotal!: number;
  @ApiProperty({ enum: [...MURAL_REACTIONS], nullable: true }) myReaction!: string | null;
}

export class ReactorView {
  @ApiProperty({ type: MuralPerson }) person!: MuralPerson;
  @ApiProperty({ enum: [...MURAL_REACTIONS] }) kind!: string;
}

export class CommentRevisionView {
  @ApiProperty() body!: string;
  @ApiProperty({ format: 'date-time', description: 'Quando este texto foi substituído' }) replacedAt!: string;
}

export class ReportReasonCount {
  @ApiProperty({ enum: [...REPORT_REASONS] }) reason!: string;
  @ApiProperty() count!: number;
}
export class ReportNote {
  @ApiProperty({ enum: [...REPORT_REASONS] }) reason!: string;
  @ApiProperty() note!: string;
}

/** Comentário com denúncias pendentes, para a fila da equipe (RN-154). Quem denunciou não aparece. */
export class ReportQueueItem {
  @ApiProperty() commentId!: string;
  @ApiProperty() ideaCode!: string;
  @ApiProperty() ideaTitle!: string;
  @ApiProperty({ type: MuralPerson }) author!: MuralPerson;
  @ApiProperty() body!: string;
  @ApiProperty({ format: 'date-time' }) commentedAt!: string;
  @ApiProperty() count!: number;
  @ApiProperty({ type: [ReportReasonCount] }) reasons!: ReportReasonCount[];
  @ApiProperty({ type: [ReportNote] }) notes!: ReportNote[];
  @ApiProperty({ format: 'date-time' }) firstReportedAt!: string;
}

export class MuralPersonOption {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: String, nullable: true }) photoVersion!: string | null;
}
