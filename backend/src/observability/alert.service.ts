import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { type DataSource, In } from 'typeorm';
import { PtBrLogger } from '../common/pt-br-logger.js';
import { Notification, NotificationEmailState } from '../communication/entities.js';
import { isEmailActive, queueEmail } from '../communication/mail.js';
import { User, UserStatus } from '../identity-access/entities/user.entity.js';
import { usersWithPermission } from '../identity-access/permission-holders.js';
import { getSetting } from '../organization/settings.service.js';
import { type AlertItemState, type AlertStates, transitions } from './alert-rules.js';
import { alertEmail, healthTitles } from './alert-text.js';
import { OpsAlertState } from './entities.js';
import { HealthService } from './health.service.js';

const logger = new PtBrLogger('Alerta');

/** Chave da trava que serializa as conferências: dois workers não avisam duas vezes (CA-RN-94.7). */
const LOCK_KEY = 'its.ops_alert';

const toState = (row: OpsAlertState): AlertItemState => ({
  failed: row.state === 'failed',
  cleanChecks: row.cleanChecks,
  lastFailureNoticeAt: row.lastFailureNoticeAt,
  silenced: row.silenced,
});

export interface AlertResult {
  failed: string[];
  recovered: string[];
  recipients: number;
}

/**
 * O alerta de saúde (RN-94). Roda no worker, a cada 5 minutos: confere a saúde, compara com o que
 * lembrava (em `ops_alert_state`) e, quando um item entra em falha ou volta, avisa quem tem
 * `ops.view` por aviso interno (obrigatório) e, com o e-mail ligado, por e-mail na hora. Nada sai
 * da instalação além do provedor de e-mail que o próprio administrador configurou.
 */
@Injectable()
export class AlertService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly health: HealthService,
  ) {}

  /** Uma conferência. Nunca lança: banco fora, por exemplo, não permite avisar e só vai para o log. */
  async check(now = new Date()): Promise<AlertResult | null> {
    try {
      const { items } = await this.health.evaluate(now);
      return await this.dataSource.transaction(async (m) => {
        await m.query('SELECT pg_advisory_xact_lock(hashtext($1))', [LOCK_KEY]);
        const rows = await m.getRepository(OpsAlertState).find();
        const before: AlertStates = new Map(rows.map((row) => [row.itemKey, toState(row)]));
        const result = transitions(before, items, now);

        for (const [itemKey, state] of result.states) {
          await m.getRepository(OpsAlertState).upsert(
            {
              itemKey,
              state: state.failed ? 'failed' : 'ok',
              cleanChecks: state.cleanChecks,
              lastFailureNoticeAt: state.lastFailureNoticeAt,
              silenced: state.silenced,
              ...(state.failed !== before.get(itemKey)?.failed ? { since: now } : {}),
            },
            ['itemKey'],
          );
        }

        const failed = result.failedItems.map((item) => item.key);
        const recovered = result.recoveredItems.map((item) => item.key);
        if (failed.length === 0 && recovered.length === 0) return { failed, recovered, recipients: 0 };

        const userIds = await usersWithPermission(m, 'ops.view');
        if (userIds.length === 0) {
          logger.error(
            `Alerta de saúde sem destinatário (falha: ${failed.join(', ')}; voltou: ${recovered.join(', ')})`,
          );
          return { failed, recovered, recipients: 0 };
        }
        const users = await m.getRepository(User).findBy({ id: In(userIds), status: UserStatus.Active });

        const notifications = m.getRepository(Notification);
        const rowsToSave: Notification[] = [];
        for (const user of users) {
          for (const [type, keys] of [
            ['ops_failed', failed],
            ['ops_recovered', recovered],
          ] as const) {
            if (keys.length === 0) continue;
            rowsToSave.push(
              notifications.create({
                userId: user.id,
                type,
                ideaId: null,
                payload: { items: keys },
                inApp: true,
                // O e-mail do alerta sai na hora, abaixo; não vai de novo no resumo diário.
                emailState: NotificationEmailState.None,
                readAt: null,
              }),
            );
          }
        }
        await notifications.save(rowsToSave);

        if (await isEmailActive(m)) {
          const organization = await getSetting(m, 'organization.name');
          const appUrl = await getSetting(m, 'email.app_url');
          for (const user of users) {
            const mail = alertEmail(user.locale, {
              name: user.name,
              organization,
              failed,
              recovered,
              link: appUrl ? `${appUrl}/admin/observabilidade` : '',
            });
            await queueEmail(m, { kind: 'ops_alert', userId: user.id, to: user.email, ...mail });
          }
        }

        logger.log(
          `Alerta de saúde enviado: falha em [${healthTitles(failed, 'pt-BR')}], voltou [${healthTitles(recovered, 'pt-BR')}], ${users.length} destinatário(s)`,
        );
        return { failed, recovered, recipients: users.length };
      });
    } catch (error) {
      logger.error(
        `Não foi possível conferir a saúde para o alerta: ${error instanceof Error ? error.message : error}`,
      );
      return null;
    }
  }
}
