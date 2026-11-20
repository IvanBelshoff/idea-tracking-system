import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiParam,
  ApiProduces,
  ApiQuery,
  ApiResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { ApiErrorBody, apiError, parseInput } from '../common/api-error.js';
import { normalizeRich } from '../common/rich-text.js';
import { AccessService } from '../identity-access/access.service.js';
import { type RequestWithAuth, RequirePermission, requestMeta } from '../identity-access/auth-context.js';
import { asciiFileName } from './attachment-storage.js';
import { AttachmentsService, type IncomingFile } from './attachments.service.js';
import { ConvergenceService } from './convergence.service.js';
import { IdeaStatus } from './entities/idea.entity.js';
import { IdeaActivityService } from './idea-activity.service.js';
import { BatchRequest, BatchResult, BatchSchema } from './idea-batch.dto.js';
import { IdeaBatchService } from './idea-batch.service.js';
import { IdeaExportService } from './idea-export.service.js';
import { IdeaPdfService } from './idea-pdf.service.js';
import {
  ApproveRequest,
  ApproveSchema,
  AssignRequest,
  AssignSchema,
  AttachmentView,
  CommentRequest,
  CommentSchema,
  CommentView,
  ConvergeRequest,
  ConvergeSchema,
  IdeaAttachments,
  IdeaDetail,
  IdeaListQuerySchema,
  IdeaPage,
  ImplementRequest,
  ImplementSchema,
  ParticipantRequest,
  ParticipantSchema,
  PeopleQuerySchema,
  PersonOption,
  PriorityRequest,
  PrioritySchema,
  ReasonRequest,
  ReasonSchema,
  SetPublicLookupRequest,
  SetPublicLookupSchema,
  SimilarIdeaView,
  SimilarQuerySchema,
  StepRequest,
  StepSchema,
  SubmitIdeaRequest,
  SubmitIdeaSchema,
  SupportRequest,
  SupportSchema,
  TimelineEvent,
  UnconvergeRequest,
  UnconvergeSchema,
  UpdateIdeaRequest,
  UpdateIdeaSchema,
  UpdateStepRequest,
  UpdateStepSchema,
} from './ideas.dto.js';
import { IdeasService } from './ideas.service.js';
import { IdeasWorkflowService } from './ideas-workflow.service.js';
import { parseRange, sniffViewable } from './media-view.js';
import { StepsService } from './steps.service.js';

/** Validação das ideias responde 422, como pedem os critérios (CA-RN-03.1, 05.1, 06.1). */
const UNPROCESSABLE = 422;
/** Campos que nunca mudam por edição: status só pelas ações (RN-10), código é imutável (RN-22). */
const NOT_EDITABLE = ['status', 'code', 'authorId', 'registeredById', 'assignedToId'];

const stepUuid = new ParseUUIDPipe({ exceptionFactory: () => apiError(404, 'not_found', 'Etapa não encontrada.') });
const attachmentUuid = new ParseUUIDPipe({
  exceptionFactory: () => apiError(404, 'not_found', 'Anexo não encontrado.'),
});
const ref = { name: 'ref', description: 'Id da ideia ou o código (ex.: ITS-2026-0042)' };

/** Estado que a tela estava mostrando ao agir (opcional). Diferente do atual → 409 `stale_state`. */
function expectedStatus(body: unknown): IdeaStatus | undefined {
  const v = (body as { expectedStatus?: unknown } | undefined)?.expectedStatus;
  return typeof v === 'string' && (Object.values(IdeaStatus) as string[]).includes(v) ? (v as IdeaStatus) : undefined;
}

/** O envio traz o "já aprovar" (D3) dentro do corpo: o texto da primeira etapa também pode vir do editor. */
function normalizeSubmit(body: unknown): unknown {
  const base = normalizeRich(body, ['description', 'proposedSolution']) as Record<string, unknown> | null;
  if (base && typeof base === 'object' && base.approveNow && typeof base.approveNow === 'object') {
    return { ...base, approveNow: normalizeRich(base.approveNow, ['stepDescription']) };
  }
  return base;
}

@ApiTags('ideas')
@ApiCookieAuth()
@Controller('ideas')
export class IdeasController {
  constructor(
    private readonly ideas: IdeasService,
    private readonly workflow: IdeasWorkflowService,
    private readonly activity: IdeaActivityService,
    private readonly steps: StepsService,
    private readonly files: AttachmentsService,
    private readonly access: AccessService,
    private readonly exports: IdeaExportService,
    private readonly pdfs: IdeaPdfService,
    private readonly batches: IdeaBatchService,
    private readonly convergence: ConvergenceService,
  ) {}

  @Get()
  @ApiQuery({ name: 'status', required: false, enum: IdeaStatus, enumName: 'IdeaStatus', isArray: true })
  @ApiQuery({ name: 'entityId', required: false, description: 'Inclui as sub-entidades' })
  @ApiQuery({ name: 'categoryId', required: false })
  @ApiQuery({ name: 'search', required: false, description: 'Código, título ou referência externa' })
  @ApiQuery({ name: 'assignedToMe', required: false, enum: ['true', 'false'] })
  @ApiQuery({ name: 'sort', required: false, enum: ['oldest', 'newest', 'priority'] })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiOkResponse({ type: IdeaPage, description: 'Ideias das entidades do escopo (idea.view_scope) e as próprias.' })
  async list(@Req() req: RequestWithAuth, @Query() query: unknown): Promise<IdeaPage> {
    return this.ideas.list(await this.access.forRequest(req), parseInput(IdeaListQuerySchema, query));
  }

  @Get('export.csv')
  @ApiQuery({ name: 'status', required: false, enum: IdeaStatus, enumName: 'IdeaStatus', isArray: true })
  @ApiQuery({ name: 'entityId', required: false, description: 'Inclui as sub-entidades' })
  @ApiQuery({ name: 'categoryId', required: false })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'assignedToMe', required: false, enum: ['true', 'false'] })
  @ApiQuery({ name: 'sort', required: false, enum: ['oldest', 'newest', 'priority'] })
  @ApiProduces('text/csv')
  @ApiOkResponse({ description: 'CSV (UTF-8, separador ponto e vírgula) das ideias que a lista mostraria.' })
  async exportCsv(@Req() req: RequestWithAuth, @Query() query: unknown, @Res() res: Response): Promise<void> {
    const access = await this.access.forRequest(req);
    const filters = parseInput(IdeaListQuerySchema, query);
    const csv = await this.exports.ideasCsv(access, filters);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="ideias.csv"');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    res.send(csv);
  }

  @Post('batch')
  @HttpCode(200)
  @ApiBody({ type: BatchRequest })
  @ApiOkResponse({ type: BatchResult, description: 'Resultado item a item: cada ideia passa ou falha sozinha.' })
  @ApiUnprocessableEntityResponse({
    type: ApiErrorBody,
    description: 'Pedido inválido (ex.: recusar sem justificativa).',
  })
  async batch(@Req() req: RequestWithAuth, @Body() body: unknown): Promise<BatchResult> {
    const results = await this.batches.run(
      await this.access.forRequest(req),
      parseInput(BatchSchema, body, UNPROCESSABLE),
    );
    const succeeded = results.filter((r) => r.ok).length;
    return { results, succeeded, failed: results.length - succeeded };
  }

  @Get('similar')
  @ApiQuery({ name: 'q', required: true, description: 'Título (ou parte do texto) que a pessoa está digitando' })
  @ApiQuery({ name: 'entityId', required: false, description: 'Entidade onde a ideia vai ser enviada' })
  @ApiOkResponse({ type: [SimilarIdeaView], description: 'Até 5 ideias abertas parecidas (RN-57).' })
  async similar(@Req() req: RequestWithAuth, @Query() query: unknown): Promise<SimilarIdeaView[]> {
    const { q, entityId } = parseInput(SimilarQuerySchema, query);
    return this.ideas.similar(await this.access.forRequest(req), q, entityId);
  }

  @Get('mine')
  @ApiQuery({ name: 'status', required: false, enum: IdeaStatus, enumName: 'IdeaStatus', isArray: true })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiOkResponse({ type: IdeaPage })
  async mine(@Req() req: RequestWithAuth, @Query() query: unknown): Promise<IdeaPage> {
    return this.ideas.mine(await this.access.forRequest(req), parseInput(IdeaListQuerySchema, query));
  }

  @Get('people')
  @RequirePermission('idea.triage', 'idea.register_for_other', 'reward.register')
  @ApiQuery({ name: 'search', required: false })
  @ApiOkResponse({
    type: [PersonOption],
    description:
      'Pessoas ativas (autor em nome de outro, responsável de etapa, aprovador), com os campos pesquisáveis.',
  })
  people(@Query() query: unknown): Promise<PersonOption[]> {
    return this.ideas.people(parseInput(PeopleQuerySchema, query).search);
  }

  @Post()
  @RequirePermission('idea.submit', 'idea.register_for_other')
  @ApiBody({ type: SubmitIdeaRequest })
  @ApiCreatedResponse({ type: IdeaDetail })
  @ApiForbiddenResponse({ type: ApiErrorBody })
  @ApiUnprocessableEntityResponse({ type: ApiErrorBody })
  async submit(@Req() req: RequestWithAuth, @Body() body: unknown): Promise<IdeaDetail> {
    return this.ideas.submit(
      await this.access.forRequest(req),
      parseInput(SubmitIdeaSchema, normalizeSubmit(body), UNPROCESSABLE),
    );
  }

  @Get(':ref')
  @ApiParam(ref)
  @ApiOkResponse({ type: IdeaDetail })
  @ApiNotFoundResponse({ type: ApiErrorBody, description: 'Inexistente ou fora do escopo (não revela).' })
  async get(@Req() req: RequestWithAuth, @Param('ref') refValue: string): Promise<IdeaDetail> {
    return this.ideas.detail(await this.access.forRequest(req), refValue);
  }

  @Patch(':ref')
  @ApiParam(ref)
  @ApiBody({ type: UpdateIdeaRequest })
  @ApiOkResponse({ type: IdeaDetail })
  @ApiConflictResponse({ type: ApiErrorBody, description: 'Ideia encerrada: somente leitura.' })
  @ApiUnprocessableEntityResponse({ type: ApiErrorBody })
  async update(
    @Req() req: RequestWithAuth,
    @Param('ref') refValue: string,
    @Body() body: unknown,
  ): Promise<IdeaDetail> {
    const locked = body && typeof body === 'object' ? NOT_EDITABLE.filter((k) => k in body) : [];
    if (locked.length > 0) {
      throw apiError(UNPROCESSABLE, 'field_not_editable', 'Estes campos não mudam por edição.', { fields: locked });
    }
    return this.ideas.update(
      await this.access.forRequest(req),
      refValue,
      parseInput(UpdateIdeaSchema, normalizeRich(body, ['description', 'proposedSolution']), UNPROCESSABLE),
    );
  }

  @Put(':ref/public-lookup')
  @ApiParam(ref)
  @ApiBody({ type: SetPublicLookupRequest })
  @ApiOkResponse({ type: IdeaDetail })
  @ApiForbiddenResponse({ type: ApiErrorBody, description: 'Só o autor altera a consulta pública da ideia.' })
  async setPublicLookup(
    @Req() req: RequestWithAuth,
    @Param('ref') refValue: string,
    @Body() body: unknown,
  ): Promise<IdeaDetail> {
    const { enabled } = parseInput(SetPublicLookupSchema, body, UNPROCESSABLE);
    return this.ideas.setPublicLookup(await this.access.forRequest(req), refValue, enabled);
  }

  @Post(':ref/converge')
  @HttpCode(200)
  @ApiParam(ref)
  @ApiBody({ type: ConvergeRequest })
  @ApiOkResponse({ type: IdeaDetail, description: 'A principal, depois de receber a convergida.' })
  @ApiForbiddenResponse({ type: ApiErrorBody, description: 'Sem idea.converge nas entidades das duas ideias.' })
  @ApiConflictResponse({ type: ApiErrorBody, description: 'A mais recente já está em andamento ou encerrada.' })
  @ApiUnprocessableEntityResponse({ type: ApiErrorBody, description: 'Sem justificativa, ou as duas já são a mesma.' })
  async converge(
    @Req() req: RequestWithAuth,
    @Param('ref') refValue: string,
    @Body() body: unknown,
  ): Promise<IdeaDetail> {
    const { targetRef, reason } = parseInput(ConvergeSchema, body, UNPROCESSABLE);
    return this.convergence.converge(await this.access.forRequest(req), refValue, targetRef, reason);
  }

  @Post(':ref/unconverge')
  @HttpCode(200)
  @ApiParam(ref)
  @ApiBody({ type: UnconvergeRequest })
  @ApiOkResponse({ type: IdeaDetail, description: 'A ideia, de volta com fluxo próprio.' })
  async unconverge(
    @Req() req: RequestWithAuth,
    @Param('ref') refValue: string,
    @Body() body: unknown,
  ): Promise<IdeaDetail> {
    const { reason } = parseInput(UnconvergeSchema, body, UNPROCESSABLE);
    return this.convergence.unconverge(await this.access.forRequest(req), refValue, reason ?? null);
  }

  @Post(':ref/support')
  @HttpCode(200)
  @ApiParam(ref)
  @ApiBody({ type: SupportRequest })
  @ApiOkResponse({ type: IdeaDetail, description: 'A ideia apoiada; a pessoa agora é co-autora.' })
  @ApiConflictResponse({ type: ApiErrorBody, description: 'Ideia própria, já apoiada ou encerrada.' })
  async support(
    @Req() req: RequestWithAuth,
    @Param('ref') refValue: string,
    @Body() body: unknown,
  ): Promise<IdeaDetail> {
    const { note } = parseInput(SupportSchema, body, UNPROCESSABLE);
    return this.convergence.support(await this.access.forRequest(req), refValue, note || null);
  }

  @Post(':ref/participants')
  @HttpCode(200)
  @ApiParam(ref)
  @ApiBody({ type: ParticipantRequest })
  @ApiOkResponse({ type: IdeaDetail })
  async addParticipant(
    @Req() req: RequestWithAuth,
    @Param('ref') refValue: string,
    @Body() body: unknown,
  ): Promise<IdeaDetail> {
    const input = parseInput(ParticipantSchema, body, UNPROCESSABLE);
    return this.convergence.addParticipant(await this.access.forRequest(req), refValue, {
      userId: input.userId,
      role: input.role,
      note: input.note ?? null,
    });
  }

  @Delete(':ref/participants/:participantId')
  @ApiParam(ref)
  @ApiOkResponse({ type: IdeaDetail })
  @ApiConflictResponse({ type: ApiErrorBody, description: 'O autor não sai (a ideia precisa de um autor).' })
  async removeParticipant(
    @Req() req: RequestWithAuth,
    @Param('ref') refValue: string,
    @Param('participantId', ParseUUIDPipe) participantId: string,
  ): Promise<IdeaDetail> {
    return this.convergence.removeParticipant(await this.access.forRequest(req), refValue, participantId);
  }

  @Post(':ref/priority')
  @HttpCode(200)
  @ApiParam(ref)
  @ApiBody({ type: PriorityRequest })
  @ApiOkResponse({ type: IdeaDetail })
  @ApiUnprocessableEntityResponse({ type: ApiErrorBody, description: 'Impacto e esforço vão de 1 a 5.' })
  async prioritize(
    @Req() req: RequestWithAuth,
    @Param('ref') refValue: string,
    @Body() body: unknown,
  ): Promise<IdeaDetail> {
    const { impact, effort, expectedStatus } = parseInput(PrioritySchema, body, UNPROCESSABLE);
    return this.workflow.prioritize(await this.access.forRequest(req), refValue, impact, effort, expectedStatus);
  }

  @Post(':ref/assign')
  @HttpCode(200)
  @ApiParam(ref)
  @ApiBody({ type: AssignRequest })
  @ApiOkResponse({ type: IdeaDetail })
  @ApiForbiddenResponse({ type: ApiErrorBody, description: 'Sem triagem nesta entidade.' })
  @ApiUnprocessableEntityResponse({ type: ApiErrorBody, description: 'A pessoa não tria ideias desta entidade.' })
  async assign(
    @Req() req: RequestWithAuth,
    @Param('ref') refValue: string,
    @Body() body: unknown,
  ): Promise<IdeaDetail> {
    const { assigneeId, expectedStatus } = parseInput(AssignSchema, body, UNPROCESSABLE);
    return this.workflow.assign(await this.access.forRequest(req), refValue, assigneeId, expectedStatus);
  }

  @Post(':ref/start-review')
  @HttpCode(200)
  @ApiParam(ref)
  @ApiOkResponse({ type: IdeaDetail })
  @ApiConflictResponse({ type: ApiErrorBody })
  async startReview(
    @Req() req: RequestWithAuth,
    @Param('ref') refValue: string,
    @Body() body: unknown,
  ): Promise<IdeaDetail> {
    return this.workflow.startReview(await this.access.forRequest(req), refValue, expectedStatus(body));
  }

  @Post(':ref/approve')
  @HttpCode(200)
  @ApiParam(ref)
  @ApiBody({ type: ApproveRequest })
  @ApiOkResponse({ type: IdeaDetail })
  @ApiConflictResponse({ type: ApiErrorBody })
  @ApiUnprocessableEntityResponse({ type: ApiErrorBody })
  async approve(
    @Req() req: RequestWithAuth,
    @Param('ref') refValue: string,
    @Body() body: unknown,
  ): Promise<IdeaDetail> {
    const input = parseInput(ApproveSchema, normalizeRich(body, ['stepDescription']), UNPROCESSABLE);
    return this.workflow.approve(await this.access.forRequest(req), refValue, input, expectedStatus(body));
  }

  @Post(':ref/reject')
  @HttpCode(200)
  @ApiParam(ref)
  @ApiBody({ type: ReasonRequest })
  @ApiOkResponse({ type: IdeaDetail })
  @ApiConflictResponse({ type: ApiErrorBody })
  @ApiUnprocessableEntityResponse({ type: ApiErrorBody, description: 'Justificativa obrigatória (RN-05).' })
  async reject(
    @Req() req: RequestWithAuth,
    @Param('ref') refValue: string,
    @Body() body: unknown,
  ): Promise<IdeaDetail> {
    const { reason } = parseInput(ReasonSchema, body, UNPROCESSABLE);
    return this.workflow.reject(await this.access.forRequest(req), refValue, reason, expectedStatus(body));
  }

  @Post(':ref/interrupt')
  @HttpCode(200)
  @ApiParam(ref)
  @ApiBody({ type: ReasonRequest })
  @ApiOkResponse({ type: IdeaDetail, description: 'Interrompe uma ideia em andamento (→ Não autorizada).' })
  @ApiConflictResponse({ type: ApiErrorBody })
  @ApiUnprocessableEntityResponse({ type: ApiErrorBody, description: 'Justificativa obrigatória.' })
  async interrupt(
    @Req() req: RequestWithAuth,
    @Param('ref') refValue: string,
    @Body() body: unknown,
  ): Promise<IdeaDetail> {
    const { reason } = parseInput(ReasonSchema, body, UNPROCESSABLE);
    return this.workflow.interrupt(await this.access.forRequest(req), refValue, reason, expectedStatus(body));
  }

  @Post(':ref/implement')
  @HttpCode(200)
  @ApiParam(ref)
  @ApiBody({ type: ImplementRequest })
  @ApiOkResponse({ type: IdeaDetail })
  @ApiConflictResponse({ type: ApiErrorBody })
  @ApiUnprocessableEntityResponse({ type: ApiErrorBody })
  async implement(
    @Req() req: RequestWithAuth,
    @Param('ref') refValue: string,
    @Body() body: unknown,
  ): Promise<IdeaDetail> {
    const input = parseInput(ImplementSchema, normalizeRich(body, ['resultText', 'standardAdopted']), UNPROCESSABLE);
    return this.workflow.implement(await this.access.forRequest(req), refValue, input, expectedStatus(body));
  }

  @Post(':ref/reopen')
  @HttpCode(200)
  @ApiParam(ref)
  @ApiBody({ type: ReasonRequest })
  @ApiOkResponse({ type: IdeaDetail })
  @ApiForbiddenResponse({ type: ApiErrorBody })
  @ApiConflictResponse({ type: ApiErrorBody, description: 'Só ideias encerradas são reabertas.' })
  @ApiUnprocessableEntityResponse({ type: ApiErrorBody, description: 'Motivo obrigatório (RN-09).' })
  async reopen(
    @Req() req: RequestWithAuth,
    @Param('ref') refValue: string,
    @Body() body: unknown,
  ): Promise<IdeaDetail> {
    // O motivo é conferido no serviço, depois da permissão e do estado (CA-RN-09.1 a 09.4).
    const raw = (body ?? {}) as { reason?: unknown };
    const reason = typeof raw.reason === 'string' ? raw.reason.trim().slice(0, 5000) : '';
    return this.workflow.reopen(await this.access.forRequest(req), refValue, reason, expectedStatus(body));
  }

  @Post(':ref/archive')
  @HttpCode(200)
  @ApiParam(ref)
  @ApiOkResponse({ type: IdeaDetail })
  @ApiConflictResponse({ type: ApiErrorBody })
  async archive(
    @Req() req: RequestWithAuth,
    @Param('ref') refValue: string,
    @Body() body: unknown,
  ): Promise<IdeaDetail> {
    const reason = (body as { reason?: unknown } | undefined)?.reason;
    return this.workflow.archive(
      await this.access.forRequest(req),
      refValue,
      typeof reason === 'string' && reason.trim() ? reason.trim().slice(0, 5000) : null,
      expectedStatus(body),
    );
  }

  @Delete(':ref')
  @HttpCode(204)
  @ApiParam(ref)
  @ApiNoContentResponse({ description: 'Excluída definitivamente; registrado na auditoria (RN-11).' })
  @ApiForbiddenResponse({ type: ApiErrorBody })
  async purge(@Req() req: RequestWithAuth, @Param('ref') refValue: string): Promise<void> {
    await this.workflow.purge(await this.access.forRequest(req), refValue, requestMeta(req));
  }

  @Post(':ref/steps')
  @ApiParam(ref)
  @ApiBody({ type: StepRequest })
  @ApiCreatedResponse({ type: IdeaDetail })
  @ApiForbiddenResponse({ type: ApiErrorBody })
  @ApiConflictResponse({
    type: ApiErrorBody,
    description: 'Já existe etapa aberta (RN-12) ou ideia fora de andamento.',
  })
  @ApiUnprocessableEntityResponse({ type: ApiErrorBody })
  async createStep(
    @Req() req: RequestWithAuth,
    @Param('ref') refValue: string,
    @Body() body: unknown,
  ): Promise<IdeaDetail> {
    return this.steps.create(
      await this.access.forRequest(req),
      refValue,
      parseInput(StepSchema, normalizeRich(body, ['description']), UNPROCESSABLE),
    );
  }

  @Patch(':ref/steps/:stepId')
  @ApiParam(ref)
  @ApiParam({ name: 'stepId' })
  @ApiBody({ type: UpdateStepRequest })
  @ApiOkResponse({ type: IdeaDetail })
  @ApiConflictResponse({ type: ApiErrorBody, description: 'Só a última etapa aberta é editável (RN-13).' })
  @ApiUnprocessableEntityResponse({ type: ApiErrorBody })
  async updateStep(
    @Req() req: RequestWithAuth,
    @Param('ref') refValue: string,
    @Param('stepId', stepUuid) stepId: string,
    @Body() body: unknown,
  ): Promise<IdeaDetail> {
    return this.steps.update(
      await this.access.forRequest(req),
      refValue,
      stepId,
      parseInput(UpdateStepSchema, normalizeRich(body, ['description']), UNPROCESSABLE),
    );
  }

  @Delete(':ref/steps/:stepId')
  @ApiParam(ref)
  @ApiParam({ name: 'stepId' })
  @ApiOkResponse({ type: IdeaDetail })
  @ApiConflictResponse({ type: ApiErrorBody })
  async removeStep(
    @Req() req: RequestWithAuth,
    @Param('ref') refValue: string,
    @Param('stepId', stepUuid) stepId: string,
  ): Promise<IdeaDetail> {
    return this.steps.remove(await this.access.forRequest(req), refValue, stepId);
  }

  @Post(':ref/steps/:stepId/complete')
  @HttpCode(200)
  @ApiParam(ref)
  @ApiParam({ name: 'stepId' })
  @ApiOkResponse({ type: IdeaDetail })
  @ApiConflictResponse({ type: ApiErrorBody })
  async completeStep(
    @Req() req: RequestWithAuth,
    @Param('ref') refValue: string,
    @Param('stepId', stepUuid) stepId: string,
  ): Promise<IdeaDetail> {
    return this.steps.complete(await this.access.forRequest(req), refValue, stepId);
  }

  /** Anexos da própria ideia (RN-146). */
  @Get(':ref/attachments')
  @ApiParam(ref)
  @ApiOkResponse({ type: IdeaAttachments })
  async ideaAttachments(@Req() req: RequestWithAuth, @Param('ref') refValue: string): Promise<IdeaAttachments> {
    return this.files.listIdea(await this.access.forRequest(req), refValue);
  }

  @Post(':ref/attachments')
  @ApiParam(ref)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } }, required: ['file'] },
  })
  @ApiCreatedResponse({ type: AttachmentView })
  @ApiResponse({ status: 413, type: ApiErrorBody, description: 'Acima do tamanho máximo configurado.' })
  @ApiResponse({ status: 415, type: ApiErrorBody, description: 'Tipo de arquivo fora da lista configurada.' })
  @ApiResponse({
    status: 422,
    type: ApiErrorBody,
    description: 'A ideia já tem o máximo de anexos (`attachment_limit`).',
  })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 50 * 1024 * 1024 + 1, files: 1 } }))
  async uploadIdeaAttachment(
    @Req() req: RequestWithAuth,
    @Param('ref') refValue: string,
    @UploadedFile() file: IncomingFile | undefined,
  ): Promise<AttachmentView> {
    return this.files.uploadIdea(await this.access.forRequest(req), refValue, file);
  }

  @Get(':ref/steps/:stepId/attachments')
  @ApiParam(ref)
  @ApiParam({ name: 'stepId' })
  @ApiOkResponse({ type: [AttachmentView] })
  async attachments(
    @Req() req: RequestWithAuth,
    @Param('ref') refValue: string,
    @Param('stepId', stepUuid) stepId: string,
  ) {
    return this.files.list(await this.access.forRequest(req), refValue, stepId);
  }

  @Post(':ref/steps/:stepId/attachments')
  @ApiParam(ref)
  @ApiParam({ name: 'stepId' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } }, required: ['file'] },
  })
  @ApiCreatedResponse({ type: AttachmentView })
  @ApiResponse({ status: 413, type: ApiErrorBody, description: 'Acima do tamanho máximo configurado.' })
  @ApiResponse({ status: 415, type: ApiErrorBody, description: 'Tipo de arquivo fora da lista configurada.' })
  // Teto fixo de 50 MB no recebimento; o limite configurado (menor) é conferido no serviço.
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 50 * 1024 * 1024 + 1, files: 1 } }))
  async upload(
    @Req() req: RequestWithAuth,
    @Param('ref') refValue: string,
    @Param('stepId', stepUuid) stepId: string,
    @UploadedFile() file: IncomingFile | undefined,
  ): Promise<AttachmentView> {
    return this.files.upload(await this.access.forRequest(req), refValue, stepId, file);
  }

  @Get(':ref/attachments/:attachmentId/download')
  @ApiParam(ref)
  @ApiParam({ name: 'attachmentId' })
  @ApiProduces('application/octet-stream')
  @ApiOkResponse({ description: 'O arquivo, sempre como download (nunca exibido nem executado).' })
  async download(
    @Req() req: RequestWithAuth,
    @Param('ref') refValue: string,
    @Param('attachmentId', attachmentUuid) attachmentId: string,
    @Res() res: Response,
  ): Promise<void> {
    const { attachment, content } = await this.files.download(
      await this.access.forRequest(req),
      refValue,
      attachmentId,
    );
    const ascii = asciiFileName(attachment.originalName);
    res.set({
      'Content-Type': attachment.mime,
      'Content-Length': String(content.length),
      'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(attachment.originalName)}`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cache-Control': 'private, no-store',
    });
    res.send(content);
  }

  /**
   * Ver na tela (RN-147): só imagem e vídeo cujo CONTEÚDO confere (o nome não basta); o resto só baixa
   * (415). Aceita uma faixa (`Range` → 206) para o vídeo andar sem baixar o arquivo inteiro.
   */
  @Get(':ref/attachments/:attachmentId/view')
  @ApiParam(ref)
  @ApiParam({ name: 'attachmentId' })
  @ApiProduces('image/png', 'image/jpeg', 'image/webp', 'image/gif', 'video/mp4', 'video/webm')
  @ApiOkResponse({ description: 'O arquivo para exibir (inline), com `nosniff` e `sandbox`.' })
  @ApiResponse({ status: 206, description: 'A faixa pedida.' })
  @ApiResponse({ status: 415, type: ApiErrorBody, description: 'Não é imagem nem vídeo pelo conteúdo: só o download.' })
  @ApiResponse({ status: 416, description: 'Faixa fora do arquivo.' })
  async view(
    @Req() req: RequestWithAuth,
    @Param('ref') refValue: string,
    @Param('attachmentId', attachmentUuid) attachmentId: string,
    @Res() res: Response,
  ): Promise<void> {
    const { content } = await this.files.download(await this.access.forRequest(req), refValue, attachmentId);
    const mime = sniffViewable(content.subarray(0, 64));
    if (!mime) throw apiError(415, 'not_viewable', 'Este arquivo não abre na tela; use o download.');
    const range = parseRange(req.headers.range, content.length);
    res.set({
      'Content-Type': mime,
      'Content-Disposition': 'inline',
      'Accept-Ranges': 'bytes',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cache-Control': 'private, no-store',
    });
    if (range === 'invalid') {
      res.status(416).set('Content-Range', `bytes */${content.length}`).end();
      return;
    }
    if (range) {
      const part = content.subarray(range.start, range.end + 1);
      res
        .status(206)
        .set({
          'Content-Range': `bytes ${range.start}-${range.end}/${content.length}`,
          'Content-Length': String(part.length),
        })
        .send(part);
      return;
    }
    res.set('Content-Length', String(content.length)).send(content);
  }

  @Delete(':ref/attachments/:attachmentId')
  @HttpCode(204)
  @ApiParam(ref)
  @ApiParam({ name: 'attachmentId' })
  @ApiNoContentResponse()
  @ApiForbiddenResponse({ type: ApiErrorBody })
  @ApiConflictResponse({ type: ApiErrorBody, description: 'Etapa concluída ou ideia encerrada.' })
  async removeAttachment(
    @Req() req: RequestWithAuth,
    @Param('ref') refValue: string,
    @Param('attachmentId', attachmentUuid) attachmentId: string,
  ): Promise<void> {
    await this.files.remove(await this.access.forRequest(req), refValue, attachmentId);
  }

  @Get(':ref/comments')
  @ApiParam(ref)
  @ApiOkResponse({ type: [CommentView] })
  async comments(@Req() req: RequestWithAuth, @Param('ref') refValue: string): Promise<CommentView[]> {
    return this.activity.comments(await this.access.forRequest(req), refValue);
  }

  @Post(':ref/comments')
  @ApiParam(ref)
  @ApiBody({ type: CommentRequest })
  @ApiCreatedResponse({ type: CommentView })
  @ApiForbiddenResponse({ type: ApiErrorBody })
  async addComment(
    @Req() req: RequestWithAuth,
    @Param('ref') refValue: string,
    @Body() body: unknown,
  ): Promise<CommentView> {
    return this.activity.addComment(
      await this.access.forRequest(req),
      refValue,
      parseInput(CommentSchema, normalizeRich(body, ['body']), UNPROCESSABLE),
    );
  }

  @Get(':ref/pdf')
  @ApiParam(ref)
  @ApiQuery({ name: 'history', required: false, enum: ['true', 'false'], description: 'Inclui o histórico' })
  @ApiProduces('application/pdf')
  @ApiOkResponse({ description: 'PDF da ideia (dados, etapas e situação; histórico se pedido).' })
  @ApiNotFoundResponse({ type: ApiErrorBody, description: 'Quem não vê a ideia recebe 404.' })
  async pdf(
    @Req() req: RequestWithAuth,
    @Param('ref') refValue: string,
    @Query('history') history: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const { code, pdf } = await this.pdfs.render(await this.access.forRequest(req), refValue, history === 'true');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${code}.pdf"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    res.send(pdf);
  }

  @Get(':ref/timeline')
  @ApiParam(ref)
  @ApiOkResponse({ type: [TimelineEvent] })
  async timeline(@Req() req: RequestWithAuth, @Param('ref') refValue: string): Promise<TimelineEvent[]> {
    return this.activity.timeline(await this.access.forRequest(req), refValue);
  }
}
