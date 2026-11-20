import { Module } from '@nestjs/common';
import { PublicController } from './public.controller.js';
import { PublicService } from './public.service.js';

/** Consulta pública por código (M5, RN-33 a RN-37). */
@Module({ controllers: [PublicController], providers: [PublicService] })
export class PublicModule {}
