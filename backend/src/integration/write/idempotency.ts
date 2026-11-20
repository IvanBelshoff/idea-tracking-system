import { createHash } from 'node:crypto';
import {
  type CallHandler,
  type ExecutionContext,
  HttpException,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Response } from 'express';
import { catchError, from, mergeMap, type Observable, of, throwError } from 'rxjs';
import type { DataSource } from 'typeorm';
import { apiError } from '../../common/api-error.js';
import { IntegrationIdempotency } from '../entities.js';
import { INTEGRATION_LIMITS } from '../modules.js';
import type { RequestWithIntegration } from '../principal.js';
import { isValidIdempotencyKey } from './write-schemas.js';

/** O resumo do corpo, com as chaves em ordem: a mesma chamada sempre dá o mesmo resumo (RN-131). */
export function requestHash(body: unknown): string {
  const canon = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(canon)
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.entries(v as Record<string, unknown>)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, x]) => [k, canon(x)]),
          )
        : v;
  return createHash('sha256')
    .update(JSON.stringify(canon(body ?? {})))
    .digest('hex');
}

export type Reservation =
  | { kind: 'new' }
  | { kind: 'replay'; status: number; response: unknown }
  | { kind: 'reused' }
  | { kind: 'busy' };

/** Uma reserva "em andamento" parada há mais que isto é de um processo que caiu: pode ser refeita. */
const STALE_IN_PROGRESS_MS = 2 * 60_000;

/** O TypeORM devolve `[linhas, contagem]` em UPDATE/DELETE e só as linhas em INSERT; aceita os dois. */
const rowsOf = (result: unknown): unknown[] =>
  Array.isArray(result) && Array.isArray(result[0]) ? (result[0] as unknown[]) : (result as unknown[]);

/**
 * Idempotência das escritas (M18, RN-131). A chave é reservada com `INSERT ... ON CONFLICT DO NOTHING`:
 * duas chamadas simultâneas com a mesma chave nunca gravam duas vezes (uma ganha; a outra recebe a
 * mesma resposta ou `request_in_progress`). Guarda a resposta de sucesso e a de erro de negócio
 * (`4xx`); falha do servidor (`5xx`) libera a chave.
 */
@Injectable()
export class IdempotencyService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async reserve(
    integrationId: string,
    route: string,
    key: string,
    hash: string,
    now = new Date(),
  ): Promise<Reservation> {
    const repo = this.dataSource.getRepository(IntegrationIdempotency);
    for (let attempt = 0; attempt < 3; attempt++) {
      const inserted = rowsOf(
        await this.dataSource.query(
          `INSERT INTO integration_idempotency (integration_id, route, key, request_hash, state)
           VALUES ($1, $2, $3, $4, 'in_progress') ON CONFLICT DO NOTHING RETURNING key`,
          [integrationId, route, key, hash],
        ),
      );
      if (inserted.length > 0) return { kind: 'new' };
      const row = await repo.findOneBy({ integrationId, route, key });
      if (!row) continue; // foi apagada entre o INSERT e a leitura
      const age = now.getTime() - row.createdAt.getTime();
      const expired =
        age > INTEGRATION_LIMITS.idempotencyHours * 3_600_000 ||
        (row.state === 'in_progress' && age > STALE_IN_PROGRESS_MS);
      if (expired) {
        // Só apaga a reserva que foi lida (não uma refeita no meio): o banco guarda microssegundos e o JS, milissegundos.
        await this.dataSource.query(
          'DELETE FROM integration_idempotency WHERE integration_id = $1 AND route = $2 AND key = $3 AND created_at <= $4',
          [integrationId, route, key, new Date(row.createdAt.getTime() + 1)],
        );
        continue;
      }
      if (row.requestHash !== hash) return { kind: 'reused' };
      if (row.state === 'in_progress') return { kind: 'busy' };
      return { kind: 'replay', status: row.status ?? 200, response: row.response };
    }
    return { kind: 'busy' };
  }

  async finish(integrationId: string, route: string, key: string, status: number, response: unknown): Promise<void> {
    await this.dataSource
      .getRepository(IntegrationIdempotency)
      .update({ integrationId, route, key }, { state: 'done', status, response: (response ?? null) as never });
  }

  async release(integrationId: string, route: string, key: string): Promise<void> {
    await this.dataSource.getRepository(IntegrationIdempotency).delete({ integrationId, route, key });
  }

  /** Apaga as chaves com mais de 24 horas. Idempotente (CA-RN-131.6). */
  async purge(now = new Date()): Promise<number> {
    const cut = new Date(now.getTime() - INTEGRATION_LIMITS.idempotencyHours * 3_600_000);
    const res = await this.dataSource
      .createQueryBuilder()
      .delete()
      .from(IntegrationIdempotency)
      .where('created_at < :cut', { cut })
      .execute();
    return res.affected ?? 0;
  }
}

/**
 * Aplica a idempotência às rotas de escrita (RN-131). `POST` exige `Idempotency-Key` (`422` sem ela);
 * `PUT` já é idempotente por natureza e a aceita. A chave vale por integração e por rota (método e
 * caminho, com o código da ideia).
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly idempotency: IdempotencyService) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const http = context.switchToHttp();
    const req = http.getRequest<RequestWithIntegration>();
    const res = http.getResponse<Response>();
    const integration = req.integration;
    if (!integration) return next.handle();

    const header = req.get('idempotency-key');
    if (header === undefined) {
      if (req.method === 'POST') {
        throw apiError(
          422,
          'idempotency_key_required',
          'Envie o cabeçalho Idempotency-Key (1 a 64 caracteres: letras, números, - e _).',
        );
      }
      return next.handle();
    }
    if (!isValidIdempotencyKey(header)) {
      throw apiError(
        422,
        'invalid_idempotency_key',
        'Idempotency-Key deve ter de 1 a 64 caracteres: letras, números, - e _.',
      );
    }

    const route = `${req.method} ${req.path}`.slice(0, 200);
    const reservation = await this.idempotency.reserve(integration.id, route, header, requestHash(req.body));
    if (reservation.kind === 'reused') {
      throw apiError(422, 'idempotency_key_reused', 'Esta Idempotency-Key já foi usada com um corpo diferente.');
    }
    if (reservation.kind === 'busy') {
      throw apiError(409, 'request_in_progress', 'Uma chamada com esta Idempotency-Key ainda está em andamento.');
    }
    if (reservation.kind === 'replay') {
      res.setHeader('Idempotent-Replay', 'true');
      if (reservation.status >= 400) throw new HttpException(reservation.response as object, reservation.status);
      return of(reservation.response);
    }

    // As rotas de escrita usam o status padrão: 201 no POST, 200 no PUT.
    const successStatus = req.method === 'POST' ? 201 : 200;
    return next.handle().pipe(
      mergeMap((body) =>
        from(this.idempotency.finish(integration.id, route, header, successStatus, body)).pipe(
          mergeMap(() => of(body)),
        ),
      ),
      catchError((error: unknown) => {
        const settle =
          error instanceof HttpException && error.getStatus() < 500
            ? this.idempotency.finish(integration.id, route, header, error.getStatus(), error.getResponse())
            : this.idempotency.release(integration.id, route, header);
        return from(settle.catch(() => undefined)).pipe(mergeMap(() => throwError(() => error)));
      }),
    );
  }
}
