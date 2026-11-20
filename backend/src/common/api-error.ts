import { HttpException } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

/**
 * Mensagens padrão do Zod em pt-BR, no mesmo idioma das mensagens próprias das regras (M28). A tela em
 * inglês não usa este texto: traduz pelo `code` e pelos limites que vão em `details`.
 */
z.config(z.locales.ptBR());

/**
 * Formato único de erro da API: `code` estável (o frontend traduz por ele, pt-BR e en) e
 * `message` em pt-BR para quem lê o log ou chama a API direto.
 */
export class ApiErrorBody {
  @ApiProperty({ example: 'validation_failed' })
  code!: string;

  @ApiProperty({ example: 'Dados inválidos.' })
  message!: string;

  @ApiProperty({ required: false, description: 'Detalhes por campo (validação) ou regras não atendidas.' })
  details?: unknown;
}

export function apiError(status: number, code: string, message: string, details?: unknown): HttpException {
  const body: ApiErrorBody = { code, message, ...(details === undefined ? {} : { details }) };
  return new HttpException(body, status);
}

/**
 * Valida a entrada com Zod; falha → `validation_failed` com os campos problemáticos.
 * Padrão 400; as rotas de ideias usam 422, como pedem os critérios (CA-RN-03.1, 05.1, 06.1).
 */
export function parseInput<T extends z.ZodType>(schema: T, input: unknown, status = 400): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    // `origin`, `minimum` e `maximum` deixam a tela montar a mensagem no idioma de quem lê (M28).
    const details = result.error.issues.map((i) => ({
      path: i.path.join('.'),
      code: i.code,
      message: i.message,
      ...('origin' in i && typeof i.origin === 'string' ? { origin: i.origin } : {}),
      ...('minimum' in i ? { minimum: Number(i.minimum) } : {}),
      ...('maximum' in i ? { maximum: Number(i.maximum) } : {}),
    }));
    throw apiError(status, 'validation_failed', 'Dados inválidos.', details);
  }
  return result.data;
}
