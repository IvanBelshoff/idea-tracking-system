/**
 * Modelo da aba Documentação das integrações (M16, RN-115): transforma o OpenAPI do contrato
 * (`/api/admin/integrations/openapi`) em módulos, rotas, parâmetros, campos, um exemplo FICTÍCIO de
 * resposta e um `curl` com `SEU_TOKEN`. Funções puras, sem React: rodam nos testes do Node. A aba só
 * lê o contrato; nunca chama a API de integração e nunca mostra dado real nem token.
 */
type Json = Record<string, unknown>;

export type DocLang = 'pt-BR' | 'en';

export interface DocParam {
  name: string;
  /** `query` ou `path`. */
  place: string;
  required: boolean;
  type: string;
  description: string;
}

export interface DocField {
  name: string;
  type: string;
  nullable: boolean;
  description: string;
  children: DocField[];
}

export interface DocRoute {
  method: string;
  path: string;
  summary: string;
  description: string;
  params: DocParam[];
  fields: DocField[];
  example: unknown;
  /** O corpo da chamada, nas rotas de escrita (M18); nulo nas de leitura. */
  body: { fields: DocField[]; example: unknown } | null;
  curl: string;
}

export interface DocModule {
  id: string;
  routes: DocRoute[];
}

/** O marcador do token nos exemplos: nunca um token de verdade (CA-RN-115.9). */
export const TOKEN_PLACEHOLDER = 'SEU_TOKEN';
/** Endereço de exemplo quando o endereço do sistema ainda não foi informado. */
export const BASE_PLACEHOLDER = 'https://seu-endereco-do-its';

const MODULE_ORDER = [
  'ideas',
  'indicators',
  'campaigns',
  'hall',
  'entities',
  'users',
  'store',
  'ideas_write',
  'gains_write',
  'contract',
];
const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {});
const text = (v: unknown): string => (typeof v === 'string' ? v : '');

/** A descrição no idioma da pessoa; sem a tradução, a em inglês (o padrão do contrato). */
export function describe(node: unknown, lang: DocLang): string {
  const n = obj(node);
  if (lang === 'pt-BR') return text(n['x-description-pt-BR']) || text(n.description);
  return text(n.description);
}

function resolve(doc: Json, node: Json): Json {
  const ref = node.$ref;
  if (typeof ref !== 'string') {
    // O Nest escreve um campo que aponta para outro esquema, com descrição própria, como `allOf: [{ $ref }]`.
    const all = Array.isArray(node.allOf) ? (node.allOf as unknown[]) : null;
    return all && all.length === 1 ? resolve(doc, obj(all[0])) : node;
  }
  const name = ref.replace('#/components/schemas/', '');
  return obj(obj(obj(doc.components).schemas)[name]);
}

/** O tipo para a pessoa: `string`, `inteiro`..., com formato e lista; objeto e lista de objetos são nomeados pelo campo. */
export function typeLabel(doc: Json, node: Json, lang: DocLang): string {
  const n = resolve(doc, node);
  if (n.items) return `${lang === 'pt-BR' ? 'lista de ' : 'list of '}${typeLabel(doc, obj(n.items), lang)}`;
  const type = text(n.type);
  const format = text(n.format);
  if (Array.isArray(n.enum)) return (n.enum as unknown[]).map((e) => `"${String(e)}"`).join(' | ');
  if (type === 'integer') return lang === 'pt-BR' ? 'inteiro' : 'integer';
  if (type === 'number') return lang === 'pt-BR' ? 'número' : 'number';
  if (type === 'boolean') return lang === 'pt-BR' ? 'verdadeiro/falso' : 'boolean';
  if (type === 'object' || n.properties) return lang === 'pt-BR' ? 'objeto' : 'object';
  if (type === 'string') return format ? `string (${format})` : 'string';
  return type || (lang === 'pt-BR' ? 'valor' : 'value');
}

/** Os campos de um esquema, com os objetos aninhados até 2 níveis. */
export function fieldsOf(doc: Json, node: Json, lang: DocLang, depth = 0): DocField[] {
  const schema = resolve(doc, node);
  const target = schema.items ? resolve(doc, obj(schema.items)) : schema;
  const props = obj(target.properties);
  return Object.entries(props).map(([name, raw]) => {
    const prop = obj(raw);
    const inner = resolve(doc, prop.items ? obj(prop.items) : prop);
    const nested = depth < 2 && obj(inner.properties) && Object.keys(obj(inner.properties)).length > 0;
    return {
      name,
      type: typeLabel(doc, prop, lang),
      nullable: prop.nullable === true,
      description: describe(prop, lang) || describe(resolve(doc, prop), lang),
      children: nested ? fieldsOf(doc, prop.items ? obj(prop.items) : prop, lang, depth + 1) : [],
    };
  });
}

/**
 * Um exemplo FICTÍCIO de resposta, montado dos `example` do contrato (escritos à mão, com dados
 * inventados); o que não tem exemplo vira um valor neutro pelo tipo. Nunca vem do banco.
 */
export function exampleOf(doc: Json, node: Json, depth = 0): unknown {
  if (depth > 5) return null;
  const n = resolve(doc, node);
  if (n.example !== undefined) return n.example;
  if (n.items) return [exampleOf(doc, obj(n.items), depth + 1)];
  if (Array.isArray(n.enum) && n.enum.length > 0) return n.enum[0];
  const props = obj(n.properties);
  if (Object.keys(props).length > 0) {
    return Object.fromEntries(Object.entries(props).map(([k, v]) => [k, exampleOf(doc, obj(v), depth + 1)]));
  }
  switch (text(n.type)) {
    case 'integer':
    case 'number':
      return 0;
    case 'boolean':
      return false;
    case 'string':
      return text(n.format) === 'date-time'
        ? '2026-11-11T12:00:00Z'
        : text(n.format) === 'date'
          ? '2026-11-11'
          : 'texto';
    default:
      return null;
  }
}

/** O marcador da chave de idempotência nos exemplos de escrita (M18). */
export const IDEMPOTENCY_PLACEHOLDER = 'UMA-CHAVE-UNICA-123';

/**
 * O `curl` de uma rota, com o marcador no lugar do token e os parâmetros de caminho de exemplo. Nas
 * rotas de escrita (M18) leva o método, o `Idempotency-Key` e o corpo de exemplo (inventado).
 */
export function curlOf(
  base: string,
  path: string,
  params: readonly DocParam[],
  write?: { method: string; body: unknown },
): string {
  let url = path;
  for (const p of params)
    if (p.place === 'path') url = url.replace(`{${p.name}}`, p.name === 'code' ? 'ITS-2026-0042' : `{${p.name}}`);
  const query = !write && params.some((p) => p.place === 'query' && p.name === 'limit') ? '?limit=50' : '';
  const target = `"${base.replace(/\/+$/, '')}${url}${query}"`;
  if (!write) return `curl -H "Authorization: Bearer ${TOKEN_PLACEHOLDER}" ${target}`;
  // Aspas simples dentro do corpo viram `'\''`, como o shell exige.
  const json = JSON.stringify(write.body).replace(/'/g, "'\\''");
  return [
    `curl -X ${write.method}`,
    `-H "Authorization: Bearer ${TOKEN_PLACEHOLDER}"`,
    `-H "Idempotency-Key: ${IDEMPOTENCY_PLACEHOLDER}"`,
    '-H "Content-Type: application/json"',
    `-d '${json}'`,
    target,
  ].join(' \\\n  ');
}

function paramsOf(doc: Json, op: Json, lang: DocLang): DocParam[] {
  const raw = Array.isArray(op.parameters) ? (op.parameters as unknown[]) : [];
  return raw.map((p) => {
    const param = obj(p);
    const schema = obj(param.schema);
    return {
      name: text(param.name),
      place: text(param.in),
      required: param.required === true,
      // Parâmetro sem esquema declarado (identificadores, texto livre) é texto.
      type: Object.keys(schema).length === 0 ? 'string' : typeLabel(doc, schema, lang),
      description: describe(param, lang),
    };
  });
}

function successSchema(op: Json): Json {
  const responses = obj(op.responses);
  const ok = obj(responses['200'] ?? responses['201']);
  return obj(obj(obj(ok.content)['application/json']).schema);
}

function bodySchema(op: Json): Json {
  return obj(obj(obj(obj(op.requestBody).content)['application/json']).schema);
}

/** Módulos e rotas da documentação, na ordem do contrato (ideias, indicadores, ...), no idioma pedido. */
export function buildDocs(document: object, lang: DocLang): { baseUrl: string; modules: DocModule[] } {
  const doc = document as Json;
  const servers = Array.isArray(doc.servers) ? (doc.servers as Json[]) : [];
  const baseUrl = text(servers[0]?.url) || BASE_PLACEHOLDER;
  const byModule = new Map<string, DocRoute[]>();
  for (const [path, item] of Object.entries(obj(doc.paths))) {
    for (const method of METHODS) {
      const op = obj(obj(item)[method]);
      if (Object.keys(op).length === 0) continue;
      const tag = text((Array.isArray(op.tags) ? op.tags : [])[0]) || 'contract';
      const params = paramsOf(doc, op, lang);
      const schema = successSchema(op);
      const requestSchema = bodySchema(op);
      const hasBody = Object.keys(requestSchema).length > 0;
      const bodyExample = hasBody ? exampleOf(doc, requestSchema) : null;
      const route: DocRoute = {
        method: method.toUpperCase(),
        path,
        summary: text(op.summary),
        description: describe(op, lang),
        params,
        fields: Object.keys(schema).length > 0 ? fieldsOf(doc, dataItem(doc, schema), lang) : [],
        example: Object.keys(schema).length > 0 ? exampleOf(doc, schema) : null,
        body: hasBody ? { fields: fieldsOf(doc, requestSchema, lang), example: bodyExample } : null,
        curl: curlOf(baseUrl, path, params, hasBody ? { method: method.toUpperCase(), body: bodyExample } : undefined),
      };
      byModule.set(tag, [...(byModule.get(tag) ?? []), route]);
    }
  }
  const modules = [...byModule.entries()].sort(([a], [b]) => rank(a) - rank(b)).map(([id, routes]) => ({ id, routes }));
  return { baseUrl, modules };
}

/** Em lista com envelope `{ data: [item] }`, os campos documentados são os do item. */
function dataItem(doc: Json, schema: Json): Json {
  const s = resolve(doc, schema);
  const data = obj(obj(s.properties).data);
  return data.items ? obj(data.items) : schema;
}

function rank(id: string): number {
  const i = MODULE_ORDER.indexOf(id);
  return i === -1 ? MODULE_ORDER.length : i;
}
