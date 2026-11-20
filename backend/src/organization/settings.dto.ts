import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';
import { LoginScreenPublicView } from './login-screen.dto.js';
import { BRAND_FONTS, type BrandFont } from './settings.js';
import { EDITABLE_KEYS } from './settings-rules.js';

export const UpdateSettingsSchema = z.object({ values: z.record(z.string(), z.unknown()) });

export class SettingItemView {
  @ApiProperty({ enum: EDITABLE_KEYS, enumName: 'SettingKey' }) key!: string;
  @ApiProperty({ description: 'Valor atual (JSON)' }) value!: unknown;
  @ApiProperty({ description: 'Valor de fábrica' }) defaultValue!: unknown;
  @ApiProperty({ type: String, format: 'date-time', nullable: true, description: 'Nulo = nunca alterado' })
  updatedAt!: string | null;
}

export class UpdateSettingsRequest {
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    example: { 'auth.lockout_minutes': 30, 'organization.name': 'Ideias Vale Verde' },
  })
  values!: Record<string, unknown>;
}

export class PasswordPolicyView {
  @ApiProperty() minLength!: number;
  @ApiProperty() minClasses!: number;
}

export class IdeaSettingsView {
  @ApiProperty({ description: 'Categoria principal obrigatória no envio' }) categoryRequired!: boolean;
}

export class AttachmentSettingsView {
  @ApiProperty() maxMb!: number;
  @ApiProperty({ type: [String] }) allowedExtensions!: string[];
}

export class BrandPairView {
  @ApiProperty({ example: 'oklch(0.52 0.17 277)' }) brand!: string;
  @ApiProperty({ example: 'oklch(0.99 0 0)', description: 'Texto sobre a cor da marca' }) brandFg!: string;
  @ApiProperty({ example: 'oklch(0.925 0.012 277)', description: 'Fundo do item ativo do menu' }) shellActive!: string;
  @ApiProperty({ example: 'oklch(0.2 0.03 277)', description: 'Texto do item ativo do menu' }) shellActiveFg!: string;
}
export class BrandAdjustedView {
  @ApiProperty() light!: boolean;
  @ApiProperty() dark!: boolean;
}
/** Cor da marca já derivada para os dois temas, com contraste garantido (identidade visual). */
export class BrandingView {
  @ApiProperty({ type: BrandPairView }) light!: BrandPairView;
  @ApiProperty({ type: BrandPairView }) dark!: BrandPairView;
  @ApiProperty({ example: '#5458c8', description: 'Variante clara em hex (theme-color, PDF)' }) lightHex!: string;
  @ApiProperty({ type: BrandAdjustedView, description: 'O tom foi corrigido para manter a leitura' })
  adjusted!: BrandAdjustedView;
}
export const BrandPreviewSchema = z.object({
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable(),
  colorDark: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullish()
    .transform((v) => v ?? null),
});
export class BrandPreviewRequest {
  @ApiProperty({ type: String, nullable: true, example: '#0b6e4f', description: 'Nulo = índigo do ITS' }) color!:
    | string
    | null;
  @ApiProperty({ type: String, nullable: true, required: false }) colorDark?: string | null;
}

/** Versões dos logos da organização (vão no ?v= da URL); nulo = sem logo naquele tema. */
export class LogoVersionsView {
  @ApiProperty({ type: String, nullable: true }) light!: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Opcional; sem ele, o claro vai sobre uma placa clara' })
  dark!: string | null;
}

export class RecognitionSettingsView {
  @ApiProperty({ description: 'Módulo de reconhecimento ligado (RN-66)' }) enabled!: boolean;
  @ApiProperty({ description: 'Ranking individual ligado (RN-70)' }) individualRanking!: boolean;
}

export class MuralSettingsView {
  @ApiProperty({ description: 'Mural de ideias ligado; o Início vira o mural (RN-148)' }) enabled!: boolean;
}

export class StoreSettingsView {
  @ApiProperty({ description: 'Loja ligada (RN-159)' }) enabled!: boolean;
}

export class SsoPublicView {
  @ApiProperty({
    enum: ['password', 'password_sso', 'sso'],
    description: 'Como se entra: só senha, senha ou SSO, ou só SSO',
  })
  mode!: 'password' | 'password_sso' | 'sso';
  @ApiProperty({
    enum: ['microsoft', 'google'],
    isArray: true,
    description: 'Provedores ligados (botões da tela de entrada)',
  })
  providers!: ('microsoft' | 'google')[];
}

export class PublicSettingsView {
  @ApiProperty() organizationName!: string;
  @ApiProperty({ enum: ['pt-BR', 'en'] }) defaultLocale!: string;
  @ApiProperty({ example: '/ajuda/', description: 'Endereço da ajuda (documentação), sempre terminado em /' })
  helpUrl!: string;
  @ApiProperty({ example: 'America/Sao_Paulo' }) timezone!: string;
  @ApiProperty({ type: PasswordPolicyView }) passwordPolicy!: PasswordPolicyView;
  @ApiProperty({ type: IdeaSettingsView }) ideas!: IdeaSettingsView;
  @ApiProperty({ type: AttachmentSettingsView }) attachments!: AttachmentSettingsView;
  @ApiProperty({ description: 'Tamanho máximo da foto do perfil, em MB (RN-91)' }) profilePhotoMaxMb!: number;
  @ApiProperty({ description: 'Consulta pública ligada na instalação (RN-33)' }) publicLookupEnabled!: boolean;
  @ApiProperty({ description: 'Envio de e-mail ligado (mostra "Esqueci minha senha")' }) emailEnabled!: boolean;
  @ApiProperty({ type: SsoPublicView }) sso!: SsoPublicView;
  @ApiProperty({ example: 'BRL', description: 'Moeda dos ganhos financeiros (RN-62)' }) currency!: string;
  @ApiProperty({ type: RecognitionSettingsView }) recognition!: RecognitionSettingsView;
  @ApiProperty({ type: MuralSettingsView }) mural!: MuralSettingsView;
  @ApiProperty({ type: StoreSettingsView }) store!: StoreSettingsView;
  @ApiProperty({ type: BrandingView }) branding!: BrandingView;
  @ApiProperty({ type: LogoVersionsView, description: 'Logo da organização, ao lado do símbolo do ITS' })
  logo!: LogoVersionsView;
  @ApiProperty({ enum: BRAND_FONTS, description: 'Fonte da interface (os códigos continuam em Geist Mono)' })
  font!: BrandFont;
  @ApiProperty({ type: LoginScreenPublicView, description: 'Tela de login: layout, fundo e textos (M23)' })
  login!: LoginScreenPublicView;
}
