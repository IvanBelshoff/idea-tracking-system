import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { eligibility, showsName } from '../../src/hall/hall-rules.js';
import { canBeConverged, canSupport, principalOf, requesterCount } from '../../src/ideas/convergence-rules.js';
import { IdeaStatus } from '../../src/ideas/entities/idea.entity.js';
import { type IdeaAction, implementBlocker, isClosed, nextStatus } from '../../src/ideas/lifecycle.js';
import {
  canAddStep,
  ideaDeadline,
  isLate,
  progress,
  type StepLike,
  validStepDates,
} from '../../src/ideas/steps-rules.js';
import { isTriageOverdue, priorityScore, triageDueDate } from '../../src/ideas/triage-rules.js';
import { computeAccess } from '../../src/identity-access/access.js';
import { FACTORY_ROLES } from '../../src/identity-access/factory-roles.js';
import { PERMISSIONS } from '../../src/identity-access/permissions.js';
import { SETTING_DEFAULTS } from '../../src/organization/settings.js';

/**
 * Regras que os simuladores da ajuda (its/ajuda) usam, tiradas das regras REAIS do backend. A ajuda
 * não importa código do backend (que depende do TypeORM): lê este JSON. Se uma regra mudar, este
 * teste falha até o JSON ser regerado, e a ajuda nunca ensina algo que o sistema não faz.
 *
 * Regerar: UPDATE_DOCS_RULES=1 pnpm exec vitest run test/docs
 */
const FILE = join(process.cwd(), '..', 'ajuda', 'src', 'simuladores', 'regras.json');

const STATUSES = Object.values(IdeaStatus);
/** Árvore de exemplo do simulador "quem enxerga" (mpath no formato do TypeORM). */
const TREE = [
  { id: 'org', mpath: 'org.' },
  { id: 'unidade-a', mpath: 'org.unidade-a.' },
  { id: 'expedicao', mpath: 'org.unidade-a.expedicao.' },
  { id: 'producao', mpath: 'org.unidade-a.producao.' },
  { id: 'unidade-b', mpath: 'org.unidade-b.' },
  { id: 'camaras-frias', mpath: 'org.unidade-b.camaras-frias.' },
];
const ACTIONS: IdeaAction[] = ['start_review', 'approve', 'reject', 'interrupt', 'implement', 'reopen'];

function build() {
  const transitions: Record<string, Record<string, string>> = {};
  for (const action of ACTIONS) {
    transitions[action] = {};
    for (const from of STATUSES) {
      const to = nextStatus(from, action);
      if (to) transitions[action][from] = to;
    }
  }
  const step = (dueDate: string, done: boolean): StepLike => ({
    position: 1,
    startDate: '2026-11-02',
    dueDate,
    completedAt: done ? new Date('2026-11-05T12:00:00Z') : null,
  });
  // Uma segunda-feira, para os exemplos de prazo em dias úteis.
  const submitted = '2026-11-09';
  const sla = SETTING_DEFAULTS['triage.sla_days'];
  const older = { id: 'b', submittedAt: new Date('2026-10-01T10:00:00Z') };
  const newer = { id: 'a', submittedAt: new Date('2026-10-20T10:00:00Z') };
  return {
    lifecycle: {
      statuses: STATUSES,
      actions: ACTIONS,
      transitions,
      closed: STATUSES.filter(isClosed),
      implementBlockers: {
        semEtapas: implementBlocker([], 'ok'),
        etapaAberta: implementBlocker([{ completedAt: null }], 'ok'),
        semResultado: implementBlocker([{ completedAt: new Date() }], ''),
        pronto: implementBlocker([{ completedAt: new Date() }], 'Retrabalho caiu 60%.'),
      },
    },
    triage: {
      slaDays: sla,
      businessDaysDefault: SETTING_DEFAULTS['triage.business_days'],
      examples: {
        submitted,
        calendarDue: triageDueDate(submitted, sla, false),
        businessDue: triageDueDate(submitted, sla, true),
      },
      // Vetores para o simulador da triagem conferir o próprio cálculo (de segunda a domingo, 1 e 10 dias).
      dueVectors: ['2026-11-09', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15'].flatMap((day) =>
        [1, 10].flatMap((days) =>
          [false, true].map((business) => ({
            submitted: day,
            days,
            business,
            due: triageDueDate(day, days, business),
          })),
        ),
      ),
      priority: [1, 2, 3, 4, 5].flatMap((impact) =>
        [1, 2, 3, 4, 5].map((effort) => ({ impact, effort, score: priorityScore(impact, effort) })),
      ),
      overdue: {
        noDiaDoPrazo: isTriageOverdue(IdeaStatus.Submitted, '2026-11-19', '2026-11-19'),
        diaSeguinte: isTriageOverdue(IdeaStatus.Submitted, '2026-11-19', '2026-11-20'),
        emAnaliseNaoAtrasa: isTriageOverdue(IdeaStatus.InReview, '2026-11-19', '2026-11-30'),
      },
    },
    steps: {
      canAddStep: {
        semEtapas: canAddStep([]),
        comEtapaAberta: canAddStep([step('2026-11-20', false)]),
        todasConcluidas: canAddStep([step('2026-11-20', true)]),
      },
      validDates: {
        previstaDepois: validStepDates('2026-11-10', '2026-11-20'),
        mesmoDia: validStepDates('2026-11-10', '2026-11-10'),
        previstaAntes: validStepDates('2026-11-10', '2026-11-09'),
      },
      deadlineIsLastDue: ideaDeadline([step('2026-11-20', true), { ...step('2026-12-05', false), position: 2 }]),
      progressSteps: [
        [0, 1],
        [1, 2],
        [1, 3],
        [2, 3],
        [3, 3],
      ].map(([done, total]) => ({
        done,
        total,
        pct: progress(
          'steps',
          IdeaStatus.InProgress,
          Array.from({ length: total ?? 0 }, (_, i) => ({ ...step('2026-11-20', i < (done ?? 0)), position: i + 1 })),
          '2026-11-09',
        ),
      })),
      lateExamples: {
        previsaoHoje: isLate(IdeaStatus.InProgress, [step('2026-11-09', false)], '2026-11-09'),
        previsaoOntem: isLate(IdeaStatus.InProgress, [step('2026-11-08', false)], '2026-11-09'),
        concluida: isLate(IdeaStatus.InProgress, [step('2026-11-08', true)], '2026-11-09'),
      },
    },
    convergence: {
      canBeConverged: Object.fromEntries(STATUSES.map((s) => [s, canBeConverged(s)])),
      canSupport: Object.fromEntries(STATUSES.map((s) => [s, canSupport(s)])),
      principalIsOlder: principalOf(newer, older)[0].id === older.id,
      requesterCountWith2CoAuthors: requesterCount(2),
    },
    // Escopo (§3.2): numa árvore de exemplo, onde vale "ver as ideias da entidade" para cada concessão.
    access: {
      tree: TREE,
      vectors: TREE.flatMap((g) =>
        [false, true].map((includeChildren) => {
          const access = computeAccess(
            'u',
            [{ entityId: g.id, includeChildren, permissions: ['idea.view_scope'] }],
            TREE,
          );
          return {
            grant: g.id,
            includeChildren,
            sees: TREE.filter((e) => access.hasIn('idea.view_scope', e.id)).map((e) => e.id),
          };
        }),
      ),
    },
    // Perfis de fábrica (§3.1) e o nome de cada permissão, para a tabela da referência.
    roles: FACTORY_ROLES.map((r) => ({ key: r.key, name: r.name, permissions: [...r.permissions] })),
    permissions: PERMISSIONS,
    hall: {
      allowInProgressDefault: SETTING_DEFAULTS['hall.allow_in_progress'],
      eligibility: Object.fromEntries(STATUSES.map((s) => [s, [eligibility(s, false), eligibility(s, true)]])),
      showsName: {
        aceitou: showsName('accepted', false, false),
        semResposta: showsName('pending', false, false),
        recusou: showsName('declined', false, false),
        aceitouMasOcultaNome: showsName('accepted', true, false),
      },
    },
  };
}

describe('Regras dos simuladores da ajuda (M11)', () => {
  it('o regras.json da ajuda é exatamente o que as regras reais do backend produzem', () => {
    const expected = `${JSON.stringify(build(), null, 2)}\n`;
    if (process.env.UPDATE_DOCS_RULES === '1') writeFileSync(FILE, expected);
    expect(readFileSync(FILE, 'utf8'), 'Regere com UPDATE_DOCS_RULES=1 pnpm exec vitest run test/docs').toBe(expected);
  });
});
