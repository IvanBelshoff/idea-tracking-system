import { ApiProperty } from '@nestjs/swagger';
import {
  BLUR_MAX,
  LOGIN_BACKGROUNDS,
  LOGIN_LAYOUTS,
  LOGIN_OVERLAYS,
  LOGIN_SIDES,
  LOGIN_TEXT_TONES,
  OVERLAY_MAX,
  SUBTITLE_MAX,
  TITLE_MAX,
} from './login-screen-rules.js';

/** Tela de login (M23, RN-176 a RN-180): o contrato da configuração e da configuração pública. */
export class LoginTitleView {
  @ApiProperty({ maxLength: TITLE_MAX, description: 'Em português (Brasil)' }) ptBR!: string;
  @ApiProperty({ maxLength: TITLE_MAX, description: 'Em inglês; vazio = mostra o pt-BR' }) en!: string;
}

export class LoginSubtitleView {
  @ApiProperty({ maxLength: SUBTITLE_MAX, description: 'Em português (Brasil)' }) ptBR!: string;
  @ApiProperty({ maxLength: SUBTITLE_MAX, description: 'Em inglês; vazio = mostra o pt-BR' }) en!: string;
}

export class LoginBackgroundView {
  @ApiProperty({ enum: LOGIN_BACKGROUNDS }) type!: (typeof LOGIN_BACKGROUNDS)[number];
  @ApiProperty({ type: String, nullable: true, example: '#0b6e4f', description: 'Nulo = a cor da marca' })
  color1!: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    example: '#063d2c',
    description: 'Segunda cor do gradiente; nulo = uma variante escura da marca',
  })
  color2!: string | null;
  @ApiProperty({ minimum: 0, maximum: 100, description: 'Ponto de foco da imagem, % da largura' }) focusX!: number;
  @ApiProperty({ minimum: 0, maximum: 100, description: 'Ponto de foco da imagem, % da altura' }) focusY!: number;
  @ApiProperty({ enum: LOGIN_OVERLAYS, description: 'Cor da camada sobre a imagem ou o vídeo' })
  overlayColor!: (typeof LOGIN_OVERLAYS)[number];
  @ApiProperty({ minimum: 0, maximum: OVERLAY_MAX, description: 'Opacidade da camada, em %' }) overlayOpacity!: number;
  @ApiProperty({ minimum: 0, maximum: BLUR_MAX, description: 'Desfoque da imagem, em px' }) blur!: number;
}

export class LoginScreenConfigView {
  @ApiProperty({ enum: LOGIN_LAYOUTS }) layout!: (typeof LOGIN_LAYOUTS)[number];
  @ApiProperty({ enum: LOGIN_SIDES, description: 'De que lado fica o formulário (dividido e painel lateral)' })
  side!: (typeof LOGIN_SIDES)[number];
  @ApiProperty({ type: LoginBackgroundView }) background!: LoginBackgroundView;
  @ApiProperty({ type: LoginTitleView }) title!: LoginTitleView;
  @ApiProperty({ type: LoginSubtitleView }) subtitle!: LoginSubtitleView;
  @ApiProperty({
    enum: LOGIN_TEXT_TONES,
    description: 'Cor do texto sobre o fundo; sem contraste, o texto ganha uma placa atrás (RN-177)',
  })
  textTone!: (typeof LOGIN_TEXT_TONES)[number];
}

export class LoginMediaItemView {
  @ApiProperty({ description: 'Versão (vai no ?v= da URL)' }) version!: string;
  @ApiProperty() sizeBytes!: number;
}

export class LoginMediaView {
  @ApiProperty({ type: LoginMediaItemView, nullable: true }) image!: LoginMediaItemView | null;
  @ApiProperty({ type: LoginMediaItemView, nullable: true, description: 'Capa do vídeo' })
  poster!: LoginMediaItemView | null;
  @ApiProperty({ type: LoginMediaItemView, nullable: true }) video!: LoginMediaItemView | null;
}

export class LoginScreenAdminView {
  @ApiProperty({ type: LoginScreenConfigView }) config!: LoginScreenConfigView;
  @ApiProperty({ type: LoginMediaView }) media!: LoginMediaView;
}

export class LoginPublicBackgroundView {
  @ApiProperty({ enum: LOGIN_BACKGROUNDS }) type!: (typeof LOGIN_BACKGROUNDS)[number];
  @ApiProperty({ example: '#0b6e4f', description: 'Já resolvida (a marca quando não escolhida)' }) color1!: string;
  @ApiProperty({ example: '#063d2c' }) color2!: string;
  @ApiProperty() focusX!: number;
  @ApiProperty() focusY!: number;
  @ApiProperty({ enum: LOGIN_OVERLAYS }) overlayColor!: (typeof LOGIN_OVERLAYS)[number];
  @ApiProperty() overlayOpacity!: number;
  @ApiProperty() blur!: number;
  @ApiProperty({ type: String, nullable: true }) imageVersion!: string | null;
  @ApiProperty({ type: String, nullable: true }) posterVersion!: string | null;
  @ApiProperty({ type: String, nullable: true }) videoVersion!: string | null;
}

export class LoginTextPlacementView {
  @ApiProperty({ description: 'O texto fica sobre o fundo (senão, na superfície do formulário)' })
  onBackground!: boolean;
  @ApiProperty({ enum: ['light', 'dark'], description: 'Cor do texto sobre o fundo (4,5:1 no pior caso)' })
  tone!: 'light' | 'dark';
  @ApiProperty({
    type: Number,
    nullable: true,
    example: 0.55,
    description:
      'Opacidade (0 a 1) da placa atrás do texto (preta para o claro, branca para o escuro); nulo = sem placa',
  })
  plate!: number | null;
}

export class LoginScreenPublicView {
  @ApiProperty({ enum: LOGIN_LAYOUTS }) layout!: (typeof LOGIN_LAYOUTS)[number];
  @ApiProperty({ enum: LOGIN_SIDES }) side!: (typeof LOGIN_SIDES)[number];
  @ApiProperty({ type: LoginPublicBackgroundView }) background!: LoginPublicBackgroundView;
  @ApiProperty({ type: LoginTitleView }) title!: LoginTitleView;
  @ApiProperty({ type: LoginSubtitleView }) subtitle!: LoginSubtitleView;
  @ApiProperty({ type: LoginTextPlacementView }) text!: LoginTextPlacementView;
}
