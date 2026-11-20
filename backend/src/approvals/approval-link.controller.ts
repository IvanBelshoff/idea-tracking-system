import { Body, Controller, Header, HttpCode, Post, Req, Res } from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBody,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { ApiErrorBody } from '../common/api-error.js';
import { asciiFileName } from '../ideas/attachment-storage.js';
import { Public, requestMeta } from '../identity-access/auth-context.js';
import { ApprovalDecisionsService, approvalLinkLimiter } from './approval-decisions.service.js';
import {
  ApprovalLinkAttachmentBody,
  ApprovalLinkDecisionBody,
  ApprovalLinkView,
  ApprovalTokenBody,
} from './approvals.dto.js';

/**
 * A página do link de uso único (M24, RN-184 e RN-185), sem login. O link vai no corpo (nunca na URL,
 * que fica em log); limite por IP; nada é indexado nem guardado em cache.
 */
@ApiTags('approvals')
@Controller('approvals/link')
@Public()
export class ApprovalLinkController {
  constructor(private readonly decisions: ApprovalDecisionsService) {}

  @Post('view')
  @HttpCode(200)
  @Header('X-Robots-Tag', 'noindex, nofollow')
  @Header('Cache-Control', 'no-store')
  @ApiBody({ type: ApprovalTokenBody })
  @ApiOkResponse({ type: ApprovalLinkView })
  @ApiNotFoundResponse({ type: ApiErrorBody, description: 'Link inventado ou alterado.' })
  @ApiTooManyRequestsResponse({ type: ApiErrorBody })
  view(@Req() req: Request, @Body() body: unknown): Promise<ApprovalLinkView> {
    approvalLinkLimiter.hit(requestMeta(req).ip ?? 'sem-ip');
    return this.decisions.linkView(body);
  }

  @Post('code')
  @HttpCode(202)
  @Header('Cache-Control', 'no-store')
  @ApiBody({ type: ApprovalTokenBody })
  @ApiAcceptedResponse({ description: 'Código enviado ao e-mail do aprovador.' })
  @ApiConflictResponse({ type: ApiErrorBody, description: 'Código desligado ou link que não vale mais.' })
  @ApiTooManyRequestsResponse({ type: ApiErrorBody })
  async code(@Req() req: Request, @Body() body: unknown): Promise<void> {
    approvalLinkLimiter.hit(requestMeta(req).ip ?? 'sem-ip');
    await this.decisions.sendCode(body);
  }

  @Post('decide')
  @HttpCode(200)
  @Header('X-Robots-Tag', 'noindex, nofollow')
  @Header('Cache-Control', 'no-store')
  @ApiBody({ type: ApprovalLinkDecisionBody })
  @ApiOkResponse({ type: ApprovalLinkView })
  @ApiConflictResponse({ type: ApiErrorBody, description: 'Já respondido, vencido, cancelado ou encerrado.' })
  @ApiUnprocessableEntityResponse({
    type: ApiErrorBody,
    description: 'Sem motivo para não aprovar; código ausente, errado ou vencido.',
  })
  @ApiTooManyRequestsResponse({ type: ApiErrorBody })
  decide(@Req() req: Request, @Body() body: unknown): Promise<ApprovalLinkView> {
    const meta = requestMeta(req);
    approvalLinkLimiter.hit(meta.ip ?? 'sem-ip');
    return this.decisions.linkDecide(body, meta);
  }

  @Post('attachment')
  @HttpCode(200)
  @ApiBody({ type: ApprovalLinkAttachmentBody })
  @ApiOkResponse({ description: 'O anexo (download).' })
  @ApiNotFoundResponse({ type: ApiErrorBody })
  async attachment(@Req() req: Request, @Body() body: unknown, @Res() res: Response): Promise<void> {
    approvalLinkLimiter.hit(requestMeta(req).ip ?? 'sem-ip');
    const { attachment, content } = await this.decisions.linkAttachment(body);
    res.set({
      'Content-Type': attachment.mime,
      'Content-Length': String(content.length),
      'Content-Disposition': `attachment; filename="${asciiFileName(attachment.originalName)}"; filename*=UTF-8''${encodeURIComponent(attachment.originalName)}`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    });
    res.send(content);
  }
}
