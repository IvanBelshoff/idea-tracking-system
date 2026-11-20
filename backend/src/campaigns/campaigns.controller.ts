import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common';
import {
  ApiBody,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiQuery,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { ApiErrorBody, apiError, parseInput } from '../common/api-error.js';
import { normalizeRich } from '../common/rich-text.js';
import type { Access } from '../identity-access/access.js';
import { AccessService } from '../identity-access/access.service.js';
import type { RequestWithAuth } from '../identity-access/auth-context.js';
import {
  AvailableQuerySchema,
  CampaignDashboard,
  CampaignRequest,
  CampaignSchema,
  CampaignView,
} from './campaigns.dto.js';
import { CampaignsService } from './campaigns.service.js';

const UNPROCESSABLE = 422;

/** Campanhas (RN-50 a RN-53). Listar e ver o painel: quem gerencia campanhas ou vê indicadores. */
@ApiTags('campaigns')
@ApiCookieAuth()
@ApiForbiddenResponse({ type: ApiErrorBody })
@Controller('campaigns')
export class CampaignsController {
  constructor(
    private readonly campaigns: CampaignsService,
    private readonly access: AccessService,
  ) {}

  private async viewer(req: RequestWithAuth): Promise<Access> {
    const access = await this.access.forRequest(req);
    if (access.entities('campaign.manage').length === 0 && access.entities('report.view').length === 0) {
      throw apiError(403, 'forbidden', 'Você não acompanha campanhas.');
    }
    return access;
  }

  @Get('available')
  @ApiQuery({ name: 'entityId', required: false, description: 'Entidade da ideia que vai ser enviada' })
  @ApiQuery({ name: 'categoryId', required: false })
  @ApiOkResponse({ type: [CampaignView], description: 'Campanhas ativas que podem receber a ideia (RN-51).' })
  async available(@Req() req: RequestWithAuth, @Query() query: unknown): Promise<CampaignView[]> {
    const { entityId, categoryId } = parseInput(AvailableQuerySchema, query);
    return this.campaigns.available(await this.access.forRequest(req), entityId, categoryId);
  }

  @Get()
  @ApiOkResponse({ type: [CampaignView] })
  async list(@Req() req: RequestWithAuth): Promise<CampaignView[]> {
    return this.campaigns.list(await this.viewer(req));
  }

  @Post()
  @ApiBody({ type: CampaignRequest })
  @ApiOkResponse({ type: CampaignView })
  @ApiUnprocessableEntityResponse({ type: ApiErrorBody, description: 'Sem nome, período invertido ou meta faltando.' })
  async create(@Req() req: RequestWithAuth, @Body() body: unknown): Promise<CampaignView> {
    return this.campaigns.create(
      await this.access.forRequest(req),
      parseInput(CampaignSchema, normalizeRich(body, ['objective']), UNPROCESSABLE),
    );
  }

  @Get(':id')
  @ApiOkResponse({ type: CampaignDashboard, description: 'Campanha e painel (RN-52).' })
  async dashboard(@Req() req: RequestWithAuth, @Param('id', ParseUUIDPipe) id: string): Promise<CampaignDashboard> {
    return this.campaigns.dashboard(await this.viewer(req), id);
  }

  @Put(':id')
  @ApiBody({ type: CampaignRequest })
  @ApiOkResponse({ type: CampaignView })
  @ApiConflictResponse({ type: ApiErrorBody, description: 'Campanha encerrada.' })
  async update(
    @Req() req: RequestWithAuth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<CampaignView> {
    return this.campaigns.update(
      await this.access.forRequest(req),
      id,
      parseInput(CampaignSchema, normalizeRich(body, ['objective']), UNPROCESSABLE),
    );
  }

  @Post(':id/activate')
  @HttpCode(200)
  @ApiOkResponse({ type: CampaignView })
  @ApiConflictResponse({ type: ApiErrorBody, description: 'Só rascunho vira ativa.' })
  async activate(@Req() req: RequestWithAuth, @Param('id', ParseUUIDPipe) id: string): Promise<CampaignView> {
    return this.campaigns.activate(await this.access.forRequest(req), id);
  }

  @Post(':id/close')
  @HttpCode(200)
  @ApiOkResponse({ type: CampaignDashboard, description: 'Painel com o resumo e as candidatas ao Hall (RN-53).' })
  @ApiConflictResponse({ type: ApiErrorBody, description: 'Só campanha ativa se encerra; encerrada não volta.' })
  async close(@Req() req: RequestWithAuth, @Param('id', ParseUUIDPipe) id: string): Promise<CampaignDashboard> {
    return this.campaigns.close(await this.access.forRequest(req), id);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiNoContentResponse()
  @ApiConflictResponse({ type: ApiErrorBody, description: 'Só rascunho se exclui.' })
  async remove(@Req() req: RequestWithAuth, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.campaigns.remove(await this.access.forRequest(req), id);
  }
}
