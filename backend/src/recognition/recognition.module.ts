import { Module } from '@nestjs/common';
import { RecognitionController } from './recognition.controller.js';
import { RecognitionService } from './recognition.service.js';

/** Reconhecimento (M8, RN-66 a RN-71): pontos, temporadas, níveis, conquistas e recompensas. */
@Module({ controllers: [RecognitionController], providers: [RecognitionService] })
export class RecognitionModule {}
