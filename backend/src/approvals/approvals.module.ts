import { Module } from '@nestjs/common';
import { IdeasModule } from '../ideas/ideas.module.js';
import { ApprovalDecisionsService } from './approval-decisions.service.js';
import { ApprovalInboxController } from './approval-inbox.controller.js';
import { ApprovalLinkController } from './approval-link.controller.js';
import { ApprovalsController } from './approvals.controller.js';
import { ApprovalsService } from './approvals.service.js';

/** Aprovação de outras áreas (M24, RN-183 a RN-192). */
@Module({
  imports: [IdeasModule],
  controllers: [ApprovalsController, ApprovalInboxController, ApprovalLinkController],
  providers: [ApprovalsService, ApprovalDecisionsService],
})
export class ApprovalsModule {}
