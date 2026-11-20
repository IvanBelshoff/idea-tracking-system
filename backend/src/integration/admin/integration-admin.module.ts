import { Module } from '@nestjs/common';
import { IntegrationModule } from '../integration.module.js';
import { IntegrationAdminController } from './integration-admin.controller.js';
import { IntegrationAdminService } from './integration-admin.service.js';

/** Administração das integrações (permissão `integration.manage`): parte da API interna (`/api/admin/integrations`). */
@Module({
  imports: [IntegrationModule],
  controllers: [IntegrationAdminController],
  providers: [IntegrationAdminService],
})
export class IntegrationAdminModule {}
