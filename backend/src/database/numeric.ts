/** `numeric` volta do driver como texto (precisão exata); na aplicação vira `number`. */
export const numeric = {
  to: (v: number | null | undefined) => v,
  from: (v: string | null) => (v === null ? null : Number(v)),
};
