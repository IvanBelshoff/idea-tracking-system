import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';
import { PageMeta, PageQuerySchema } from '../common/pagination.js';
import type { RichDoc } from '../common/rich-text.js';
import { NamedRef, PersonWithPhoto } from '../identity-access/users.dto.js';
import { IdeaStatus } from './entities/idea.entity.js';
import { Visibility } from './entities/idea-related.entity.js';

/*
 * Contratos das ideias. Validação real com Zod (campos desconhecidos são descartados: o autor
 * nunca vem do corpo, CA-RN-02.2); classes para o OpenAPI.
 */

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));
const isoDate = z.iso.date();
/** O documento do editor (RN-136): já limpo por `normalizeRich` antes de chegar aqui. */
const rich = z
  .custom<RichDoc>((v) => v === null || (typeof v === 'object' && (v as { type?: string })?.type === 'doc'))
  .nullish();

export const ApproveSchema = z.object({
  stepName: text(200),
  stepDescription: optionalText(5000),
  stepDescriptionRich: rich,
  assigneeId: z.uuid(),
  dueDate: isoDate,
  stepModel: z.enum(['free', 'pdca']).default('free'),
});

export const SubmitIdeaSchema = z.object({
  title: text(200),
  description: text(10_000),
  descriptionRich: rich,
  entityId: z.uuid(),
  categoryId: z.uuid().nullish(),
  tagIds: z.array(z.uuid()).max(10).default([]),
  proposedSolution: optionalText(10_000),
  proposedSolutionRich: rich,
  expectedGain: optionalText(5000),
  externalRef: optionalText(100),
  /** Cadastro em nome de outra pessoa (RN-04): exige `idea.register_for_other` na entidade. */
  onBehalfOfUserId: z.uuid().nullish(),
  /** Atalho da D3 (CA-RN-04.3): já nasce aprovada, com a primeira etapa. */
  approveNow: ApproveSchema.nullish(),
  campaignId: z.uuid().nullish(),
});

export const UpdateIdeaSchema = z
  .object({
    title: text(200),
    description: text(10_000),
    descriptionRich: rich,
    entityId: z.uuid(),
    categoryId: z.uuid().nullable(),
    tagIds: z.array(z.uuid()).max(10),
    proposedSolution: optionalText(10_000),
    proposedSolutionRich: rich,
    expectedGain: optionalText(5000),
    externalRef: optionalText(100),
  })
  .partial();

const optionalDate = z.iso.date().nullish();
export const StepSchema = z.object({
  name: text(200),
  description: optionalText(5000),
  descriptionRich: rich,
  assigneeId: z.uuid(),
  startDate: optionalDate,
  dueDate: isoDate,
});
export const UpdateStepSchema = StepSchema.partial().refine(
  (v) => Object.keys(v).length > 0,
  'Informe ao menos um campo',
);

export const ReasonSchema = z.object({ reason: z.string().trim().min(1, 'Informe a justificativa.').max(5000) });
export const ImplementSchema = z.object({
  resultText: z.string().trim().min(1).max(10_000),
  resultTextRich: rich,
  standardAdopted: optionalText(10_000),
  standardAdoptedRich: rich,
  isReplicable: z.boolean().optional(),
});
export const CommentSchema = z.object({
  body: text(5000),
  bodyRich: rich,
  visibility: z.enum(Visibility).default(Visibility.Public),
});

export const IdeaListQuerySchema = PageQuerySchema.extend({
  status: z
    .union([z.enum(IdeaStatus), z.array(z.enum(IdeaStatus))])
    .optional()
    .transform((v) => (v === undefined ? [] : Array.isArray(v) ? v : [v])),
  entityId: z.uuid().optional(),
  categoryId: z.uuid().optional(),
  search: z.string().trim().max(200).optional(),
  assignedToMe: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  sort: z.enum(['oldest', 'newest', 'priority']).default('newest'),
});

export const PeopleQuerySchema = z.object({ search: z.string().trim().max(200).default('') });

// --- Saídas ---------------------------------------------------------------------------------------

export class CategoryRef {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ example: '#4f46e5' }) color!: string;
}

export class IdeaCodeRef {
  @ApiProperty({ example: 'ITS-2026-0042' }) code!: string;
  @ApiProperty() title!: string;
}

export class IdeaSummary {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'ITS-2026-0042' }) code!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ enum: IdeaStatus, enumName: 'IdeaStatus' }) status!: IdeaStatus;
  @ApiProperty({ type: NamedRef }) entity!: NamedRef;
  @ApiProperty({ type: CategoryRef, nullable: true }) category!: CategoryRef | null;
  @ApiProperty({ type: NamedRef, nullable: true, description: 'Nulo só em casos de dados antigos sem autor' })
  author!: NamedRef | null;
  @ApiProperty({ type: NamedRef, nullable: true }) assignedTo!: NamedRef | null;
  @ApiProperty({ format: 'date-time' }) submittedAt!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) archivedAt!: string | null;
  @ApiProperty({
    type: String,
    format: 'date',
    nullable: true,
    description: 'Prazo = previsão da última etapa (RN-17)',
  })
  deadline!: string | null;
  @ApiProperty({ description: 'Em andamento com etapa aberta vencida, no fuso da instalação (RN-18)' }) late!: boolean;
  @ApiProperty({ format: 'date', description: 'Previsão de retorno da triagem: envio + prazo (RN-54)' })
  triageDue!: string;
  @ApiProperty({ description: 'Ainda Enviada depois da previsão de retorno (RN-54)' }) triageOverdue!: boolean;
  @ApiProperty({
    type: IdeaCodeRef,
    nullable: true,
    description: 'Convergida com esta principal (RN-84): a situação mostrada é a da principal',
  })
  convergedInto!: IdeaCodeRef | null;
  @ApiProperty({
    enum: ['author', 'co_author'],
    nullable: true,
    description: 'Em "Minhas ideias": se a pessoa é autora ou co-autora (RN-87)',
  })
  relation!: 'author' | 'co_author' | null;
  @ApiProperty({ type: Number, nullable: true, description: 'Impacto de 1 a 5 (RN-56); só para a equipe' })
  impact!: number | null;
  @ApiProperty({ type: Number, nullable: true, description: 'Esforço de 1 a 5 (RN-56); só para a equipe' })
  effort!: number | null;
}

export class IdeaPage {
  @ApiProperty({ type: [IdeaSummary] }) items!: IdeaSummary[];
  @ApiProperty({ type: PageMeta }) meta!: PageMeta;
}

export class StepView {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() position!: number;
  @ApiProperty() name!: string;
  @ApiProperty({ type: String, nullable: true }) description!: string | null;
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    description: 'Documento do editor (RN-136); nulo = só o texto puro',
  })
  descriptionRich!: RichDoc | null;
  @ApiProperty({ type: NamedRef }) assignee!: NamedRef;
  @ApiProperty({ format: 'date' }) startDate!: string;
  @ApiProperty({ format: 'date' }) dueDate!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) completedAt!: string | null;
  @ApiProperty({ description: 'Só a última etapa aberta é editável (RN-13)' }) editable!: boolean;
  @ApiProperty({ description: 'Pode ser excluída (última aberta, sobrando outra)' }) deletable!: boolean;
  @ApiProperty({ description: 'Quem chama pode concluir (aberta; responsável ou gestão de etapas)' })
  canComplete!: boolean;
  @ApiProperty({ description: 'Quantidade de anexos' }) attachmentsCount!: number;
  @ApiProperty({ enum: ['plan', 'do', 'check', 'act'], nullable: true, description: 'Fase PDCA (RN-60)' })
  pdcaPhase!: 'plan' | 'do' | 'check' | 'act' | null;
}

/** Medição (RN-61). Atingimento só com meta (CA-RN-61.2); a variação aparece sempre que há obtido. */
export class MeasurementView {
  @ApiProperty() indicator!: string;
  @ApiProperty({ example: 'min' }) unit!: string;
  @ApiProperty({ enum: ['increase', 'decrease'] }) direction!: 'increase' | 'decrease';
  @ApiProperty() baseline!: number;
  @ApiProperty({ type: Number, nullable: true }) target!: number | null;
  @ApiProperty({ type: Number, nullable: true }) achieved!: number | null;
  @ApiProperty({ type: Number, nullable: true, description: 'De 0 a 1; nulo sem meta ou sem obtido' })
  attainment!: number | null;
  @ApiProperty({ type: Number, nullable: true, description: 'Obtido − linha de base' }) variation!: number | null;
  @ApiProperty({ type: Number, nullable: true, description: 'Variação ÷ linha de base' })
  variationPercent!: number | null;
}

/** Revisão de sustentação (RN-65): a mais recente da ideia. */
export class SustainmentView {
  @ApiProperty({ format: 'date' }) dueOn!: string;
  @ApiProperty({ enum: ['pending', 'confirmed', 'contested'] }) status!: 'pending' | 'confirmed' | 'contested';
  @ApiProperty({ description: 'Já chegou o dia da revisão' }) due!: boolean;
  @ApiProperty({ type: NamedRef, nullable: true }) reviewedBy!: NamedRef | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) reviewedAt!: string | null;
  @ApiProperty({ type: String, nullable: true }) note!: string | null;
}

/** Ganho financeiro (RN-62, RN-63). ROI só com ganho validado e custo maior que zero (RN-82). */
export class GainView {
  @ApiProperty({ example: 'BRL' }) currency!: string;
  @ApiProperty({ enum: ['once', 'monthly', 'yearly'] }) periodicity!: 'once' | 'monthly' | 'yearly';
  @ApiProperty({ type: Number, nullable: true, description: 'Estimado na triagem' }) estimated!: number | null;
  @ApiProperty({ type: Number, nullable: true, description: 'Realizado, informado depois de implementar' })
  realized!: number | null;
  @ApiProperty({ type: Number, nullable: true }) implementationCost!: number | null;
  @ApiProperty({ type: Number, nullable: true, description: 'Realizado anualizado (mensal × 12)' })
  annualizedRealized!: number | null;
  @ApiProperty({ type: Number, nullable: true, description: 'Ganho validado anualizado ÷ custo' }) roi!: number | null;
  @ApiProperty({ enum: ['declared', 'validated'] }) status!: 'declared' | 'validated';
  @ApiProperty({ type: NamedRef, nullable: true }) validatedBy!: NamedRef | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) validatedAt!: string | null;
}

/** O que quem chama pode fazer nesta ideia (a API confere de novo em cada ação). */
export class IdeaCapabilities {
  @ApiProperty() edit!: boolean;
  @ApiProperty() triage!: boolean;
  @ApiProperty() reopen!: boolean;
  @ApiProperty() archive!: boolean;
  @ApiProperty() delete!: boolean;
  @ApiProperty() manageSteps!: boolean;
  @ApiProperty() comment!: boolean;
  @ApiProperty() commentInternal!: boolean;
  @ApiProperty({ description: 'Converger esta ideia com outra (RN-85)' }) converge!: boolean;
  @ApiProperty({ description: 'Desfazer a convergência desta ideia (RN-88)' }) unconverge!: boolean;
  @ApiProperty({ description: 'Apoiar (entrar como co-autor; RN-85)' }) support!: boolean;
  @ApiProperty({ description: 'Adicionar e remover participantes (RN-69)' }) manageParticipants!: boolean;
  @ApiProperty({ description: 'Editar medição, ganho e padronização (RN-61 a RN-64)' }) editResults!: boolean;
  @ApiProperty({ description: 'Validar o ganho realizado (gain.validate; RN-63)' }) validateGain!: boolean;
  @ApiProperty({ description: 'Replicar em outra entidade (RN-64)' }) replicate!: boolean;
  @ApiProperty({ description: 'Confirmar ou contestar a sustentação (RN-65)' }) reviewSustainment!: boolean;
  @ApiProperty({ description: 'Destacar no Hall (RN-72): curadoria e ideia elegível' }) highlight!: boolean;
}

export class ParticipantView {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ type: NamedRef }) user!: NamedRef;
  @ApiProperty({ enum: ['author', 'executor', 'co_author'] }) role!: string;
  @ApiProperty({ enum: ['original', 'support', 'converged', 'manual'] }) origin!: string;
  @ApiProperty({ type: String, nullable: true, description: 'Texto de apoio; só a equipe vê' }) note!: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Ideia de origem (convergência); só a equipe vê' })
  sourceCode!: string | null;
}

export class ConvergedIdeaView {
  @ApiProperty() code!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ description: 'Texto original, preservado (RN-86)' }) description!: string;
  @ApiProperty({ type: NamedRef, nullable: true }) author!: NamedRef | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) convergedAt!: string | null;
  @ApiProperty({ type: String, nullable: true }) reason!: string | null;
}

export class PublicLookupSettings {
  @ApiProperty({ description: 'A consulta pública desta ideia está ativa (RN-37)' }) enabled!: boolean;
  @ApiProperty({ description: 'Código de acompanhamento (RN-34); só o autor o vê' }) code!: string;
}

export class SetPublicLookupRequest {
  @ApiProperty() enabled!: boolean;
}

export const SetPublicLookupSchema = z.object({ enabled: z.boolean() });

export const PrioritySchema = z.object({
  impact: z.number().int().min(1).max(5).nullable(),
  effort: z.number().int().min(1).max(5).nullable(),
  expectedStatus: z.enum(IdeaStatus).optional(),
});

export class PriorityRequest {
  @ApiProperty({ type: Number, nullable: true, minimum: 1, maximum: 5 }) impact!: number | null;
  @ApiProperty({ type: Number, nullable: true, minimum: 1, maximum: 5 }) effort!: number | null;
  @ApiProperty({ enum: IdeaStatus, enumName: 'IdeaStatus', required: false }) expectedStatus?: IdeaStatus;
}

export const ConvergeSchema = z.object({
  targetRef: z.string().trim().min(1).max(64),
  reason: z.string().trim().min(1, 'Informe a justificativa.').max(5000),
});
export class ConvergeRequest {
  @ApiProperty({ description: 'Código ou id da outra ideia (a mais antiga das duas vira a principal)' })
  targetRef!: string;
  @ApiProperty({ description: 'Por que são a mesma coisa (obrigatória; RN-85)' }) reason!: string;
}

export const UnconvergeSchema = z.object({ reason: z.string().trim().max(5000).optional() });
export class UnconvergeRequest {
  @ApiProperty({ required: false }) reason?: string;
}

export const SupportSchema = z.object({ note: z.string().trim().max(2000).optional() });
export class SupportRequest {
  @ApiProperty({ required: false, description: 'Contexto que a pessoa quer acrescentar (só a equipe vê)' })
  note?: string;
}

export const ParticipantSchema = z.object({
  userId: z.uuid(),
  role: z.enum(['co_author', 'executor']),
  note: z.string().trim().max(2000).nullable().optional(),
});
export class ParticipantRequest {
  @ApiProperty({ format: 'uuid' }) userId!: string;
  @ApiProperty({ enum: ['co_author', 'executor'] }) role!: string;
  @ApiProperty({ type: String, nullable: true, required: false }) note?: string | null;
}

export const SimilarQuerySchema = z.object({
  q: z.string().trim().max(300).default(''),
  entityId: z.uuid().optional(),
});
export class SimilarIdeaView {
  @ApiProperty() code!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ enum: IdeaStatus, enumName: 'IdeaStatus' }) status!: IdeaStatus;
  @ApiProperty({ description: 'A pessoa pode abrir a ideia (senão, só viu o título)' }) canView!: boolean;
  @ApiProperty() canSupport!: boolean;
  @ApiProperty({ description: 'É uma ideia da própria pessoa' }) own!: boolean;
}

export const AssignSchema = z.object({
  assigneeId: z.uuid().nullable(),
  expectedStatus: z.enum(IdeaStatus).optional(),
});

export class AssignRequest {
  @ApiProperty({ type: String, format: 'uuid', nullable: true, description: 'Nulo devolve à fila geral' })
  assigneeId!: string | null;
  @ApiProperty({ enum: IdeaStatus, enumName: 'IdeaStatus', required: false }) expectedStatus?: IdeaStatus;
}

export class IdeaDetail extends IdeaSummary {
  @ApiProperty({ description: 'Quantas pessoas pediram a mesma coisa: autor + co-autores (RN-87)' })
  requesters!: number;
  @ApiProperty({ type: [ParticipantView] }) participants!: ParticipantView[];
  @ApiProperty({ type: [ConvergedIdeaView], description: 'Só para a equipe (RN-86)' })
  convergedIdeas!: ConvergedIdeaView[];
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Justificativa da convergência, se esta ideia foi convergida',
  })
  convergedReason!: string | null;
  @ApiProperty({ type: PublicLookupSettings, nullable: true, description: 'Só para o autor da ideia' })
  publicLookup!: PublicLookupSettings | null;
  @ApiProperty() description!: string;
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    description: 'Documento do editor (RN-136); nulo = só o texto puro',
  })
  descriptionRich!: RichDoc | null;
  @ApiProperty({ type: String, nullable: true }) proposedSolution!: string | null;
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    description: 'Documento do editor (RN-136); nulo = só o texto puro',
  })
  proposedSolutionRich!: RichDoc | null;
  @ApiProperty({ type: String, nullable: true }) expectedGain!: string | null;
  @ApiProperty({ type: String, nullable: true }) externalRef!: string | null;
  @ApiProperty({ type: [CategoryRef] }) tags!: CategoryRef[];
  @ApiProperty({ type: NamedRef, nullable: true, description: 'Quem cadastrou em nome do autor (RN-04)' })
  registeredBy!: NamedRef | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Nome da integração que enviou a ideia pela API ("via Integração X", RN-133)',
  })
  viaIntegration!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) reviewStartedAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) decidedAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) implementedAt!: string | null;
  @ApiProperty({ type: String, nullable: true }) rejectionReason!: string | null;
  @ApiProperty({ type: String, nullable: true }) resultText!: string | null;
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    description: 'Documento do editor (RN-136); nulo = só o texto puro',
  })
  resultTextRich!: RichDoc | null;
  @ApiProperty({ type: [StepView] }) steps!: StepView[];
  @ApiProperty({ description: 'Progresso de 0 a 100 (RN-19)' }) progress!: number;
  @ApiProperty({ enum: ['steps', 'time'], description: 'Como o progresso é calculado' }) progressMode!:
    | 'steps'
    | 'time';
  @ApiProperty({ description: 'Em andamento e todas as etapas concluídas: criar nova ou implementar (RN-20)' })
  allStepsCompleted!: boolean;
  @ApiProperty({ enum: ['free', 'pdca'], description: 'Modelo das etapas (RN-60)' }) stepModel!: 'free' | 'pdca';
  @ApiProperty({
    enum: ['plan', 'do', 'check', 'act'],
    nullable: true,
    description: 'Fase da próxima etapa, quando o modelo é PDCA',
  })
  nextPdcaPhase!: 'plan' | 'do' | 'check' | 'act' | null;
  @ApiProperty({ type: MeasurementView, nullable: true }) measurement!: MeasurementView | null;
  @ApiProperty({ type: GainView, nullable: true, description: 'Para a equipe, o autor e quem valida ganhos' })
  gain!: GainView | null;
  @ApiProperty({ type: String, nullable: true, description: 'Padrão adotado (RN-64)' }) standardAdopted!: string | null;
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    description: 'Documento do editor (RN-136); nulo = só o texto puro',
  })
  standardAdoptedRich!: RichDoc | null;
  @ApiProperty() isReplicable!: boolean;
  @ApiProperty({ type: IdeaCodeRef, nullable: true, description: 'Ideia de origem, se esta é uma réplica' })
  origin!: IdeaCodeRef | null;
  @ApiProperty({ type: [IdeaCodeRef], description: 'Réplicas desta ideia em outras entidades' })
  replicas!: IdeaCodeRef[];
  @ApiProperty({ type: SustainmentView, nullable: true }) sustainment!: SustainmentView | null;
  @ApiProperty({ type: NamedRef, nullable: true, description: 'Campanha vinculada (RN-51)' })
  campaign!: NamedRef | null;
  @ApiProperty({ type: String, nullable: true, description: 'Destaque em vigor no Hall (id), se houver' })
  highlightId!: string | null;
  @ApiProperty({ type: IdeaCapabilities }) can!: IdeaCapabilities;
}

export class CommentView {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() body!: string;
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    description: 'Documento do editor (RN-136); nulo = só o texto puro',
  })
  bodyRich!: RichDoc | null;
  @ApiProperty({ enum: Visibility, enumName: 'Visibility' }) visibility!: Visibility;
  @ApiProperty({ type: PersonWithPhoto, nullable: true, description: 'Nulo no comentário de uma integração (M18)' })
  author!: PersonWithPhoto | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Nome da integração que comentou pela API ("via Integração X")',
  })
  viaIntegration!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class TimelineEvent {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'status_changed' }) type!: string;
  @ApiProperty({ format: 'date-time' }) at!: string;
  @ApiProperty({ type: NamedRef, nullable: true, description: 'Nulo quando foi o sistema' }) actor!: NamedRef | null;
  @ApiProperty({ type: String, nullable: true }) reason!: string | null;
  @ApiProperty({ type: 'object', additionalProperties: true }) data!: Record<string, unknown>;
  @ApiProperty({ enum: Visibility, enumName: 'Visibility' }) visibility!: Visibility;
}

export class AttachmentView {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) stepId!: string | null;
  @ApiProperty() originalName!: string;
  @ApiProperty() mime!: string;
  @ApiProperty() sizeBytes!: number;
  @ApiProperty({ type: NamedRef }) uploadedBy!: NamedRef;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ description: 'Quem chama pode remover (etapa aberta e step.manage)' }) deletable!: boolean;
  @ApiProperty({
    description: 'Imagem ou vídeo que a tela tenta abrir (RN-147); o servidor confere o conteúdo ao exibir',
  })
  viewable!: boolean;
}

/** Anexos da própria ideia (RN-146). */
export class IdeaAttachments {
  @ApiProperty({ type: [AttachmentView] }) items!: AttachmentView[];
  @ApiProperty({ description: 'Quem chama pode anexar agora (direito, situação e limite)' }) canUpload!: boolean;
  @ApiProperty({ description: 'Até quantos anexos a ideia aceita' }) limit!: number;
}

export class PersonRef extends NamedRef {
  @ApiProperty() email!: string;
}

export class PersonFieldView {
  @ApiProperty() labelPt!: string;
  @ApiProperty({ type: String, nullable: true }) labelEn!: string | null;
  @ApiProperty() value!: string;
}

/** Pessoa no seletor da equipe (RN-200): com os campos pesquisáveis que não são sensíveis. */
export class PersonOption extends PersonRef {
  @ApiProperty({ type: [PersonFieldView] }) fields!: PersonFieldView[];
}

// --- Entradas (OpenAPI) ---------------------------------------------------------------------------

export class ApproveRequest {
  @ApiProperty({ example: 'Planejar a mudança' }) stepName!: string;
  @ApiProperty({ type: String, required: false, nullable: true }) stepDescription?: string | null;
  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    description: 'Documento do editor (RN-136); o texto puro é derivado dele',
  })
  stepDescriptionRich?: RichDoc | null;
  @ApiProperty({ format: 'uuid', description: 'Responsável pela primeira etapa (RN-06)' }) assigneeId!: string;
  @ApiProperty({ format: 'date', description: 'Data prevista da primeira etapa' }) dueDate!: string;
  @ApiProperty({
    enum: ['free', 'pdca'],
    required: false,
    description: 'Modelo das etapas (RN-60): PDCA rotula as etapas Planejar, Fazer, Verificar, Agir',
  })
  stepModel?: 'free' | 'pdca';
  @ApiProperty({
    enum: IdeaStatus,
    enumName: 'IdeaStatus',
    required: false,
    description: 'Estado que a tela mostrava (409 se mudou)',
  })
  expectedStatus?: IdeaStatus;
}

export class SubmitIdeaRequest {
  @ApiProperty() title!: string;
  @ApiProperty({ description: 'Problema ou situação atual' }) description!: string;
  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    description: 'Documento do editor (RN-136); o texto puro é derivado dele',
  })
  descriptionRich?: RichDoc | null;
  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    description: 'Documento do editor (RN-136); o texto puro é derivado dele',
  })
  proposedSolutionRich?: RichDoc | null;
  @ApiProperty({ format: 'uuid' }) entityId!: string;
  @ApiProperty({ type: String, format: 'uuid', required: false, nullable: true }) categoryId?: string | null;
  @ApiProperty({ type: [String], required: false, description: 'Categorias secundárias' }) tagIds?: string[];
  @ApiProperty({ type: String, required: false, nullable: true }) proposedSolution?: string | null;
  @ApiProperty({ type: String, required: false, nullable: true }) expectedGain?: string | null;
  @ApiProperty({ type: String, required: false, nullable: true, maxLength: 100 }) externalRef?: string | null;
  @ApiProperty({ type: String, format: 'uuid', required: false, nullable: true }) onBehalfOfUserId?: string | null;
  @ApiProperty({ type: ApproveRequest, required: false, nullable: true }) approveNow?: ApproveRequest | null;
  @ApiProperty({ type: String, format: 'uuid', required: false, nullable: true, description: 'Campanha ativa (RN-51)' })
  campaignId?: string | null;
}

export class UpdateIdeaRequest {
  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    description: 'Documento do editor (RN-136); o texto puro é derivado dele',
  })
  descriptionRich?: RichDoc | null;
  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    description: 'Documento do editor (RN-136); o texto puro é derivado dele',
  })
  proposedSolutionRich?: RichDoc | null;
  @ApiProperty({ required: false }) title?: string;
  @ApiProperty({ required: false }) description?: string;
  @ApiProperty({ required: false, format: 'uuid' }) entityId?: string;
  @ApiProperty({ type: String, required: false, nullable: true, format: 'uuid' }) categoryId?: string | null;
  @ApiProperty({ type: [String], required: false }) tagIds?: string[];
  @ApiProperty({ type: String, required: false, nullable: true }) proposedSolution?: string | null;
  @ApiProperty({ type: String, required: false, nullable: true }) expectedGain?: string | null;
  @ApiProperty({ type: String, required: false, nullable: true }) externalRef?: string | null;
}

export class StepRequest {
  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    description: 'Documento do editor (RN-136); o texto puro é derivado dele',
  })
  descriptionRich?: RichDoc | null;
  @ApiProperty({ example: 'Pintar a faixa de pedestres' }) name!: string;
  @ApiProperty({ type: String, required: false, nullable: true }) description?: string | null;
  @ApiProperty({ format: 'uuid', description: 'Ativo e com acesso à entidade da ideia (CA-RN-15.2)' })
  assigneeId!: string;
  @ApiProperty({ type: String, format: 'date', required: false, nullable: true, description: 'Padrão: hoje' })
  startDate?: string | null;
  @ApiProperty({ format: 'date' }) dueDate!: string;
}

export class UpdateStepRequest {
  @ApiProperty({ required: false }) name?: string;
  @ApiProperty({ type: String, required: false, nullable: true }) description?: string | null;
  @ApiProperty({ required: false, format: 'uuid' }) assigneeId?: string;
  @ApiProperty({ type: String, required: false, nullable: true, format: 'date' }) startDate?: string | null;
  @ApiProperty({ required: false, format: 'date' }) dueDate?: string;
}

export class ReasonRequest {
  @ApiProperty() reason!: string;
  @ApiProperty({
    enum: IdeaStatus,
    enumName: 'IdeaStatus',
    required: false,
    description: 'Estado que a tela mostrava (409 se mudou)',
  })
  expectedStatus?: IdeaStatus;
}

export class ImplementRequest {
  @ApiProperty({ description: 'Resultado obtido (RN-07)' }) resultText!: string;
  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    description: 'Documento do editor (RN-136); o texto puro é derivado dele',
  })
  resultTextRich?: RichDoc | null;
  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    description: 'Documento do editor (RN-136); o texto puro é derivado dele',
  })
  standardAdoptedRich?: RichDoc | null;
  @ApiProperty({ type: String, required: false, nullable: true, description: 'Padrão adotado (RN-64)' })
  standardAdopted?: string | null;
  @ApiProperty({ required: false, description: 'A solução pode ser replicada em outra entidade (RN-64)' })
  isReplicable?: boolean;
  @ApiProperty({ enum: IdeaStatus, enumName: 'IdeaStatus', required: false }) expectedStatus?: IdeaStatus;
}

export class CommentRequest {
  @ApiProperty() body!: string;
  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    description: 'Documento do editor (RN-136); o texto puro é derivado dele',
  })
  bodyRich?: RichDoc | null;
  @ApiProperty({ enum: Visibility, enumName: 'Visibility', required: false, default: 'public' })
  visibility?: Visibility;
}

// --- Resultado (RN-61 a RN-64) --------------------------------------------------------------------

const amount = z.number().finite().min(0, 'Não pode ser negativo').max(1e11);
const measure = z.number().finite().min(-1e13).max(1e13);

export const MeasurementSchema = z.object({
  indicator: text(200),
  unit: text(40),
  direction: z.enum(['increase', 'decrease']),
  baseline: measure,
  target: measure.nullable().default(null),
  achieved: measure.nullable().default(null),
});
export class MeasurementRequest {
  @ApiProperty({ example: 'Tempo de troca de ferramenta' }) indicator!: string;
  @ApiProperty({ example: 'min' }) unit!: string;
  @ApiProperty({ enum: ['increase', 'decrease'], description: 'Melhorar = aumentar ou diminuir' }) direction!: string;
  @ApiProperty({ description: 'Valor antes (linha de base)' }) baseline!: number;
  @ApiProperty({ type: Number, nullable: true, required: false }) target?: number | null;
  @ApiProperty({ type: Number, nullable: true, required: false }) achieved?: number | null;
}

export const GainSchema = z.object({
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/)
    .optional(),
  periodicity: z.enum(['once', 'monthly', 'yearly']),
  estimated: amount.nullable().optional(),
  realized: amount.nullable().optional(),
  implementationCost: amount.nullable().optional(),
});
export class GainRequest {
  @ApiProperty({ required: false, example: 'BRL', description: 'Padrão: a moeda da instalação' }) currency?: string;
  @ApiProperty({ enum: ['once', 'monthly', 'yearly'] }) periodicity!: string;
  @ApiProperty({ type: Number, nullable: true, required: false, description: 'Só enquanto Enviada ou Em análise' })
  estimated?: number | null;
  @ApiProperty({ type: Number, nullable: true, required: false, description: 'Só depois de implementada' })
  realized?: number | null;
  @ApiProperty({ type: Number, nullable: true, required: false }) implementationCost?: number | null;
}

export const StandardSchema = z.object({
  standardAdopted: optionalText(10_000),
  standardAdoptedRich: rich,
  isReplicable: z.boolean(),
});
export class StandardRequest {
  @ApiProperty({ type: String, nullable: true }) standardAdopted!: string | null;
  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    description: 'Documento do editor (RN-136); o texto puro é derivado dele',
  })
  standardAdoptedRich?: RichDoc | null;
  @ApiProperty() isReplicable!: boolean;
}

export const ReplicateSchema = z.object({ entityId: z.uuid() });
export class ReplicateRequest {
  @ApiProperty({ format: 'uuid', description: 'Entidade onde a nova ideia vai acontecer' }) entityId!: string;
}

export class PendingGainView {
  @ApiProperty() code!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ type: NamedRef }) entity!: NamedRef;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) implementedAt!: string | null;
  @ApiProperty({ type: GainView }) gain!: GainView;
}

export const SustainmentSchema = z
  .object({ decision: z.enum(['confirmed', 'contested']), note: optionalText(5000) })
  .refine((v) => v.decision === 'confirmed' || !!v.note, { path: ['note'], message: 'Conte o que mudou.' });
export class SustainmentRequest {
  @ApiProperty({ enum: ['confirmed', 'contested'], description: 'O ganho se mantém (confirmar) ou não (contestar)' })
  decision!: string;
  @ApiProperty({ type: String, nullable: true, required: false, description: 'Obrigatória ao contestar' })
  note?: string | null;
}
