import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Req } from '@nestjs/common';
import {
  ApiBody,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiParam,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { ApiErrorBody, parseInput } from '../common/api-error.js';
import { normalizeRich } from '../common/rich-text.js';
import { AccessService } from '../identity-access/access.service.js';
import type { RequestWithAuth } from '../identity-access/auth-context.js';
import {
  GainRequest,
  GainSchema,
  IdeaDetail,
  MeasurementRequest,
  MeasurementSchema,
  PendingGainView,
  ReplicateRequest,
  ReplicateSchema,
  StandardRequest,
  StandardSchema,
  SustainmentRequest,
  SustainmentSchema,
} from './ideas.dto.js';
import { ResultsService } from './results.service.js';

const UNPROCESSABLE = 422;
const ref = { name: 'ref', description: 'Id da ideia ou o código (ex.: ITS-2026-0042)' };

/** Resultado da ideia (RN-61 a RN-64): medição, ganho, validação, lição aprendida e réplica. */
@ApiTags('ideas')
@ApiCookieAuth()
@ApiForbiddenResponse({ type: ApiErrorBody })
@Controller('ideas')
export class ResultsController {
  constructor(
    private readonly results: ResultsService,
    private readonly access: AccessService,
  ) {}

  @Put(':ref/measurement')
  @ApiParam(ref)
  @ApiBody({ type: MeasurementRequest })
  @ApiOkResponse({ type: IdeaDetail })
  @ApiUnprocessableEntityResponse({ type: ApiErrorBody })
  async setMeasurement(@Req() req: RequestWithAuth, @Param('ref') r: string, @Body() body: unknown) {
    const input = parseInput(MeasurementSchema, body, UNPROCESSABLE);
    return this.results.setMeasurement(await this.access.forRequest(req), r, input);
  }

  @Delete(':ref/measurement')
  @ApiParam(ref)
  @ApiOkResponse({ type: IdeaDetail })
  async removeMeasurement(@Req() req: RequestWithAuth, @Param('ref') r: string) {
    return this.results.removeMeasurement(await this.access.forRequest(req), r);
  }

  @Put(':ref/gain')
  @ApiParam(ref)
  @ApiBody({ type: GainRequest })
  @ApiOkResponse({ type: IdeaDetail })
  @ApiConflictResponse({
    type: ApiErrorBody,
    description: 'Estimado fora da triagem ou realizado antes de implementar.',
  })
  @ApiUnprocessableEntityResponse({ type: ApiErrorBody, description: 'Valor negativo ou periodicidade inválida.' })
  async setGain(@Req() req: RequestWithAuth, @Param('ref') r: string, @Body() body: unknown) {
    const input = parseInput(GainSchema, body, UNPROCESSABLE);
    return this.results.setGain(await this.access.forRequest(req), r, input);
  }

  @Post(':ref/gain/validate')
  @HttpCode(200)
  @ApiParam(ref)
  @ApiOkResponse({ type: IdeaDetail })
  @ApiConflictResponse({ type: ApiErrorBody, description: 'Sem ganho realizado, ou já validado.' })
  async validateGain(@Req() req: RequestWithAuth, @Param('ref') r: string) {
    return this.results.validateGain(await this.access.forRequest(req), r);
  }

  @Put(':ref/standard')
  @ApiParam(ref)
  @ApiBody({ type: StandardRequest })
  @ApiOkResponse({ type: IdeaDetail })
  async setStandard(@Req() req: RequestWithAuth, @Param('ref') r: string, @Body() body: unknown) {
    const input = parseInput(StandardSchema, normalizeRich(body, ['standardAdopted']), UNPROCESSABLE);
    return this.results.setStandard(await this.access.forRequest(req), r, {
      standardAdopted: input.standardAdopted,
      standardAdoptedRich: input.standardAdoptedRich ?? null,
      isReplicable: input.isReplicable,
    });
  }

  @Post(':ref/sustainment')
  @HttpCode(200)
  @ApiParam(ref)
  @ApiBody({ type: SustainmentRequest })
  @ApiOkResponse({ type: IdeaDetail })
  @ApiConflictResponse({ type: ApiErrorBody, description: 'Sem revisão pendente, ou ainda não chegou o dia.' })
  async reviewSustainment(@Req() req: RequestWithAuth, @Param('ref') r: string, @Body() body: unknown) {
    const input = parseInput(SustainmentSchema, body, UNPROCESSABLE);
    return this.results.reviewSustainment(await this.access.forRequest(req), r, {
      decision: input.decision,
      note: input.note,
    });
  }

  @Post(':ref/replicate')
  @HttpCode(201)
  @ApiParam(ref)
  @ApiBody({ type: ReplicateRequest })
  @ApiOkResponse({ type: IdeaDetail, description: 'A nova ideia (Enviada), ligada à origem.' })
  @ApiConflictResponse({ type: ApiErrorBody, description: 'A origem não está implementada ou não é replicável.' })
  async replicate(@Req() req: RequestWithAuth, @Param('ref') r: string, @Body() body: unknown) {
    const { entityId } = parseInput(ReplicateSchema, body, UNPROCESSABLE);
    return this.results.replicate(await this.access.forRequest(req), r, entityId);
  }
}

/** Fila de quem valida ganhos (RN-63). */
@ApiTags('ideas')
@ApiCookieAuth()
@Controller('gains')
export class GainsController {
  constructor(
    private readonly results: ResultsService,
    private readonly access: AccessService,
  ) {}

  @Get('pending')
  @ApiOkResponse({ type: [PendingGainView], description: 'Ganhos realizados à espera de validação no escopo.' })
  async pending(@Req() req: RequestWithAuth): Promise<PendingGainView[]> {
    return this.results.pendingGains(await this.access.forRequest(req));
  }
}
