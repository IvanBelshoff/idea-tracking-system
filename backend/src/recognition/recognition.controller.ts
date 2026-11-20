import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common';
import {
  ApiBody,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { ApiErrorBody, apiError, parseInput } from '../common/api-error.js';
import { AccessService } from '../identity-access/access.service.js';
import {
  type AuthContext,
  CurrentAuth,
  type RequestWithAuth,
  RequirePermission,
} from '../identity-access/auth-context.js';
import {
  AchievementRequest,
  AchievementSchema,
  AchievementView,
  GrantResult,
  LevelsRequest,
  LevelsSchema,
  LevelView,
  MyRecognition,
  Ranking,
  RankingQuerySchema,
  RewardRequest,
  RewardSchema,
  RewardView,
  SeasonRequest,
  SeasonSchema,
  SeasonView,
} from './recognition.dto.js';
import { RecognitionService } from './recognition.service.js';

const UNPROCESSABLE = 422;

/** Reconhecimento (RN-66 a RN-71): pontos e ranking para todos; configuração para quem administra. */
@ApiTags('recognition')
@ApiCookieAuth()
@Controller('recognition')
export class RecognitionController {
  constructor(
    private readonly recognition: RecognitionService,
    private readonly access: AccessService,
  ) {}

  @Get('me')
  @ApiOkResponse({ type: MyRecognition })
  @ApiNotFoundResponse({ type: ApiErrorBody, description: 'Módulo desligado (CA-RN-66.2).' })
  me(@CurrentAuth() auth: AuthContext): Promise<MyRecognition> {
    return this.recognition.me(auth.user.id);
  }

  @Get('ranking')
  @ApiQuery({ name: 'scope', required: false, enum: ['individual', 'entity'] })
  @ApiQuery({ name: 'period', required: false, enum: ['season', 'all'] })
  @ApiOkResponse({ type: Ranking })
  @ApiNotFoundResponse({ type: ApiErrorBody, description: 'Módulo ou ranking individual desligado (CA-RN-70.2).' })
  ranking(@CurrentAuth() auth: AuthContext, @Query() query: unknown): Promise<Ranking> {
    const { scope, period } = parseInput(RankingQuerySchema, query);
    return this.recognition.ranking(auth.user.id, scope, period);
  }

  @Get('levels')
  @RequirePermission('setting.manage')
  @ApiOkResponse({ type: [LevelView] })
  levels(): Promise<LevelView[]> {
    return this.recognition.levels();
  }

  @Put('levels')
  @RequirePermission('setting.manage')
  @ApiBody({ type: LevelsRequest })
  @ApiOkResponse({ type: [LevelView] })
  replaceLevels(@Body() body: unknown): Promise<LevelView[]> {
    return this.recognition.replaceLevels(parseInput(LevelsSchema, body, UNPROCESSABLE).levels);
  }

  @Get('achievements')
  @RequirePermission('setting.manage')
  @ApiOkResponse({ type: [AchievementView] })
  achievements(): Promise<AchievementView[]> {
    return this.recognition.achievements();
  }

  @Post('achievements')
  @RequirePermission('setting.manage')
  @ApiBody({ type: AchievementRequest })
  @ApiOkResponse({ type: [AchievementView] })
  @ApiConflictResponse({ type: ApiErrorBody, description: 'Código repetido.' })
  createAchievement(@Body() body: unknown): Promise<AchievementView[]> {
    return this.recognition.saveAchievement(null, parseInput(AchievementSchema, body, UNPROCESSABLE));
  }

  @Put('achievements/:id')
  @RequirePermission('setting.manage')
  @ApiBody({ type: AchievementRequest })
  @ApiOkResponse({ type: [AchievementView] })
  updateAchievement(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown): Promise<AchievementView[]> {
    return this.recognition.saveAchievement(id, parseInput(AchievementSchema, body, UNPROCESSABLE));
  }

  @Delete('achievements/:id')
  @RequirePermission('setting.manage')
  @ApiOkResponse({ type: [AchievementView] })
  removeAchievement(@Param('id', ParseUUIDPipe) id: string): Promise<AchievementView[]> {
    return this.recognition.removeAchievement(id);
  }

  @Post('achievements/:id/grant')
  @HttpCode(200)
  @RequirePermission('setting.manage')
  @ApiOkResponse({ type: GrantResult, description: 'Concede a quem já cumpre a regra (ação explícita, CA-RN-68.1).' })
  async grant(@Param('id', ParseUUIDPipe) id: string): Promise<GrantResult> {
    return { granted: await this.recognition.grantRetroactive(id) };
  }

  @Get('seasons')
  @RequirePermission('setting.manage')
  @ApiOkResponse({ type: [SeasonView] })
  seasons(): Promise<SeasonView[]> {
    return this.recognition.seasons();
  }

  @Post('seasons')
  @RequirePermission('setting.manage')
  @ApiBody({ type: SeasonRequest })
  @ApiOkResponse({ type: [SeasonView] })
  @ApiConflictResponse({ type: ApiErrorBody, description: 'Período sobreposto a outra temporada.' })
  createSeason(@Body() body: unknown): Promise<SeasonView[]> {
    return this.recognition.saveSeason(null, parseInput(SeasonSchema, body, UNPROCESSABLE));
  }

  @Put('seasons/:id')
  @RequirePermission('setting.manage')
  @ApiBody({ type: SeasonRequest })
  @ApiOkResponse({ type: [SeasonView] })
  updateSeason(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown): Promise<SeasonView[]> {
    return this.recognition.saveSeason(id, parseInput(SeasonSchema, body, UNPROCESSABLE));
  }

  @Delete('seasons/:id')
  @RequirePermission('setting.manage')
  @ApiOkResponse({ type: [SeasonView] })
  removeSeason(@Param('id', ParseUUIDPipe) id: string): Promise<SeasonView[]> {
    return this.recognition.removeSeason(id);
  }

  @Get('rewards')
  @ApiOkResponse({ type: [RewardView], description: 'Recompensas registradas (quem registra recompensas).' })
  async rewards(@Req() req: RequestWithAuth): Promise<RewardView[]> {
    const access = await this.access.forRequest(req);
    if (access.entities('reward.register').length === 0) throw apiError(403, 'forbidden', 'Sem acesso às recompensas.');
    return this.recognition.rewards();
  }

  @Post('rewards')
  @ApiBody({ type: RewardRequest })
  @ApiOkResponse({ type: [RewardView] })
  async registerReward(@Req() req: RequestWithAuth, @Body() body: unknown): Promise<RewardView[]> {
    const access = await this.access.forRequest(req);
    if (access.entities('reward.register').length === 0) {
      throw apiError(403, 'forbidden', 'Você não registra recompensas.');
    }
    return this.recognition.registerReward(access, parseInput(RewardSchema, body, UNPROCESSABLE));
  }
}
