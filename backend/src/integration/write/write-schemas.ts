import { z } from 'zod';

/*
 * Corpos das quatro gravações da API de integração (M18, RN-127 a RN-130). Todos `strict`: campo
 * desconhecido (como `status` ou `author_id`) é recusado, nunca ignorado em silêncio (CA-RN-127.7).
 * Os limites são os da tela. Os nomes seguem o contrato da leitura (snake_case).
 */
const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

export const IdeaSubmitSchema = z
  .object({
    author_email: z.string().trim().toLowerCase().min(3).max(254),
    title: text(200),
    description: text(10_000),
    entity_id: z.uuid(),
    category_id: z.uuid().nullish(),
    campaign_id: z.uuid().nullish(),
    proposed_solution: optionalText(10_000),
    external_ref: optionalText(100),
  })
  .strict();
export type IdeaSubmitInput = z.infer<typeof IdeaSubmitSchema>;

export const CommentWriteSchema = z.object({ body: text(5000) }).strict();

export const ExternalRefSchema = z
  .object({
    external_ref: z
      .string()
      .trim()
      .max(100)
      .nullable()
      .transform((v) => (v ? v : null)),
  })
  .strict();

const amount = z.number().finite().min(0, 'Não pode ser negativo').max(1e11);

export const GainWriteSchema = z
  .object({
    periodicity: z.enum(['once', 'monthly', 'yearly']),
    currency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/)
      .optional(),
    estimated: amount.nullable().optional(),
    realized: amount.nullable().optional(),
    implementation_cost: amount.nullable().optional(),
  })
  .strict();
export type GainWriteInput = z.infer<typeof GainWriteSchema>;

/** A chave de idempotência (RN-131): 1 a 64 caracteres entre letras, números, `-` e `_`. */
export const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{1,64}$/;
export const isValidIdempotencyKey = (key: string) => IDEMPOTENCY_KEY.test(key);
