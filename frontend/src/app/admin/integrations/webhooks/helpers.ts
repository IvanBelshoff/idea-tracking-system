/** Só o servidor do endereço: o caminho e a consulta podem trazer segredo, então a lista não os mostra. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

/** `idea.submitted` → `idea_submitted`, a chave do texto (o ponto separa níveis no i18n). */
export const eventKey = (type: string) => type.replace('.', '_');

/** O estado de uma assinatura: ativa, suspensa pelo administrador ou suspensa por falhas (RN-118, RN-121). */
export function statusKey(sub: { status: string; suspendedReason: string | null }): 'active' | 'admin' | 'failures' {
  if (sub.status === 'active') return 'active';
  return sub.suspendedReason === 'failures' ? 'failures' : 'admin';
}
