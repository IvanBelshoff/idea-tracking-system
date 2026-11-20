import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Req, Res } from '@nestjs/common';
import { ApiBody, ApiCookieAuth, ApiForbiddenResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ApiErrorBody } from '../common/api-error.js';
import { asciiFileName } from '../ideas/attachment-storage.js';
import { AccessService } from '../identity-access/access.service.js';
import { type RequestWithAuth, requestMeta } from '../identity-access/auth-context.js';
import { ApprovalDecisionsService } from './approval-decisions.service.js';
import { ApprovalDecisionBody, ApprovalOkView, MyPendingApprovalView } from './approvals.dto.js';

/** Aprovações pendentes de quem tem usuário no ITS (M24, RN-186): sem link, decide aqui. */
@ApiTags('approvals')
@ApiCookieAuth()
@Controller('approvals')
export class ApprovalInboxController {
  constructor(
    private readonly decisions: ApprovalDecisionsService,
    private readonly access: AccessService,
  ) {}

  @Get('pending')
  @ApiOkResponse({ type: [MyPendingApprovalView] })
  async pending(@Req() req: RequestWithAuth): Promise<MyPendingApprovalView[]> {
    return this.decisions.myPending(await this.access.forRequest(req));
  }

  @Post('recipients/:recipientId/decide')
  @HttpCode(200)
  @ApiBody({ type: ApprovalDecisionBody })
  @ApiOkResponse({ type: ApprovalOkView })
  @ApiForbiddenResponse({ type: ApiErrorBody, description: 'Só a pessoa escolhida decide.' })
  async decide(
    @Req() req: RequestWithAuth,
    @Param('recipientId', new ParseUUIDPipe()) recipientId: string,
    @Body() body: unknown,
  ): Promise<ApprovalOkView> {
    return this.decisions.decide(await this.access.forRequest(req), recipientId, body, requestMeta(req));
  }

  @Get('recipients/:recipientId/attachments/:attachmentId')
  @ApiOkResponse({ description: 'O anexo (download).' })
  async attachment(
    @Req() req: RequestWithAuth,
    @Param('recipientId', new ParseUUIDPipe()) recipientId: string,
    @Param('attachmentId', new ParseUUIDPipe()) attachmentId: string,
    @Res() res: Response,
  ): Promise<void> {
    const { attachment, content } = await this.decisions.myAttachment(
      await this.access.forRequest(req),
      recipientId,
      attachmentId,
    );
    res.set({
      'Content-Type': attachment.mime,
      'Content-Length': String(content.length),
      'Content-Disposition': `attachment; filename="${asciiFileName(attachment.originalName)}"; filename*=UTF-8''${encodeURIComponent(attachment.originalName)}`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cache-Control': 'private, no-store',
    });
    res.send(content);
  }
}
