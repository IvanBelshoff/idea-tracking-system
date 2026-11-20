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
} from '@nestjs/common';
import {
  ApiBody,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { ApiErrorBody, parseInput } from '../common/api-error.js';
import { AccessService } from '../identity-access/access.service.js';
import { type RequestWithAuth, requestMeta } from '../identity-access/auth-context.js';
import {
  CommentRevisionView,
  CommentSchema,
  EditCommentRequest,
  EditCommentSchema,
  FeedQuerySchema,
  HideCommentRequest,
  HideCommentSchema,
  MuralCommentRequest,
  MuralCommentView,
  MuralConsentRequest,
  MuralConsentSchema,
  MuralFeed,
  MuralPage,
  MuralPersonOption,
  MuralPublicationView,
  PeopleQuerySchema,
  ReactionRequest,
  ReactionResult,
  ReactionSchema,
  ReactionsQuerySchema,
  ReactorView,
  ReportQueueItem,
  ReportRequest,
  ReportSchema,
  ShareRequest,
  ShareSchema,
  WithdrawRequest,
  WithdrawSchema,
} from './mural.dto.js';
import { MuralService } from './mural.service.js';
import { MuralFeedService } from './mural-feed.service.js';
import { MURAL_REACTIONS } from './mural-rules.js';
import { MuralTalkService } from './mural-talk.service.js';

const UNPROCESSABLE = 422;
const REF = { name: 'ref', description: 'Código ou id da ideia' };
const WITHDRAWN = 'Mural desligado, ideia fora do mural (`not_found`) ou retirada (`mural_withdrawn`).';

/** Mural de ideias (M21, RN-148 a RN-158). Com o módulo desligado, tudo responde 404. */
@ApiTags('mural')
@ApiCookieAuth()
@Controller('mural')
export class MuralController {
  constructor(
    private readonly mural: MuralService,
    private readonly feedService: MuralFeedService,
    private readonly talk: MuralTalkService,
    private readonly access: AccessService,
  ) {}

  // --- Lista e página (RN-150) ---------------------------------------------------------------------

  @Get()
  @ApiQuery({ name: 'sort', required: false, enum: ['recent', 'reactions'] })
  @ApiQuery({ name: 'status', required: false, enum: ['in_progress', 'implemented'], isArray: true })
  @ApiQuery({ name: 'categoryId', required: false })
  @ApiQuery({ name: 'entityId', required: false, description: 'Inclui as sub-entidades' })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiOkResponse({ type: MuralFeed, description: 'Páginas de 20 cartões, por cursor estável.' })
  async feed(@Req() req: RequestWithAuth, @Query() query: unknown): Promise<MuralFeed> {
    return this.feedService.feed(await this.access.forRequest(req), parseInput(FeedQuerySchema, query, UNPROCESSABLE));
  }

  @Get('people')
  @ApiQuery({ name: 'search', required: false })
  @ApiOkResponse({ type: [MuralPersonOption], description: 'Colegas ativos para o "enviar" (RN-155), sem e-mail.' })
  async people(@Req() req: RequestWithAuth, @Query() query: unknown): Promise<MuralPersonOption[]> {
    return this.feedService.people(await this.access.forRequest(req), parseInput(PeopleQuerySchema, query).search);
  }

  @Get('reports')
  @ApiOkResponse({ type: [ReportQueueItem], description: 'Denúncias pendentes das entidades que a pessoa modera.' })
  @ApiForbiddenResponse({ type: ApiErrorBody, description: 'Sem mural.manage em nenhuma entidade.' })
  async reports(@Req() req: RequestWithAuth): Promise<ReportQueueItem[]> {
    return this.talk.queue(await this.access.forRequest(req));
  }

  @Get('ideas/:ref')
  @ApiParam(REF)
  @ApiOkResponse({ type: MuralPage })
  @ApiNotFoundResponse({ type: ApiErrorBody, description: WITHDRAWN })
  async page(@Req() req: RequestWithAuth, @Param('ref') ref: string): Promise<MuralPage> {
    return this.feedService.page(await this.access.forRequest(req), ref);
  }

  // --- Publicar, retirar e consentimento (RN-149, RN-151) ------------------------------------------

  @Get('ideas/:ref/publication')
  @ApiParam(REF)
  @ApiOkResponse({ type: MuralPublicationView, description: 'Estado da ideia no mural, para quem vê a ideia.' })
  @ApiNotFoundResponse({ type: ApiErrorBody, description: 'Mural desligado ou ideia que a pessoa não vê.' })
  async publication(@Req() req: RequestWithAuth, @Param('ref') ref: string): Promise<MuralPublicationView> {
    return this.mural.publication(await this.access.forRequest(req), ref);
  }

  @Post('ideas/:ref/publish')
  @HttpCode(200)
  @ApiParam(REF)
  @ApiOkResponse({ type: MuralPublicationView })
  @ApiForbiddenResponse({ type: ApiErrorBody, description: 'Sem mural.manage na entidade da ideia.' })
  @ApiConflictResponse({ type: ApiErrorBody, description: 'Já está no mural.' })
  @ApiUnprocessableEntityResponse({
    type: ApiErrorBody,
    description: 'Só Em andamento ou Implementada (`not_publishable`); convergida (`idea_converged`).',
  })
  async publish(@Req() req: RequestWithAuth, @Param('ref') ref: string): Promise<MuralPublicationView> {
    return this.mural.publish(await this.access.forRequest(req), ref, requestMeta(req));
  }

  @Post('ideas/:ref/withdraw')
  @HttpCode(200)
  @ApiParam(REF)
  @ApiBody({ type: WithdrawRequest })
  @ApiOkResponse({ type: MuralPublicationView })
  @ApiConflictResponse({ type: ApiErrorBody, description: 'Não está no mural.' })
  async withdraw(
    @Req() req: RequestWithAuth,
    @Param('ref') ref: string,
    @Body() body: unknown,
  ): Promise<MuralPublicationView> {
    const { reason } = parseInput(WithdrawSchema, body, UNPROCESSABLE);
    return this.mural.withdraw(await this.access.forRequest(req), ref, reason, requestMeta(req));
  }

  @Put('ideas/:ref/consent')
  @ApiParam(REF)
  @ApiBody({ type: MuralConsentRequest })
  @ApiOkResponse({ type: MuralPublicationView })
  @ApiForbiddenResponse({ type: ApiErrorBody, description: 'Só participante de ideia publicada.' })
  async consent(
    @Req() req: RequestWithAuth,
    @Param('ref') ref: string,
    @Body() body: unknown,
  ): Promise<MuralPublicationView> {
    const { accept } = parseInput(MuralConsentSchema, body, UNPROCESSABLE);
    return this.mural.consent(await this.access.forRequest(req), ref, accept);
  }

  // --- Reações (RN-152) ----------------------------------------------------------------------------

  @Put('ideas/:ref/reaction')
  @ApiParam(REF)
  @ApiBody({ type: ReactionRequest })
  @ApiOkResponse({ type: ReactionResult })
  @ApiForbiddenResponse({ type: ApiErrorBody, description: 'Participante da ideia (`own_idea`).' })
  async react(@Req() req: RequestWithAuth, @Param('ref') ref: string, @Body() body: unknown): Promise<ReactionResult> {
    const { kind } = parseInput(ReactionSchema, body, UNPROCESSABLE);
    return this.feedService.react(await this.access.forRequest(req), ref, kind);
  }

  @Delete('ideas/:ref/reaction')
  @ApiParam(REF)
  @ApiOkResponse({ type: ReactionResult })
  async unreact(@Req() req: RequestWithAuth, @Param('ref') ref: string): Promise<ReactionResult> {
    return this.feedService.react(await this.access.forRequest(req), ref, null);
  }

  @Get('ideas/:ref/reactions')
  @ApiParam(REF)
  @ApiQuery({ name: 'kind', required: false, enum: MURAL_REACTIONS })
  @ApiOkResponse({ type: [ReactorView] })
  async reactors(@Param('ref') ref: string, @Query() query: unknown): Promise<ReactorView[]> {
    const { kind } = parseInput(ReactionsQuerySchema, query, UNPROCESSABLE);
    return this.feedService.reactors(ref, kind);
  }

  // --- Conversa (RN-153) ---------------------------------------------------------------------------

  @Post('ideas/:ref/comments')
  @HttpCode(200)
  @ApiParam(REF)
  @ApiBody({ type: MuralCommentRequest })
  @ApiOkResponse({ type: [MuralCommentView], description: 'A conversa inteira, já com o comentário novo.' })
  @ApiTooManyRequestsResponse({ type: ApiErrorBody, description: '30 comentários por hora (`too_many_comments`).' })
  async comment(
    @Req() req: RequestWithAuth,
    @Param('ref') ref: string,
    @Body() body: unknown,
  ): Promise<MuralCommentView[]> {
    const input = parseInput(CommentSchema, body, UNPROCESSABLE);
    return this.talk.comment(await this.access.forRequest(req), ref, input.body, input.parentId ?? null);
  }

  @Patch('comments/:id')
  @ApiBody({ type: EditCommentRequest })
  @ApiOkResponse({ type: [MuralCommentView] })
  async edit(
    @Req() req: RequestWithAuth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<MuralCommentView[]> {
    const { body: text } = parseInput(EditCommentSchema, body, UNPROCESSABLE);
    return this.talk.edit(await this.access.forRequest(req), id, text);
  }

  @Delete('comments/:id')
  @ApiOkResponse({ type: [MuralCommentView] })
  async remove(@Req() req: RequestWithAuth, @Param('id', ParseUUIDPipe) id: string): Promise<MuralCommentView[]> {
    return this.talk.remove(await this.access.forRequest(req), id);
  }

  @Get('comments/:id/revisions')
  @ApiOkResponse({ type: [CommentRevisionView], description: 'Textos anteriores (só a equipe).' })
  async revisions(@Req() req: RequestWithAuth, @Param('id', ParseUUIDPipe) id: string): Promise<CommentRevisionView[]> {
    return this.talk.revisions(await this.access.forRequest(req), id);
  }

  // --- Denúncia e moderação (RN-154) ---------------------------------------------------------------

  @Post('comments/:id/report')
  @HttpCode(200)
  @ApiBody({ type: ReportRequest })
  @ApiOkResponse({ type: [MuralCommentView] })
  @ApiUnprocessableEntityResponse({ type: ApiErrorBody, description: 'Próprio, já denunciado ou já oculto.' })
  async report(
    @Req() req: RequestWithAuth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<MuralCommentView[]> {
    const input = parseInput(ReportSchema, body, UNPROCESSABLE);
    return this.talk.report(await this.access.forRequest(req), id, input.reason, input.note ?? null);
  }

  @Post('comments/:id/hide')
  @HttpCode(200)
  @ApiBody({ type: HideCommentRequest })
  @ApiOkResponse({ type: [MuralCommentView] })
  async hide(
    @Req() req: RequestWithAuth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<MuralCommentView[]> {
    const { reason } = parseInput(HideCommentSchema, body, UNPROCESSABLE);
    return this.talk.hide(await this.access.forRequest(req), id, reason, requestMeta(req));
  }

  @Post('comments/:id/restore')
  @HttpCode(200)
  @ApiOkResponse({ type: [MuralCommentView] })
  async restore(@Req() req: RequestWithAuth, @Param('id', ParseUUIDPipe) id: string): Promise<MuralCommentView[]> {
    return this.talk.restore(await this.access.forRequest(req), id, requestMeta(req));
  }

  @Post('comments/:id/dismiss')
  @HttpCode(200)
  @ApiOkResponse({ type: [ReportQueueItem], description: 'A fila atualizada.' })
  async dismiss(@Req() req: RequestWithAuth, @Param('id', ParseUUIDPipe) id: string): Promise<ReportQueueItem[]> {
    return this.talk.dismiss(await this.access.forRequest(req), id, requestMeta(req));
  }

  // --- Compartilhar (RN-155) -----------------------------------------------------------------------

  @Post('ideas/:ref/share')
  @HttpCode(204)
  @ApiParam(REF)
  @ApiBody({ type: ShareRequest })
  @ApiNoContentResponse({ description: 'Enviado; a pessoa recebe o aviso no sino.' })
  @ApiTooManyRequestsResponse({ type: ApiErrorBody, description: '20 envios por hora (`too_many_shares`).' })
  async share(@Req() req: RequestWithAuth, @Param('ref') ref: string, @Body() body: unknown): Promise<void> {
    const input = parseInput(ShareSchema, body, UNPROCESSABLE);
    await this.talk.share(await this.access.forRequest(req), ref, input.recipientId, input.message ?? null);
  }
}
