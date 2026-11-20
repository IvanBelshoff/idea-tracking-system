import { describe, expect, it } from 'vitest';
import { localTimeInZone } from '../../src/common/dates.js';
import {
  composeTemplateMap,
  DEFAULT_TEMPLATES,
  renderTemplate,
  resolveTemplate,
  unknownVariables,
} from '../../src/communication/email-templates.js';
import { MailSendError, safeErrorMessage } from '../../src/communication/mail-transport.js';
import {
  channelsFor,
  deadlineAlertKind,
  MANDATORY_TYPES,
  NOTIFICATION_TYPES,
  notificationsForEvent,
  prefKey,
} from '../../src/communication/notification-rules.js';
import { describeNotification } from '../../src/communication/notification-text.js';
import { open, seal } from '../../src/communication/secret-box.js';

const idea = { id: 'i1', code: 'ITS-2026-0001', title: 'Faixa', authorId: 'autor', assignedToId: 'analista' };

describe('Notificações e e-mail: regras puras (M4)', () => {
  it('CA-RN-29.1 alerta padrão de 3 dias: vence em 3 dias alerta, em 4 não; no dia, "vence hoje"', () => {
    expect(deadlineAlertKind('2026-11-05', '2026-11-08', 3)).toBe('soon');
    expect(deadlineAlertKind('2026-11-05', '2026-11-09', 3)).toBeNull();
    expect(deadlineAlertKind('2026-11-05', '2026-11-05', 3)).toBe('due');
    expect(deadlineAlertKind('2026-11-05', '2026-11-04', 3)).toBeNull(); // já vencida
    expect(deadlineAlertKind('2026-12-30', '2027-01-02', 3)).toBe('soon'); // virada de ano
  });

  it('CA-RN-29.4 a pessoa que pede menos dias só é avisada mais perto do vencimento', () => {
    expect(deadlineAlertKind('2026-11-05', '2026-11-08', 1)).toBeNull();
    expect(deadlineAlertKind('2026-11-05', '2026-11-06', 1)).toBe('soon');
    expect(deadlineAlertKind('2026-11-05', '2026-11-06', 0)).toBeNull();
  });

  it('CA-RN-27.1 cada evento da ideia gera exatamente 1 aviso ao autor', () => {
    const cases: [Parameters<typeof notificationsForEvent>[0], string][] = [
      [{ type: 'created' }, 'idea_received'],
      [{ type: 'status_changed', data: { from: 'submitted', to: 'in_review' } }, 'review_started'],
      [{ type: 'status_changed', data: { from: 'in_review', to: 'in_progress' } }, 'idea_approved'],
      [
        { type: 'status_changed', data: { from: 'in_review', to: 'rejected' }, reason: 'Fora do escopo' },
        'idea_rejected',
      ],
      [
        { type: 'status_changed', data: { from: 'in_progress', to: 'rejected' }, reason: 'Sem verba' },
        'idea_interrupted',
      ],
      [{ type: 'step_completed', data: { position: 1, name: 'Planejar' } }, 'step_completed'],
      [{ type: 'status_changed', data: { from: 'in_progress', to: 'implemented' } }, 'idea_implemented'],
      [{ type: 'reopened', data: { from: 'implemented', to: 'in_progress' }, reason: 'Voltou' }, 'idea_reopened'],
    ];
    for (const [event, type] of cases) {
      const drafts = notificationsForEvent(event, idea);
      expect(drafts, event.type).toHaveLength(1);
      expect(drafts[0]).toMatchObject({ userId: 'autor', type, ideaId: 'i1' });
    }
    // A recusa leva a justificativa (CA-RN-05.2).
    expect(
      notificationsForEvent({ type: 'status_changed', data: { to: 'rejected' }, reason: 'Fora do escopo' }, idea)[0]
        ?.payload.reason,
    ).toBe('Fora do escopo');
  });

  it('CA-RN-27.2 e CA-RN-20.1 só o autor recebe; ao concluir todas as etapas, só o analista', () => {
    expect(notificationsForEvent({ type: 'comment_added' }, idea)).toEqual([]);
    expect(notificationsForEvent({ type: 'updated' }, idea)).toEqual([]);
    expect(notificationsForEvent({ type: 'created' }, { ...idea, authorId: null })).toEqual([]);
    const done = notificationsForEvent({ type: 'all_steps_completed' }, idea);
    expect(done).toEqual([expect.objectContaining({ userId: 'analista', type: 'all_steps_completed' })]);
    expect(notificationsForEvent({ type: 'all_steps_completed' }, { ...idea, assignedToId: null })).toEqual([]);
  });

  it('RN-30 canais: interno sempre que não desligado; e-mail só com envio ligado; decisões não se desligam', () => {
    const off = new Map([
      [prefKey('review_started', 'in_app'), false],
      [prefKey('review_started', 'email'), false],
      [prefKey('idea_approved', 'in_app'), false],
      [prefKey('idea_approved', 'email'), false],
    ]);
    expect(channelsFor('idea_received', new Map(), false)).toEqual({ inApp: true, email: false });
    expect(channelsFor('idea_received', new Map(), true)).toEqual({ inApp: true, email: true });
    expect(channelsFor('review_started', off, true)).toEqual({ inApp: false, email: false });
    expect(channelsFor('idea_approved', off, true)).toEqual({ inApp: true, email: true });
    expect([...MANDATORY_TYPES].every((t) => (NOTIFICATION_TYPES as readonly string[]).includes(t))).toBe(true);
  });

  it('CA-RN-32.1 variável inexistente é detectada; o idioma sem modelo cai no pt-BR', () => {
    expect(unknownVariables('digest', 'Olá {{name}}', '{{items}} {{ senha }} {{}}')).toEqual(['senha', '(vazia)']);
    expect(unknownVariables('password_reset', '{{link}} {{minutes}}')).toEqual([]);

    const stored = composeTemplateMap([{ key: 'digest', locale: 'pt-BR', subject: 'Editado', body: 'Corpo' }]);
    expect(resolveTemplate('digest', 'pt-BR', stored).subject).toBe('Editado');
    expect(resolveTemplate('digest', 'en', stored)).toEqual(DEFAULT_TEMPLATES.digest.en);
    expect(resolveTemplate('digest', 'es', stored).subject).toBe('Editado');
    expect(resolveTemplate('digest', 'es', new Map())).toEqual(DEFAULT_TEMPLATES.digest['pt-BR']);
  });

  it('o assunto sai numa linha só (sem injeção de cabeçalho) e os valores não são reinterpretados', () => {
    const out = renderTemplate(
      { subject: '{{name}}', body: '{{name}} / {{count}}' },
      {
        name: 'Ana\r\nBcc: x@example.test',
        count: '{{name}}',
      },
    );
    expect(out.subject).toBe('Ana Bcc: x@example.test');
    expect(out.body).toBe('Ana\r\nBcc: x@example.test / {{name}}');
  });

  it('CA-RN-90.3 o segredo cifrado difere do original, volta igual e cada cifra é única', () => {
    const a = seal('senha-super-secreta');
    const b = seal('senha-super-secreta');
    expect(a.toString('utf8')).not.toContain('senha-super-secreta');
    expect(a.equals(b)).toBe(false);
    expect(open(a)).toBe('senha-super-secreta');
    const tampered = Buffer.from(a);
    tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 1;
    expect(() => open(tampered)).toThrow();
  });

  it('CA-RN-90.2 mensagem de erro nunca expõe a senha', () => {
    expect(safeErrorMessage(new Error('Invalid login for s3nh4!\n535 denied'), ['s3nh4!'])).toBe(
      'transport: Invalid login for *** 535 denied',
    );
  });

  it('M28 falha de envio vira código (a tela traduz), com o detalhe técnico depois de ": "', () => {
    expect(safeErrorMessage(new MailSendError('google_key_unusable', true), [])).toBe('google_key_unusable');
    expect(safeErrorMessage(new MailSendError('graph_send_failed', false, 'HTTP 503'), [])).toBe(
      'graph_send_failed: HTTP 503',
    );
    expect(safeErrorMessage(new Error(''), [])).toBe('unknown');
  });

  it('horário local e texto do aviso no idioma da pessoa', () => {
    expect(localTimeInZone(new Date('2030-01-10T10:01:00Z'), 'America/Sao_Paulo')).toBe('07:01');
    expect(localTimeInZone(new Date('2030-01-10T23:59:00Z'), 'UTC')).toBe('23:59');
    const payload = { code: 'ITS-2026-0001', title: 'Faixa', position: 2, name: 'Pintar', dueDate: '2026-11-08' };
    expect(describeNotification('deadline_soon', payload, 'pt-BR')).toBe(
      'ITS-2026-0001 · Faixa: a etapa 2 (Pintar) vence em 8 de nov. de 2026',
    );
    expect(describeNotification('deadline_due', payload, 'en')).toBe(
      'ITS-2026-0001 · Faixa: step 2 (Pintar) is due today',
    );
  });
});
