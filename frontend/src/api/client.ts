import createClient from 'openapi-fetch';
import type { paths } from './schema';

/**
 * Cliente HTTP tipado pelo contrato OpenAPI do backend.
 * Os tipos (`schema.d.ts`) são GERADOS: `pnpm api:generate` (lê ../backend/openapi.json). Não editar à mão.
 * Mesma origem: em desenvolvimento o Vite repassa /api; em produção, o nginx.
 */
export const api = createClient<paths>({ baseUrl: '/', credentials: 'include' });
