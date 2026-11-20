import { Module } from '@nestjs/common';
import { IdeasModule } from '../ideas/ideas.module.js';
import { HallController, IdeaLikesController } from './hall.controller.js';
import { HallService } from './hall.service.js';

/** Hall de destaques (M9, RN-72 a RN-80). */
@Module({ imports: [IdeasModule], controllers: [HallController, IdeaLikesController], providers: [HallService] })
export class HallModule {}
