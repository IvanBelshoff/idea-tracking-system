import { Module } from '@nestjs/common';
import { IdeasModule } from '../ideas/ideas.module.js';
import { ReportsModule } from '../reports/reports.module.js';
import { IntegrationDocsService } from './admin/integration-docs.service.js';
import { CampaignsApiController, CampaignsReader } from './api/campaigns.api.js';
import { ContractApiController } from './api/contract.api.js';
import { EntitiesApiController, EntitiesReader } from './api/entities.api.js';
import { HallApiController, HallReader } from './api/hall.api.js';
import { IdeasApiController, IdeasReader } from './api/ideas.api.js';
import { IndicatorsApiController, IndicatorsReader } from './api/indicators.api.js';
import { StoreApiController, StoreReader } from './api/store.api.js';
import { UsersApiController, UsersReader } from './api/users.api.js';
import { IntegrationAuthService } from './integration-auth.service.js';
import { IntegrationUsageService } from './integration-usage.service.js';
import { IdempotencyInterceptor, IdempotencyService } from './write/idempotency.js';
import { GainsWriteApiController, IdeasWriteApiController } from './write/write.api.js';
import { IntegrationWriteService } from './write/write.service.js';

/**
 * API de integração (M16, RN-102 a RN-116): `/integration/v1`, só leitura, separada da API interna.
 * Este módulo tem SÓ as rotas e os leitores do contrato; é o único que entra no OpenAPI da
 * integração e o único que sai do OpenAPI interno (CA-T.15). A administração fica em
 * `IntegrationAdminModule`, que é da API interna.
 */
@Module({
  imports: [ReportsModule, IdeasModule],
  controllers: [
    ContractApiController,
    IdeasApiController,
    IndicatorsApiController,
    CampaignsApiController,
    HallApiController,
    EntitiesApiController,
    UsersApiController,
    StoreApiController,
    IdeasWriteApiController,
    GainsWriteApiController,
  ],
  providers: [
    IntegrationAuthService,
    IntegrationUsageService,
    IntegrationDocsService,
    IdeasReader,
    IndicatorsReader,
    CampaignsReader,
    HallReader,
    EntitiesReader,
    UsersReader,
    StoreReader,
    IntegrationWriteService,
    IdempotencyService,
    IdempotencyInterceptor,
  ],
  exports: [IntegrationUsageService, IntegrationDocsService, IdempotencyService],
})
export class IntegrationModule {}
