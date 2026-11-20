import { Module } from '@nestjs/common';
import { AuditController } from './audit.controller.js';
import { AuditQueryService } from './audit-query.service.js';

/** Leitura do log de auditoria. A gravação (AuditService) é global, no módulo de identidade. */
@Module({
  controllers: [AuditController],
  providers: [AuditQueryService],
})
export class AuditModule {}
