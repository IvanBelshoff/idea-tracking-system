import type { OpenAPIObject } from '@nestjs/swagger';

/**
 * Filtra o contrato da API de integração pelos módulos permitidos (RN-106, RN-115): cada operação
 * leva uma tag com o código do módulo (`ideas`, `users`...) e as rotas do próprio contrato levam a
 * tag `contract`, sempre mantida. O resto é poda: caminhos sem operação, esquemas que ninguém
 * referencia mais e tags sem uso. Regra pura, sem Nest (testável no nível U).
 */
export const CONTRACT_TAG = 'contract';

type Json = Record<string, unknown>;
const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

export function filterContract(document: OpenAPIObject, allowedModules: readonly string[]): OpenAPIObject {
  const allowed = new Set([...allowedModules, CONTRACT_TAG]);
  const copy = structuredClone(document) as OpenAPIObject & { paths: Record<string, Json> };
  const usedTags = new Set<string>();

  for (const [path, item] of Object.entries(copy.paths)) {
    for (const method of HTTP_METHODS) {
      const op = item[method] as { tags?: string[] } | undefined;
      if (!op) continue;
      const tags = op.tags ?? [];
      if (tags.some((t) => allowed.has(t))) for (const t of tags) usedTags.add(t);
      else delete item[method];
    }
    if (!HTTP_METHODS.some((method) => item[method])) delete copy.paths[path];
  }

  const schemas = (copy.components?.schemas ?? {}) as Record<string, unknown>;
  const keep = new Set<string>();
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    if (!node || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node as Json)) {
      if (key === '$ref' && typeof value === 'string') {
        const name = value.replace('#/components/schemas/', '');
        if (!keep.has(name) && name in schemas) {
          keep.add(name);
          visit(schemas[name]);
        }
      } else visit(value);
    }
  };
  visit(copy.paths);
  for (const name of Object.keys(schemas)) if (!keep.has(name)) delete schemas[name];
  if (copy.tags) copy.tags = copy.tags.filter((t) => usedTags.has(t.name));
  return copy;
}
