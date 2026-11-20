import { Module } from '@nestjs/common';
import { CampaignsController } from './campaigns.controller.js';
import { CampaignsService } from './campaigns.service.js';

/** Campanhas (M7, RN-50 a RN-53). O envio de ideias usa o serviço para conferir o vínculo. */
@Module({ controllers: [CampaignsController], providers: [CampaignsService], exports: [CampaignsService] })
export class CampaignsModule {}
