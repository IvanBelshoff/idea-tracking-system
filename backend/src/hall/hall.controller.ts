import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Req, Res } from '@nestjs/common';
import {
  ApiBody,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiParam,
  ApiProduces,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { ApiErrorBody, parseInput } from '../common/api-error.js';
import { AccessService } from '../identity-access/access.service.js';
import type { RequestWithAuth } from '../identity-access/auth-context.js';
import {
  CandidateView,
  ConsentRequest,
  ConsentSchema,
  HallView,
  HidePraiseSchema,
  HighlightDetail,
  HighlightRequest,
  HighlightSchema,
  LikeResult,
  PraiseRequest,
  PraiseSchema,
  RevokeRequest,
  RevokeSchema,
} from './hall.dto.js';
import { HallService } from './hall.service.js';

const UNPROCESSABLE = 422;

/** Hall de destaques (RN-72 a RN-80). */
@ApiTags('hall')
@ApiCookieAuth()
@Controller('hall')
export class HallController {
  constructor(
    private readonly hall: HallService,
    private readonly access: AccessService,
  ) {}

  @Get()
  @ApiOkResponse({ type: HallView })
  async view(@Req() req: RequestWithAuth): Promise<HallView> {
    return this.hall.hall(await this.access.forRequest(req));
  }

  @Get('candidates')
  @ApiOkResponse({ type: [CandidateView], description: 'Sugestões automáticas para a curadoria (RN-72b).' })
  async candidates(@Req() req: RequestWithAuth): Promise<CandidateView[]> {
    return this.hall.candidates(await this.access.forRequest(req));
  }

  @Post('candidates/:ref/dismiss')
  @HttpCode(200)
  @ApiParam({ name: 'ref', description: 'Código ou id da ideia' })
  @ApiOkResponse({ type: [CandidateView] })
  async dismiss(@Req() req: RequestWithAuth, @Param('ref') ref: string): Promise<CandidateView[]> {
    return this.hall.dismiss(await this.access.forRequest(req), ref);
  }

  @Post('highlights')
  @ApiBody({ type: HighlightRequest })
  @ApiOkResponse({ type: HighlightDetail })
  @ApiConflictResponse({ type: ApiErrorBody, description: 'Já em destaque neste escopo.' })
  @ApiUnprocessableEntityResponse({ type: ApiErrorBody, description: 'Ideia não implementada ou não autorizada.' })
  async create(@Req() req: RequestWithAuth, @Body() body: unknown): Promise<HighlightDetail> {
    return this.hall.create(await this.access.forRequest(req), parseInput(HighlightSchema, body, UNPROCESSABLE));
  }

  @Get('highlights/:id')
  @ApiOkResponse({ type: HighlightDetail })
  @ApiNotFoundResponse({ type: ApiErrorBody, description: 'Quem não vê o destaque recebe 404 (CA-RN-80.2).' })
  async detail(@Req() req: RequestWithAuth, @Param('id', ParseUUIDPipe) id: string): Promise<HighlightDetail> {
    return this.hall.detail(await this.access.forRequest(req), id);
  }

  @Get('highlights/:id/card')
  @ApiProduces('application/pdf')
  @ApiOkResponse({ description: 'Cartão do destaque em PDF (RN-80).' })
  async card(@Req() req: RequestWithAuth, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response): Promise<void> {
    const { code, pdf } = await this.hall.cardPdf(await this.access.forRequest(req), id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="destaque-${code}.pdf"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    res.send(pdf);
  }

  @Post('highlights/:id/revoke')
  @HttpCode(200)
  @ApiBody({ type: RevokeRequest })
  @ApiOkResponse({ type: HighlightDetail })
  async revoke(@Req() req: RequestWithAuth, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.hall.revoke(
      await this.access.forRequest(req),
      id,
      parseInput(RevokeSchema, body, UNPROCESSABLE).reason,
    );
  }

  @Post('highlights/:id/consent')
  @HttpCode(200)
  @ApiBody({ type: ConsentRequest })
  @ApiOkResponse({ type: HighlightDetail })
  async consent(@Req() req: RequestWithAuth, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.hall.consent(
      await this.access.forRequest(req),
      id,
      parseInput(ConsentSchema, body, UNPROCESSABLE).accept,
    );
  }

  @Post('highlights/:id/praises')
  @ApiBody({ type: PraiseRequest })
  @ApiOkResponse({ type: HighlightDetail })
  async praise(@Req() req: RequestWithAuth, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.hall.praise(await this.access.forRequest(req), id, parseInput(PraiseSchema, body, UNPROCESSABLE).body);
  }

  @Post('praises/:id/hide')
  @HttpCode(200)
  @ApiBody({ type: RevokeRequest })
  @ApiOkResponse({ type: HighlightDetail })
  async hidePraise(@Req() req: RequestWithAuth, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.hall.hidePraise(
      await this.access.forRequest(req),
      id,
      parseInput(HidePraiseSchema, body, UNPROCESSABLE),
    );
  }
}

/** Curtidas (RN-76) ficam na ideia: PUT curte (idempotente), DELETE desfaz. */
@ApiTags('hall')
@ApiCookieAuth()
@Controller('ideas')
export class IdeaLikesController {
  constructor(
    private readonly hall: HallService,
    private readonly access: AccessService,
  ) {}

  @Put(':ref/like')
  @ApiParam({ name: 'ref', description: 'Código ou id da ideia' })
  @ApiOkResponse({ type: LikeResult })
  @ApiNotFoundResponse({ type: ApiErrorBody, description: 'Curtidas desligadas ou ideia que a pessoa não vê.' })
  @ApiUnprocessableEntityResponse({ type: ApiErrorBody, description: 'A própria ideia ou de co-autoria.' })
  async like(@Req() req: RequestWithAuth, @Param('ref') ref: string): Promise<LikeResult> {
    return this.hall.like(await this.access.forRequest(req), ref, true);
  }

  @Delete(':ref/like')
  @ApiParam({ name: 'ref', description: 'Código ou id da ideia' })
  @ApiOkResponse({ type: LikeResult })
  async unlike(@Req() req: RequestWithAuth, @Param('ref') ref: string): Promise<LikeResult> {
    return this.hall.like(await this.access.forRequest(req), ref, false);
  }
}
