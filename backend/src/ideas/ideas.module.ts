import { Module } from '@nestjs/common';
import { CampaignsModule } from '../campaigns/campaigns.module.js';
import { AttachmentStorage } from './attachment-storage.js';
import { AttachmentsService } from './attachments.service.js';
import { ConvergenceService } from './convergence.service.js';
import { IdeaActivityService } from './idea-activity.service.js';
import { IdeaBatchService } from './idea-batch.service.js';
import { IdeaExportService } from './idea-export.service.js';
import { IdeaPdfService } from './idea-pdf.service.js';
import { IdeasController } from './ideas.controller.js';
import { IdeasService } from './ideas.service.js';
import { IdeasWorkflowService } from './ideas-workflow.service.js';
import { GainsController, ResultsController } from './results.controller.js';
import { ResultsService } from './results.service.js';
import { SavedFiltersController } from './saved-filters.controller.js';
import { StepsService } from './steps.service.js';
import { TriageRulesController } from './triage-rules.controller.js';
import { TriageRulesService } from './triage-rules.service.js';

/** Ideias e ciclo de vida (M2): envio, consultas com escopo, triagem, comentários e histórico. */
@Module({
  imports: [CampaignsModule],
  controllers: [IdeasController, TriageRulesController, SavedFiltersController, ResultsController, GainsController],
  providers: [
    IdeasService,
    IdeasWorkflowService,
    IdeaActivityService,
    StepsService,
    TriageRulesService,
    IdeaExportService,
    IdeaPdfService,
    IdeaBatchService,
    ConvergenceService,
    ResultsService,
    AttachmentsService,
    AttachmentStorage,
  ],
  exports: [IdeasService, ResultsService, AttachmentStorage],
})
export class IdeasModule {}
