import { Module } from '@nestjs/common';
import { realDeps } from '../webhook-sender.js';
import { WebhooksAdminController } from './webhooks-admin.controller.js';
import { SENDER_DEPS, WebhooksAdminService } from './webhooks-admin.service.js';

/** Administração dos webhooks (permissão `integration.manage`): parte da API interna (`/api/admin/webhooks`). */
@Module({
  controllers: [WebhooksAdminController],
  providers: [WebhooksAdminService, { provide: SENDER_DEPS, useFactory: realDeps }],
})
export class WebhooksAdminModule {}
