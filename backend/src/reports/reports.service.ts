import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { apiError } from '../common/api-error.js';
import { addMonthsToMonth, dayStartInZone, monthInZone, todayInZone } from '../common/dates.js';
import type { Access } from '../identity-access/access.js';
import { AccessService } from '../identity-access/access.service.js';
import { usersWithPermissionInAny } from '../identity-access/permission-holders.js';
import { SettingsService } from '../organization/settings.service.js';
import { subtreeIds } from '../organization/tree.js';
import { reportFields } from '../user-fields/snapshot.js';
import { engagementMonths, rate } from './engagement-rules.js';
import type { EngagementReport, GainGroup, ReportQuery, ReportSummary, ResultsReport } from './reports.dto.js';

const STATUSES = ['submitted', 'in_review', 'in_progress', 'implemented', 'rejected'] as const;

/** Condição SQL e parâmetros de um relatório: período, escopo, entidade e categoria. */
export interface ReportFilter {
  where: string;
  params: unknown[];
  /** Entidades consideradas (escopo ∩ entidade escolhida, com descendentes). */
  entityIds: string[];
}

/**
 * Indicadores (RN-44, RN-45, RN-49): painel por período, entidade e categoria, sempre dentro do
 * escopo de `report.view` de quem pede. Arquivadas não entram (CA-RN-44.2).
 * O ganho acumulado (RN-46) depende do campo numérico de ganho, previsto para a fase 2.
 */
@Injectable()
export class ReportsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly settings: SettingsService,
    private readonly accessService: AccessService,
  ) {}

  /** Monta o filtro. Entidade fora do escopo → 403 (CA-RN-49.1). Período no fuso da instalação. */
  async filter(access: Access, q: ReportQuery, opts: { includeConverged?: boolean } = {}): Promise<ReportFilter> {
    const scope = access.entities('report.view');
    let ids = scope;
    if (q.entityId) {
      if (!access.hasIn('report.view', q.entityId)) {
        throw apiError(403, 'forbidden', 'Você não tem acesso aos indicadores desta entidade.');
      }
      ids = subtreeIds(q.entityId, await this.accessService.tree()).filter((id) => scope.includes(id));
    }
    // Arquivadas e convergidas não contam (CA-RN-44.2, CA-RN-84.2): a principal representa o pedido.
    const where = ['i.archived_at IS NULL', 'i.entity_id = ANY($1::uuid[])'];
    if (!opts.includeConverged) where.push('i.converged_into_id IS NULL');
    const params: unknown[] = [ids];
    const zone = await this.settings.get('organization.timezone');
    if (q.from) {
      params.push(dayStartInZone(q.from, zone));
      where.push(`i.submitted_at >= $${params.length}`);
    }
    if (q.to) {
      params.push(dayStartInZone(q.to, zone, 1)); // limite final exclusivo: o dia inteiro entra
      where.push(`i.submitted_at < $${params.length}`);
    }
    if (q.categoryId) {
      params.push(q.categoryId);
      where.push(`i.category_id = $${params.length}`);
    }
    for (const option of q.options ?? []) {
      params.push(option);
      where.push(
        `EXISTS (SELECT 1 FROM idea_field_value fv WHERE fv.idea_id = i.id AND fv.option_id = $${params.length})`,
      );
    }
    return { where: where.join(' AND '), params, entityIds: ids };
  }

  async summary(access: Access, q: ReportQuery): Promise<ReportSummary> {
    const { where, params } = await this.filter(access, q);
    const m = this.dataSource.manager;
    const zone = await this.settings.get('organization.timezone');
    const todayParam = params.length + 1;
    const today = todayInZone(new Date(), zone);

    const statusRows: { status: string; n: string }[] = await m.query(
      `SELECT i.status, count(*) AS n FROM idea i WHERE ${where} GROUP BY i.status`,
      params,
    );
    const counts = new Map(statusRows.map((r) => [r.status, Number(r.n)]));
    const byStatus = STATUSES.map((status) => ({ status, count: counts.get(status) ?? 0 }));
    const total = byStatus.reduce((sum, s) => sum + s.count, 0);

    const [p]: Record<string, string | null>[] = await m.query(
      `SELECT
         avg(extract(epoch FROM (i.decided_at - i.submitted_at))) FILTER (WHERE i.decided_at IS NOT NULL) AS triage,
         avg(extract(epoch FROM (i.implemented_at - i.decided_at)))
           FILTER (WHERE i.status = 'implemented' AND i.implemented_at IS NOT NULL AND i.decided_at IS NOT NULL) AS execution,
         count(*) FILTER (WHERE i.decided_at IS NOT NULL) AS decided,
         count(*) FILTER (WHERE i.decided_at IS NOT NULL AND i.status IN ('in_progress', 'implemented')) AS approved,
         count(*) FILTER (WHERE i.status = 'in_progress') AS in_progress,
         count(*) FILTER (WHERE i.status = 'in_progress' AND EXISTS (
           SELECT 1 FROM step s WHERE s.idea_id = i.id AND s.completed_at IS NULL AND s.due_date < $${todayParam}::date
         )) AS late,
         count(DISTINCT i.author_id) AS authors
       FROM idea i WHERE ${where}`,
      [...params, today],
    );
    const decided = Number(p?.decided ?? 0);
    const inProgress = Number(p?.in_progress ?? 0);
    const late = Number(p?.late ?? 0);
    const authors = Number(p?.authors ?? 0);
    const num = (v: string | null | undefined) => (v === null || v === undefined ? null : Math.round(Number(v)));

    const byCategory: { id: string | null; name: string | null; color: string | null; n: string }[] = await m.query(
      `SELECT c.id, c.name, c.color, count(*) AS n FROM idea i LEFT JOIN category c ON c.id = i.category_id
        WHERE ${where} GROUP BY c.id, c.name, c.color ORDER BY n DESC, c.name`,
      params,
    );
    const byEntity: { id: string; name: string; n: string }[] = await m.query(
      `SELECT e.id, e.name, count(*) AS n FROM idea i JOIN entity e ON e.id = i.entity_id
        WHERE ${where} GROUP BY e.id, e.name ORDER BY n DESC, e.name`,
      params,
    );

    return {
      total,
      byStatus,
      process: {
        avgTriageSeconds: num(p?.triage),
        avgExecutionSeconds: num(p?.execution),
        approvalRate: decided === 0 ? null : Number(p?.approved ?? 0) / decided,
        decided,
        lateRate: inProgress === 0 ? null : late / inProgress,
        inProgress,
        late,
        authors,
        ideasPerAuthor: authors === 0 ? null : total / authors,
      },
      byCategory: byCategory.map((r) => ({ id: r.id, name: r.name ?? '', color: r.color, count: Number(r.n) })),
      byEntity: byEntity.map((r) => ({ id: r.id, name: r.name, count: Number(r.n) })),
      byField: await this.byField(where, params),
    };
  }

  /** Ideias por campo fechado, pelo valor gravado na ideia; sem valor, "Não informado" (RN-201). */
  private async byField(where: string, params: unknown[]): Promise<ReportSummary['byField']> {
    const m = this.dataSource.manager;
    const fields = await reportFields(m);
    const out: ReportSummary['byField'] = [];
    for (const field of fields) {
      const rows: { option_id: string | null; label: string | null; n: string }[] = await m.query(
        `SELECT fv.option_id, COALESCE(o.label, max(fv.label)) AS label, count(*) AS n
           FROM idea i
           LEFT JOIN idea_field_value fv ON fv.idea_id = i.id AND fv.field_id = $${params.length + 1}
           LEFT JOIN user_field_option o ON o.id = fv.option_id
          WHERE ${where}
          GROUP BY fv.option_id, o.label
          ORDER BY (fv.option_id IS NULL), n DESC, label`,
        [...params, field.id],
      );
      out.push({
        fieldId: field.id,
        labelPt: field.labelPt,
        labelEn: field.labelEn,
        items: rows.map((r) => ({ optionId: r.option_id, label: r.label, count: Number(r.n) })),
      });
    }
    return out;
  }

  /**
   * Engajamento (RN-81). "Colaboradores ativos" = pessoas ativas que podem enviar ideias
   * (`idea.submit`) em alguma entidade do relatório. Participação = quantas delas enviaram ao menos
   * uma ideia no período (ideia convergida também conta: a pessoa participou). Ideias por
   * colaborador e taxa de implementação (implementadas ÷ enviadas, das enviadas no período) não
   * contam convergidas, como o resto do painel (CA-RN-84.2).
   */
  async engagement(access: Access, q: ReportQuery): Promise<EngagementReport> {
    const strict = await this.filter(access, q);
    const all = await this.filter(access, q, { includeConverged: true });
    const m = this.dataSource.manager;
    const zone = await this.settings.get('organization.timezone');
    const collaborators = await usersWithPermissionInAny(m, 'idea.submit', strict.entityIds);

    const [totals]: { ideas: string; implemented: string }[] = await m.query(
      `SELECT count(*) AS ideas, count(*) FILTER (WHERE i.status = 'implemented') AS implemented
         FROM idea i WHERE ${strict.where}`,
      strict.params,
    );
    const [part]: { n: string }[] = await m.query(
      `SELECT count(DISTINCT i.author_id) AS n FROM idea i
        WHERE ${all.where} AND i.author_id = ANY($${all.params.length + 1}::uuid[])`,
      [...all.params, collaborators],
    );

    const months = engagementMonths(monthInZone(new Date(), zone), q.from, q.to);
    const byMonth = new Map<string, { submitted: string; implemented: string; participants: string }>();
    if (months.length > 0) {
      const first = months[0] as string;
      const afterLast = addMonthsToMonth(months.at(-1) as string, 1);
      const n = all.params.length;
      const rows: { month: string; submitted: string; implemented: string; participants: string }[] = await m.query(
        `SELECT to_char(i.submitted_at AT TIME ZONE $${n + 1}, 'YYYY-MM') AS month,
                count(*) FILTER (WHERE i.converged_into_id IS NULL) AS submitted,
                count(*) FILTER (WHERE i.converged_into_id IS NULL AND i.status = 'implemented') AS implemented,
                count(DISTINCT i.author_id) AS participants
           FROM idea i
          WHERE ${all.where} AND i.submitted_at >= $${n + 2} AND i.submitted_at < $${n + 3}
          GROUP BY 1`,
        [...all.params, zone, dayStartInZone(`${first}-01`, zone), dayStartInZone(`${afterLast}-01`, zone)],
      );
      for (const r of rows) byMonth.set(r.month, r);
    }

    const ideas = Number(totals?.ideas ?? 0);
    const implemented = Number(totals?.implemented ?? 0);
    const participants = Number(part?.n ?? 0);
    return {
      activeCollaborators: collaborators.length,
      participants,
      participationRate: rate(participants, collaborators.length),
      ideas,
      ideasPerCollaborator: rate(ideas, collaborators.length),
      implemented,
      implementationRate: rate(implemented, ideas),
      monthly: months.map((month) => {
        const r = byMonth.get(month);
        return {
          month,
          submitted: Number(r?.submitted ?? 0),
          implemented: Number(r?.implemented ?? 0),
          participants: Number(r?.participants ?? 0),
        };
      }),
    };
  }

  /**
   * Resultado financeiro (RN-46, RN-82, CA-RN-63.3): ganhos realizados das ideias implementadas no
   * recorte, por moeda. Só o **validado** entra nos totais, na média e no ROI; o declarado aparece à
   * parte, como "aguardando validação". Mensal vira anual (× 12). Ideia sem ganho não entra na média.
   */
  async results(access: Access, q: ReportQuery): Promise<ResultsReport> {
    const { where, params } = await this.filter(access, q);
    const m = this.dataSource.manager;
    const base = `SELECT i.id, i.category_id, i.entity_id, g.currency, g.status, g.implementation_cost AS cost,
                         CASE g.periodicity WHEN 'monthly' THEN g.realized * 12 ELSE g.realized END AS annual
                    FROM idea i JOIN financial_gain g ON g.idea_id = i.id
                   WHERE ${where} AND i.status = 'implemented' AND g.realized IS NOT NULL`;
    const money = (v: string | null) => (v === null ? 0 : Number(v));
    const ratio = (gain: string | null, cost: string | null) => (money(cost) === 0 ? null : money(gain) / money(cost));

    const totals: Record<string, string | null>[] = await m.query(
      `SELECT x.currency,
              sum(x.annual) FILTER (WHERE x.status = 'validated') AS validated,
              count(*) FILTER (WHERE x.status = 'validated') AS validated_n,
              sum(x.annual) FILTER (WHERE x.status = 'validated' AND x.cost > 0) AS roi_gain,
              sum(x.cost) FILTER (WHERE x.status = 'validated' AND x.cost > 0) AS roi_cost,
              sum(x.annual) FILTER (WHERE x.status = 'declared') AS declared,
              count(*) FILTER (WHERE x.status = 'declared') AS declared_n
         FROM (${base}) x GROUP BY x.currency ORDER BY validated DESC NULLS LAST, x.currency`,
      params,
    );
    const group = async (join: string, key: string, name: string, color: string): Promise<GainGroup[]> => {
      const rows: Record<string, string | null>[] = await m.query(
        `SELECT ${key} AS id, ${name} AS name, ${color} AS color, x.currency,
                sum(x.annual) AS validated, count(*) AS n,
                sum(x.annual) FILTER (WHERE x.cost > 0) AS roi_gain, sum(x.cost) FILTER (WHERE x.cost > 0) AS roi_cost
           FROM (${base}) x ${join}
          WHERE x.status = 'validated'
          GROUP BY ${key}, ${name}, ${color}, x.currency ORDER BY validated DESC, name`,
        params,
      );
      return rows.map((r) => ({
        id: r.id ?? null,
        name: r.name ?? '',
        color: r.color ?? null,
        currency: r.currency ?? '',
        validatedAnnual: money(r.validated ?? null),
        ideas: Number(r.n ?? 0),
        roi: ratio(r.roi_gain ?? null, r.roi_cost ?? null),
      }));
    };
    return {
      currencies: totals.map((r) => {
        const n = Number(r.validated_n ?? 0);
        return {
          currency: r.currency ?? '',
          validatedAnnual: money(r.validated ?? null),
          validatedIdeas: n,
          avgPerIdea: n === 0 ? null : money(r.validated ?? null) / n,
          roi: ratio(r.roi_gain ?? null, r.roi_cost ?? null),
          declaredAnnual: money(r.declared ?? null),
          declaredIdeas: Number(r.declared_n ?? 0),
        };
      }),
      byCategory: await group('LEFT JOIN category c ON c.id = x.category_id', 'c.id', 'c.name', 'c.color'),
      byEntity: await group('JOIN entity e ON e.id = x.entity_id', 'e.id', 'e.name', 'NULL::text'),
    };
  }
}
