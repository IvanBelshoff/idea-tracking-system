import 'reflect-metadata';
import { buildOpenApiDocument, createApp } from './app.factory.js';
import { PtBrLogger } from './common/pt-br-logger.js';
import { prepareDatabase } from './database/bootstrap.js';
import { createDataSource } from './database/data-source.js';

async function bootstrap(): Promise<void> {
  // Migrações pendentes e dados de fábrica, antes de aceitar requisições (com trava entre instâncias).
  const dataSource = createDataSource();
  await dataSource.initialize();
  const applied = await prepareDatabase(dataSource);
  const logger = new PtBrLogger('Banco');
  logger.log(
    applied.length > 0 ? `Migrações aplicadas: ${applied.join(', ')}` : 'Esquema em dia, nenhuma migração pendente',
  );
  await dataSource.destroy();

  const app = await createApp();

  // Contrato da API, em JSON (sem interface Swagger UI).
  const document = buildOpenApiDocument(app);
  app.getHttpAdapter().get('/api/openapi.json', (_req: unknown, res: { json(body: unknown): void }) => {
    res.json(document);
  });

  const port = Number(process.env.PORT ?? 3000);
  // Por padrão só aceita conexões desta máquina; no Docker, o Compose define HOST=0.0.0.0.
  const host = process.env.HOST ?? '127.0.0.1';
  await app.listen(port, host);
}

void bootstrap();
