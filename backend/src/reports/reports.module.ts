import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';

/** Indicadores (M5, RN-44, RN-45, RN-49). Exportações e PDF ficam em `ideas/`, junto das consultas. */
@Module({ controllers: [ReportsController], providers: [ReportsService], exports: [ReportsService] })
export class ReportsModule {}
