import { Injectable } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { apiError } from '../../common/api-error.js';
import { SettingsService } from '../../organization/settings.service.js';
import { filterContract } from '../contract-filter.js';
import { Integration } from '../entities.js';

/**
 * O contrato da API de integração (RN-106, RN-115). O documento completo é montado na subida da API
 * (`createApp`); aqui ele é só FILTRADO: pelos módulos ligados e, se pedido, pelos de uma integração.
 * Serve a rota `GET /integration/v1/openapi.json` (com token) e a aba Documentação da tela do
 * administrador (com sessão). Nunca devolve dado real: o contrato só tem tipos e exemplos fictícios.
 */
@Injectable()
export class IntegrationDocsService {
  private document: OpenAPIObject | null = null;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly settings: SettingsService,
  ) {}

  /** Chamado por `createApp` com o documento completo. */
  setDocument(document: OpenAPIObject): void {
    this.document = document;
  }

  /** Os módulos ligados, ou só os de uma integração (os dela que também estão ligados). */
  async contract(integrationId?: string): Promise<OpenAPIObject> {
    if (!this.document) throw apiError(503, 'contract_unavailable', 'O contrato ainda não foi montado.');
    const enabled = await this.settings.get('integration.modules');
    let modules: string[] = enabled;
    if (integrationId) {
      const integration = /^[0-9a-f-]{36}$/i.test(integrationId)
        ? await this.dataSource.getRepository(Integration).findOneBy({ id: integrationId })
        : null;
      if (!integration) throw apiError(404, 'not_found', 'Integração não encontrada.');
      modules = integration.modules.filter((m) => enabled.includes(m));
    }
    const filtered = filterContract(this.document, modules);
    const appUrl = (await this.settings.get('email.app_url')).trim().replace(/\/+$/, '');
    if (appUrl) filtered.servers = [{ url: appUrl }];
    return filtered;
  }

  /** O contrato visto por uma integração autenticada: só os módulos dela que estão ligados. */
  async contractFor(integrationId: string): Promise<OpenAPIObject> {
    return this.contract(integrationId);
  }
}
