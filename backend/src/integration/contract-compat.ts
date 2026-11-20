/**
 * Contrato congelado do `v1` (RN-106, CA-RN-106.10): compara o OpenAPI de referência (o que está
 * versionado em `openapi-integration.json`) com o atual e lista o que QUEBRA quem já integra:
 * rota ou método removido, parâmetro removido, obrigatório novo, campo removido, tipo mudado ou
 * campo que passou a ser obrigatório. Acréscimos (rota nova, campo novo opcional) passam.
 * Regra pura, sem Nest.
 */
type Json = Record<string, unknown>;
const METHODS = ['get', 'put', 'post', 'delete', 'patch', 'options', 'head'];

const obj = (v: unknown): Json => (v && typeof v === 'object' ? (v as Json) : {});

function resolve(doc: Json, node: Json): Json {
  const ref = node.$ref;
  if (typeof ref !== 'string') return node;
  const name = ref.replace('#/components/schemas/', '');
  return obj(obj(obj(doc.components).schemas)[name]);
}

/** O "formato" de um esquema, para comparar tipos: tipo, formato, enum e se aceita nulo. */
function shape(doc: Json, node: Json): string {
  const ref = node.$ref;
  if (typeof ref === 'string') return `ref:${ref}`;
  const items = node.items ? `[${shape(doc, obj(node.items))}]` : '';
  const en = Array.isArray(node.enum) ? `enum:${(node.enum as unknown[]).join('|')}` : '';
  return `${String(node.type ?? '')}${node.format ? `/${String(node.format)}` : ''}${node.nullable ? '?' : ''}${items}${en}`;
}

function compareSchema(
  ref: Json,
  cur: Json,
  refNode: Json,
  curNode: Json,
  path: string,
  out: string[],
  seen: Set<string>,
): void {
  const a = resolve(ref, refNode);
  const b = resolve(cur, curNode);
  const refName = typeof refNode.$ref === 'string' ? refNode.$ref : null;
  if (refName) {
    if (seen.has(`${path}|${refName}`)) return;
    seen.add(`${path}|${refName}`);
  }
  if (a.items && b.items) {
    compareSchema(ref, cur, obj(a.items), obj(b.items), `${path}[]`, out, seen);
  }
  const aProps = obj(a.properties);
  const bProps = obj(b.properties);
  const bRequired = new Set(Array.isArray(b.required) ? (b.required as string[]) : []);
  const aRequired = new Set(Array.isArray(a.required) ? (a.required as string[]) : []);
  for (const [name, aProp] of Object.entries(aProps)) {
    const here = `${path}.${name}`;
    const bProp = bProps[name];
    if (!bProp) {
      out.push(`Campo removido: ${here}`);
      continue;
    }
    const aShape = shape(ref, obj(aProp));
    const bShape = shape(cur, obj(bProp));
    if (aShape !== bShape) out.push(`Tipo mudou em ${here}: ${aShape} → ${bShape}`);
    else compareSchema(ref, cur, obj(aProp), obj(bProp), here, out, seen);
  }
  for (const name of bRequired)
    if (!aRequired.has(name) && name in aProps) out.push(`Campo passou a ser obrigatório: ${path}.${name}`);
}

/** Lista as mudanças incompatíveis entre o contrato de referência e o atual. Vazia = só acréscimos. */
export function breakingChanges(reference: object, current: object): string[] {
  const ref = reference as Json;
  const cur = current as Json;
  const out: string[] = [];
  const refPaths = obj(ref.paths);
  const curPaths = obj(cur.paths);
  for (const [path, refItem] of Object.entries(refPaths)) {
    const curItem = obj(curPaths[path]);
    if (!curPaths[path]) {
      out.push(`Rota removida: ${path}`);
      continue;
    }
    for (const method of METHODS) {
      const refOp = obj(obj(refItem)[method]);
      if (Object.keys(refOp).length === 0) continue;
      const curOp = obj(curItem[method]);
      const here = `${method.toUpperCase()} ${path}`;
      if (Object.keys(curOp).length === 0) {
        out.push(`Método removido: ${here}`);
        continue;
      }
      const curParams = new Map(
        (Array.isArray(curOp.parameters) ? curOp.parameters : []).map((p) => [`${obj(p).in}:${obj(p).name}`, obj(p)]),
      );
      for (const p of Array.isArray(refOp.parameters) ? refOp.parameters : []) {
        const key = `${obj(p).in}:${obj(p).name}`;
        if (!curParams.has(key)) out.push(`Parâmetro removido: ${here} ${key}`);
      }
      const refRequired = new Set(
        (Array.isArray(refOp.parameters) ? refOp.parameters : [])
          .filter((p) => obj(p).required)
          .map((p) => `${obj(p).in}:${obj(p).name}`),
      );
      for (const [key, p] of curParams)
        if (p.required && !refRequired.has(key)) out.push(`Parâmetro novo obrigatório: ${here} ${key}`);
      const refOk = obj(obj(obj(obj(obj(refOp.responses)['200']).content)['application/json']).schema);
      const curOk = obj(obj(obj(obj(obj(curOp.responses)['200']).content)['application/json']).schema);
      if (Object.keys(refOk).length > 0) {
        if (Object.keys(curOk).length === 0) out.push(`Resposta 200 removida: ${here}`);
        else compareSchema(ref, cur, refOk, curOk, here, out, new Set());
      }
    }
  }
  return out;
}
