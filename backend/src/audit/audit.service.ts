import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource, EntityManager } from 'typeorm';
import { AuditLog } from './audit-log.entity.js';

export interface AuditEntry {
  action: string;
  actorId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  data?: Record<string, unknown>;
  ip?: string | null;
}

/** Chaves que nunca podem ir para o log (CA-RN-39.2). */
const FORBIDDEN_KEYS = /pass(word)?|senha|token|secret|segredo|hash|cookie/i;

/** Remove recursivamente qualquer campo com nome de segredo, por garantia. */
export function scrub(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([k]) => !FORBIDDEN_KEYS.test(k))
        .map(([k, v]) => [k, scrub(v)]),
    );
  }
  return value;
}

/** Grava no log de auditoria com o `manager` dado (para quem não tem o serviço injetado, como os ganchos do histórico). */
export async function recordAudit(manager: EntityManager, entry: AuditEntry): Promise<void> {
  const row = manager.getRepository(AuditLog).create({
    action: entry.action,
    actorId: entry.actorId ?? null,
    targetType: entry.targetType ?? null,
    targetId: entry.targetId ?? null,
    data: scrub(entry.data ?? {}) as Record<string, unknown>,
    ip: entry.ip ?? null,
  });
  await manager.getRepository(AuditLog).save(row);
}

/** Registro no log de auditoria (RN-39). Use o `manager` da transação para gravar junto com a ação. */
@Injectable()
export class AuditService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async record(entry: AuditEntry, manager: EntityManager = this.dataSource.manager): Promise<void> {
    await recordAudit(manager, entry);
  }
}
