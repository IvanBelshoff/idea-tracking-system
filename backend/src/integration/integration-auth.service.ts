import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { computeAccess, type Grant } from '../identity-access/access.js';
import { AccessService } from '../identity-access/access.service.js';
import { tokenHash } from '../identity-access/password.js';
import { Integration, IntegrationScope, IntegrationToken } from './entities.js';
import { ipAllowed } from './ip-rules.js';
import { INTEGRATION_LIMITS } from './modules.js';
import { isTokenValid } from './token-rules.js';

/** Resultado de uma autenticação que deu certo. */
export interface Authenticated {
  integration: Integration;
  token: IntegrationToken;
}

/**
 * Autentica o token de integração e calcula o escopo (RN-103, RN-104). A busca é pelo HASH do
 * token; o prefixo nunca decide acesso (CA-RN-104.9). Qualquer falha devolve `null`: o chamador
 * responde sempre o mesmo 401, sem dizer o motivo.
 */
@Injectable()
export class IntegrationAuthService {
  /** Última gravação de `last_used_at` por token, para gravar no máximo uma vez por minuto. */
  private readonly lastWrite = new Map<string, number>();

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly access: AccessService,
  ) {}

  async authenticate(token: string, ip: string | undefined, now: Date): Promise<Authenticated | null> {
    const row = await this.dataSource
      .getRepository(IntegrationToken)
      .findOne({ where: { tokenHash: tokenHash(token) }, relations: { integration: true } });
    if (!row) return null;
    const integration = row.integration;
    if (integration.status !== 'active') return null;
    if (!isTokenValid(row, now)) return null;
    if (!ipAllowed(ip, integration.ipAllowlist)) return null;
    return { integration, token: row };
  }

  /** Grava a "última chamada" do token, no máximo uma vez por minuto (CA-RN-104.10). */
  async touch(tokenId: string, now: Date): Promise<void> {
    const last = this.lastWrite.get(tokenId) ?? 0;
    if (now.getTime() - last < INTEGRATION_LIMITS.lastUsedWriteMs) return;
    this.lastWrite.set(tokenId, now.getTime());
    await this.dataSource.getRepository(IntegrationToken).update({ id: tokenId }, { lastUsedAt: now });
  }

  /**
   * As entidades do escopo, com as subentidades de quem tem `includeChildren`. Usa o MESMO cálculo
   * do escopo de perfis (`computeAccess`), sem `userId` real: a exceção "o autor vê a própria ideia"
   * não existe para integração (CA-RN-103.7). Sem escopo, lista vazia.
   */
  async scopeEntityIds(integrationId: string): Promise<string[]> {
    const rows = await this.dataSource.getRepository(IntegrationScope).findBy({ integrationId });
    if (rows.length === 0) return [];
    const grants: Grant[] = rows.map((r) => ({
      entityId: r.entityId,
      includeChildren: r.includeChildren,
      permissions: ['idea.view_scope'],
    }));
    return computeAccess(integrationId, grants, await this.access.tree()).entities('idea.view_scope');
  }
}
