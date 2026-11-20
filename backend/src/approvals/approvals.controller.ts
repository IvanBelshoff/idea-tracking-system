import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiParam,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { ApiErrorBody } from '../common/api-error.js';
import { asciiFileName } from '../ideas/attachment-storage.js';
import { AccessService } from '../identity-access/access.service.js';
import { type RequestWithAuth, requestMeta } from '../identity-access/auth-context.js';
import { ApprovalDecisionsService, type IncomingFile } from './approval-decisions.service.js';
import { ApprovalOkView, ApprovalReasonBody, ApprovalRequestBody, ApprovalsView } from './approvals.dto.js';
import { ApprovalsService } from './approvals.service.js';

/** Teto do corpo no registro manual (o limite de cada arquivo é o da instalação, RN-21). */
const EVIDENCE_CEILING = 60 * 1024 * 1024;

const REF = { name: 'ref', description: 'Código ou id da ideia' };

/** Aprovação de outras áreas (M24, RN-183 a RN-192): pedir, cancelar, seguir sem e ver. */
@ApiTags('approvals')
@ApiCookieAuth()
@Controller('ideas')
export class ApprovalsController {
  constructor(
    private readonly approvals: ApprovalsService,
    private readonly decisions: ApprovalDecisionsService,
    private readonly access: AccessService,
  ) {}

  @Get(':ref/approvals')
  @ApiParam(REF)
  @ApiOkResponse({ type: ApprovalsView, description: 'Sem acesso de equipe, só a situação (RN-190).' })
  async view(@Req() req: RequestWithAuth, @Param('ref') ref: string): Promise<ApprovalsView> {
    return this.approvals.view(await this.access.forRequest(req), ref);
  }

  @Post(':ref/approvals')
  @ApiParam(REF)
  @ApiBody({ type: ApprovalRequestBody })
  @ApiCreatedResponse({ type: ApprovalsView })
  @ApiForbiddenResponse({ type: ApiErrorBody, description: 'Sem `idea.triage` na entidade da ideia.' })
  @ApiConflictResponse({
    type: ApiErrorBody,
    description: 'Situação da ideia não permite (`approval_invalid_state`) ou já há pedido aberto (`approval_open`).',
  })
  @ApiUnprocessableEntityResponse({
    type: ApiErrorBody,
    description:
      'Dados inválidos, aprovador inválido, repetido ou quem pede (`approval_self`), e-mail de fora dos domínios.',
  })
  async request(@Req() req: RequestWithAuth, @Param('ref') ref: string, @Body() body: unknown): Promise<ApprovalsView> {
    return this.approvals.request(await this.access.forRequest(req), ref, body, requestMeta(req));
  }

  @Post(':ref/approvals/:requestId/cancel')
  @HttpCode(200)
  @ApiParam(REF)
  @ApiParam({ name: 'requestId' })
  @ApiBody({ type: ApprovalReasonBody })
  @ApiOkResponse({ type: ApprovalsView })
  @ApiConflictResponse({ type: ApiErrorBody, description: 'O pedido já foi encerrado (`approval_not_open`).' })
  async cancel(
    @Req() req: RequestWithAuth,
    @Param('ref') ref: string,
    @Param('requestId', new ParseUUIDPipe()) requestId: string,
    @Body() body: unknown,
  ): Promise<ApprovalsView> {
    return this.approvals.cancel(await this.access.forRequest(req), ref, requestId, body, requestMeta(req));
  }

  @Post(':ref/approvals/:requestId/override')
  @HttpCode(200)
  @ApiParam(REF)
  @ApiParam({ name: 'requestId' })
  @ApiBody({ type: ApprovalReasonBody })
  @ApiOkResponse({ type: ApprovalsView })
  @ApiForbiddenResponse({ type: ApiErrorBody, description: 'Modo bloquear (`approval_override_blocked`).' })
  @ApiConflictResponse({
    type: ApiErrorBody,
    description: 'Só depois de recusa ou prazo vencido (`approval_not_overridable`).',
  })
  async override(
    @Req() req: RequestWithAuth,
    @Param('ref') ref: string,
    @Param('requestId', new ParseUUIDPipe()) requestId: string,
    @Body() body: unknown,
  ): Promise<ApprovalsView> {
    return this.approvals.override(await this.access.forRequest(req), ref, requestId, body, requestMeta(req));
  }

  @Post(':ref/approvals/:requestId/recipients/:recipientId/record')
  @HttpCode(200)
  @ApiParam(REF)
  @ApiParam({ name: 'requestId' })
  @ApiParam({ name: 'recipientId' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        decision: { type: 'string', enum: ['approved', 'rejected'] },
        decidedName: { type: 'string', maxLength: 120 },
        decidedOn: { type: 'string', example: '2026-11-16' },
        comment: { type: 'string', maxLength: 1000 },
        files: { type: 'array', items: { type: 'string', format: 'binary' } },
      },
      required: ['decision', 'decidedName', 'decidedOn', 'files'],
    },
  })
  @ApiOkResponse({ type: ApprovalOkView })
  @ApiUnprocessableEntityResponse({
    type: ApiErrorBody,
    description: 'Sem evidência (`approval_evidence_required`) ou data no futuro.',
  })
  @UseInterceptors(FilesInterceptor('files', 5, { limits: { fileSize: EVIDENCE_CEILING, files: 5 } }))
  async record(
    @Req() req: RequestWithAuth,
    @Param('ref') ref: string,
    @Param('requestId', new ParseUUIDPipe()) requestId: string,
    @Param('recipientId', new ParseUUIDPipe()) recipientId: string,
    @Body() body: unknown,
    @UploadedFiles() files: IncomingFile[] | undefined,
  ): Promise<ApprovalOkView> {
    return this.decisions.record(
      await this.access.forRequest(req),
      ref,
      requestId,
      recipientId,
      body,
      files ?? [],
      requestMeta(req),
    );
  }

  @Get(':ref/approvals/evidence/:evidenceId')
  @ApiParam(REF)
  @ApiParam({ name: 'evidenceId' })
  @ApiOkResponse({ description: 'A evidência (download), só para quem vê os detalhes do pedido.' })
  async evidence(
    @Req() req: RequestWithAuth,
    @Param('ref') ref: string,
    @Param('evidenceId', new ParseUUIDPipe()) evidenceId: string,
    @Res() res: Response,
  ): Promise<void> {
    const file = await this.decisions.evidence(await this.access.forRequest(req), ref, evidenceId);
    res.set({
      'Content-Type': file.mime,
      'Content-Length': String(file.content.length),
      'Content-Disposition': `attachment; filename="${asciiFileName(file.originalName)}"; filename*=UTF-8''${encodeURIComponent(file.originalName)}`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cache-Control': 'private, no-store',
    });
    res.send(file.content);
  }
}
