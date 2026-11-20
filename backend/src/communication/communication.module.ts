import { Module } from '@nestjs/common';
import { EmailAdminController, NotificationsController } from './communication.controller.js';
import { EmailAdminService } from './email-admin.service.js';
import { NotificationsService } from './notifications.service.js';

/**
 * Comunicação (M4): notificações internas e preferências, provedor de e-mail, modelos e envios.
 * Os jobs (alertas, resumo diário, entrega) rodam no worker, com as funções de `jobs.ts` e `mail.ts`.
 */
@Module({
  controllers: [NotificationsController, EmailAdminController],
  providers: [NotificationsService, EmailAdminService],
})
export class CommunicationModule {}
