import { ApiProperty } from '@nestjs/swagger';
import {
  APPROVAL_HOLDS,
  APPROVAL_STATUSES,
  AREA_MAX,
  DAYS_MAX,
  DAYS_MIN,
  DECISION_SOURCES,
  MAX_ATTACHMENTS,
  MAX_RECIPIENTS,
  NAME_MAX,
  REASON_MAX,
  RECIPIENT_DECISIONS,
  SUMMARY_MAX,
} from './approval-rules.js';

/** Aprovação de outras áreas (M24, RN-183 a RN-192): o contrato. */
export class ApprovalRecipientInput {
  @ApiProperty({ required: false, description: 'Pessoa do ITS (ou, para quem é de fora, nome, e-mail e área)' })
  userId?: string;
  @ApiProperty({ required: false, maxLength: NAME_MAX }) name?: string;
  @ApiProperty({ required: false, example: 'gerente@empresa.com' }) email?: string;
  @ApiProperty({ required: false, maxLength: AREA_MAX, description: 'A área que a pessoa representa' })
  area?: string;
}

export class ApprovalRequestBody {
  @ApiProperty({ enum: APPROVAL_HOLDS, description: 'A transição que o pedido segura' })
  holds!: (typeof APPROVAL_HOLDS)[number];
  @ApiProperty({ maxLength: SUMMARY_MAX, description: 'O que o aprovador precisa saber (texto simples)' })
  summary!: string;
  @ApiProperty({ required: false, minimum: DAYS_MIN, maximum: DAYS_MAX, description: 'Prazo em dias' })
  days?: number;
  @ApiProperty({ required: false, description: 'Mostrar o ganho estimado ao aprovador' })
  showGain?: boolean;
  @ApiProperty({ type: [String], required: false, maxItems: MAX_ATTACHMENTS, description: 'Anexos da ideia a mostrar' })
  attachmentIds?: string[];
  @ApiProperty({ type: [ApprovalRecipientInput], minItems: 1, maxItems: MAX_RECIPIENTS })
  recipients!: ApprovalRecipientInput[];
}

export class ApprovalReasonBody {
  @ApiProperty({ maxLength: REASON_MAX }) reason!: string;
}

export class ApprovalFileRef {
  @ApiProperty() id!: string;
  @ApiProperty() originalName!: string;
}

export class ApprovalRecipientView {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: ['user', 'external'] }) kind!: 'user' | 'external';
  @ApiProperty({ type: String, nullable: true }) userId!: string | null;
  @ApiProperty() name!: string;
  @ApiProperty({ type: String, nullable: true, description: 'Só de quem é de fora (sensível)' }) email!: string | null;
  @ApiProperty() area!: string;
  @ApiProperty({ enum: RECIPIENT_DECISIONS }) decision!: (typeof RECIPIENT_DECISIONS)[number];
  @ApiProperty({ enum: DECISION_SOURCES, nullable: true }) source!: (typeof DECISION_SOURCES)[number] | null;
  @ApiProperty({ type: String, nullable: true }) comment!: string | null;
  @ApiProperty({ type: String, nullable: true }) decidedName!: string | null;
  @ApiProperty({ type: String, nullable: true }) decidedAt!: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Data informada no registro manual' })
  decidedOn!: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Quem registrou (registro manual)' })
  recordedBy!: string | null;
  @ApiProperty({ type: [ApprovalFileRef] }) evidence!: ApprovalFileRef[];
}

export class ApprovalGainView {
  @ApiProperty() estimated!: string;
  @ApiProperty() currency!: string;
  @ApiProperty() periodicity!: string;
}

export class ApprovalPersonRef {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
}

export class ApprovalRequestView {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: APPROVAL_STATUSES }) status!: (typeof APPROVAL_STATUSES)[number];
  @ApiProperty({ enum: APPROVAL_HOLDS }) holds!: (typeof APPROVAL_HOLDS)[number];
  @ApiProperty() summary!: string;
  @ApiProperty() ideaTitle!: string;
  @ApiProperty({ type: ApprovalGainView, nullable: true }) gain!: ApprovalGainView | null;
  @ApiProperty({ example: '2026-11-30' }) dueOn!: string;
  @ApiProperty() expiresAt!: string;
  @ApiProperty() createdAt!: string;
  @ApiProperty({ type: String, nullable: true }) closedAt!: string | null;
  @ApiProperty({ type: ApprovalPersonRef }) requestedBy!: ApprovalPersonRef;
  @ApiProperty({ type: String, nullable: true }) cancelReason!: string | null;
  @ApiProperty({ type: String, nullable: true }) overriddenAt!: string | null;
  @ApiProperty({ type: String, nullable: true }) overriddenBy!: string | null;
  @ApiProperty({ type: String, nullable: true }) overrideReason!: string | null;
  @ApiProperty({ type: [ApprovalFileRef] }) attachments!: ApprovalFileRef[];
  @ApiProperty({ type: [ApprovalRecipientView] }) recipients!: ApprovalRecipientView[];
}

export class ApprovalFormInfo {
  @ApiProperty({ description: 'Prazo padrão em dias (approval.default_days)' }) defaultDays!: number;
  @ApiProperty({ type: [String], description: 'Domínios da empresa (RN-95); vazio = nenhum aviso' })
  emailDomains!: string[];
  @ApiProperty({ description: 'Aceita e-mail fora dos domínios (approval.allow_outside_domains)' })
  allowOutsideDomains!: boolean;
  @ApiProperty({ description: 'O e-mail com o link sai para quem é de fora (envio ligado e endereço do sistema)' })
  emailActive!: boolean;
}

export class ApprovalsView {
  @ApiProperty({
    enum: ['none', 'pending', 'approved', 'not_approved'],
    description: 'O que todos que veem a ideia sabem',
  })
  state!: 'none' | 'pending' | 'approved' | 'not_approved';
  @ApiProperty({ description: 'Pode pedir, cancelar e seguir sem a aprovação (a equipe)' }) canManage!: boolean;
  @ApiProperty({ description: 'Vê os detalhes (equipe e gestores com acesso)' }) full!: boolean;
  @ApiProperty({ enum: ['return', 'block'] }) onReject!: 'return' | 'block';
  @ApiProperty({ type: [ApprovalRequestView], description: 'Só com `full`; do mais novo ao mais antigo' })
  requests!: ApprovalRequestView[];
  @ApiProperty({ type: ApprovalFormInfo, nullable: true, description: 'Só para a equipe (`canManage`)' })
  form!: ApprovalFormInfo | null;
}

// --- Decidir (M24, fatia 2) ---------------------------------------------------------------

export class ApprovalTokenBody {
  @ApiProperty({ description: 'O link de uso único (o que vem depois do # no endereço)' }) token!: string;
}

export class ApprovalLinkDecisionBody {
  @ApiProperty() token!: string;
  @ApiProperty({ enum: ['approved', 'rejected'] }) decision!: 'approved' | 'rejected';
  @ApiProperty({ required: false, maxLength: 1000, description: 'Obrigatório para não aprovar' }) comment?: string;
  @ApiProperty({ maxLength: NAME_MAX, description: 'O nome confirmado de quem decide' }) name!: string;
  @ApiProperty({ required: false, example: '042917', description: 'Com o código ligado (RN-185)' }) code?: string;
}

export class ApprovalLinkAttachmentBody {
  @ApiProperty() token!: string;
  @ApiProperty() attachmentId!: string;
}

export class ApprovalSnapshotFile {
  @ApiProperty() id!: string;
  @ApiProperty() originalName!: string;
  @ApiProperty() sizeBytes!: number;
}

export class ApprovalSnapshotView {
  @ApiProperty() ideaCode!: string;
  @ApiProperty() ideaTitle!: string;
  @ApiProperty() summary!: string;
  @ApiProperty() area!: string;
  @ApiProperty({ description: 'Nome do aprovador' }) name!: string;
  @ApiProperty({ description: 'Quem pediu' }) requestedBy!: string;
  @ApiProperty({ example: '2026-11-30' }) dueOn!: string;
  @ApiProperty({ type: ApprovalGainView, nullable: true }) gain!: ApprovalGainView | null;
  @ApiProperty({ type: [ApprovalSnapshotFile] }) attachments!: ApprovalSnapshotFile[];
}

export class ApprovalLinkView {
  @ApiProperty({ enum: ['open', 'decided', 'expired', 'cancelled', 'closed'] })
  state!: 'open' | 'decided' | 'expired' | 'cancelled' | 'closed';
  @ApiProperty({ type: ApprovalSnapshotView, nullable: true, description: 'Só com o link aberto' })
  request!: ApprovalSnapshotView | null;
  @ApiProperty({ description: 'Pede o código de confirmação (RN-185)' }) codeRequired!: boolean;
  @ApiProperty({ enum: ['approved', 'rejected'], nullable: true }) decision!: 'approved' | 'rejected' | null;
}

export class MyPendingApprovalView extends ApprovalSnapshotView {
  @ApiProperty() recipientId!: string;
  @ApiProperty() requestId!: string;
  @ApiProperty({ description: 'Pode abrir a ideia (já tinha acesso a ela)' }) canOpenIdea!: boolean;
}

export class ApprovalDecisionBody {
  @ApiProperty({ enum: ['approved', 'rejected'] }) decision!: 'approved' | 'rejected';
  @ApiProperty({ required: false, maxLength: 1000, description: 'Obrigatório para não aprovar' }) comment?: string;
}

export class ApprovalOkView {
  @ApiProperty() ok!: boolean;
}
