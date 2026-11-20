import { Module } from '@nestjs/common';
import { IdeasModule } from '../ideas/ideas.module.js';
import { MuralController } from './mural.controller.js';
import { MuralService } from './mural.service.js';
import { MuralFeedService } from './mural-feed.service.js';
import { MuralTalkService } from './mural-talk.service.js';

/** Mural de ideias (M21, RN-148 a RN-158). */
@Module({
  imports: [IdeasModule],
  controllers: [MuralController],
  providers: [MuralService, MuralFeedService, MuralTalkService],
})
export class MuralModule {}
