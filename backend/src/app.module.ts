import { type DynamicModule, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApprovalsModule } from './approvals/approvals.module.js';
import { AuditModule } from './audit/audit.module.js';
import { CampaignsModule } from './campaigns/campaigns.module.js';
import { CommunicationModule } from './communication/communication.module.js';
import { dataSourceOptions } from './database/data-source.js';
import { HallModule } from './hall/hall.module.js';
import { HealthController } from './health.controller.js';
import { IdeasModule } from './ideas/ideas.module.js';
import { IdentityAccessModule } from './identity-access/identity-access.module.js';
import { IntegrationAdminModule } from './integration/admin/integration-admin.module.js';
import { IntegrationModule } from './integration/integration.module.js';
import { WebhooksAdminModule } from './integration/webhooks/admin/webhooks-admin.module.js';
import { MuralModule } from './mural/mural.module.js';
import { ObservabilityModule } from './observability/observability.module.js';
import { OrganizationModule } from './organization/organization.module.js';
import { PublicModule } from './public/public.module.js';
import { RecognitionModule } from './recognition/recognition.module.js';
import { ReportsModule } from './reports/reports.module.js';
import { StoreModule } from './store/store.module.js';
import { UserFieldsModule } from './user-fields/user-fields.module.js';

export interface AppModuleOptions {
  /** URL do banco; padrão: DATABASE_URL. Os testes passam a do banco temporário. */
  databaseUrl?: string;
}

/** Raiz da aplicação. Módulos por fase em docs/STACK-E-ARQUITETURA.md, §1.1. */
@Module({})
// biome-ignore lint/complexity/noStaticOnlyClass: módulo dinâmico do NestJS (padrão forRoot)
export class AppModule {
  static forRoot(options: AppModuleOptions = {}): DynamicModule {
    return {
      module: AppModule,
      imports: [
        TypeOrmModule.forRoot(dataSourceOptions(options.databaseUrl)),
        IdentityAccessModule,
        OrganizationModule,
        AuditModule,
        IdeasModule,
        CampaignsModule,
        RecognitionModule,
        HallModule,
        MuralModule,
        StoreModule,
        ApprovalsModule,
        UserFieldsModule,
        CommunicationModule,
        PublicModule,
        ReportsModule,
        ObservabilityModule,
        IntegrationModule,
        IntegrationAdminModule,
        WebhooksAdminModule,
      ],
      controllers: [HealthController],
    };
  }
}
