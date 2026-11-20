import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, it } from 'node:test';

/**
 * CA-RN-174.5: toda ação que grava (`useMutation`) declara o aviso de sucesso (`meta.success`) ou diz
 * que a tela já mostra o resultado na hora (`meta.silent`). Ação nova sem nada declarado quebra aqui.
 */
const ROOT = join(import.meta.dirname, '..');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(ts|tsx)$/.test(name) && !name.endsWith('.test.ts') && !name.endsWith('.d.ts') ? [path] : [];
  });
}

/** O texto dos argumentos de cada `useMutation(...)`, contando os parênteses. */
function mutationCalls(source: string): { line: number; args: string }[] {
  const calls: { line: number; args: string }[] = [];
  const pattern = /\buseMutation\(/g;
  for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
    let depth = 1;
    let index = match.index + match[0].length;
    while (index < source.length && depth > 0) {
      const char = source[index];
      if (char === '(') depth += 1;
      else if (char === ')') depth -= 1;
      index += 1;
    }
    calls.push({
      line: source.slice(0, match.index).split('\n').length,
      args: source.slice(match.index + match[0].length, index - 1),
    });
  }
  return calls;
}

describe('Aviso de toda ação (CA-RN-174.5)', () => {
  it('CA-RN-174.5 toda ação declara meta.success ou meta.silent', () => {
    const missing: string[] = [];
    let total = 0;
    for (const file of files(ROOT)) {
      for (const call of mutationCalls(readFileSync(file, 'utf8'))) {
        total += 1;
        if (!/\bmeta:\s*\{[^}]*\b(success|silent)\b/s.test(call.args)) {
          missing.push(`${relative(ROOT, file).replaceAll('\\', '/')}:${call.line}`);
        }
      }
    }
    assert.ok(total > 100, `a varredura achou só ${total} ações: o padrão de busca quebrou`);
    assert.deepEqual(missing, [], `ações sem aviso declarado:\n${missing.join('\n')}`);
  });
});
