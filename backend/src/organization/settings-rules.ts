import { z } from 'zod';
import { isValidTimeZone } from '../common/dates.js';
import { BRAND_FONTS, type SettingKey } from './settings.js';

/**
 * O que o administrador pode alterar e dentro de que limites. Chaves fora desta lista (ex.:
 * `installation.completed_at`) são internas e não aparecem na tela. Os limites protegem a própria
 * instalação: senha mínima nunca abaixo de 8 (OWASP), bloqueio e sessão com teto razoável.
 */
/** Cor no formato #RRGGBB (o seletor de cor do navegador entrega assim). */
const hexColor = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Use uma cor no formato #RRGGBB')
  .transform((v) => v.toLowerCase());

export const EDITABLE_SETTINGS = {
  'organization.name': z.string().trim().min(1).max(200),
  'organization.timezone': z.string().refine(isValidTimeZone, 'Fuso horário inválido'),
  'organization.default_locale': z.enum(['pt-BR', 'en']),
  // Caminho no mesmo endereço (/ajuda/) ou um endereço https:// (ajuda hospedada em outro lugar).
  'help.docs_url': z
    .string()
    .trim()
    .max(300)
    .refine(
      (v) => /^\/(?!\/)[^\s?#]*$/.test(v) || /^https:\/\/[^\s/?#]+(\/[^\s?#]*)?$/i.test(v),
      'Use um caminho como /ajuda/ ou um endereço https://',
    )
    .transform((v) => (v.endsWith('/') ? v : `${v}/`)),
  'ideas.code_prefix': z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z][A-Z0-9]{1,7}$/, 'De 2 a 8 letras ou números, começando por letra'),
  'ideas.category_required': z.boolean(),
  'ideas.triage_shortcut': z.boolean(),
  'ideas.similar_show_titles': z.boolean(),
  'triage.sla_days': z.number().int().min(1).max(90),
  'triage.business_days': z.boolean(),
  'results.sustainment_days': z.number().int().min(0).max(730),
  'recognition.enabled': z.boolean(),
  'recognition.points_submitted': z.number().int().min(0).max(10_000),
  'recognition.points_approved': z.number().int().min(0).max(10_000),
  'recognition.points_implemented': z.number().int().min(0).max(10_000),
  'recognition.points_highlighted': z.number().int().min(0).max(10_000),
  'recognition.author_share': z.number().int().min(0).max(100),
  'recognition.converged_coauthorship': z.boolean(),
  'recognition.individual_ranking': z.boolean(),
  'hall.likes_enabled': z.boolean(),
  'hall.show_gain': z.boolean(),
  'hall.allow_in_progress': z.boolean(),
  'hall.auto_entry': z.boolean(),
  'hall.suggest_min_gain': z.number().int().min(0).max(100_000_000),
  'hall.suggest_min_likes': z.number().int().min(0).max(100_000),
  'mural.enabled': z.boolean(),
  'store.enabled': z.boolean(),
  'store.expiry_months': z.number().int().min(0).max(60),
  'approval.on_reject': z.enum(['return', 'block']),
  'approval.email_code': z.boolean(),
  'approval.allow_outside_domains': z.boolean(),
  'approval.default_days': z.number().int().min(1).max(60),
  'branding.color': hexColor.nullable(),
  'branding.color_dark': hexColor.nullable(),
  'branding.font': z.enum(BRAND_FONTS),
  'branding.user_theme': z.boolean(),
  'results.currency': z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, 'Use o código de 3 letras da moeda (ex.: BRL)'),
  'steps.progress_mode': z.enum(['steps', 'time']),
  'attachments.max_mb': z.number().int().min(1).max(50),
  'attachments.allowed_extensions': z
    .array(
      z
        .string()
        .trim()
        .toLowerCase()
        .regex(/^[a-z0-9]{1,10}$/, 'Extensão inválida'),
    )
    .min(1)
    .max(50)
    // Nunca aceitar extensões executáveis, mesmo que o admin peça.
    .refine(
      (list) =>
        !list.some((e) => ['exe', 'bat', 'cmd', 'com', 'msi', 'sh', 'ps1', 'js', 'html', 'htm', 'svg'].includes(e)),
      'Extensão não permitida por segurança',
    )
    .transform((list) => [...new Set(list)]),
  'public.lookup_enabled': z.boolean(),
  'profile.photo_max_mb': z.number().int().min(1).max(10),
  'notifications.deadline_alert_days': z.number().int().min(1).max(30),
  'email.digest_time': z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use o formato HH:MM, de 00:00 a 23:59'),
  'email.app_url': z
    .string()
    .trim()
    .refine(
      (v) => v === '' || /^https?:\/\/[^\s/?#]+(\/[^\s?#]*)?$/i.test(v),
      'Informe um endereço http:// ou https://',
    )
    .transform((v) => v.replace(/\/+$/, '')),
  'auth.password_min_length': z.number().int().min(8).max(128),
  'auth.password_min_classes': z.number().int().min(1).max(4),
  'auth.max_failed_attempts': z.number().int().min(3).max(20),
  'auth.lockout_minutes': z.number().int().min(1).max(1440),
  'auth.session_hours': z.number().int().min(1).max(720),
  'auth.sso_session_hours': z.number().int().min(1).max(720),
  'auth.reset_link_minutes': z.number().int().min(10).max(10_080),
  'ops.retention_days': z.number().int().min(1).max(90),
} satisfies Partial<Record<SettingKey, z.ZodType>>;

export type EditableSettingKey = keyof typeof EDITABLE_SETTINGS;
export const EDITABLE_KEYS = Object.keys(EDITABLE_SETTINGS) as EditableSettingKey[];

export function isEditableSetting(key: string): key is EditableSettingKey {
  return Object.hasOwn(EDITABLE_SETTINGS, key);
}
