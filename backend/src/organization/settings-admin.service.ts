import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { type DataSource, IsNull } from 'typeorm';
import { AuditService } from '../audit/audit.service.js';
import { apiError } from '../common/api-error.js';
import { isEmailActive } from '../communication/mail.js';
import type { RequestMeta } from '../identity-access/auth-context.js';
import { SsoProvider, type SsoProviderId } from '../identity-access/entities/sso-provider.entity.js';
import { initializeBalances, storeInitialized } from '../store/store-core.js';
import { type DerivedBrand, deriveBrand } from './brand-color.js';
import { logoVersions } from './branding.service.js';
import { OrgEntity } from './entities/org-entity.entity.js';
import { Setting } from './entities/setting.entity.js';
import { type LoginScreenPublic, loginScreenPublic } from './login-screen.service.js';
import { type BrandFont, SETTING_DEFAULTS } from './settings.js';
import { SettingsService } from './settings.service.js';
import { EDITABLE_KEYS, EDITABLE_SETTINGS, type EditableSettingKey, isEditableSetting } from './settings-rules.js';

export interface SettingItem {
  key: EditableSettingKey;
  value: unknown;
  defaultValue: unknown;
  updatedAt: string | null;
}

export interface PublicSettings {
  organizationName: string;
  defaultLocale: string;
  helpUrl: string;
  timezone: string;
  passwordPolicy: { minLength: number; minClasses: number };
  ideas: { categoryRequired: boolean };
  attachments: { maxMb: number; allowedExtensions: string[] };
  emailEnabled: boolean;
  /** Login corporativo (M13): o modo e só os provedores ligados; nunca cliente, tenant ou segredo. */
  sso: { mode: 'password' | 'password_sso' | 'sso'; providers: SsoProviderId[] };
  publicLookupEnabled: boolean;
  profilePhotoMaxMb: number;
  currency: string;
  recognition: { enabled: boolean; individualRanking: boolean };
  mural: { enabled: boolean };
  store: { enabled: boolean };
  branding: DerivedBrand;
  logo: { light: string | null; dark: string | null };
  font: BrandFont;
  /** Tela de login (M23, RN-176 a RN-179): só o que a própria tela mostra. */
  login: LoginScreenPublic;
}

/**
 * Tela de configurações do administrador (permissão `setting.manage`). Cada alteração é validada
 * pela regra da chave e registrada na auditoria com o valor anterior e o novo (CA-RN-39.1).
 * O nome da organização e o nome da entidade raiz andam juntos.
 */
@Injectable()
export class SettingsAdminService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<SettingItem[]> {
    const rows = new Map((await this.dataSource.getRepository(Setting).find()).map((r) => [r.key, r]));
    return EDITABLE_KEYS.map((key) => {
      const row = rows.get(key);
      return {
        key,
        value: row ? row.value : SETTING_DEFAULTS[key],
        defaultValue: SETTING_DEFAULTS[key],
        updatedAt: row?.updatedAt.toISOString() ?? null,
      };
    });
  }

  /** O que qualquer visitante pode saber (tela de login, assistente, página de nova senha). */
  async publicSettings(): Promise<PublicSettings> {
    const s = await this.settings.getMany([
      'organization.name',
      'organization.default_locale',
      'help.docs_url',
      'organization.timezone',
      'auth.password_min_length',
      'auth.password_min_classes',
      'ideas.category_required',
      'attachments.max_mb',
      'attachments.allowed_extensions',
      'email.app_url',
      'public.lookup_enabled',
      'profile.photo_max_mb',
      'results.currency',
      'recognition.enabled',
      'recognition.individual_ranking',
      'mural.enabled',
      'store.enabled',
      'branding.color',
      'branding.color_dark',
      'branding.font',
      'auth.login_mode',
    ]);
    const mode = s['auth.login_mode'];
    const enabled =
      mode === 'password'
        ? []
        : await this.dataSource
            .getRepository(SsoProvider)
            .find({ where: { enabled: true }, order: { provider: 'ASC' } });
    return {
      organizationName: s['organization.name'],
      defaultLocale: s['organization.default_locale'],
      helpUrl: s['help.docs_url'],
      timezone: s['organization.timezone'],
      passwordPolicy: { minLength: s['auth.password_min_length'], minClasses: s['auth.password_min_classes'] },
      ideas: { categoryRequired: s['ideas.category_required'] },
      attachments: { maxMb: s['attachments.max_mb'], allowedExtensions: s['attachments.allowed_extensions'] },
      // Liga o "Esqueci minha senha" na tela de login.
      publicLookupEnabled: s['public.lookup_enabled'],
      currency: s['results.currency'],
      recognition: {
        enabled: s['recognition.enabled'],
        individualRanking: s['recognition.individual_ranking'],
      },
      mural: { enabled: s['mural.enabled'] },
      store: { enabled: s['store.enabled'] },
      branding: deriveBrand(s['branding.color'], s['branding.color_dark']),
      logo: await logoVersions(this.dataSource.manager),
      font: s['branding.font'],
      login: await loginScreenPublic(this.dataSource.manager),
      profilePhotoMaxMb: s['profile.photo_max_mb'],
      emailEnabled: s['email.app_url'] !== '' && (await isEmailActive(this.dataSource.manager)),
      sso: { mode, providers: enabled.map((p) => p.provider) },
    };
  }

  /** Altera várias chaves de uma vez (tudo ou nada). Chave desconhecida ou valor fora da regra → 400. */
  async update(actorId: string, meta: RequestMeta, values: Record<string, unknown>): Promise<SettingItem[]> {
    const parsed: [EditableSettingKey, unknown][] = [];
    const problems: { key: string; message: string }[] = [];
    for (const [key, raw] of Object.entries(values)) {
      if (!isEditableSetting(key)) {
        problems.push({ key, message: 'Configuração inexistente ou não editável.' });
        continue;
      }
      const result = EDITABLE_SETTINGS[key].safeParse(raw);
      if (result.success) parsed.push([key, result.data]);
      else problems.push({ key, message: result.error.issues[0]?.message ?? 'Valor inválido.' });
    }
    if (problems.length > 0) throw apiError(400, 'validation_failed', 'Configurações inválidas.', problems);
    if (parsed.length === 0) throw apiError(400, 'validation_failed', 'Informe ao menos uma configuração.');

    // A loja exige o reconhecimento (RN-159): sem pontos não há o que trocar.
    const next = async (key: 'store.enabled' | 'recognition.enabled') =>
      (parsed.find(([k]) => k === key)?.[1] as boolean | undefined) ?? (await this.settings.get(key));
    if ((await next('store.enabled')) && !(await next('recognition.enabled'))) {
      throw apiError(
        422,
        'store_requires_recognition',
        'A loja só funciona com o reconhecimento ligado. Ligue o reconhecimento antes (ou desligue a loja antes de desligá-lo).',
      );
    }

    await this.dataSource.transaction(async (m) => {
      for (const [key, value] of parsed) {
        const before = await this.settings.get(key, m);
        if (JSON.stringify(before) === JSON.stringify(value)) continue;
        await this.settings.set(key, value as never, actorId, m);
        // Primeira vez que a loja liga (RN-161): o saldo nasce igual aos pontos já ganhos.
        if (key === 'store.enabled' && value === true && !(await storeInitialized(m))) {
          const people = await initializeBalances(m, actorId);
          await this.settings.set('store.initialized_at', new Date().toISOString(), actorId, m);
          await this.audit.record(
            {
              action: 'store.initialized',
              actorId,
              targetType: 'setting',
              targetId: key,
              data: { people },
              ip: meta.ip,
            },
            m,
          );
        }
        if (key === 'organization.name') {
          await m.getRepository(OrgEntity).update({ parent: IsNull() }, { name: value as string });
        }
        await this.audit.record(
          {
            action: 'setting.updated',
            actorId,
            targetType: 'setting',
            targetId: key,
            data: { key, before, after: value },
            ip: meta.ip,
          },
          m,
        );
      }
    });
    return this.list();
  }
}
