import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { type DataSource, type EntityManager, IsNull, MoreThan } from 'typeorm';
import { AuditService } from '../audit/audit.service.js';
import { apiError } from '../common/api-error.js';
import { hasPassed, isUpcoming, minutesAgo, minutesFromNow } from '../common/dates.js';
import { EmailLog } from '../communication/entities.js';
import { composeEmail, isEmailActive, queueEmail } from '../communication/mail.js';
import { SettingsService } from '../organization/settings.service.js';
import type { RequestMeta } from './auth-context.js';
import { PasswordReset } from './entities/password-reset.entity.js';
import { User, UserStatus } from './entities/user.entity.js';
import {
  checkPasswordPolicy,
  dummyPasswordHash,
  hashPassword,
  newToken,
  tokenHash,
  verifyPassword,
} from './password.js';
import { userHasPermission } from './permission-holders.js';
import { SessionService } from './session.service.js';
import { canUsePassword } from './sso/sso-rules.js';

/** Mesma resposta para e-mail inexistente, senha errada, conta bloqueada ou inativa (CA-RN-42.2). */
const invalidCredentials = () => apiError(401, 'invalid_credentials', 'E-mail ou senha inválidos.');

@Injectable()
export class AuthService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly settings: SettingsService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  /** Recusa com 422 `weak_password` (e as regras não atendidas) se a senha não segue a política. */
  async assertPasswordPolicy(password: string, manager?: EntityManager): Promise<void> {
    const policy = {
      minLength: await this.settings.get('auth.password_min_length', manager),
      minClasses: await this.settings.get('auth.password_min_classes', manager),
    };
    const violations = checkPasswordPolicy(password, policy);
    if (violations.length > 0) {
      throw apiError(422, 'weak_password', 'A senha não atende à política mínima.', { violations, policy });
    }
  }

  async login(
    email: string,
    password: string,
    meta: RequestMeta,
  ): Promise<{ token: string; user: User; hours: number }> {
    const users = this.dataSource.getRepository(User);
    const user = await users
      .createQueryBuilder('u')
      .addSelect('u.passwordHash')
      .where('u.email = :email', { email })
      .getOne();

    const fail = async (reason: string, userId: string | null = null) => {
      await this.audit.record({
        action: 'auth.login_failed',
        targetType: 'user',
        targetId: userId,
        data: { email, reason },
        ip: meta.ip,
      });
      return invalidCredentials();
    };

    if (!user || user.status !== UserStatus.Active || !user.passwordHash) {
      await verifyPassword(await dummyPasswordHash(), password); // mesmo custo de tempo
      throw await fail(user ? 'inactive' : 'unknown', user?.id ?? null);
    }
    if (user.lockedUntil && isUpcoming(user.lockedUntil)) {
      await verifyPassword(await dummyPasswordHash(), password);
      throw await fail('locked', user.id);
    }

    if (!(await verifyPassword(user.passwordHash, password))) {
      const max = await this.settings.get('auth.max_failed_attempts');
      const minutes = await this.settings.get('auth.lockout_minutes');
      // Incremento atômico: tentativas simultâneas não "perdem" contagem.
      const result = await users
        .createQueryBuilder()
        .update()
        .set({ failedAttempts: () => 'failed_attempts + 1' })
        .where('id = :id', { id: user.id })
        .returning('failed_attempts')
        .execute();
      const attempts = Number((result.raw as { failed_attempts: number }[])[0]?.failed_attempts ?? 0);
      if (attempts >= max) {
        await users.update(user.id, { failedAttempts: 0, lockedUntil: minutesFromNow(minutes) });
        await this.audit.record({
          action: 'auth.locked',
          targetType: 'user',
          targetId: user.id,
          data: { minutes },
          ip: meta.ip,
        });
      }
      throw await fail('wrong_password', user.id);
    }

    // A senha está certa, mas no modo "Só SSO" esta pessoa entra por Microsoft/Google (RN-97).
    if (!(await this.canUserUsePassword(user))) {
      await this.audit.record({
        action: 'auth.login_failed',
        targetType: 'user',
        targetId: user.id,
        data: { email, reason: 'sso_required' },
        ip: meta.ip,
      });
      throw apiError(403, 'sso_required', 'Esta organização entra com a conta corporativa (Microsoft ou Google).');
    }
    return this.finishLogin(user, meta, 'auth.login');
  }

  /**
   * Esta pessoa pode entrar (e definir senha) por senha agora? Regra única de RN-97: fora do modo
   * "Só SSO", sim; nele, só o acesso de emergência (`setting.manage`) e quem tem e-mail de fora.
   */
  async canUserUsePassword(
    user: Pick<User, 'id' | 'email'>,
    m: EntityManager = this.dataSource.manager,
  ): Promise<boolean> {
    const mode = await this.settings.get('auth.login_mode', m);
    if (mode !== 'sso') return true;
    return canUsePassword({
      mode,
      email: user.email,
      domains: await this.settings.get('auth.email_domains', m),
      isEmergency: await userHasPermission(m, user.id, 'setting.manage'),
    });
  }

  /**
   * Termina o login: zera as falhas, grava a entrada na auditoria e abre a sessão. É o mesmo bloco
   * para a senha e para o login corporativo (que passa `auth.sso_login` e o provedor).
   */
  async finishLogin(
    user: User,
    meta: RequestMeta,
    action: 'auth.login' | 'auth.sso_login',
    data?: Record<string, unknown>,
  ): Promise<{ token: string; user: User; hours: number }> {
    // Quem entra pelo login corporativo tem sessão mais curta: volta ao provedor, que então vê a conta desativada.
    const hours = await this.settings.get(
      action === 'auth.sso_login' ? 'auth.sso_session_hours' : 'auth.session_hours',
    );
    const token = await this.dataSource.transaction(async (m) => {
      const patch = action === 'auth.login' ? { failedAttempts: 0, lockedUntil: null } : {};
      await m.getRepository(User).update(user.id, { ...patch, lastLoginAt: new Date() });
      await this.audit.record(
        { action, actorId: user.id, targetType: 'user', targetId: user.id, data, ip: meta.ip },
        m,
      );
      return this.sessions.create(user.id, hours, meta, m);
    });
    return { token, user, hours };
  }

  /** Preferências de interface (não é dado de segurança: não vai para a auditoria). */
  async updatePreferences(
    userId: string,
    prefs: Partial<{
      locale: string;
      theme: User['theme'];
      navCollapsed: boolean;
      hideName: boolean;
      uiColor: string | null;
      uiFont: string | null;
    }>,
  ): Promise<User> {
    const users = this.dataSource.getRepository(User);
    await users.update(userId, prefs);
    return users.findOneByOrFail({ id: userId });
  }

  async logout(userId: string, sessionId: string, meta: RequestMeta): Promise<void> {
    await this.dataSource.transaction(async (m) => {
      await this.sessions.revoke(sessionId, m);
      await this.audit.record(
        { action: 'auth.logout', actorId: userId, targetType: 'user', targetId: userId, ip: meta.ip },
        m,
      );
    });
  }

  /** Troca da própria senha: confere a atual, aplica a política e encerra as outras sessões. */
  async changePassword(userId: string, sessionId: string, current: string, next: string, meta: RequestMeta) {
    const user = await this.dataSource
      .getRepository(User)
      .createQueryBuilder('u')
      .addSelect('u.passwordHash')
      .where('u.id = :userId', { userId })
      .getOneOrFail();
    if (!user.passwordHash || !(await verifyPassword(user.passwordHash, current))) {
      throw apiError(400, 'current_password_invalid', 'A senha atual não confere.');
    }
    await this.assertPasswordPolicy(next);
    const passwordHash = await hashPassword(next);
    await this.dataSource.transaction(async (m) => {
      await m.getRepository(User).update(userId, { passwordHash });
      await this.sessions.revokeAll(userId, m, sessionId);
      await this.audit.record(
        { action: 'auth.password_changed', actorId: userId, targetType: 'user', targetId: userId, ip: meta.ip },
        m,
      );
    });
  }

  /**
   * Gera um link de recuperação de uso único e com prazo (CA-RN-42.3). No M1 o administrador o
   * entrega à pessoa; com e-mail configurado (M4) ele vai por e-mail. Nunca se envia a senha.
   * Links anteriores ainda não usados deixam de valer.
   */
  async createPasswordReset(
    userId: string,
    actorId: string | null,
    meta: RequestMeta,
  ): Promise<{ token: string; expiresAt: Date }> {
    const minutes = await this.settings.get('auth.reset_link_minutes');
    const token = newToken();
    const expiresAt = minutesFromNow(minutes);
    await this.dataSource.transaction(async (m) => {
      const resets = m.getRepository(PasswordReset);
      await resets.update({ userId, usedAt: IsNull() }, { usedAt: new Date() });
      await resets.save(resets.create({ userId, tokenHash: tokenHash(token), expiresAt, usedAt: null }));
      await this.audit.record(
        {
          action: 'auth.password_reset_created',
          actorId,
          targetType: 'user',
          targetId: userId,
          data: { minutes },
          ip: meta.ip,
        },
        m,
      );
    });
    return { token, expiresAt };
  }

  /** Usa o link: define a nova senha, desbloqueia a conta e encerra todas as sessões. */
  /**
   * "Esqueci minha senha" (RN-42, por e-mail a partir do M4). A resposta é sempre a mesma, exista ou
   * não a conta, para não revelar quem está cadastrado. Só age com o envio de e-mail ligado; no
   * máximo um e-mail de recuperação a cada 2 minutos por pessoa (o link gerado pelo admin não conta).
   * O link vai cifrado na fila de saída.
   */
  async requestPasswordResetByEmail(email: string, meta: RequestMeta): Promise<void> {
    const m = this.dataSource.manager;
    if (!(await isEmailActive(m))) return;
    const appUrl = await this.settings.get('email.app_url');
    if (!appUrl) return;
    const user = await m.getRepository(User).findOneBy({ email });
    if (!user || user.status !== UserStatus.Active) return;
    if (!(await this.canUserUsePassword(user, m))) return;
    const recent = await m.getRepository(EmailLog).existsBy({
      userId: user.id,
      kind: 'password_reset',
      createdAt: MoreThan(minutesAgo(2)),
    });
    if (recent) return;
    const { token } = await this.createPasswordReset(user.id, null, meta);
    const minutes = await this.settings.get('auth.reset_link_minutes');
    const mail = await composeEmail(m, 'password_reset', user.locale, {
      name: user.name,
      link: `${appUrl}/definir-senha#${token}`,
      minutes,
    });
    await queueEmail(m, { kind: 'password_reset', userId: user.id, to: user.email, ...mail });
  }

  async redeemPasswordReset(token: string, next: string, meta: RequestMeta): Promise<void> {
    await this.assertPasswordPolicy(next);
    const passwordHash = await hashPassword(next);
    await this.dataSource.transaction(async (m) => {
      const reset = await m
        .getRepository(PasswordReset)
        .createQueryBuilder('r')
        .setLock('pessimistic_write')
        .where('r.token_hash = :hash', { hash: tokenHash(token) })
        .getOne();
      if (!reset || reset.usedAt || hasPassed(reset.expiresAt)) {
        throw apiError(400, 'reset_link_invalid', 'Link de recuperação inválido ou expirado.');
      }
      const user = await m.getRepository(User).findOneByOrFail({ id: reset.userId });
      if (user.status !== UserStatus.Active) {
        throw apiError(400, 'reset_link_invalid', 'Link de recuperação inválido ou expirado.');
      }
      if (!(await this.canUserUsePassword(user, m))) {
        throw apiError(403, 'sso_required', 'Esta organização entra com a conta corporativa (Microsoft ou Google).');
      }
      await m.getRepository(PasswordReset).update(reset.id, { usedAt: new Date() });
      await m.getRepository(User).update(user.id, { passwordHash, failedAttempts: 0, lockedUntil: null });
      await this.sessions.revokeAll(user.id, m);
      await this.audit.record(
        { action: 'auth.password_reset_used', actorId: user.id, targetType: 'user', targetId: user.id, ip: meta.ip },
        m,
      );
    });
  }
}
