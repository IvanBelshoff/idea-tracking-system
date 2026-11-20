import { Check, Column, Entity, Index, JoinColumn, ManyToOne, Unique } from 'typeorm';
import { CreatedEntity, EditableEntity } from '../../database/base.entity.js';
import { User } from '../../identity-access/entities/user.entity.js';
import { Integration } from '../entities.js';
import type { WebhookData } from './events.js';

export type SubscriptionStatus = 'active' | 'suspended';
export type SuspendedReason = 'admin' | 'failures';
export type DeliveryState = 'pending' | 'delivered' | 'failed';

/**
 * Assinatura de webhook de uma integração (RN-118): o endereço, os eventos e o estado. A URL pode
 * trazer segredo na consulta: só a tela do administrador a mostra; auditoria e logs guardam só o servidor.
 */
@Entity('webhook_subscription')
@Unique('uq_webhook_subscription_name', ['integrationId', 'name'])
@Check('ck_webhook_subscription_status', "status IN ('active', 'suspended')")
@Check('ck_webhook_subscription_reason', "suspended_reason IS NULL OR suspended_reason IN ('admin', 'failures')")
export class WebhookSubscription extends EditableEntity {
  @Index()
  @Column({ name: 'integration_id', type: 'uuid' })
  integrationId!: string;

  @ManyToOne(() => Integration, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'integration_id' })
  integration!: Integration;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Column({ type: 'text' })
  url!: string;

  /** Só os códigos da RN-119, de módulos que a integração tem. */
  @Column({ type: 'text', array: true, default: () => `'{}'` })
  events!: string[];

  @Column({ type: 'varchar', length: 12, default: 'active' })
  status!: SubscriptionStatus;

  @Column({ name: 'suspended_reason', type: 'varchar', length: 12, nullable: true })
  suspendedReason!: SuspendedReason | null;

  /** Falhas definitivas seguidas; um sucesso zera (RN-121). */
  @Column({ name: 'consecutive_failures', type: 'int', default: 0 })
  consecutiveFailures!: number;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById!: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by_id' })
  createdBy!: User | null;
}

/**
 * Segredo de assinatura (RN-120). Fica CIFRADO (o HMAC precisa dele em claro na hora de assinar, ao
 * contrário do token da API, que só tem hash). Validade obrigatória, de até 365 dias.
 */
@Entity('webhook_secret')
@Check('ck_webhook_secret_validity', "expires_at <= created_at + interval '365 days'")
export class WebhookSecret extends CreatedEntity {
  @Index()
  @Column({ name: 'subscription_id', type: 'uuid' })
  subscriptionId!: string;

  @ManyToOne(() => WebhookSubscription, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'subscription_id' })
  subscription!: WebhookSubscription;

  @Column({ name: 'secret_encrypted', type: 'bytea' })
  secretEncrypted!: Buffer;

  /** `whsec_` mais 4 caracteres: só para reconhecer o segredo na tela. */
  @Column({ type: 'varchar', length: 12 })
  prefix!: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  /** Fim da sobreposição de um segredo que foi girado. */
  @Column({ name: 'retire_at', type: 'timestamptz', nullable: true })
  retireAt!: Date | null;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;
}

/**
 * O evento (RN-119): a caixa de saída. Gravado na MESMA transação da mudança de negócio, só com
 * identificadores e estado. O `id` é o `X-ITS-Event-Id`.
 */
@Entity('webhook_event')
export class WebhookEvent extends CreatedEntity {
  @Column({ type: 'varchar', length: 40 })
  type!: string;

  @Column({ type: 'jsonb' })
  data!: WebhookData;

  /** A entidade da ideia, para o escopo. */
  @Column({ name: 'entity_id', type: 'uuid', nullable: true })
  entityId!: string | null;

  /** Quem causou o evento, quando foi uma integração (M18): ela não recebe o próprio eco (RN-133). */
  @Column({ name: 'origin_integration_id', type: 'uuid', nullable: true })
  originIntegrationId!: string | null;

  @ManyToOne(() => Integration, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'origin_integration_id' })
  originIntegration!: Integration | null;
}

/** Uma entrega: um evento para uma assinatura (RN-121, RN-122). Nunca guarda o corpo da resposta. */
@Entity('webhook_delivery')
@Unique('uq_webhook_delivery', ['eventId', 'subscriptionId'])
@Check('ck_webhook_delivery_state', "state IN ('pending', 'delivered', 'failed')")
@Index('ix_webhook_delivery_due', ['nextAttemptAt'], { where: "state = 'pending'" })
export class WebhookDelivery extends CreatedEntity {
  @Column({ name: 'event_id', type: 'uuid' })
  eventId!: string;

  @ManyToOne(() => WebhookEvent, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'event_id' })
  event!: WebhookEvent;

  @Index()
  @Column({ name: 'subscription_id', type: 'uuid' })
  subscriptionId!: string;

  @ManyToOne(() => WebhookSubscription, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'subscription_id' })
  subscription!: WebhookSubscription;

  @Column({ type: 'varchar', length: 10, default: 'pending' })
  state!: DeliveryState;

  @Column({ type: 'int', default: 0 })
  attempts!: number;

  @Column({ name: 'next_attempt_at', type: 'timestamptz', default: () => 'now()' })
  nextAttemptAt!: Date;

  /** Último código HTTP; nulo se nunca houve resposta. */
  @Column({ name: 'last_status', type: 'int', nullable: true })
  lastStatus!: number | null;

  /** Código curto (`timeout`, `connection`, `blocked_destination`, `redirect`...), nunca texto do destino. */
  @Column({ name: 'last_error', type: 'varchar', length: 40, nullable: true })
  lastError!: string | null;

  @Column({ name: 'delivered_at', type: 'timestamptz', nullable: true })
  deliveredAt!: Date | null;
}
