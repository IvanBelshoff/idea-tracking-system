import { Controller, Delete, Get, HttpCode, Param, Put, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiCookieAuth,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiParam,
  ApiProduces,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { ApiErrorBody, apiError } from '../common/api-error.js';
import {
  type AuthContext,
  CurrentAuth,
  Public,
  RequirePermission,
  requestMeta,
} from '../identity-access/auth-context.js';
import { BrandingService, isLogoVariant } from './branding.service.js';
import type { LogoVariant } from './entities/organization-logo.entity.js';

/** Teto do corpo da requisição (o limite de 2 MB é conferido no serviço, com 413). */
const UPLOAD_CEILING = 12 * 1024 * 1024;
const variantParam = { name: 'variant', enum: ['light', 'dark'], description: 'Logo do tema claro ou do escuro' };

export class LogoUploadResult {
  @ApiProperty({ description: 'Versão nova (vai no ?v= da URL)' }) version!: string;
  @ApiProperty({
    type: String,
    nullable: true,
    example: '#0b6e4f',
    description: 'Cor dominante, sugerida como cor da marca',
  })
  suggestedColor!: string | null;
}

function variantOf(value: string): LogoVariant {
  if (!isLogoVariant(value)) throw apiError(404, 'not_found', 'Logo não encontrado.');
  return value;
}

/** Logo da organização (identidade visual): ver é público (tela de login); trocar exige setting.manage. */
@ApiTags('settings')
@Controller('branding/logo')
export class BrandingController {
  constructor(private readonly branding: BrandingService) {}

  @Get(':variant')
  @Public()
  @ApiParam(variantParam)
  @ApiProduces('image/webp')
  @ApiOkResponse({ description: 'O logo (WebP). Público: aparece na tela de login.' })
  @ApiNotFoundResponse({ type: ApiErrorBody, description: 'Sem logo neste tema.' })
  async get(@Param('variant') value: string, @Res() res: Response): Promise<void> {
    const logo = await this.branding.read(variantOf(value));
    if (!logo) throw apiError(404, 'not_found', 'Sem logo.');
    res.setHeader('Content-Type', 'image/webp');
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    // A tela renova pelo ?v= quando o logo muda.
    res.setHeader('Cache-Control', 'public, max-age=604800');
    res.send(logo.data);
  }

  @Put(':variant')
  @RequirePermission('setting.manage')
  @ApiCookieAuth()
  @ApiParam(variantParam)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } }, required: ['file'] },
  })
  @ApiOkResponse({ type: LogoUploadResult })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: UPLOAD_CEILING, files: 1 } }))
  async upload(
    @Param('variant') value: string,
    @UploadedFile() file: { buffer: Buffer; size: number } | undefined,
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
  ): Promise<LogoUploadResult> {
    if (!file) throw apiError(400, 'validation_failed', 'Envie o arquivo do logo no campo "file".');
    return this.branding.upload(variantOf(value), file, auth.user.id, requestMeta(req));
  }

  @Delete(':variant')
  @HttpCode(204)
  @RequirePermission('setting.manage')
  @ApiCookieAuth()
  @ApiParam(variantParam)
  @ApiNoContentResponse()
  async remove(@Param('variant') value: string, @CurrentAuth() auth: AuthContext, @Req() req: Request): Promise<void> {
    await this.branding.remove(variantOf(value), auth.user.id, requestMeta(req));
  }
}
