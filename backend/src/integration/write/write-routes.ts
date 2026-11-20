/**
 * As rotas de escrita da API de integração (M18, RN-126 a RN-132): as ÚNICAS que aceitam outro método
 * além de `GET`. O middleware de `/integration` usa esta lista para responder `405` (com o `Allow` do
 * método certo) a tudo o mais, e nada fora dela chega a gravar. Não há rota para decidir, validar,
 * arquivar, excluir, destacar ou mexer em pessoas e configurações (RN-132).
 */
const BASE = '/integration/v1/ideas';
const CODE = '[^/]+';

const ROUTES: { method: 'POST' | 'PUT'; pattern: RegExp; readable: boolean }[] = [
  { method: 'POST', pattern: new RegExp(`^${BASE}/?$`), readable: true },
  { method: 'POST', pattern: new RegExp(`^${BASE}/${CODE}/comments/?$`), readable: false },
  { method: 'PUT', pattern: new RegExp(`^${BASE}/${CODE}/external-ref/?$`), readable: false },
  { method: 'PUT', pattern: new RegExp(`^${BASE}/${CODE}/gain/?$`), readable: false },
];

/** Os métodos de escrita que a rota aceita (vazio = rota só de leitura ou inexistente). */
export function writeMethodsOf(path: string): string[] {
  return ROUTES.filter((r) => r.pattern.test(path)).map((r) => r.method);
}

/** O `Allow` de uma rota: a leitura (quando existe `GET`) mais a escrita declarada. */
export function allowOf(path: string): string {
  const writes = ROUTES.filter((r) => r.pattern.test(path));
  const get = writes.length === 0 || writes.some((r) => r.readable);
  return [...(get ? ['GET'] : []), ...writes.map((r) => r.method)].join(', ');
}
