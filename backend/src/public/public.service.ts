import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { apiError } from '../common/api-error.js';
import { todayInZone } from '../common/dates.js';
import { RateLimiter } from '../common/rate-limit.js';
import { Idea } from '../ideas/entities/idea.entity.js';
import { Step } from '../ideas/entities/idea-related.entity.js';
import { ideaDeadline, isLate } from '../ideas/steps-rules.js';
import { SettingsService } from '../organization/settings.service.js';
import type { PublicIdeaView } from './public.dto.js';

/** Código de acompanhamento (RN-34): 256 bits de fonte criptográfica, em base64url (43 caracteres). */
export const newPublicCode = (): string => randomBytes(32).toString('base64url');

/** Formato aceito na rota: o que `newPublicCode` gera (e o do preenchimento das ideias antigas). */
export const PUBLIC_CODE_FORMAT = /^[A-Za-z0-9_-]{43,64}$/;

/** 30 consultas por minuto por IP (RN-36, CA-RN-36.1). */
export const PUBLIC_LOOKUP_LIMIT = 30;
export const publicLookupLimiter = new RateLimiter(PUBLIC_LOOKUP_LIMIT, 60_000);

const notFound = () => apiError(404, 'not_found', 'Código não encontrado.');
/** Código válido no formato que nunca existe: faz a consulta ao banco mesmo com entrada inválida. */
const NEVER_ISSUED = 'x'.repeat(43);

/**
 * Consulta pública por código (RN-33 a RN-37): só leitura, só campos permitidos (RN-35), desligada
 * por padrão. Código inexistente, ideia com a consulta desativada e consulta desligada na instalação
 * respondem exatamente igual (CA-RN-36.2).
 */
@Injectable()
export class PublicService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly settings: SettingsService,
  ) {}

  async lookup(code: string, ip: string | null): Promise<PublicIdeaView> {
    publicLookupLimiter.hit(ip ?? 'desconhecido');
    const enabled = await this.settings.get('public.lookup_enabled');
    // A consulta ao banco acontece sempre (mesmo desligada ou com formato inválido), para a
    // resposta não diferir em tempo entre os casos de 404.
    const idea = await this.dataSource.getRepository(Idea).findOne({
      where: { publicCode: PUBLIC_CODE_FORMAT.test(code) ? code : NEVER_ISSUED },
      relations: { category: true },
    });
    if (!enabled || !idea?.publicEnabled || idea.archivedAt || idea.convergedIntoId) throw notFound();

    const steps = await this.dataSource
      .getRepository(Step)
      .find({ where: { ideaId: idea.id }, order: { position: 'ASC' } });
    const today = todayInZone(new Date(), await this.settings.get('organization.timezone'));
    // Lista fechada de campos (RN-35): nada de autor, comentários, anexos, ganho ou pessoas.
    return {
      title: idea.title,
      category: idea.category ? { name: idea.category.name, color: idea.category.color } : null,
      status: idea.status,
      submittedAt: idea.submittedAt.toISOString(),
      deadline: ideaDeadline(steps),
      late: isLate(idea.status, steps, today),
      steps: steps.map((s) => ({
        position: s.position,
        name: s.name,
        dueDate: s.dueDate,
        completedAt: s.completedAt?.toISOString() ?? null,
      })),
    };
  }
}
