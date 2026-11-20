import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';
import { PageMeta, PageQuerySchema } from '../common/pagination.js';
import type { User } from './entities/user.entity.js';
import { UserStatus } from './entities/user.entity.js';
import type { UserRoleScope } from './entities/user-role-scope.entity.js';

const email = z.string().trim().toLowerCase().pipe(z.email().max(254));
const name = z.string().trim().min(1).max(200);
const locale = z.enum(['pt-BR', 'en']);

export const UserListQuerySchema = PageQuerySchema.extend({
  search: z.string().trim().max(200).optional(),
  status: z.enum(UserStatus).optional(),
  /** Só quem tem campo obrigatório vazio (RN-198). */
  incomplete: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  /** Opções de campos fechados (RN-200): a pessoa precisa ter todas. Repetido ou separado por vírgula. */
  options: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) =>
      v === undefined ? [] : (Array.isArray(v) ? v : v.split(',')).map((x) => x.trim()).filter(Boolean),
    )
    .pipe(z.array(z.uuid()).max(8)),
});

/** Sem idioma, a pessoa nasce com o idioma padrão da organização (organization.default_locale). */
export const CreateUserSchema = z.object({ name, email, locale: locale.optional() });
export const UpdateUserSchema = z
  .object({ name, email, locale })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Informe ao menos um campo');

export const ScopeInputSchema = z.object({
  roleId: z.uuid(),
  entityId: z.uuid(),
  includeChildren: z.boolean().default(true),
});
export const SetScopesSchema = z.object({ scopes: z.array(ScopeInputSchema).max(100) });

export class CreateUserRequest {
  @ApiProperty({ example: 'Bruno Lima' }) name!: string;
  @ApiProperty({ example: 'bruno@example.org' }) email!: string;
  @ApiProperty({ enum: ['pt-BR', 'en'], required: false, description: 'Sem ele, vale o idioma padrão da organização' })
  locale?: 'pt-BR' | 'en';
}

export class UpdateUserRequest {
  @ApiProperty({ required: false }) name?: string;
  @ApiProperty({ required: false }) email?: string;
  @ApiProperty({ enum: ['pt-BR', 'en'], required: false }) locale?: 'pt-BR' | 'en';
}

export class ScopeInput {
  @ApiProperty({ format: 'uuid' }) roleId!: string;
  @ApiProperty({ format: 'uuid' }) entityId!: string;
  @ApiProperty({ default: true, description: 'Inclui as sub-entidades' }) includeChildren!: boolean;
}

export class SetScopesRequest {
  @ApiProperty({ type: [ScopeInput], description: 'Substitui todos os perfis do usuário' }) scopes!: ScopeInput[];
}

export class NamedRef {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
}

/** Uma pessoa com a versão da foto (RN-142): nula = sem foto (ou foto oculta pelo opt-out), a tela mostra as iniciais. */
export class PersonWithPhoto extends NamedRef {
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Versão da foto (`/api/users/{id}/photo?v=`); nula = iniciais',
  })
  photoVersion!: string | null;
}

export class UserScope {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ type: NamedRef }) role!: NamedRef;
  @ApiProperty({ type: NamedRef }) entity!: NamedRef;
  @ApiProperty() includeChildren!: boolean;

  static from(s: UserRoleScope): UserScope {
    return {
      id: s.id,
      role: { id: s.role.id, name: s.role.name },
      entity: { id: s.entity.id, name: s.entity.name },
      includeChildren: s.includeChildren,
    };
  }
}

export class UserSummary {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() email!: string;
  @ApiProperty({ enum: UserStatus, enumName: 'UserStatus' }) status!: UserStatus;
  @ApiProperty({ enum: ['pt-BR', 'en'] }) locale!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) lastLoginAt!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: String, nullable: true, description: 'Versão da foto (RN-142); nula = iniciais' })
  photoVersion!: string | null;
  @ApiProperty({ description: 'Tem campo obrigatório vazio (RN-198)' }) incomplete!: boolean;

  static from(u: User, photoVersion: string | null = null, incomplete = false): UserSummary {
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      status: u.status,
      locale: u.locale,
      lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
      createdAt: u.createdAt.toISOString(),
      photoVersion,
      incomplete,
    };
  }
}

export class UserIdentityView {
  @ApiProperty({ enum: ['microsoft', 'google'] }) provider!: string;
  @ApiProperty({ format: 'date-time' }) linkedAt!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) lastLoginAt!: string | null;
}

export class UserDetail extends UserSummary {
  @ApiProperty({ type: [UserScope] }) scopes!: UserScope[];
  @ApiProperty({
    type: [UserIdentityView],
    description: 'Contas do login corporativo (Microsoft/Google) vinculadas a este usuário',
  })
  identities!: UserIdentityView[];
  @ApiProperty({ description: 'Pode entrar (e definir senha) por senha agora; falso no modo "Só SSO" (RN-97)' })
  canUsePassword!: boolean;
}

export class UserPage {
  @ApiProperty({ type: [UserSummary] }) items!: UserSummary[];
  @ApiProperty({ type: PageMeta }) meta!: PageMeta;
  @ApiProperty({ description: 'Quantos usuários do escopo têm cadastro incompleto (RN-198)' }) incompleteTotal!: number;
}

export class PasswordLink {
  @ApiProperty({ description: 'Token para a página "definir senha"; mostrado uma única vez' }) token!: string;
  @ApiProperty({ format: 'date-time' }) expiresAt!: string;
}

export class CreateUserResponse {
  @ApiProperty({ type: UserDetail }) user!: UserDetail;
  @ApiProperty({
    type: PasswordLink,
    nullable: true,
    description:
      'O usuário nasce sem senha; ele a define por este link. Nulo quando a pessoa entra só por login corporativo (RN-97)',
  })
  passwordLink!: PasswordLink | null;
}
