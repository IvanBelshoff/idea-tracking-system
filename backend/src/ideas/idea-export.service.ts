import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { CSV_BOM, csvRow } from '../common/csv.js';
import { formatDateTimeInZone, formatDayBr } from '../common/dates.js';
import type { Access } from '../identity-access/access.js';
import { SettingsService } from '../organization/settings.service.js';
import { reportFields } from '../user-fields/snapshot.js';
import { type IdeaFilters, IdeasService } from './ideas.service.js';

const STATUS_PT: Record<string, string> = {
  submitted: 'Enviada',
  in_review: 'Em análise',
  in_progress: 'Em andamento',
  implemented: 'Implementada',
  rejected: 'Não autorizada',
};

/** Exportação e relatórios por ideia (RN-47, RN-48). */
@Injectable()
export class IdeaExportService {
  constructor(
    private readonly ideas: IdeasService,
    private readonly settings: SettingsService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  /**
   * CSV das listagens filtradas (RN-48): só as linhas que a pessoa veria na tela (mesmo escopo e
   * filtros) e células neutralizadas contra injeção de fórmula (CA-RN-48.2).
   */
  async ideasCsv(access: Access, filters: IdeaFilters): Promise<string> {
    const [rows, zone] = await Promise.all([
      this.ideas.exportRows(access, filters),
      this.settings.get('organization.timezone'),
    ]);
    // Campos fechados do autor, pelo valor gravado na ideia ao enviar (RN-201); abertos nunca entram.
    const fields = await reportFields(this.dataSource.manager);
    const saved: { idea_id: string; field_id: string; label: string }[] =
      fields.length && rows.length
        ? await this.dataSource.query(
            `SELECT fv.idea_id, fv.field_id, COALESCE(o.label, fv.label) AS label
               FROM idea_field_value fv LEFT JOIN user_field_option o ON o.id = fv.option_id
              WHERE fv.idea_id = ANY($1)`,
            [rows.map((i) => i.id)],
          )
        : [];
    const savedLabel = new Map(saved.map((r) => [`${r.idea_id}:${r.field_id}`, r.label]));
    let csv = CSV_BOM;
    csv += csvRow([
      'Código',
      'Título',
      'Situação',
      'Entidade',
      'Categoria',
      'Autor',
      'Responsável pela análise',
      'Enviada em',
      'Prazo',
      'Atrasada',
      ...fields.map((f) => f.labelPt),
    ]);
    for (const i of rows) {
      csv += csvRow([
        i.code,
        i.title,
        STATUS_PT[i.status] ?? i.status,
        i.entity.name,
        i.category?.name ?? '',
        i.author?.name ?? '',
        i.assignedTo?.name ?? '',
        formatDateTimeInZone(new Date(i.submittedAt), zone),
        i.deadline ? formatDayBr(i.deadline) : '',
        i.late ? 'Sim' : 'Não',
        ...fields.map((f) => savedLabel.get(`${i.id}:${f.id}`) ?? 'Não informado'),
      ]);
    }
    return csv;
  }
}
