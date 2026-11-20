/**
 * CSV seguro para planilhas (RN-48). Dois cuidados:
 * - Injeção de fórmula (CA-RN-48.2): célula que começa com `=`, `+`, `-`, `@`, tabulação ou retorno
 *   de carro é lida como fórmula pelo Excel/LibreOffice. Recebe um apóstrofo na frente, que a
 *   planilha esconde e que impede a execução. Vale para texto digitado por pessoas (título, motivo).
 * - Separador `;` e BOM UTF-8: o Excel em português abre direto, com acentos corretos.
 */
const FORMULA_START = /^[=+\-@\t\r]/;

export function neutralize(value: string): string {
  return FORMULA_START.test(value) ? `'${value}` : value;
}

/** Uma célula: neutraliza fórmula e protege separador, aspas e quebra de linha. */
export function csvCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return '';
  // Número de verdade não é fórmula (ex.: -5); só texto passa pela neutralização.
  const text = typeof value === 'string' ? neutralize(value) : String(value);
  return /[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export const CSV_BOM = '﻿';

export function csvRow(cells: readonly (string | number | boolean | null | undefined)[]): string {
  return `${cells.map(csvCell).join(';')}\r\n`;
}
