import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { type DataSource, type EntityManager, IsNull } from 'typeorm';
import { hasPassed, hoursFromNow } from '../common/dates.js';
import type { AuthContext, RequestMeta } from './auth-context.js';
import { Session } from './entities/session.entity.js';
import { UserStatus } from './entities/user.entity.js';
import { newToken, tokenHash } from './password.js';

/** Sessões no servidor: o token vai no cookie, o banco guarda só o hash (RN-41, RN-42). */
@Injectable()
export class SessionService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /** Cria a sessão e devolve o token (que só existe no cookie). */
  async create(userId: string, hours: number, meta: RequestMeta, manager: EntityManager): Promise<string> {
    const token = newToken();
    const repo = manager.getRepository(Session);
    await repo.save(
      repo.create({
        userId,
        tokenHash: tokenHash(token),
        expiresAt: hoursFromNow(hours),
        revokedAt: null,
        ip: meta.ip,
        userAgent: meta.userAgent,
      }),
    );
    return token;
  }

  /** Sessão válida = não revogada, não expirada e de usuário ativo (desativado perde o acesso na hora). */
  async resolve(token: string): Promise<AuthContext | null> {
    const session = await this.dataSource.getRepository(Session).findOne({
      where: { tokenHash: tokenHash(token), revokedAt: IsNull() },
      relations: { user: true },
    });
    if (!session || hasPassed(session.expiresAt)) return null;
    if (session.user.status !== UserStatus.Active) return null;
    return { user: session.user, sessionId: session.id };
  }

  async revoke(sessionId: string, manager: EntityManager = this.dataSource.manager): Promise<void> {
    await manager.getRepository(Session).update({ id: sessionId, revokedAt: IsNull() }, { revokedAt: new Date() });
  }

  /** Revoga todas as sessões do usuário (troca de senha, recuperação, desativação; CA-RN-41.1). */
  async revokeAll(userId: string, manager: EntityManager = this.dataSource.manager, exceptSessionId?: string) {
    const qb = manager
      .getRepository(Session)
      .createQueryBuilder()
      .update()
      .set({ revokedAt: () => 'now()' })
      .where('user_id = :userId AND revoked_at IS NULL', { userId });
    if (exceptSessionId) qb.andWhere('id <> :exceptSessionId', { exceptSessionId });
    await qb.execute();
  }
}
