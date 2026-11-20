import { Body, Controller, Param, Post, Put, UseInterceptors } from '@nestjs/common';
import {
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProperty,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { ApiErrorBody, parseInput } from '../../common/api-error.js';
import { bi, PT_KEY } from '../api/bilingual.js';
import { IntegrationApi } from '../api/decorators.js';
import { CurrentIntegration, type IntegrationPrincipal } from '../principal.js';
import { IdempotencyInterceptor } from './idempotency.js';
import { type IdeaSubmitResult, IntegrationWriteService } from './write.service.js';
import { CommentWriteSchema, ExternalRefSchema, GainWriteSchema, IdeaSubmitSchema } from './write-schemas.js';

// --- Contrato -----------------------------------------------------------------------------------

export class IdeaSubmitRequest {
  @ApiProperty({
    example: 'maria.souza@empresa.com.br',
    ...bi(
      'E-mail of the active person who authors the idea. She must be allowed to submit ideas to the entity; otherwise the call is refused.',
      'E-mail da pessoa ativa que é a autora da ideia. Ela precisa poder enviar ideias para a entidade; senão a chamada é recusada.',
    ),
  })
  author_email!: string;
  @ApiProperty({ maxLength: 200, example: 'Trocar o rolo da esteira', ...bi('Title of the idea.', 'Título da ideia.') })
  title!: string;
  @ApiProperty({
    maxLength: 10_000,
    example: 'O rolo atual trava a cada semana.',
    ...bi('Description of the current situation.', 'Descrição da situação atual.'),
  })
  description!: string;
  @ApiProperty({
    format: 'uuid',
    ...bi(
      'Entity that receives the idea. It must be inside the integration scope and active.',
      'Entidade que recebe a ideia. Precisa estar no escopo da integração e ativa.',
    ),
  })
  entity_id!: string;
  @ApiProperty({
    format: 'uuid',
    required: false,
    nullable: true,
    ...bi(
      'Main category. Required when the installation requires a category.',
      'Categoria principal. Obrigatória quando a instalação exige categoria.',
    ),
  })
  category_id?: string | null;
  @ApiProperty({
    format: 'uuid',
    required: false,
    nullable: true,
    ...bi('Campaign to link the idea to, if it is eligible.', 'Campanha à qual ligar a ideia, se for elegível.'),
  })
  campaign_id?: string | null;
  @ApiProperty({
    maxLength: 10_000,
    required: false,
    nullable: true,
    ...bi('Proposed solution.', 'Solução proposta.'),
  })
  proposed_solution?: string | null;
  @ApiProperty({
    maxLength: 100,
    required: false,
    nullable: true,
    example: 'CHAMADO-4711',
    ...bi('Reference in your own system (ticket number, etc.).', 'Referência no seu sistema (número do chamado etc.).'),
  })
  external_ref?: string | null;
}

export class IdeaSubmitResponse {
  @ApiProperty({ example: 'ITS-2026-0042', ...bi('Identifier of the new idea.', 'Identificador da ideia nova.') })
  code!: string;
  @ApiProperty({
    example: 'submitted',
    ...bi('Situation of the idea: always `submitted`.', 'Situação da ideia: sempre `submitted`.'),
  })
  status!: string;
  @ApiProperty({ format: 'uuid', ...bi('Entity that received the idea.', 'Entidade que recebeu a ideia.') })
  entity_id!: string;
}

export class CommentWriteRequest {
  @ApiProperty({
    maxLength: 5000,
    example: 'Chamado atendido pela equipe de manutenção.',
    ...bi(
      'Text of the comment (up to 5000 characters). It is always public.',
      'Texto do comentário (até 5000 caracteres). É sempre público.',
    ),
  })
  body!: string;
}

export class CommentWriteResponse {
  @ApiProperty({ format: 'uuid', ...bi('Identifier of the comment.', 'Identificador do comentário.') }) id!: string;
  @ApiProperty({ example: 'ITS-2026-0042', ...bi('Identifier of the idea.', 'Identificador da ideia.') })
  idea_code!: string;
  @ApiProperty({ format: 'date-time', ...bi('When the comment was recorded.', 'Quando o comentário foi gravado.') })
  created_at!: string;
}

export class ExternalRefRequest {
  @ApiProperty({
    type: String,
    nullable: true,
    maxLength: 100,
    example: 'CHAMADO-4711',
    ...bi(
      'New reference (up to 100 characters), or null to clear it.',
      'Referência nova (até 100 caracteres), ou nulo para limpar.',
    ),
  })
  external_ref!: string | null;
}

export class ExternalRefResponse {
  @ApiProperty({ example: 'ITS-2026-0042', ...bi('Identifier of the idea.', 'Identificador da ideia.') })
  idea_code!: string;
  @ApiProperty({ type: String, nullable: true, ...bi('Reference now stored.', 'Referência agora gravada.') })
  external_ref!: string | null;
}

export class GainWriteRequest {
  @ApiProperty({
    enum: ['once', 'monthly', 'yearly'],
    ...bi('How often the gain happens.', 'Com que frequência o ganho acontece.'),
  })
  periodicity!: string;
  @ApiProperty({
    required: false,
    example: 'BRL',
    ...bi(
      'Currency (ISO 4217). Default: the installation currency.',
      'Moeda (ISO 4217). Padrão: a moeda da instalação.',
    ),
  })
  currency?: string;
  @ApiProperty({
    type: Number,
    nullable: true,
    required: false,
    example: 12000,
    ...bi(
      'Estimated gain. Only while the idea is submitted or in review.',
      'Ganho estimado. Só enquanto a ideia está enviada ou em análise.',
    ),
  })
  estimated?: number | null;
  @ApiProperty({
    type: Number,
    nullable: true,
    required: false,
    example: 9000,
    ...bi(
      'Realized gain. Only after the idea is implemented.',
      'Ganho realizado. Só depois de a ideia ser implementada.',
    ),
  })
  realized?: number | null;
  @ApiProperty({
    type: Number,
    nullable: true,
    required: false,
    example: 3000,
    ...bi('Implementation cost.', 'Custo de implementação.'),
  })
  implementation_cost?: number | null;
}

export class GainWriteResponse {
  @ApiProperty({ example: 'ITS-2026-0042', ...bi('Identifier of the idea.', 'Identificador da ideia.') })
  idea_code!: string;
  @ApiProperty({
    example: 'declared',
    ...bi('Always `declared`: only a person validates a gain.', 'Sempre `declared`: só uma pessoa valida um ganho.'),
  })
  status!: string;
}

const KEY_TEXT = bi(
  'Unique key of this call (1 to 64 characters: letters, digits, - and _). Repeating the call with the same key and body returns the same response without recording again; valid for 24 hours.',
  'Chave única desta chamada (1 a 64 caracteres: letras, números, - e _). Repetir a chamada com a mesma chave e o mesmo corpo devolve a mesma resposta sem gravar de novo; vale por 24 horas.',
);
const KEY_DOCS = {
  name: 'Idempotency-Key',
  required: true,
  description: KEY_TEXT.description,
  extensions: { [PT_KEY]: KEY_TEXT[PT_KEY] },
  schema: { type: 'string', minLength: 1, maxLength: 64, pattern: '^[A-Za-z0-9_-]+$' },
};
const OPTIONAL_KEY_DOCS = { ...KEY_DOCS, required: false };
const CODE = { name: 'code', example: 'ITS-2026-0042', ...bi('Identifier of the idea.', 'Identificador da ideia.') };

const errors = (description: string) => ApiUnprocessableEntityResponse({ type: ApiErrorBody, description });

// --- Rotas --------------------------------------------------------------------------------------

@Controller('integration/v1/ideas')
@IntegrationApi('ideas_write')
@UseInterceptors(IdempotencyInterceptor)
export class IdeasWriteApiController {
  constructor(private readonly writes: IntegrationWriteService) {}

  @Post()
  @ApiOperation({
    summary: 'Submit an idea',
    ...bi(
      'Submits an idea in the name of the person identified by `author_email`, with the same rules and notices as the screen. The idea is born `submitted`; the integration never triages, approves or decides.',
      'Envia uma ideia em nome da pessoa indicada em `author_email`, com as mesmas regras e avisos da tela. A ideia nasce `submitted`; a integração nunca tria, aprova nem decide.',
    ),
  })
  @ApiHeader(KEY_DOCS)
  @ApiBody({ type: IdeaSubmitRequest })
  @ApiCreatedResponse({ type: IdeaSubmitResponse })
  @errors(
    'Invalid data, entity outside the scope, unknown author or author not allowed to submit, or a missing Idempotency-Key.',
  )
  submit(@CurrentIntegration() p: IntegrationPrincipal, @Body() body: unknown): Promise<IdeaSubmitResult> {
    return this.writes.submitIdea(p, parseInput(IdeaSubmitSchema, body, 422));
  }

  @Post(':code/comments')
  @ApiOperation({
    summary: 'Comment on an idea',
    ...bi(
      'Adds a public comment in the name of the integration ("via Integration X"). Allowed on closed ideas, as on the screen. Never internal.',
      'Acrescenta um comentário público em nome da integração ("via Integração X"). Permitido em ideia encerrada, como na tela. Nunca interno.',
    ),
  })
  @ApiParam(CODE)
  @ApiHeader(KEY_DOCS)
  @ApiBody({ type: CommentWriteRequest })
  @ApiCreatedResponse({ type: CommentWriteResponse })
  @errors('Empty or too long text, unknown field, or a missing Idempotency-Key.')
  comment(
    @CurrentIntegration() p: IntegrationPrincipal,
    @Param('code') code: string,
    @Body() body: unknown,
  ): Promise<CommentWriteResponse> {
    return this.writes.comment(p, code, parseInput(CommentWriteSchema, body, 422).body);
  }

  @Put(':code/external-ref')
  @ApiOperation({
    summary: 'Update the external reference',
    ...bi(
      'Sets (or clears, with null) the reference to your own system. Not allowed on closed ideas (409).',
      'Define (ou limpa, com nulo) a referência ao seu sistema. Não vale em ideia encerrada (409).',
    ),
  })
  @ApiParam(CODE)
  @ApiHeader(OPTIONAL_KEY_DOCS)
  @ApiBody({ type: ExternalRefRequest })
  @ApiOkResponse({ type: ExternalRefResponse })
  @ApiConflictResponse({ type: ApiErrorBody, description: 'Closed idea (idea_closed).' })
  @errors('Reference with more than 100 characters or unknown field.')
  externalRef(
    @CurrentIntegration() p: IntegrationPrincipal,
    @Param('code') code: string,
    @Body() body: unknown,
  ): Promise<ExternalRefResponse> {
    return this.writes.setExternalRef(p, code, parseInput(ExternalRefSchema, body, 422).external_ref);
  }
}

@Controller('integration/v1/ideas')
@IntegrationApi('gains_write')
@UseInterceptors(IdempotencyInterceptor)
export class GainsWriteApiController {
  constructor(private readonly writes: IntegrationWriteService) {}

  @Put(':code/gain')
  @ApiOperation({
    summary: 'Declare a gain',
    ...bi(
      'Records the declared gain of an idea, with the same rules as the screen. It stays declared: only a person validates it, and a gain already validated is never overwritten (409).',
      'Registra o ganho declarado de uma ideia, com as mesmas regras da tela. Ele fica declarado: só uma pessoa o valida, e um ganho já validado nunca é sobrescrito (409).',
    ),
  })
  @ApiParam(CODE)
  @ApiHeader(OPTIONAL_KEY_DOCS)
  @ApiBody({ type: GainWriteRequest })
  @ApiOkResponse({ type: GainWriteResponse })
  @ApiConflictResponse({
    type: ApiErrorBody,
    description: 'Gain already validated, estimate or realized value not allowed in this situation, or closed idea.',
  })
  @errors('Invalid periodicity, negative value or unknown field.')
  declare(
    @CurrentIntegration() p: IntegrationPrincipal,
    @Param('code') code: string,
    @Body() body: unknown,
  ): Promise<GainWriteResponse> {
    return this.writes.declareGain(p, code, parseInput(GainWriteSchema, body, 422));
  }
}
