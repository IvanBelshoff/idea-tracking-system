import { applyDecorators, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiQuery,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ApiErrorBody } from '../../common/api-error.js';
import { AllowBeforeInstall, Public } from '../../identity-access/auth-context.js';
import { IntegrationGuard } from '../integration.guard.js';
import type { IntegrationModuleId } from '../modules.js';
import { IntegrationRoute } from '../principal.js';
import { bi } from './bilingual.js';

/**
 * Tudo que toda rota de módulo da API de integração precisa (RN-102 a RN-106): sem sessão (o
 * `IntegrationGuard` autentica pelo token), a tag do módulo (usada para filtrar o contrato), o
 * esquema Bearer e as respostas de erro comuns.
 */
export function IntegrationApi(module: IntegrationModuleId) {
  return applyDecorators(
    Public(),
    AllowBeforeInstall(),
    UseGuards(IntegrationGuard),
    IntegrationRoute(module),
    ApiTags(module),
    ApiBearerAuth(),
    ApiUnauthorizedResponse({ type: ApiErrorBody, description: 'Token ausente, inválido, vencido ou revogado.' }),
    ApiForbiddenResponse({ type: ApiErrorBody, description: 'A integração não tem este módulo.' }),
    ApiNotFoundResponse({ type: ApiErrorBody, description: 'Módulo desligado ou item fora do escopo.' }),
    ApiTooManyRequestsResponse({ type: ApiErrorBody, description: 'Limite de chamadas por minuto (Retry-After).' }),
  );
}

/** Os parâmetros comuns das listas (RN-106). */
export function PageQueryDocs() {
  return applyDecorators(
    ApiQuery({
      name: 'limit',
      required: false,
      schema: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
      ...bi('Items per page (1 to 200, default 50).', 'Itens por página (de 1 a 200, padrão 50).'),
    }),
    ApiQuery({
      name: 'cursor',
      required: false,
      schema: { type: 'string' },
      ...bi(
        'Opaque cursor: use the `next_cursor` of the previous page.',
        'Cursor opaco: use o `next_cursor` da página anterior.',
      ),
    }),
    ApiQuery({
      name: 'updated_since',
      required: false,
      schema: { type: 'string', format: 'date-time' },
      ...bi(
        'Only items changed at or after this date (ISO 8601). Use it to sync only what is new.',
        'Só os itens alterados a partir desta data (ISO 8601). Serve para sincronizar só o que mudou.',
      ),
    }),
  );
}
