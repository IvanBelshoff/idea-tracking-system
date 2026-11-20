import { type INestApplication, RequestMethod } from '@nestjs/common';
import { ModulesContainer, NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, type OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { AppModule, type AppModuleOptions } from './app.module.js';
import { PtBrLogger } from './common/pt-br-logger.js';
import { IntegrationDocsService } from './integration/admin/integration-docs.service.js';
import { IntegrationModule } from './integration/integration.module.js';
import { createIntegrationHttp } from './integration/integration-http.js';
import { appVersion } from './observability/app-version.js';
import { createHttpMetricsMiddleware } from './observability/http-metrics.middleware.js';
import { HttpMetricsStore } from './observability/http-metrics.store.js';
import { SettingsService } from './organization/settings.service.js';

/** Única configuração da aplicação, usada pelo servidor, pelos testes e pela exportação do OpenAPI. */
export async function createApp(
  options: AppModuleOptions & { logger?: boolean; preview?: boolean } = {},
): Promise<INestApplication> {
  // Logs em pt-BR (inclusive as mensagens do próprio NestJS).
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(options), {
    logger: options.logger === false ? false : new PtBrLogger(),
    // Modo prévia: monta as rotas sem instanciar serviços (nem conectar ao banco). Usado no OpenAPI.
    preview: options.preview,
  });
  configureApp(app);
  // O contrato da integração é montado uma vez, aqui; o serviço só o filtra por módulo (RN-106, RN-115).
  if (!options.preview) {
    app.get(IntegrationDocsService, { strict: false }).setDocument(buildIntegrationOpenApiDocument(app));
  }
  return app;
}

export function configureApp(app: INestApplication): void {
  // A API de integração (M16, RN-106) vive fora de `/api`: contrato estável e caminho próprio no nginx.
  app.setGlobalPrefix('api', { exclude: [{ path: 'integration/{*path}', method: RequestMethod.ALL }] });
  // Atrás do nginx (rede interna): confia no X-Forwarded-* para IP real e HTTPS (cookie Secure).
  (app as NestExpressApplication).set('trust proxy', 'loopback, linklocal, uniquelocal');
  // Superfície `/integration`: sem cache, só GET e sem CORS (RN-106).
  (app as NestExpressApplication).use(
    '/integration',
    createIntegrationHttp(() => app.get(SettingsService, { strict: false })),
  );
  // Métricas de tráfego (M12, RN-92): mede a resposta de cada requisição pela rota molde.
  (app as NestExpressApplication).use(createHttpMetricsMiddleware(() => app.get(HttpMetricsStore)));
}

/**
 * Contrato da API interna, com o frontend (docs/STACK-E-ARQUITETURA.md, §7). NÃO contém as rotas de
 * integração (CA-T.15): todos os módulos entram, menos o `IntegrationModule`.
 */
export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('ITS API')
    .setDescription('API do ITS – Sistema de Acompanhamento de Ideias.')
    .setVersion(appVersion)
    .build();
  const modules = [...app.get(ModulesContainer, { strict: false }).values()]
    .map((m) => m.metatype)
    .filter((m): m is NonNullable<typeof m> => !!m && m !== IntegrationModule);
  return SwaggerModule.createDocument(app, config, { include: modules });
}

/** Contrato da API de integração (`/integration/v1`, RN-106): só o `IntegrationModule`, com o esquema Bearer. */
export function buildIntegrationOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('ITS Integration API')
    .setDescription(
      'Read-only API for other systems (Power Automate, n8n, BI, ERP). Send the token in the Authorization: Bearer header. ' +
        'API de leitura para outros sistemas; envie o token no cabeçalho Authorization: Bearer.',
    )
    .setVersion('v1')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'its_… (token de integração)' }, 'bearer')
    .build();
  return SwaggerModule.createDocument(app, config, { include: [IntegrationModule] });
}
