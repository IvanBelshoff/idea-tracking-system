import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { type PageQuery, pageMeta } from '../common/pagination.js';
import type { AuditEntryView, AuditPage } from './audit.dto.js';
import { AuditLog } from './audit-log.entity.js';

export interface AuditFilter extends PageQuery {
  action?: string;
  actorId?: string;
  targetType?: string;
  targetId?: string;
  from?: Date;
  to?: Date;
}

/** Leitura do log de auditoria (RN-39), só para quem tem `audit.view`. Mais recente primeiro. */
@Injectable()
export class AuditQueryService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async list(f: AuditFilter): Promise<AuditPage> {
    const qb = this.dataSource
      .getRepository(AuditLog)
      .createQueryBuilder('a')
      .leftJoin('a.actor', 'u')
      .addSelect(['u.id', 'u.name']);
    if (f.action) {
      // "auth." filtra a família inteira; "auth.login" filtra exato.
      if (f.action.endsWith('.')) qb.andWhere('a.action LIKE :prefix', { prefix: `${f.action}%` });
      else qb.andWhere('a.action = :action', { action: f.action });
    }
    if (f.actorId) qb.andWhere('a.actor_id = :actorId', { actorId: f.actorId });
    if (f.targetType) qb.andWhere('a.target_type = :targetType', { targetType: f.targetType });
    if (f.targetId) qb.andWhere('a.target_id = :targetId', { targetId: f.targetId });
    if (f.from) qb.andWhere('a.at >= :from', { from: f.from });
    if (f.to) qb.andWhere('a.at < :to', { to: f.to });

    const [rows, total] = await qb
      .orderBy('a.id', 'DESC')
      .skip((f.page - 1) * f.pageSize)
      .take(f.pageSize)
      .getManyAndCount();
    return { items: rows.map(toView), meta: pageMeta(f, total) };
  }

  /** Ações já registradas, para o filtro da tela. */
  async actions(): Promise<string[]> {
    const rows: { action: string }[] = await this.dataSource.query(
      'SELECT DISTINCT action FROM audit_log ORDER BY action',
    );
    return rows.map((r) => r.action);
  }
}

function toView(a: AuditLog): AuditEntryView {
  return {
    id: a.id,
    at: a.at.toISOString(),
    action: a.action,
    actor: a.actor ? { id: a.actor.id, name: a.actor.name } : null,
    targetType: a.targetType,
    targetId: a.targetId,
    data: a.data,
    ip: a.ip,
  };
}
