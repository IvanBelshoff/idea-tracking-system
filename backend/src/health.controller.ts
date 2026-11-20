import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { ApiOkResponse, ApiProperty, ApiResponse, ApiTags } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Response } from 'express';
import type { DataSource } from 'typeorm';
import { AllowBeforeInstall, Public } from './identity-access/auth-context.js';

/** Tempo máximo para o banco responder ao healthcheck (o do Docker espera 3 s). */
const DATABASE_TIMEOUT_MS = 2000;

export class HealthResponse {
  @ApiProperty({ enum: ['ok', 'degraded'], example: 'ok' })
  status!: 'ok' | 'degraded';

  @ApiProperty({ enum: ['ok', 'down'], example: 'ok', description: 'O banco de dados respondeu?' })
  db!: 'ok' | 'down';
}

/**
 * Healthcheck público (liveness + banco): sem detalhe, funciona antes da instalação e devolve 503
 * quando o banco não responde, para a hospedagem e o Compose enxergarem (RN-93, CA-RN-93.3/93.4).
 * O detalhe por item fica em `/api/ops/health`, protegido por permissão.
 */
@ApiTags('health')
@Controller('health')
@Public()
@AllowBeforeInstall()
export class HealthController {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  @Get()
  @ApiOkResponse({ type: HealthResponse, description: 'A API está no ar e o banco responde.' })
  @ApiResponse({ status: 503, type: HealthResponse, description: 'A API está no ar, mas o banco não responde.' })
  async check(@Res({ passthrough: true }) res: Response): Promise<HealthResponse> {
    const databaseUp = await this.databaseResponds();
    if (!databaseUp) res.status(HttpStatus.SERVICE_UNAVAILABLE);
    return { status: databaseUp ? 'ok' : 'degraded', db: databaseUp ? 'ok' : 'down' };
  }

  private async databaseResponds(): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), DATABASE_TIMEOUT_MS);
    });
    try {
      await Promise.race([this.dataSource.query('SELECT 1'), timeout]);
      return true;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
}
