/**
 * Descrição do contrato nos dois idiomas (RN-115): `description` em inglês (padrão do contrato) e
 * `x-description-pt-BR` em português. Um teste falha se alguma rota, parâmetro ou campo ficar sem
 * uma das duas (CA-RN-115.11). A tela de documentação mostra a do idioma da pessoa.
 */
export const PT_KEY = 'x-description-pt-BR';

export function bi(en: string, pt: string): { description: string; 'x-description-pt-BR': string } {
  return { description: en, [PT_KEY]: pt };
}
