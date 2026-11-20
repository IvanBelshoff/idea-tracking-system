import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// O SWC é necessário para os decoradores do NestJS/TypeORM (emitDecoratorMetadata).
export default defineConfig({
  test: {
    include: ['test/**/*.spec.ts'],
    environment: 'node',
    // Cada arquivo de teste cria o seu próprio banco temporário; os arquivos podem rodar em paralelo.
    // Teto de arquivos simultâneos: cada um segura ~8 conexões (API, banco do teste, administração),
    // e o PostgreSQL aceita 100. Sem o teto, uma máquina com muitos núcleos estoura o limite e a API
    // de teste responde 500 em arquivos aleatórios.
    maxWorkers: 8,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    setupFiles: ['test/support/load-env.ts'],
  },
  plugins: [
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        target: 'es2023',
        parser: { syntax: 'typescript', decorators: true },
        // useDefineForClassFields=false: senão os campos de classe sobrescrevem os acessores do TypeORM.
        transform: { legacyDecorator: true, decoratorMetadata: true, useDefineForClassFields: false },
      },
    }),
  ],
});
