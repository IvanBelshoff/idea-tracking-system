import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { Injectable } from '@nestjs/common';
import sharp from 'sharp';
import { v7 as uuidv7 } from 'uuid';
import { apiError } from '../common/api-error.js';

/** Lado da foto do item (quadrada; o recorte do navegador já manda 512 × 512, RN-143). */
export const ITEM_PHOTO_SIZE = 512;
const ALLOWED_FORMATS = new Set(['jpeg', 'png', 'webp']);
const MAX_INPUT_PIXELS = 40_000_000;
/** Teto do arquivo enviado (o navegador recorta e reduz antes). */
export const ITEM_PHOTO_MAX_BYTES = 5 * 1024 * 1024;

const notAllowed = () => apiError(415, 'file_type_not_allowed', 'Envie uma imagem JPG, PNG ou WebP.');

/**
 * Foto do item da loja (RN-163), no armazenamento local como as fotos do perfil: o tipo é decidido
 * pelo CONTEÚDO (o sharp lê), a imagem vira WebP quadrado e perde todos os metadados.
 */
@Injectable()
export class StorePhotoStorage {
  private readonly dir = resolve(process.env.STORAGE_DIR ?? 'storage', 'store');

  private path(storedName: string): string {
    if (!/^[0-9a-f-]{36}\.webp$/.test(storedName) || basename(storedName) !== storedName) {
      throw new Error('Nome de armazenamento inválido.');
    }
    return join(this.dir, storedName);
  }

  /** Lê pelo conteúdo e grava o WebP; devolve o nome no disco. Tipo não aceito → 415. */
  async save(buffer: Buffer): Promise<string> {
    if (buffer.length > ITEM_PHOTO_MAX_BYTES) {
      throw apiError(413, 'file_too_large', 'A foto passa de 5 MB.');
    }
    let data: Buffer;
    try {
      const image = sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' });
      const info = await image.metadata();
      if (!info.format || !ALLOWED_FORMATS.has(info.format)) throw notAllowed();
      data = await image
        .rotate()
        .resize(ITEM_PHOTO_SIZE, ITEM_PHOTO_SIZE, { fit: 'cover', position: 'attention' })
        .webp({ quality: 82 })
        .toBuffer();
    } catch (error) {
      if (error instanceof Error && 'getStatus' in error) throw error;
      throw notAllowed();
    }
    const storedName = `${uuidv7()}.webp`;
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.path(storedName), data, { flag: 'wx' });
    return storedName;
  }

  read(storedName: string): Promise<Buffer> {
    return readFile(this.path(storedName));
  }

  async remove(storedName: string | null): Promise<void> {
    if (storedName) await rm(this.path(storedName), { force: true }).catch(() => undefined);
  }
}
