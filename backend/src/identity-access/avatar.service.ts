import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import sharp from 'sharp';
import type { DataSource, EntityManager } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';
import { AuditService } from '../audit/audit.service.js';
import { apiError } from '../common/api-error.js';
import { SettingsService } from '../organization/settings.service.js';
import type { RequestMeta } from './auth-context.js';
import { type PhotoChoice, type PhotoSource, User } from './entities/user.entity.js';
import { UserAvatar } from './entities/user-avatar.entity.js';
import { activePhoto, versionOfPhoto } from './photo-versions.js';

/** Lado da foto gravada (quadrada, recortada ao centro). */
export const AVATAR_SIZE = 256;
const ALLOWED_FORMATS = new Set(['jpeg', 'png', 'webp']);
/** Teto de pixels da imagem enviada (protege a memória contra imagem gigante). */
const MAX_INPUT_PIXELS = 40_000_000;

const notAllowed = () => apiError(415, 'file_type_not_allowed', 'Envie uma imagem JPG, PNG ou WebP.');

interface Normalized {
  data: Buffer;
  info: { size: number; width: number; height: number };
}

/** As fotos guardadas de uma pessoa, com a versão de cada uma (RN-144). */
export interface PhotoOptions {
  choice: PhotoChoice;
  sources: { source: PhotoSource; version: string }[];
}

/**
 * Foto do perfil (RN-91, RN-144). O tipo é decidido pelo CONTEÚDO (o sharp lê o arquivo), nunca pela
 * extensão nem pelo tipo informado: SVG, PDF ou executável renomeado como .jpg → 415. A imagem
 * é redimensionada e convertida para WebP, e todos os metadados (EXIF, localização) são descartados.
 *
 * Cada pessoa tem no máximo uma foto por origem (a enviada e as dos provedores do login corporativo) e
 * a escolha de qual mostrar (`user.photo_choice`). Nada troca a escolha sozinho, a não ser enviar uma foto
 * (quem envia quer usá-la) ou a origem escolhida deixar de existir (volta à enviada).
 */
@Injectable()
export class AvatarService {
  private readonly dir = resolve(process.env.STORAGE_DIR ?? 'storage', 'avatars');

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  private path(storedName: string): string {
    if (!/^[0-9a-f-]{36}\.webp$/.test(storedName) || basename(storedName) !== storedName) {
      throw new Error('Nome de armazenamento inválido.');
    }
    return join(this.dir, storedName);
  }

  /** Lê a imagem pelo conteúdo e gera o WebP quadrado sem metadados. Tipo não aceito → 415. */
  private async normalize(buffer: Buffer): Promise<Normalized> {
    try {
      const image = sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' });
      const info = await image.metadata();
      if (!info.format || !ALLOWED_FORMATS.has(info.format)) throw notAllowed();
      return await image
        .rotate() // aplica a orientação do EXIF antes de descartá-lo
        .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover', position: 'attention' })
        .webp({ quality: 82 })
        .toBuffer({ resolveWithObject: true }); // sem withMetadata(): nenhum metadado é mantido
    } catch (error) {
      if (error instanceof Error && 'getStatus' in error) throw error;
      throw notAllowed();
    }
  }

  /**
   * Grava a foto de uma origem no lugar da anterior dessa origem; `extra` roda na mesma transação
   * (escolha e auditoria). O arquivo antigo sai do disco depois do commit (CA-RN-91.3).
   */
  private async store(
    userId: string,
    source: PhotoSource,
    output: Normalized,
    extra: (m: EntityManager) => Promise<void>,
  ): Promise<void> {
    const storedName = `${uuidv7()}.webp`;
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.path(storedName), output.data, { flag: 'wx' });
    let previous: string | null = null;
    try {
      await this.dataSource.transaction(async (m) => {
        const repo = m.getRepository(UserAvatar);
        const old = await repo.findOneBy({ userId, source });
        previous = old?.storedName ?? null;
        if (old) await repo.delete({ id: old.id });
        await repo.save(
          repo.create({
            userId,
            source,
            storedName,
            mime: 'image/webp',
            sizeBytes: output.info.size,
            width: output.info.width,
            height: output.info.height,
          }),
        );
        await extra(m);
      });
    } catch (error) {
      await rm(this.path(storedName), { force: true }).catch(() => undefined);
      throw error;
    }
    if (previous) await rm(this.path(previous), { force: true }).catch(() => undefined);
  }

  private async rows(userId: string, m: EntityManager = this.dataSource.manager): Promise<UserAvatar[]> {
    return m.getRepository(UserAvatar).find({ where: { userId } });
  }

  /** Versão da foto mostrada (a tela usa para renovar o cache); nulo = iniciais. */
  async versionOf(userId: string, m: EntityManager = this.dataSource.manager): Promise<string | null> {
    const user = await m
      .getRepository(User)
      .findOne({ where: { id: userId }, select: { id: true, photoChoice: true } });
    if (!user) return null;
    const active = activePhoto(await this.rows(userId, m), user.photoChoice);
    return active ? versionOfPhoto(active) : null;
  }

  /** Foto enviada pela pessoa (ou por quem administra): passa a ser a mostrada. */
  async upload(
    userId: string,
    actorId: string,
    file: { buffer: Buffer; size: number },
    meta: RequestMeta,
  ): Promise<string> {
    const maxMb = await this.settings.get('profile.photo_max_mb');
    if (file.size > maxMb * 1024 * 1024) {
      throw apiError(413, 'file_too_large', `A foto passa do tamanho máximo de ${maxMb} MB.`);
    }
    const output = await this.normalize(file.buffer);
    await this.store(userId, 'upload', output, async (m) => {
      await m.getRepository(User).update(userId, { photoChoice: 'upload' });
      await this.audit.record(
        { action: 'user.photo_changed', actorId, targetType: 'user', targetId: userId, ip: meta.ip },
        m,
      );
    });
    return (await this.versionOf(userId)) ?? '';
  }

  /**
   * Foto buscada no provedor do login corporativo (RN-144): guardada à parte, sem mudar a escolha.
   * Imagem que não é imagem só é descartada (`false`): o login nunca falha por causa da foto.
   */
  async storeProviderPhoto(userId: string, source: Exclude<PhotoSource, 'upload'>, buffer: Buffer): Promise<boolean> {
    let output: Normalized;
    try {
      output = await this.normalize(buffer);
    } catch {
      return false;
    }
    await this.store(userId, source, output, async () => undefined);
    return true;
  }

  /** Remove a foto enviada; quem a usava passa a ver as iniciais (ou a do provedor, se escolher). */
  async remove(userId: string, actorId: string, meta: RequestMeta): Promise<void> {
    const stored = await this.dataSource.transaction(async (m) => {
      const repo = m.getRepository(UserAvatar);
      const avatar = await repo.findOneBy({ userId, source: 'upload' });
      if (!avatar) return null;
      await repo.delete({ id: avatar.id });
      await this.audit.record(
        { action: 'user.photo_removed', actorId, targetType: 'user', targetId: userId, ip: meta.ip },
        m,
      );
      return avatar.storedName;
    });
    if (stored) await rm(this.path(stored), { force: true }).catch(() => undefined);
  }

  /**
   * Apaga as fotos de uma origem (provedor desligado ou conta desvinculada, RN-144) de uma pessoa ou de
   * todas (`userId` nulo). Quem tinha escolhido essa origem volta à enviada. Devolve os arquivos, que quem
   * chama remove depois do commit.
   */
  async purgeSource(
    m: EntityManager,
    source: Exclude<PhotoSource, 'upload'>,
    userId: string | null,
  ): Promise<string[]> {
    const repo = m.getRepository(UserAvatar);
    const rows = await repo.find({ where: { source, ...(userId ? { userId } : {}) } });
    if (rows.length > 0) await repo.delete(rows.map((r) => r.id));
    await m
      .getRepository(User)
      .update({ photoChoice: source, ...(userId ? { id: userId } : {}) }, { photoChoice: 'upload' });
    return rows.map((r) => r.storedName);
  }

  /** Apaga todas as fotos da pessoa (anonimizar, CA-RN-40.1); quem chama remove os arquivos depois do commit. */
  async purge(userId: string, m: EntityManager): Promise<string[]> {
    const repo = m.getRepository(UserAvatar);
    const rows = await repo.findBy({ userId });
    if (rows.length > 0) await repo.delete(rows.map((r) => r.id));
    return rows.map((r) => r.storedName);
  }

  /** Apaga arquivos já sem registro (melhor esforço, depois do commit). */
  async removeFiles(storedNames: readonly (string | null)[]): Promise<void> {
    await Promise.all(
      storedNames
        .filter((n): n is string => n !== null)
        .map((n) => rm(this.path(n), { force: true }).catch(() => undefined)),
    );
  }

  /** As fotos guardadas e a escolha (para a própria pessoa e quem administra). */
  async options(userId: string): Promise<PhotoOptions> {
    const user = await this.dataSource.getRepository(User).findOneByOrFail({ id: userId });
    const order: PhotoSource[] = ['upload', 'microsoft', 'google'];
    const rows = (await this.rows(userId)).sort((a, b) => order.indexOf(a.source) - order.indexOf(b.source));
    return { choice: user.photoChoice, sources: rows.map((r) => ({ source: r.source, version: versionOfPhoto(r) })) };
  }

  /** Escolhe qual foto mostrar (RN-144). Origem sem foto guardada → 422; a padrão sempre vale. */
  async choose(userId: string, actorId: string, choice: PhotoChoice, meta: RequestMeta): Promise<PhotoOptions> {
    await this.dataSource.transaction(async (m) => {
      if (choice !== 'default' && !(await m.getRepository(UserAvatar).existsBy({ userId, source: choice }))) {
        throw apiError(422, 'photo_unavailable', 'Esta foto não está disponível.');
      }
      const user = await m.getRepository(User).findOneByOrFail({ id: userId });
      if (user.photoChoice === choice) return;
      await m.getRepository(User).update(userId, { photoChoice: choice });
      await this.audit.record(
        {
          action: 'user.photo_choice_changed',
          actorId,
          targetType: 'user',
          targetId: userId,
          data: { from: user.photoChoice, to: choice },
          ip: meta.ip,
        },
        m,
      );
    });
    return this.options(userId);
  }

  /**
   * A foto mostrada, ou uma origem específica (só para a própria pessoa e quem administra), ou null.
   * Quem ativou o opt-out de nome (RN-70) só aparece para si e para quem administra.
   */
  async read(
    userId: string,
    viewer: { id: string; canManageUsers: boolean },
    source?: PhotoSource,
  ): Promise<{ data: Buffer; mime: string; version: string } | null> {
    const user = await this.dataSource.getRepository(User).findOneBy({ id: userId });
    if (!user) return null;
    const privileged = viewer.id === userId || viewer.canManageUsers;
    if (user.hideName && !privileged) return null;
    if (source && !privileged) return null;
    const rows = await this.rows(userId);
    const avatar = source ? (rows.find((r) => r.source === source) ?? null) : activePhoto(rows, user.photoChoice);
    if (!avatar) return null;
    return { data: await readFile(this.path(avatar.storedName)), mime: avatar.mime, version: versionOfPhoto(avatar) };
  }
}
