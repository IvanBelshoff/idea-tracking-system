import { Controller, Get, Injectable, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProperty } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { CurrentIntegration, type IntegrationPrincipal } from '../principal.js';
import { bi } from './bilingual.js';
import { IntegrationApi, PageQueryDocs } from './decorators.js';
import { RefItem } from './ideas.api.js';
import { ISO_MICRO_SQL, type KeyRow, pagePredicates, parsePage, SqlParams, sliceRows } from './page.js';

// --- Contrato -----------------------------------------------------------------------------------

export class UserLink {
  @ApiProperty({ example: 'Analista', ...bi('Name of the role (profile).', 'Nome do perfil.') }) role!: string;
  @ApiProperty({
    type: RefItem,
    ...bi(
      'Entity where the role applies (always inside the scope).',
      'Entidade em que o perfil vale (sempre dentro do escopo).',
    ),
  })
  entity!: RefItem;
  @ApiProperty({
    example: true,
    ...bi('The role also covers the sub-entities.', 'O perfil vale também para as subentidades.'),
  })
  include_children!: boolean;
}

export class UserCustomField {
  @ApiProperty({ format: 'uuid', ...bi('Field identifier.', 'Identificador do campo.') }) field_id!: string;
  @ApiProperty({ example: 'Matrícula', ...bi('Field name (Portuguese).', 'Nome do campo (português).') })
  label!: string;
  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Employee ID',
    ...bi('Field name in English, when set.', 'Nome do campo em inglês, quando existe.'),
  })
  label_en!: string | null;
  @ApiProperty({ example: '4521', ...bi('The value, or the chosen option.', 'O valor, ou a opção escolhida.') })
  value!: string;
}

export class UserItem {
  @ApiProperty({ format: 'uuid', ...bi('Identifier.', 'Identificador.') }) id!: string;
  @ApiProperty({ example: 'Maria Souza', ...bi('Display name.', 'Nome de exibição.') }) name!: string;
  @ApiProperty({
    enum: ['active', 'disabled'],
    ...bi('Situation. Anonymized people never appear.', 'Situação. Quem foi anonimizado nunca aparece.'),
  })
  status!: string;
  @ApiProperty({
    type: String,
    required: false,
    example: 'maria.souza@empresa.com.br',
    ...bi(
      'E-mail. Present ONLY when the integration has "include e-mail" turned on; otherwise the field does not exist.',
      'E-mail. Só existe quando a integração tem "incluir e-mail" ligado; sem isso o campo nem aparece.',
    ),
  })
  email?: string;
  @ApiProperty({
    type: [UserLink],
    ...bi('Roles, cut to the integration scope.', 'Perfis, cortados ao escopo da integração.'),
  })
  links!: UserLink[];
  @ApiProperty({
    type: [UserCustomField],
    ...bi(
      'Custom fields marked "goes to integrations" (sensitive ones never). Empty when there are none.',
      'Campos personalizados marcados "sai na integração" (os sensíveis nunca). Vazio quando não há.',
    ),
  })
  custom_fields!: UserCustomField[];
  @ApiProperty({ type: String, format: 'date-time', ...bi('Last change.', 'Última alteração.') }) updated_at!: string;
}

export class UserPage {
  @ApiProperty({ type: [UserItem], ...bi('The items of this page.', 'Os itens desta página.') }) data!: UserItem[];
  @ApiProperty({
    type: String,
    nullable: true,
    ...bi('Cursor of the next page; null on the last page.', 'Cursor da próxima página; nulo na última.'),
  })
  next_cursor!: string | null;
}

// --- Leitura ------------------------------------------------------------------------------------

@Injectable()
export class UsersReader {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Pessoas com perfil em entidade do escopo (RN-112). Anonimizados não aparecem. Os vínculos vêm
   * cortados ao escopo. Nunca: senha, hash, sessão, identificador de login corporativo, foto, último
   * acesso, idioma. O e-mail só com a opção da integração.
   */
  async list(principal: IntegrationPrincipal, query: unknown): Promise<UserPage> {
    const page = parsePage(query);
    const p = new SqlParams();
    const predicates = pagePredicates('x', p, page);
    // Mudar um campo que sai na integração também conta como alteração da pessoa (RN-202).
    const sync = `GREATEST(u.updated_at, max(s.created_at), (SELECT max(v.updated_at) FROM user_field_value v
      JOIN user_field f ON f.id = v.field_id WHERE v.user_id = u.id AND f.active AND f.integration AND NOT f.sensitive))`;
    const rows: KeyRow[] = await this.dataSource.query(
      `SELECT x.id, x.cur_at FROM (
         SELECT u.id, ${sync} AS sync_at, ${ISO_MICRO_SQL(sync)} AS cur_at
           FROM "user" u JOIN user_role_scope s ON s.user_id = u.id
          WHERE u.status <> 'anonymized' AND s.entity_id = ANY(${p.add(principal.scopeEntityIds)}::uuid[])
          GROUP BY u.id
       ) x ${predicates.length > 0 ? `WHERE ${predicates.join(' AND ')}` : ''}
       ORDER BY x.sync_at ASC, x.id ASC LIMIT ${p.add(page.limit + 1)}`,
      p.values,
    );
    const { rows: kept, next } = sliceRows(rows, page.limit);
    if (kept.length === 0) return { data: [], next_cursor: null };
    const ids = kept.map((r) => r.id);
    const users: { id: string; name: string; email: string; status: string }[] = await this.dataSource.query(
      'SELECT id, name, email, status FROM "user" WHERE id = ANY($1::uuid[])',
      [ids],
    );
    const links: {
      user_id: string;
      role: string;
      entity_id: string;
      entity_name: string;
      include_children: boolean;
    }[] = await this.dataSource.query(
      `SELECT s.user_id, r.name AS role, e.id AS entity_id, e.name AS entity_name, s.include_children
           FROM user_role_scope s JOIN role r ON r.id = s.role_id JOIN entity e ON e.id = s.entity_id
          WHERE s.user_id = ANY($1::uuid[]) AND s.entity_id = ANY($2::uuid[])
          ORDER BY e.name, r.name`,
      [ids, principal.scopeEntityIds],
    );
    const custom: { user_id: string; field_id: string; label_pt: string; label_en: string | null; value: string }[] =
      await this.dataSource.query(
        `SELECT v.user_id, f.id AS field_id, f.label_pt, f.label_en, COALESCE(v.value, o.label) AS value
           FROM user_field_value v JOIN user_field f ON f.id = v.field_id
           LEFT JOIN user_field_option o ON o.id = v.option_id
          WHERE v.user_id = ANY($1::uuid[]) AND f.active AND f.integration AND NOT f.sensitive
          ORDER BY f.sort_order`,
        [ids],
      );
    const byId = new Map(users.map((u) => [u.id, u]));
    const data: UserItem[] = [];
    for (const row of kept) {
      const u = byId.get(row.id);
      if (!u) continue;
      const item: UserItem = {
        id: u.id,
        name: u.name,
        status: u.status,
        links: links
          .filter((l) => l.user_id === u.id)
          .map((l) => ({
            role: l.role,
            entity: { id: l.entity_id, name: l.entity_name },
            include_children: l.include_children,
          })),
        custom_fields: custom
          .filter((c) => c.user_id === u.id)
          .map((c) => ({ field_id: c.field_id, label: c.label_pt, label_en: c.label_en, value: c.value })),
        updated_at: row.cur_at,
      };
      if (principal.includeEmail) item.email = u.email;
      data.push(item);
    }
    return { data, next_cursor: next };
  }
}

@Controller('integration/v1/users')
@IntegrationApi('users')
export class UsersApiController {
  constructor(private readonly reader: UsersReader) {}

  @Get()
  @ApiOperation({
    summary: 'List users (sensitive)',
    ...bi(
      'People with a role in an entity of the scope, with the roles cut to the scope. The e-mail only comes if the integration has "include e-mail". Never returns passwords, sessions, single sign-on identifiers, photo or last access.',
      'Pessoas com perfil em entidade do escopo, com os perfis cortados ao escopo. O e-mail só vem se a integração tiver "incluir e-mail". Nunca devolve senha, sessão, identificador de login corporativo, foto nem último acesso.',
    ),
  })
  @PageQueryDocs()
  @ApiOkResponse({ type: UserPage })
  list(@CurrentIntegration() principal: IntegrationPrincipal, @Query() query: unknown): Promise<UserPage> {
    return this.reader.list(principal, query);
  }
}
