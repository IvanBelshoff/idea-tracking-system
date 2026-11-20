import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

interface Service {
  image?: string;
  build?: unknown;
  ports?: string[];
  networks?: string[];
  environment?: Record<string, string>;
  pull_policy?: string;
}
interface Compose {
  name?: string;
  services: Record<string, Service>;
  networks?: Record<string, { internal?: boolean } | null>;
  volumes?: Record<string, unknown>;
}

/** Os arquivos do Compose ficam na raiz do repositório (M28). */
const raw = (file: string): string => readFileSync(join(process.cwd(), '..', file), 'utf8');
const read = (file: string): Compose => parse(raw(file)) as Compose;
/** A rede de um serviço sem `networks` é a padrão. */
const nets = (s: Service | undefined) => s?.networks ?? ['default'];

describe('Compose: nome do projeto e banco só na rede interna (M19, RN-140, CA-T.21)', () => {
  const base = read('docker-compose.yml');
  const dev = read('docker-compose.dev.yml');

  it('CA-RN-140.1 o projeto se chama its, com os volumes do banco e dos anexos', () => {
    expect(base.name).toBe('its');
    expect(Object.keys(base.volumes ?? {}).sort()).toEqual(['pgdata', 'storage']);
  });

  it('CA-RN-140.2 o Compose base não publica nenhuma porta do banco; só o web publica porta (negativo)', () => {
    expect(base.services.db?.ports).toBeUndefined();
    const publishing = Object.entries(base.services)
      .filter(([, s]) => (s.ports?.length ?? 0) > 0)
      .map(([name]) => name);
    expect(publishing).toEqual(['web']);
  });

  it('CA-RN-140.3 o banco só está na rede interna, que não tem saída; web e ajuda não a enxergam; API e worker usam as duas', () => {
    expect(base.networks?.internal?.internal).toBe(true);
    expect(nets(base.services.db)).toEqual(['internal']);
    for (const outside of ['web', 'docs']) expect(nets(base.services[outside])).not.toContain('internal');
    for (const inside of ['api', 'worker']) expect(nets(base.services[inside]).sort()).toEqual(['default', 'internal']);
  });

  it('CA-RN-140.4 a exceção de desenvolvimento publica o banco só em 127.0.0.1 (nunca 0.0.0.0)', () => {
    const ports = dev.services.db?.ports ?? [];
    expect(ports.length).toBeGreaterThan(0);
    for (const p of ports) expect(p, p).toMatch(/^127\.0\.0\.1:\d+:5432$/);
    // Mantém a rede interna (a rede padrão é só para a publicação funcionar).
    expect(nets(dev.services.db)).toContain('internal');
    // E não publica mais nada além do banco.
    expect(Object.keys(dev.services)).toEqual(['db']);
  });
});

describe('Compose: imagens prontas e .env obrigatório (M28, RN-140)', () => {
  const base = read('docker-compose.yml');
  const build = read('docker-compose.build.yml');
  const SERVICES = ['api', 'worker', 'web', 'docs'];

  it('CA-RN-140.6 o Compose de instalação só usa imagens publicadas, na versão escolhida, sem montar nada', () => {
    for (const name of SERVICES) {
      const s = base.services[name];
      expect(s?.build, name).toBeUndefined();
      expect(s?.image, name).toMatch(
        /^\$\{ITS_REGISTRY:-ghcr\.io\/ivanbelshoff\}\/its-(api|web|ajuda):\$\{ITS_VERSION:-1\}$/,
      );
    }
    // A API e o worker usam a mesma imagem (sempre na mesma versão).
    expect(base.services.worker?.image).toBe(base.services.api?.image);
  });

  it('CA-RN-140.7 sem POSTGRES_PASSWORD ou APP_SECRET_KEY o Compose para com uma mensagem (sem senha padrão)', () => {
    const text = raw('docker-compose.yml');
    expect(text).toMatch(/\$\{POSTGRES_PASSWORD:\?[^}]+\}/);
    expect(text).toMatch(/\$\{APP_SECRET_KEY:\?[^}]+\}/);
    // Nenhuma forma da senha com valor padrão.
    expect(text).not.toMatch(/\$\{(POSTGRES_PASSWORD|APP_SECRET_KEY):?-/);
    // E o modelo do .env traz os dois vazios: copiar sem preencher não sobe.
    const example = raw('.env.example');
    expect(example).toMatch(/^POSTGRES_PASSWORD=$/m);
    expect(example).toMatch(/^APP_SECRET_KEY=$/m);
  });

  it('CA-RN-140.8 a sobreposição de build monta API, site e ajuda do código, e o worker reaproveita a imagem da API', () => {
    for (const name of ['api', 'web', 'docs']) expect(build.services[name]?.build, name).toBeDefined();
    expect(build.services.api?.image).toBe('its-api:local');
    expect(build.services.worker).toMatchObject({ image: 'its-api:local', pull_policy: 'never' });
    // Ela só muda de onde vêm as imagens: nada de portas, redes ou variáveis.
    for (const s of Object.values(build.services)) {
      expect(s.ports).toBeUndefined();
      expect(s.networks).toBeUndefined();
      expect(s.environment).toBeUndefined();
    }
  });
});
