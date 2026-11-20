import { Check, Column, Entity } from 'typeorm';
import { EditableEntity } from '../../database/base.entity.js';

/** Origem da foto mostrada (RN-144). */
export const PHOTO_SOURCES = ['upload', 'microsoft', 'google'] as const;
export type PhotoSource = (typeof PHOTO_SOURCES)[number];
export type PhotoChoice = PhotoSource | 'default';

/** Tema da interface escolhido pela pessoa (preferência da conta). */
export enum ThemePreference {
  System = 'system',
  Light = 'light',
  Dark = 'dark',
}

/** RN-41: usuário é desativado ou anonimizado, nunca excluído quando tem vínculos. */
export enum UserStatus {
  Active = 'active',
  Disabled = 'disabled',
  Anonymized = 'anonymized',
}

/** Usuário (RN-41, RN-42, RN-70). O login é somente por e-mail. */
@Entity('user')
@Check('ck_user_photo_choice', "photo_choice IN ('upload', 'microsoft', 'google', 'default')")
export class User extends EditableEntity {
  @Column({ type: 'citext', unique: true })
  email!: string;

  @Column({ type: 'varchar', length: 200 })
  name!: string;

  /** Argon2id. Nulo em usuários anonimizados. Nunca sai da API. */
  @Column({ name: 'password_hash', type: 'varchar', length: 255, nullable: true, select: false })
  passwordHash!: string | null;

  @Column({ type: 'enum', enum: UserStatus, enumName: 'user_status', default: UserStatus.Active })
  status!: UserStatus;

  /** Idioma da interface e dos e-mails (preferência da conta). */
  @Column({ type: 'varchar', length: 10, default: 'pt-BR' })
  locale!: string;

  /** Preferências de interface que acompanham a conta em qualquer navegador. */
  @Column({ type: 'enum', enum: ThemePreference, enumName: 'theme_preference', default: ThemePreference.System })
  theme!: ThemePreference;

  /** Menu lateral recolhido (só ícones) no computador. */
  @Column({ name: 'nav_collapsed', type: 'boolean', default: false })
  navCollapsed!: boolean;

  /**
   * Quantos dias antes do vencimento a pessoa quer o alerta de prazo (RN-29). Nulo = padrão da
   * instalação (`notifications.deadline_alert_days`).
   */
  @Column({ name: 'deadline_alert_days', type: 'int', nullable: true })
  deadlineAlertDays!: number | null;

  /** Opt-out de nome em mural, ranking e Hall (RN-70). */
  @Column({ name: 'hide_name', type: 'boolean', default: false })
  hideName!: boolean;

  /**
   * Qual foto mostrar (RN-144): a enviada (`upload`, padrão), a de um provedor do login corporativo ou a
   * padrão com as iniciais (`default`). Nada troca sozinho: só a pessoa (ou quem administra) escolhe.
   */
  @Column({ name: 'photo_choice', type: 'varchar', length: 20, default: 'upload' })
  photoChoice!: PhotoChoice;

  /** Cor e fonte escolhidas pela pessoa (RN-145); nulo = a da organização. Valem só com a chave ligada. */
  @Column({ name: 'ui_color', type: 'varchar', length: 20, nullable: true })
  uiColor!: string | null;

  @Column({ name: 'ui_font', type: 'varchar', length: 20, nullable: true })
  uiFont!: string | null;

  /** Bloqueio temporário após falhas seguidas (RN-42). */
  @Column({ name: 'failed_attempts', type: 'int', default: 0 })
  failedAttempts!: number;

  @Column({ name: 'locked_until', type: 'timestamptz', nullable: true })
  lockedUntil!: Date | null;

  @Column({ name: 'last_login_at', type: 'timestamptz', nullable: true })
  lastLoginAt!: Date | null;

  @Column({ name: 'anonymized_at', type: 'timestamptz', nullable: true })
  anonymizedAt!: Date | null;
}
