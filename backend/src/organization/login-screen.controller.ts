import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiCookieAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiParam,
  ApiProduces,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { ApiErrorBody, apiError } from '../common/api-error.js';
import { parseRange } from '../ideas/media-view.js';
import {
  type AuthContext,
  CurrentAuth,
  Public,
  RequirePermission,
  requestMeta,
} from '../identity-access/auth-context.js';
import { LoginScreenAdminView, LoginScreenConfigView, LoginScreenPublicView } from './login-screen.dto.js';
import { isLoginMediaKind, LoginScreenService } from './login-screen.service.js';
import { LOGIN_MEDIA, type LoginMediaKind } from './login-screen-rules.js';

/** Teto do corpo (os limites de 10 MB e 20 MB são conferidos no serviço, com 413). */
const UPLOAD_CEILING = 24 * 1024 * 1024;
const kindParam = { name: 'kind', enum: LOGIN_MEDIA, description: 'A imagem de fundo, a capa do vídeo ou o vídeo' };

function kindOf(value: string): LoginMediaKind {
  if (!isLoginMediaKind(value)) throw apiError(404, 'not_found', 'Arquivo não encontrado.');
  return value;
}

/**
 * Tela de login (M23, RN-176 a RN-180). Configurar exige `setting.manage` (a mesma da identidade visual);
 * os arquivos do fundo são públicos, porque a tela de login é aberta sem sessão.
 */
@ApiTags('settings')
@Controller('branding/login')
export class LoginScreenController {
  constructor(private readonly screen: LoginScreenService) {}

  @Get()
  @RequirePermission('setting.manage')
  @ApiCookieAuth()
  @ApiOkResponse({ type: LoginScreenAdminView })
  view(): Promise<LoginScreenAdminView> {
    return this.screen.view();
  }

  @Put()
  @RequirePermission('setting.manage')
  @ApiCookieAuth()
  @ApiBody({ type: LoginScreenConfigView })
  @ApiOkResponse({ type: LoginScreenAdminView })
  @ApiResponse({ status: 422, type: ApiErrorBody, description: 'Valor fora dos limites ou fundo sem o arquivo' })
  save(@Body() body: unknown, @CurrentAuth() auth: AuthContext, @Req() req: Request): Promise<LoginScreenAdminView> {
    return this.screen.save(body, auth.user.id, requestMeta(req));
  }

  @Post('preview')
  @HttpCode(200)
  @RequirePermission('setting.manage')
  @ApiCookieAuth()
  @ApiBody({ type: LoginScreenConfigView })
  @ApiOkResponse({ type: LoginScreenPublicView, description: 'A tela como ficaria, sem salvar (prévia ao vivo)' })
  @ApiResponse({ status: 422, type: ApiErrorBody })
  preview(@Body() body: unknown): Promise<LoginScreenPublicView> {
    return this.screen.preview(body);
  }

  @Post('reset')
  @HttpCode(200)
  @RequirePermission('setting.manage')
  @ApiCookieAuth()
  @ApiOkResponse({ type: LoginScreenAdminView, description: 'De volta ao cartão central, sem fundo nem textos' })
  reset(@CurrentAuth() auth: AuthContext, @Req() req: Request): Promise<LoginScreenAdminView> {
    return this.screen.reset(auth.user.id, requestMeta(req));
  }

  @Put('media/:kind')
  @RequirePermission('setting.manage')
  @ApiCookieAuth()
  @ApiParam(kindParam)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } }, required: ['file'] },
  })
  @ApiOkResponse({ type: LoginScreenAdminView })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: UPLOAD_CEILING, files: 1 } }))
  upload(
    @Param('kind') value: string,
    @UploadedFile() file: { buffer: Buffer; size: number } | undefined,
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
  ): Promise<LoginScreenAdminView> {
    const kind = kindOf(value);
    if (!file) throw apiError(400, 'validation_failed', 'Envie o arquivo no campo "file".');
    return this.screen.upload(kind, file, auth.user.id, requestMeta(req));
  }

  @Delete('media/:kind')
  @HttpCode(200)
  @RequirePermission('setting.manage')
  @ApiCookieAuth()
  @ApiParam(kindParam)
  @ApiOkResponse({ type: LoginScreenAdminView })
  @ApiResponse({ status: 422, type: ApiErrorBody, description: 'O arquivo está no fundo atual' })
  remove(
    @Param('kind') value: string,
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
  ): Promise<LoginScreenAdminView> {
    return this.screen.remove(kindOf(value), auth.user.id, requestMeta(req));
  }

  @Get('media/:kind')
  @Public()
  @ApiParam(kindParam)
  @ApiProduces('image/webp', 'video/mp4', 'video/webm')
  @ApiOkResponse({ description: 'O arquivo. Público: aparece na tela de login. O vídeo aceita Range (206).' })
  @ApiResponse({ status: 206, description: 'A faixa pedida (vídeo).' })
  @ApiResponse({ status: 416, description: 'Faixa fora do arquivo.' })
  @ApiNotFoundResponse({ type: ApiErrorBody })
  async media(@Param('kind') value: string, @Req() req: Request, @Res() res: Response): Promise<void> {
    const file = await this.screen.read(kindOf(value));
    if (!file) throw apiError(404, 'not_found', 'Sem arquivo.');
    const { data, contentType } = file;
    res.set({
      'Content-Type': contentType,
      'Content-Disposition': 'inline',
      'Accept-Ranges': 'bytes',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      // A tela renova pelo ?v= quando o arquivo muda.
      'Cache-Control': 'public, max-age=604800',
    });
    const range = parseRange(req.headers.range, data.length);
    if (range === 'invalid') {
      res.status(416).set('Content-Range', `bytes */${data.length}`).end();
      return;
    }
    if (range) {
      const part = data.subarray(range.start, range.end + 1);
      res
        .status(206)
        .set({
          'Content-Range': `bytes ${range.start}-${range.end}/${data.length}`,
          'Content-Length': String(part.length),
        })
        .send(part);
      return;
    }
    res.set('Content-Length', String(data.length)).send(data);
  }
}
