import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import sharp from 'sharp';
import type { DataSource, EntityManager } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';
import { AuditService } from '../audit/audit.service.js';
import { apiError, parseInput } from '../common/api-error.js';
import { sniffViewable } from '../ideas/media-view.js';
import type { RequestMeta } from '../identity-access/auth-context.js';
import { deriveBrand, hexToOklch, oklchToHex, toGamut } from './brand-color.js';
import { LoginMedia } from './entities/login-media.entity.js';
import {
  changedFields,
  IMAGE_MAX_BYTES,
  IMAGE_MAX_WIDTH,
  LOGIN_DEFAULT,
  LOGIN_MEDIA,
  type LoginMediaKind,
  type LoginScreenConfig,
  LoginScreenSchema,
  normalizeLogin,
  requiredMedia,
  type TextPlacement,
  textPlacement,
  VIDEO_MAX_BYTES,
} from './login-screen-rules.js';
import { getSetting, SettingsService } from './settings.service.js';

const storageDir = () => resolve(process.env.STORAGE_DIR ?? 'storage', 'branding');
const pathOf = (storedName: string) => join(storageDir(), basename(storedName));
const MAX_INPUT_PIXELS = 100_000_000;
const IMAGE_FORMATS = new Set(['png', 'jpeg', 'webp']);

export type MediaVersions = Record<LoginMediaKind, { version: string; sizeBytes: number } | null>;

export interface LoginScreenAdmin {
  config: LoginScreenConfig;
  media: MediaVersions;
}

/** O que a tela de acesso precisa saber (vai na configuração pública: a tela é aberta sem login). */
export interface LoginScreenPublic {
  layout: LoginScreenConfig['layout'];
  side: LoginScreenConfig['side'];
  background: Omit<LoginScreenConfig['background'], 'color1' | 'color2'> & {
    color1: string;
    color2: string;
    imageVersion: string | null;
    posterVersion: string | null;
    videoVersion: string | null;
  };
  title: LoginScreenConfig['title'];
  subtitle: LoginScreenConfig['subtitle'];
  text: TextPlacement;
}

export function isLoginMediaKind(value: string): value is LoginMediaKind {
  return (LOGIN_MEDIA as readonly string[]).includes(value);
}

async function mediaVersions(m: EntityManager): Promise<MediaVersions> {
  const rows = await m.getRepository(LoginMedia).find();
  const of = (kind: LoginMediaKind) => {
    const row = rows.find((r) => r.kind === kind);
    return row ? { version: String(row.updatedAt.getTime()), sizeBytes: row.sizeBytes } : null;
  };
  return { image: of('image'), poster: of('poster'), video: of('video') };
}

/** As cores do fundo já resolvidas: nulo = a cor da marca e uma variante mais escura dela. */
function resolvedColors(config: LoginScreenConfig, brandHex: string): { color1: string; color2: string } {
  const base = hexToOklch(brandHex);
  const darker = oklchToHex(toGamut({ ...base, L: Math.max(0.2, base.L * 0.62) }));
  return { color1: config.background.color1 ?? brandHex, color2: config.background.color2 ?? darker };
}

/**
 * A tela de login para a configuração pública (usada também fora do Nest). Com `draft`, calcula a
 * prévia de uma configuração ainda não salva (RN-180), com os arquivos que já existem.
 */
export async function loginScreenPublic(m: EntityManager, draft?: LoginScreenConfig): Promise<LoginScreenPublic> {
  const config = draft ?? normalizeLogin(await getSetting(m, 'branding.login'));
  const brandHex = deriveBrand(
    await getSetting(m, 'branding.color'),
    await getSetting(m, 'branding.color_dark'),
  ).lightHex;
  const colors = resolvedColors(config, brandHex);
  const media = await mediaVersions(m);
  return {
    layout: config.layout,
    side: config.side,
    background: {
      ...config.background,
      ...colors,
      imageVersion: media.image?.version ?? null,
      posterVersion: media.poster?.version ?? null,
      videoVersion: media.video?.version ?? null,
    },
    title: config.title,
    subtitle: config.subtitle,
    text: textPlacement(config, { ...colors, brand: brandHex }),
  };
}

/**
 * Tela de login (M23, RN-176 a RN-180): configurar o layout, o fundo e os textos, e enviar a imagem, a
 * capa e o vídeo. O tipo do arquivo é decidido pelo CONTEÚDO; a imagem vira WebP sem metadados.
 */
@Injectable()
export class LoginScreenService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  async view(m: EntityManager = this.dataSource.manager): Promise<LoginScreenAdmin> {
    return { config: normalizeLogin(await this.settings.get('branding.login', m)), media: await mediaVersions(m) };
  }

  /** Prévia ao vivo (RN-180): o que a tela de acesso mostraria com esta configuração, sem salvar. */
  async preview(input: unknown): Promise<LoginScreenPublic> {
    return loginScreenPublic(this.dataSource.manager, parseInput(LoginScreenSchema, input, 422));
  }

  async save(input: unknown, actorId: string, meta: RequestMeta): Promise<LoginScreenAdmin> {
    const next = parseInput(LoginScreenSchema, input, 422);
    return this.dataSource.transaction(async (m) => {
      const media = await mediaVersions(m);
      const missing = requiredMedia(next).filter((kind) => !media[kind]);
      if (missing.includes('poster') && !missing.includes('video')) {
        throw apiError(422, 'login_video_needs_poster', 'O vídeo de fundo precisa de uma imagem de capa.');
      }
      if (missing.length > 0) {
        throw apiError(422, 'login_media_missing', 'Envie o arquivo do fundo antes de escolhê-lo.', { missing });
      }
      const before = normalizeLogin(await this.settings.get('branding.login', m));
      const fields = changedFields(before, next);
      if (fields.length > 0) {
        await this.settings.set('branding.login', next, actorId, m);
        await this.audit.record(
          {
            action: 'branding.login_changed',
            actorId,
            targetType: 'setting',
            targetId: 'branding.login',
            data: { fields },
            ip: meta.ip,
          },
          m,
        );
      }
      return this.view(m);
    });
  }

  async upload(
    kind: LoginMediaKind,
    file: { buffer: Buffer; size: number },
    actorId: string,
    meta: RequestMeta,
  ): Promise<LoginScreenAdmin> {
    const prepared = kind === 'video' ? prepareVideo(file) : await prepareImage(file);
    const storedName = `login-${kind}-${uuidv7()}.${prepared.extension}`;
    await mkdir(storageDir(), { recursive: true });
    await writeFile(pathOf(storedName), prepared.data, { flag: 'wx' });
    let previous: string | null = null;
    try {
      await this.dataSource.transaction(async (m) => {
        const repo = m.getRepository(LoginMedia);
        previous = (await repo.findOneBy({ kind }))?.storedName ?? null;
        await repo.save({
          kind,
          storedName,
          contentType: prepared.contentType,
          sizeBytes: prepared.data.length,
          width: prepared.width,
          height: prepared.height,
        });
        await this.audit.record(
          {
            action: 'branding.login_media_changed',
            actorId,
            targetType: 'setting',
            targetId: `login.${kind}`,
            ip: meta.ip,
          },
          m,
        );
      });
    } catch (error) {
      await rm(pathOf(storedName), { force: true }).catch(() => undefined);
      throw error;
    }
    if (previous) await rm(pathOf(previous), { force: true }).catch(() => undefined);
    return this.view();
  }

  async remove(kind: LoginMediaKind, actorId: string, meta: RequestMeta): Promise<LoginScreenAdmin> {
    const stored = await this.dataSource.transaction(async (m) => {
      const config = normalizeLogin(await this.settings.get('branding.login', m));
      if (requiredMedia(config).includes(kind)) {
        throw apiError(422, 'login_media_in_use', 'Este arquivo está no fundo atual: troque o fundo antes de remover.');
      }
      const repo = m.getRepository(LoginMedia);
      const row = await repo.findOneBy({ kind });
      if (!row) return null;
      await repo.delete({ kind });
      await this.audit.record(
        {
          action: 'branding.login_media_removed',
          actorId,
          targetType: 'setting',
          targetId: `login.${kind}`,
          ip: meta.ip,
        },
        m,
      );
      return row.storedName;
    });
    if (stored) await rm(pathOf(stored), { force: true }).catch(() => undefined);
    return this.view();
  }

  /** Restaurar o padrão (RN-180): o cartão central sem fundo nem textos, e os arquivos apagados. */
  async reset(actorId: string, meta: RequestMeta): Promise<LoginScreenAdmin> {
    const stored = await this.dataSource.transaction(async (m) => {
      const rows = await m.getRepository(LoginMedia).find();
      await m.getRepository(LoginMedia).clear();
      await this.settings.set('branding.login', LOGIN_DEFAULT, actorId, m);
      await this.audit.record(
        { action: 'branding.login_reset', actorId, targetType: 'setting', targetId: 'branding.login', ip: meta.ip },
        m,
      );
      return rows.map((r) => r.storedName);
    });
    for (const name of stored) await rm(pathOf(name), { force: true }).catch(() => undefined);
    return this.view();
  }

  async read(kind: LoginMediaKind): Promise<{ data: Buffer; contentType: string } | null> {
    const row = await this.dataSource.getRepository(LoginMedia).findOneBy({ kind });
    if (!row) return null;
    return { data: await readFile(pathOf(row.storedName)), contentType: row.contentType };
  }
}

type Prepared = { data: Buffer; contentType: string; extension: string; width: number | null; height: number | null };

const imageNotAllowed = () => apiError(415, 'file_type_not_allowed', 'Envie a imagem em PNG, JPEG ou WebP.');

/** Imagem e capa (RN-177): PNG, JPEG ou WebP pelo conteúdo, até 10 MB; vira WebP sem metadados. */
async function prepareImage(file: { buffer: Buffer; size: number }): Promise<Prepared> {
  if (file.size > IMAGE_MAX_BYTES) throw apiError(413, 'file_too_large', 'A imagem passa do tamanho máximo de 10 MB.');
  try {
    const image = sharp(file.buffer, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' });
    const info = await image.metadata();
    if (!info.format || !IMAGE_FORMATS.has(info.format)) throw imageNotAllowed();
    const out = await image
      .rotate() // a orientação da câmera vale antes de os metadados saírem
      .resize({ width: IMAGE_MAX_WIDTH, withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true }); // sem withMetadata(): EXIF, GPS e ICC não ficam
    return {
      data: out.data,
      contentType: 'image/webp',
      extension: 'webp',
      width: out.info.width,
      height: out.info.height,
    };
  } catch (error) {
    if (error instanceof Error && 'getStatus' in error) throw error;
    throw imageNotAllowed();
  }
}

/** Vídeo (RN-178): MP4 ou WebM pelo conteúdo, até 20 MB; guardado como veio (o som é desligado na tela). */
function prepareVideo(file: { buffer: Buffer; size: number }): Prepared {
  if (file.size > VIDEO_MAX_BYTES) throw apiError(413, 'file_too_large', 'O vídeo passa do tamanho máximo de 20 MB.');
  const mime = sniffViewable(file.buffer.subarray(0, 64));
  if (mime !== 'video/mp4' && mime !== 'video/webm') {
    throw apiError(415, 'file_type_not_allowed', 'Envie o vídeo em MP4 ou WebM.');
  }
  return {
    data: file.buffer,
    contentType: mime,
    extension: mime === 'video/mp4' ? 'mp4' : 'webm',
    width: null,
    height: null,
  };
}
