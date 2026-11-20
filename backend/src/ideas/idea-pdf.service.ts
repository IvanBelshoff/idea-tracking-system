import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { formatDateInZone, formatDateTimeInZone, formatDayBr } from '../common/dates.js';
import type { Access } from '../identity-access/access.js';
import { SettingsService } from '../organization/settings.service.js';
import { IdeaActivityService } from './idea-activity.service.js';
import type { IdeaDetail, TimelineEvent } from './ideas.dto.js';
import { IdeasService } from './ideas.service.js';

const STATUS_PT: Record<string, string> = {
  submitted: 'Enviada',
  in_review: 'Em análise',
  in_progress: 'Em andamento',
  implemented: 'Implementada',
  rejected: 'Não autorizada',
};

const day = (d: unknown) => (typeof d === 'string' && d ? formatDayBr(d) : '—');

/** Frase de cada evento do histórico, em pt-BR (o PDF é um documento, não segue o idioma da tela). */
function describeEvent(e: TimelineEvent): string {
  const d = e.data as Record<string, unknown>;
  switch (e.type) {
    case 'created':
      return d.onBehalfOf ? 'Ideia registrada em nome do autor' : 'Ideia enviada';
    case 'status_changed':
    case 'reopened':
      return `${e.type === 'reopened' ? 'Reaberta' : 'Situação'}: ${STATUS_PT[String(d.to)] ?? String(d.to)}`;
    case 'step_added':
      return `Etapa ${d.position} criada: ${d.name}`;
    case 'step_updated':
      return `Etapa ${d.position} alterada`;
    case 'step_removed':
      return `Etapa ${d.position} excluída: ${d.name}`;
    case 'step_completed':
      return `Etapa ${d.position} concluída: ${d.name}`;
    case 'all_steps_completed':
      return 'Todas as etapas concluídas';
    case 'deadline_changed':
      return `Prazo alterado de ${day(d.from)} para ${day(d.to)}`;
    case 'attachment_added':
      return `Anexo adicionado na etapa ${d.position}: ${d.name}`;
    case 'attachment_removed':
      return `Anexo removido: ${d.name}`;
    case 'comment_added':
      return e.visibility === 'internal' ? 'Comentário interno' : 'Comentário';
    case 'updated':
      return 'Ideia editada';
    case 'archived':
      return 'Ideia arquivada';
    default:
      return e.type;
  }
}

/**
 * PDF de uma ideia (RN-47): dados, etapas e situação; histórico só se pedido. Quem não vê a ideia
 * recebe 404 antes de qualquer coisa (CA-RN-47.2). Eventos internos só saem para quem pode ver
 * comentários internos (CA-RN-47.1): usa a mesma linha do tempo filtrada da tela.
 */
@Injectable()
export class IdeaPdfService {
  constructor(
    private readonly ideas: IdeasService,
    private readonly activity: IdeaActivityService,
    private readonly settings: SettingsService,
  ) {}

  async render(access: Access, refValue: string, withHistory: boolean): Promise<{ code: string; pdf: Buffer }> {
    const idea = await this.ideas.detail(access, refValue); // 404 se não vê
    const [zone, organization] = await Promise.all([
      this.settings.get('organization.timezone'),
      this.settings.get('organization.name'),
    ]);
    const history = withHistory ? await this.activity.timeline(access, refValue) : null;
    return { code: idea.code, pdf: await draw(idea, history, zone, organization) };
  }
}

function draw(idea: IdeaDetail, history: TimelineEvent[] | null, zone: string, organization: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 50,
      // Nos testes o PDF sai sem compressão, para o texto poder ser conferido.
      compress: process.env.NODE_ENV !== 'test',
      info: { Title: `${idea.code} - ${idea.title}`, Author: organization || 'ITS', Creator: 'ITS' },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const label = (text: string, value: string) => {
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#555555').text(text.toUpperCase(), { continued: false });
      doc
        .font('Helvetica')
        .fontSize(11)
        .fillColor('#111111')
        .text(value || '—');
      doc.moveDown(0.5);
    };
    const section = (title: string) => {
      doc.moveDown(0.6);
      doc.font('Helvetica-Bold').fontSize(13).fillColor('#111111').text(title);
      doc
        .moveTo(50, doc.y + 2)
        .lineTo(545, doc.y + 2)
        .strokeColor('#cccccc')
        .stroke();
      doc.moveDown(0.6);
    };

    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor('#555555')
      .text(organization || 'ITS');
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#444444').text(idea.code);
    doc.font('Helvetica-Bold').fontSize(20).fillColor('#111111').text(idea.title);
    doc.moveDown(0.3);
    doc
      .font('Helvetica')
      .fontSize(11)
      .fillColor('#111111')
      .text(`Situação: ${STATUS_PT[idea.status] ?? idea.status}`);
    if (idea.late) doc.fillColor('#b45309').text('Atrasada');
    doc.fillColor('#111111');

    section('Dados');
    label('Entidade', idea.entity.name);
    label('Categoria', idea.category?.name ?? '');
    label('Autor', idea.author?.name ?? 'Ex-colaborador');
    if (idea.registeredBy) label('Registrada por', idea.registeredBy.name);
    label('Responsável pela análise', idea.assignedTo?.name ?? '');
    label('Enviada em', formatDateTimeInZone(new Date(idea.submittedAt), zone));
    if (idea.deadline) label('Prazo', formatDayBr(idea.deadline));
    if (idea.externalRef) label('Referência externa', idea.externalRef);

    section('Situação atual');
    doc.font('Helvetica').fontSize(11).text(idea.description);
    if (idea.proposedSolution) {
      section('Solução proposta');
      doc.font('Helvetica').fontSize(11).text(idea.proposedSolution);
    }
    if (idea.expectedGain) {
      section('Ganho esperado');
      doc.font('Helvetica').fontSize(11).text(idea.expectedGain);
    }
    if (idea.rejectionReason) {
      section('Motivo da decisão');
      doc.font('Helvetica').fontSize(11).text(idea.rejectionReason);
    }
    if (idea.resultText) {
      section('Resultado obtido');
      doc.font('Helvetica').fontSize(11).text(idea.resultText);
    }

    section(`Etapas (${idea.progress}% concluído)`);
    if (idea.steps.length === 0) doc.font('Helvetica').fontSize(11).text('Nenhuma etapa.');
    for (const s of idea.steps) {
      doc.font('Helvetica-Bold').fontSize(11).text(`${s.position}. ${s.name}`);
      const done = s.completedAt ? `concluída em ${formatDateInZone(new Date(s.completedAt), zone)}` : 'em execução';
      doc
        .font('Helvetica')
        .fontSize(10)
        .fillColor('#444444')
        .text(
          `Responsável: ${s.assignee.name}  |  ${formatDayBr(s.startDate)} a ${formatDayBr(s.dueDate)}  |  ${done}`,
        );
      if (s.description) doc.fillColor('#111111').text(s.description);
      doc.fillColor('#111111').moveDown(0.4);
    }

    if (history) {
      section('Histórico');
      for (const e of history) {
        const who = e.actor?.name ?? 'Sistema';
        doc
          .font('Helvetica')
          .fontSize(10)
          .fillColor('#111111')
          .text(`${formatDateTimeInZone(new Date(e.at), zone)}  -  ${describeEvent(e)}  (${who})`);
        if (e.reason) doc.fillColor('#555555').text(`Motivo: ${e.reason}`, { indent: 12 });
        doc.fillColor('#111111');
      }
    }

    doc.end();
  });
}
