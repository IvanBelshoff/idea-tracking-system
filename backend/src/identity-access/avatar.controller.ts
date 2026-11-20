import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
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
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiParam,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { ApiErrorBody, apiError, parseInput } from '../common/api-error.js';
import type { Access } from './access.js';
import { AccessService } from './access.service.js';
import {
  AllowIncompleteProfile,
  type AuthContext,
  CurrentAuth,
  type RequestWithAuth,
  requestMeta,
} from './auth-context.js';
import { AvatarService } from './avatar.service.js';
import { AvatarVersionView, PhotoChoiceRequest, PhotoChoiceSchema, PhotoOptionsView } from './dto.js';
import { PHOTO_SOURCES, type PhotoSource } from './entities/user.entity.js';
import { UsersService } from './users.service.js';

const id = { name: 'id', description: 'Id do usuário' };
/** Teto do corpo da requisição (o limite configurável, padrão 2 MB, é conferido no serviço). */
const UPLOAD_CEILING = 12 * 1024 * 1024;

/**
 * Foto do perfil (RN-91). Qualquer pessoa logada vê; só a própria pessoa ou quem administra
 * usuários (dentro do escopo) troca ou remove (CA-RN-91.4).
 */
@ApiTags('users')
@ApiCookieAuth()
@Controller('users/:id/photo')
@AllowIncompleteProfile()
export class AvatarController {
  constructor(
    private readonly avatars: AvatarService,
    private readonly users: UsersService,
    private readonly access: AccessService,
  ) {}

  private async assertCanChange(auth: AuthContext, access: Access, userId: string): Promise<void> {
    if (auth.user.id === userId) return;
    if (!access.has('user.manage'))
      throw apiError(403, 'forbidden', 'Só a própria pessoa ou a administração troca a foto.');
    await this.users.assertManages(access, userId);
  }

  @Get()
  @ApiParam(id)
  @ApiProduces('image/webp')
  @ApiOkResponse({ description: 'A foto (WebP). Exige login.' })
  @ApiNotFoundResponse({
    type: ApiErrorBody,
    description: 'Sem foto, ou a pessoa ocultou o nome (RN-70): a tela mostra as iniciais.',
  })
  async get(
    @Param('id', ParseUUIDPipe) userId: string,
    @CurrentAuth() auth: AuthContext,
    @Req() req: RequestWithAuth,
    @Res() res: Response,
  ): Promise<void> {
    const access = await this.access.forRequest(req);
    const photo = await this.avatars.read(userId, { id: auth.user.id, canManageUsers: access.has('user.manage') });
    if (!photo) throw apiError(404, 'not_found', 'Sem foto.');
    this.sendPhoto(res, photo);
  }

  /** As fotos guardadas e a escolha (RN-144): só a própria pessoa e quem administra. */
  @Get('options')
  @ApiParam(id)
  @ApiOkResponse({ type: PhotoOptionsView })
  @ApiForbiddenResponse({ type: ApiErrorBody })
  async options(
    @Param('id', ParseUUIDPipe) userId: string,
    @CurrentAuth() auth: AuthContext,
    @Req() req: RequestWithAuth,
  ): Promise<PhotoOptionsView> {
    await this.assertCanChange(auth, await this.access.forRequest(req), userId);
    return this.avatars.options(userId);
  }

  /** Uma foto guardada de uma origem, para a prévia da escolha (só a própria pessoa e quem administra). */
  @Get('sources/:source')
  @ApiParam(id)
  @ApiParam({ name: 'source', enum: PHOTO_SOURCES })
  @ApiProduces('image/webp')
  @ApiOkResponse({ description: 'A foto daquela origem (WebP).' })
  @ApiNotFoundResponse({ type: ApiErrorBody })
  async source(
    @Param('id', ParseUUIDPipe) userId: string,
    @Param('source') source: string,
    @CurrentAuth() auth: AuthContext,
    @Req() req: RequestWithAuth,
    @Res() res: Response,
  ): Promise<void> {
    if (!(PHOTO_SOURCES as readonly string[]).includes(source)) throw apiError(404, 'not_found', 'Sem foto.');
    const access = await this.access.forRequest(req);
    await this.assertCanChange(auth, access, userId);
    const photo = await this.avatars.read(
      userId,
      { id: auth.user.id, canManageUsers: access.has('user.manage') },
      source as PhotoSource,
    );
    if (!photo) throw apiError(404, 'not_found', 'Sem foto.');
    this.sendPhoto(res, photo);
  }

  /** Escolhe qual foto mostrar (RN-144): a enviada, a de um provedor ou as iniciais. */
  @Put('choice')
  @ApiParam(id)
  @ApiBody({ type: PhotoChoiceRequest })
  @ApiOkResponse({ type: PhotoOptionsView })
  @ApiForbiddenResponse({ type: ApiErrorBody })
  async choose(
    @Param('id', ParseUUIDPipe) userId: string,
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
    @Req() req: RequestWithAuth,
  ): Promise<PhotoOptionsView> {
    await this.assertCanChange(auth, await this.access.forRequest(req), userId);
    const { choice } = parseInput(PhotoChoiceSchema, body);
    return this.avatars.choose(userId, auth.user.id, choice, requestMeta(req));
  }

  private sendPhoto(res: Response, photo: { data: Buffer; mime: string }): void {
    res.setHeader('Content-Type', photo.mime);
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    // Privada (exige login); a tela renova pelo parâmetro ?v= quando a foto muda.
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.send(photo.data);
  }

  @Put()
  @ApiParam(id)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } }, required: ['file'] },
  })
  @ApiOkResponse({ type: AvatarVersionView })
  @ApiForbiddenResponse({ type: ApiErrorBody, description: 'Só a própria pessoa ou a administração.' })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: UPLOAD_CEILING, files: 1 } }))
  async put(
    @Param('id', ParseUUIDPipe) userId: string,
    @CurrentAuth() auth: AuthContext,
    @UploadedFile() file: { buffer: Buffer; size: number } | undefined,
    @Req() req: RequestWithAuth,
  ): Promise<AvatarVersionView> {
    await this.assertCanChange(auth, await this.access.forRequest(req), userId);
    if (!file) {
      throw apiError(422, 'validation_failed', 'Envie a imagem no campo "file".', [
        { path: 'file', message: 'Escolha uma imagem.' },
      ]);
    }
    return { version: await this.avatars.upload(userId, auth.user.id, file, requestMeta(req)) };
  }

  @Delete()
  @HttpCode(204)
  @ApiParam(id)
  @ApiNoContentResponse({ description: 'Foto removida (volta às iniciais).' })
  async remove(
    @Param('id', ParseUUIDPipe) userId: string,
    @CurrentAuth() auth: AuthContext,
    @Req() req: RequestWithAuth,
  ): Promise<void> {
    await this.assertCanChange(auth, await this.access.forRequest(req), userId);
    await this.avatars.remove(userId, auth.user.id, requestMeta(req));
  }
}
