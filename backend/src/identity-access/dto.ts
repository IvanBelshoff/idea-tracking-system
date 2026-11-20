import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';
import { isValidTimeZone } from '../common/dates.js';
import { BrandingView, BrandPairView } from '../organization/settings.dto.js';
import { BRAND_FONTS, type BrandFont } from '../organization/settings.js';
import { USER_THEME_KEYS } from '../organization/user-theme.js';
import { ThemePreference, type User } from './entities/user.entity.js';
import { ALL_PERMISSIONS, type Permission } from './permissions.js';

/*
 * Contratos de entrada e saída. A validação real é o Zod; as classes descrevem o OpenAPI
 * (de onde o frontend gera os tipos).
 */

const email = z.string().trim().toLowerCase().pipe(z.email().max(254));
/** Teto alto só para não processar entradas absurdas; a política fica no serviço (CA-RN-42.1). */
const password = z.string().min(1).max(1024);

export const InstallSchema = z.object({
  organizationName: z.string().trim().min(1).max(200),
  timezone: z.string().refine(isValidTimeZone, 'Fuso horário inválido'),
  locale: z.enum(['pt-BR', 'en']),
  adminName: z.string().trim().min(1).max(200),
  adminEmail: email,
  password,
});

export class InstallRequest {
  @ApiProperty({ example: 'Ideias Vale Verde' }) organizationName!: string;
  @ApiProperty({ example: 'America/Sao_Paulo', description: 'Fuso IANA da instalação' }) timezone!: string;
  @ApiProperty({ enum: ['pt-BR', 'en'] }) locale!: 'pt-BR' | 'en';
  @ApiProperty({ example: 'Ana Souza' }) adminName!: string;
  @ApiProperty({ example: 'ana@example.org' }) adminEmail!: string;
  @ApiProperty({ format: 'password' }) password!: string;
}

export class InstallStatusResponse {
  @ApiProperty() installed!: boolean;
}

export const LoginSchema = z.object({ email, password });

export class LoginRequest {
  @ApiProperty({ example: 'ana@example.org' }) email!: string;
  @ApiProperty({ format: 'password' }) password!: string;
}

export const ChangePasswordSchema = z.object({ currentPassword: password, newPassword: password });

export class ChangePasswordRequest {
  @ApiProperty({ format: 'password' }) currentPassword!: string;
  @ApiProperty({ format: 'password' }) newPassword!: string;
}

export const RedeemResetSchema = z.object({ token: z.string().min(20).max(200), newPassword: password });

export class RedeemResetRequest {
  @ApiProperty({ description: 'Token do link de recuperação' }) token!: string;
  @ApiProperty({ format: 'password' }) newPassword!: string;
}

export const PreferencesSchema = z
  .object({
    locale: z.enum(['pt-BR', 'en']),
    theme: z.enum(ThemePreference),
    navCollapsed: z.boolean(),
    hideName: z.boolean(),
    /** Cor da paleta curada e fonte da própria tela (RN-145); nulo = a da organização. */
    uiColor: z.enum(USER_THEME_KEYS).nullable(),
    uiFont: z.enum(BRAND_FONTS).nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Informe ao menos uma preferência');

export class PreferencesRequest {
  @ApiProperty({ enum: ['pt-BR', 'en'], required: false }) locale?: 'pt-BR' | 'en';
  @ApiProperty({ enum: ThemePreference, enumName: 'ThemePreference', required: false }) theme?: ThemePreference;
  @ApiProperty({ required: false, description: 'Menu lateral recolhido no computador' }) navCollapsed?: boolean;
  @ApiProperty({ required: false, description: 'Ocultar o nome em murais e rankings (RN-70)' }) hideName?: boolean;
  @ApiProperty({
    enum: USER_THEME_KEYS,
    required: false,
    nullable: true,
    description: 'Cor da paleta curada (RN-145); nulo = a da organização. Só com a chave ligada',
  })
  uiColor?: string | null;
  @ApiProperty({
    enum: BRAND_FONTS,
    required: false,
    nullable: true,
    description: 'Fonte (RN-145); nulo = a da organização',
  })
  uiFont?: BrandFont | null;
}

export class PaletteColorView {
  @ApiProperty({ enum: USER_THEME_KEYS }) key!: string;
  @ApiProperty({ type: BrandPairView }) light!: BrandPairView;
  @ApiProperty({ type: BrandPairView }) dark!: BrandPairView;
}

/** Aparência da própria tela (RN-145). */
export class AppearanceView {
  @ApiProperty({ description: 'A organização deixa cada pessoa escolher a cor e a fonte' }) allowed!: boolean;
  @ApiProperty({ enum: USER_THEME_KEYS, nullable: true, description: 'Escolhida (nula = a da organização)' })
  color!: string | null;
  @ApiProperty({ enum: BRAND_FONTS, nullable: true }) font!: BrandFont | null;
  @ApiProperty({
    type: BrandingView,
    nullable: true,
    description: 'A marca derivada da cor escolhida (só com a chave ligada)',
  })
  branding!: BrandingView | null;
  @ApiProperty({ type: [PaletteColorView], description: 'A paleta curada (vazia com a chave desligada)' })
  palette!: PaletteColorView[];
}

export const NO_APPEARANCE: AppearanceView = { allowed: false, color: null, font: null, branding: null, palette: [] };

export class AvatarVersionView {
  @ApiProperty({ description: 'Carimbo da foto atual; vai em ?v= para renovar o cache' }) version!: string;
}

/** Escolha da foto mostrada (RN-144). */
export const PhotoChoiceSchema = z.object({ choice: z.enum(['upload', 'microsoft', 'google', 'default']) });

export class PhotoChoiceRequest {
  @ApiProperty({ enum: ['upload', 'microsoft', 'google', 'default'], description: '`default` = as iniciais' })
  choice!: 'upload' | 'microsoft' | 'google' | 'default';
}

export class PhotoSourceView {
  @ApiProperty({ enum: ['upload', 'microsoft', 'google'] }) source!: 'upload' | 'microsoft' | 'google';
  @ApiProperty({ description: 'Carimbo; vai em ?v= em /photo/sources/{source}' }) version!: string;
}

export class PhotoOptionsView {
  @ApiProperty({ enum: ['upload', 'microsoft', 'google', 'default'] }) choice!:
    | 'upload'
    | 'microsoft'
    | 'google'
    | 'default';
  @ApiProperty({ type: [PhotoSourceView], description: 'As fotos guardadas (a enviada e as dos provedores)' })
  sources!: PhotoSourceView[];
}

export class MeResponse {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() email!: string;
  @ApiProperty({ enum: ['pt-BR', 'en'] }) locale!: string;
  @ApiProperty({ enum: ThemePreference, enumName: 'ThemePreference' }) theme!: ThemePreference;
  @ApiProperty({ description: 'Menu lateral recolhido no computador' }) navCollapsed!: boolean;
  @ApiProperty({ description: 'Oculta o nome em murais e rankings (RN-70)' }) hideName!: boolean;
  @ApiProperty({
    enum: ALL_PERMISSIONS,
    enumName: 'Permission',
    isArray: true,
    description: 'Permissões que o usuário tem em alguma entidade (para montar o menu; a API sempre confere de novo)',
  })
  permissions!: Permission[];
  @ApiProperty({ type: String, nullable: true, description: 'Versão da foto do perfil; nulo = sem foto (iniciais)' })
  photoVersion!: string | null;
  @ApiProperty({ type: AppearanceView }) appearance!: AppearanceView;
  @ApiProperty({
    description: 'Campos obrigatórios do cadastro ainda vazios (RN-197); acima de zero, a tela pede antes de seguir',
  })
  missingFields!: number;

  static from(
    user: User,
    permissions: Permission[] = [],
    photoVersion: string | null = null,
    appearance: AppearanceView = NO_APPEARANCE,
    missingFields = 0,
  ): MeResponse {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      locale: user.locale,
      theme: user.theme,
      navCollapsed: user.navCollapsed,
      hideName: user.hideName,
      permissions: [...permissions].sort(),
      photoVersion,
      appearance,
      missingFields,
    };
  }
}
