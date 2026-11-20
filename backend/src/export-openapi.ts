import 'reflect-metadata';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { buildIntegrationOpenApiDocument, buildOpenApiDocument, createApp } from './app.factory.js';
import { breakingChanges } from './integration/contract-compat.js';

/**
 * Gera `openapi.json` na raiz do repositório (versionado).
 * O frontend gera os tipos a partir dele; a CI falha se o arquivo estiver desatualizado.
 */
// Prévia sem banco: o contrato só precisa das rotas e dos tipos.
const app = await createApp({ logger: false, preview: true, databaseUrl: 'postgresql://openapi@localhost/openapi' });
await app.init();
const document = buildOpenApiDocument(app);
writeFileSync('openapi.json', `${JSON.stringify(document, null, 2)}\n`);
// Contrato da API de integração (RN-106): versionado à parte e congelado em `v1`. Mudança que quebra
// quem já integra (campo ou rota removidos, tipo mudado) recusa a exportação; o certo é abrir a `v2`.
const integration = buildIntegrationOpenApiDocument(app);
if (existsSync('openapi-integration.json') && !process.env.ALLOW_BREAKING_CONTRACT) {
  const broken = breakingChanges(JSON.parse(readFileSync('openapi-integration.json', 'utf8')), integration);
  if (broken.length > 0) {
    console.error(
      `O contrato /integration/v1 está congelado. Mudanças que quebram quem já integra:\n- ${broken.join('\n- ')}`,
    );
    await app.close();
    process.exit(1);
  }
}
writeFileSync('openapi-integration.json', `${JSON.stringify(integration, null, 2)}\n`);
await app.close();
console.log('openapi.json e openapi-integration.json atualizados');
