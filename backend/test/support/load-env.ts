import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Carrega o .env local (se existir). Em CI as variáveis já vêm do ambiente.
if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

// Anexos dos testes num diretório temporário (nunca no armazenamento real).
process.env.STORAGE_DIR = mkdtempSync(join(tmpdir(), 'its-test-storage-'));

// Chave fixa só para os testes (segredos cifrados no banco temporário); nunca a do .env real.
process.env.APP_SECRET_KEY = 'chave-fixa-somente-para-testes-0123456789';

// Pool pequeno por API de teste (o padrão é 10): os arquivos de teste rodam em paralelo.
process.env.DB_POOL_MAX = '4';
