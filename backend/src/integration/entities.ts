import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { CreatedEntity, EditableEntity } from '../database/base.entity.js';
import { User } from '../identity-access/entities/user.entity.js';
import { OrgEntity } from '../organization/entities/org-entity.entity.js';
import { INTEGRATION_MODULES, type IntegrationModuleId, type IntegrationStatus } from './modules.js';

const MODULE_LIST = INTEGRATION_MODULES.map((m) => `'${m}'`).join(', ');

/**
 * Integração: um sistema externo que lê dados do ITS pela API de integração (RN-103). É uma
 * identidade de serviço, NÃO um usuário: sem perfil, sem sessão, sem senha. O acesso efetivo é a
 * interseção entre os módulos ligados, os módulos da integração, o escopo e as regras de negócio.
 */
@Entity('integration')
@Check('ck_integration_status', "status IN ('active', 'suspended', 'revoked')")
@Check('ck_integration_rate', 'rate_per_minute BETWEEN 1 AND 600')
@Check('ck_integration_ip_count', 'cardinality(ip_allowlist) <= 20')
@Check('ck_integration_modules', `modules <@ ARRAY[${MODULE_LIST}]::text[]`)
export class Integration extends EditableEntity {
  @Column({ type: 'varchar', length: 120 })
  name!: string;

  /** O nome em minúsculas, único: não se diferencia maiúscula de minúscula (CA-RN-103.1). */
  @Column({ name: 'name_key', type: 'varchar', length: 120, unique: true })
  nameKey!: string;

  /** Texto livre: quem responde por esta integração. */
  @Column({ type: 'varchar', length: 200, default: '' })
  owner!: string;

  @Column({ type: 'varchar', length: 12, default: 'active' })
  status!: IntegrationStatus;

  /** Só os módulos que a integração pode usar (subconjunto dos ligados; RN-102). */
  @Column({ type: 'text', array: true, default: () => `'{}'` })
  modules!: IntegrationModuleId[];

  /** O módulo Usuários devolve o e-mail só com esta opção (RN-112); desligada de fábrica. */
  @Column({ name: 'include_email', type: 'boolean', default: false })
  includeEmail!: boolean;

  @Column({ name: 'rate_per_minute', type: 'int', default: 60 })
  ratePerMinute!: number;

  /** IPs ou faixas CIDR aceitos (até 20); vazio = qualquer origem (RN-103). */
  @Column({ name: 'ip_allowlist', type: 'text', array: true, default: () => `'{}'` })
  ipAllowlist!: string[];

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById!: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by_id' })
  createdBy!: User | null;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;
}

/** Escopo da integração: as entidades que ela enxerga, com ou sem subentidades (RN-103). */
@Entity('integration_scope')
export class IntegrationScope {
  @PrimaryColumn({ name: 'integration_id', type: 'uuid' })
  integrationId!: string;

  @PrimaryColumn({ name: 'entity_id', type: 'uuid' })
  entityId!: string;

  @Column({ name: 'include_children', type: 'boolean', default: false })
  includeChildren!: boolean;

  @ManyToOne(() => Integration, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'integration_id' })
  integration!: Integration;

  @ManyToOne(() => OrgEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'entity_id' })
  entity!: OrgEntity;
}

/**
 * Token de uma integração (RN-104). Só o hash e um prefixo curto ficam no banco; o valor completo
 * aparece uma única vez. Validade obrigatória, de no máximo 365 dias.
 */
@Entity('integration_token')
@Check('ck_integration_token_validity', "expires_at <= created_at + interval '365 days'")
export class IntegrationToken extends CreatedEntity {
  @Index()
  @Column({ name: 'integration_id', type: 'uuid' })
  integrationId!: string;

  @ManyToOne(() => Integration, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'integration_id' })
  integration!: Integration;

  /** SHA-256 do token, em hexadecimal (como `session.token_hash`). */
  @Column({ name: 'token_hash', type: 'varchar', length: 64, unique: true })
  tokenHash!: string;

  /** `its_` mais 4 caracteres: só para a pessoa reconhecer o token na tela. Nunca decide acesso. */
  @Column({ type: 'varchar', length: 8 })
  prefix!: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  /** Fim da sobreposição de um token que foi girado (nunca depois de `expires_at`). */
  @Column({ name: 'retire_at', type: 'timestamptz', nullable: true })
  retireAt!: Date | null;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  /** Gravada no máximo uma vez por minuto (CA-RN-104.10). */
  @Column({ name: 'last_used_at', type: 'timestamptz', nullable: true })
  lastUsedAt!: Date | null;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById!: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by_id' })
  createdBy!: User | null;
}

/**
 * O consumo de uma hora de uma integração em um módulo (RN-113). Uma linha por (`hour`,
 * `integration_id`, `module`); a gravação é aditiva. Sem URL crua, parâmetro, IP ou identificador
 * de pessoa ou de ideia (CA-RN-113.9). Falha de autenticação não entra aqui.
 */
@Entity('integration_hour')
@Check('ck_integration_hour_module', `module IN (${MODULE_LIST})`)
export class IntegrationHour {
  /** Início da hora, em UTC. */
  @PrimaryColumn({ type: 'timestamptz' })
  hour!: Date;

  @PrimaryColumn({ name: 'integration_id', type: 'uuid' })
  integrationId!: string;

  @PrimaryColumn({ type: 'varchar', length: 20 })
  module!: IntegrationModuleId;

  @Column({ type: 'int', default: 0 })
  requests!: number;

  @Column({ name: 'errors_4xx', type: 'int', default: 0 })
  errors4xx!: number;

  @Column({ name: 'errors_5xx', type: 'int', default: 0 })
  errors5xx!: number;

  /** Respostas 429 (também contam nos 4xx). */
  @Column({ name: 'rate_limited', type: 'int', default: 0 })
  rateLimited!: number;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @ManyToOne(() => Integration, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'integration_id' })
  integration!: Integration;
}

/**
 * Chave de idempotência de uma escrita (M18, RN-131): (`integration_id`, `route`, `key`). A chave é
 * reservada com `INSERT ... ON CONFLICT DO NOTHING`, então duas chamadas simultâneas nunca gravam duas
 * vezes. Guarda só o resumo do corpo (SHA-256) e a resposta mínima, nunca o corpo da chamada.
 */
@Entity('integration_idempotency')
@Check('ck_integration_idempotency_state', "state IN ('in_progress', 'done')")
export class IntegrationIdempotency {
  @PrimaryColumn({ name: 'integration_id', type: 'uuid' })
  integrationId!: string;

  /** Método e caminho da chamada (com o código da ideia, quando há). */
  @PrimaryColumn({ type: 'varchar', length: 200 })
  route!: string;

  @PrimaryColumn({ type: 'varchar', length: 64 })
  key!: string;

  @Column({ name: 'request_hash', type: 'varchar', length: 64 })
  requestHash!: string;

  @Column({ type: 'varchar', length: 12 })
  state!: 'in_progress' | 'done';

  @Column({ type: 'int', nullable: true })
  status!: number | null;

  @Column({ type: 'jsonb', nullable: true })
  response!: unknown;

  @Index('ix_integration_idempotency_created')
  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;
}
