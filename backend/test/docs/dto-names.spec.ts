import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Nome de classe repetido vira UM esquema só no OpenAPI: o segundo apaga o primeiro, e o contrato (e os
 * tipos do frontend) passa a descrever o formato errado de uma das rotas. Foi o que aconteceu com
 * `CommentRequest` (ideias e mural) e `ReasonRequest` (ideias e loja), corrigidos no M23.
 *
 * A API interna e a de integração (`src/integration/`) são documentos separados: o mesmo nome em uma e
 * na outra não colide.
 */
const SRC = join(import.meta.dirname, '..', '..', 'src');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return name.endsWith('.ts') ? [path] : [];
  });
}

describe('Nomes dos esquemas do OpenAPI', () => {
  it('nenhuma classe exportada repete o nome dentro do mesmo documento (interno ou integração)', () => {
    const seen = new Map<string, string[]>();
    for (const file of files(SRC)) {
      const doc = relative(SRC, file).replaceAll('\\', '/').startsWith('integration/') ? 'integração' : 'interno';
      for (const match of readFileSync(file, 'utf8').matchAll(/^export class (\w+)/gm)) {
        const key = `${doc}:${match[1]}`;
        seen.set(key, [...(seen.get(key) ?? []), relative(SRC, file).replaceAll('\\', '/')]);
      }
    }
    const repeated = [...seen]
      .filter(([, where]) => where.length > 1)
      .map(([key, where]) => `${key} em ${where.join(', ')}`);
    expect(repeated).toEqual([]);
  });
});
