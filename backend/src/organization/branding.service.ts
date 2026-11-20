import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import sharp from 'sharp';
import type { DataSource, EntityManager } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';
import { AuditService } from '../audit/audit.service.js';
import { apiError } from '../common/api-error.js';
import type { RequestMeta } from '../identity-access/auth-context.js';
import { type LogoVariant, OrganizationLogo } from './entities/organization-logo.entity.js';

/** Tamanho máximo do arquivo enviado. */
export const LOGO_MAX_BYTES = 2 * 1024 * 1024;
/** Caixa em que o logo é encaixado (sem distorcer): altura de sobra para telas de alta densidade. */
const MAX_HEIGHT = 96;
const MAX_WIDTH = 480;
const ALLOWED = new Set(['png', 'webp']);
const MAX_INPUT_PIXELS = 40_000_000;

const notAllowed = () => apiError(415, 'file_type_not_allowed', 'Envie o logo em PNG ou WebP.');

const storageDir = () => resolve(process.env.STORAGE_DIR ?? 'storage', 'branding');
const pathOf = (storedName: string) => join(storageDir(), basename(storedName));

export function isLogoVariant(v: string): v is LogoVariant {
  return v === 'light' || v === 'dark';
}

/** Versões dos logos (para o `?v=` da URL): nulo = sem logo naquele tema. */
export async function logoVersions(m: EntityManager): Promise<{ light: string | null; dark: string | null }> {
  const rows = await m.getRepository(OrganizationLogo).find();
  const of = (v: LogoVariant) => {
    const row = rows.find((r) => r.variant === v);
    return row ? String(row.updatedAt.getTime()) : null;
  };
  return { light: of('light'), dark: of('dark') };
}

/** Logo claro em PNG (o pdfkit não lê WebP), para o cartão em PDF do Hall. */
export async function logoPng(m: EntityManager): Promise<Buffer | null> {
  const row = await m.getRepository(OrganizationLogo).findOneBy({ variant: 'light' });
  if (!row) return null;
  try {
    return await sharp(await readFile(pathOf(row.storedName)))
      .png()
      .toBuffer();
  } catch {
    return null;
  }
}

/**
 * Cor dominante do logo, para sugerir como cor da marca: a cor saturada mais frequente entre os
 * pixels opacos (fundo transparente, branco, preto e cinzas não contam). Nulo se não houver.
 */
async function dominantColor(image: Buffer): Promise<string | null> {
  const { data, info } = await sharp(image)
    .resize(64, 64, { fit: 'inside' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const counts = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i < info.width * info.height * 4; i += 4) {
    const [r, g, b, a] = [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0, data[i + 3] ?? 0];
    if (a < 128 || Math.max(r, g, b) - Math.min(r, g, b) < 40) continue;
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const bucket = counts.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    counts.set(key, { n: bucket.n + 1, r: bucket.r + r, g: bucket.g + g, b: bucket.b + b });
  }
  const best = [...counts.values()].sort((x, y) => y.n - x.n)[0];
  if (!best || best.n < 8) return null;
  const hex = (v: number) =>
    Math.round(v / best.n)
      .toString(16)
      .padStart(2, '0');
  return `#${hex(best.r)}${hex(best.g)}${hex(best.b)}`;
}

/**
 * Logo da organização (identidade visual). O tipo é decidido pelo CONTEÚDO (o sharp lê o arquivo):
 * só PNG ou WebP; SVG (pode carregar código), JPEG ou executável renomeado → 415. A borda vazia é
 * aparada, o logo é encaixado sem distorcer e salvo em WebP sem nenhum metadado.
 */
@Injectable()
export class BrandingService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  async upload(
    variant: LogoVariant,
    file: { buffer: Buffer; size: number },
    actorId: string,
    meta: RequestMeta,
  ): Promise<{ version: string; suggestedColor: string | null }> {
    if (file.size > LOGO_MAX_BYTES) throw apiError(413, 'file_too_large', 'O logo passa do tamanho máximo de 2 MB.');
    let output: { data: Buffer; info: { width: number; height: number } };
    try {
      const image = sharp(file.buffer, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' });
      const info = await image.metadata();
      if (!info.format || !ALLOWED.has(info.format)) throw notAllowed();
      const trimmed = await image.trim().toBuffer();
      output = await sharp(trimmed)
        .resize(MAX_WIDTH, MAX_HEIGHT, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 92, alphaQuality: 100 })
        .toBuffer({ resolveWithObject: true }); // sem withMetadata(): nenhum metadado é mantido
    } catch (error) {
      if (error instanceof Error && 'getStatus' in error) throw error;
      throw notAllowed();
    }
    const storedName = `${uuidv7()}.webp`;
    await mkdir(storageDir(), { recursive: true });
    await writeFile(pathOf(storedName), output.data, { flag: 'wx' });
    let previous: string | null = null;
    try {
      await this.dataSource.transaction(async (m) => {
        const repo = m.getRepository(OrganizationLogo);
        previous = (await repo.findOneBy({ variant }))?.storedName ?? null;
        await repo.save({ variant, storedName, width: output.info.width, height: output.info.height });
        await this.audit.record(
          { action: 'branding.logo_changed', actorId, targetType: 'setting', targetId: `logo.${variant}`, ip: meta.ip },
          m,
        );
      });
    } catch (error) {
      await rm(pathOf(storedName), { force: true }).catch(() => undefined);
      throw error;
    }
    if (previous) await rm(pathOf(previous), { force: true }).catch(() => undefined);
    const versions = await logoVersions(this.dataSource.manager);
    return { version: versions[variant] ?? '', suggestedColor: await dominantColor(output.data).catch(() => null) };
  }

  async remove(variant: LogoVariant, actorId: string, meta: RequestMeta): Promise<void> {
    const stored = await this.dataSource.transaction(async (m) => {
      const repo = m.getRepository(OrganizationLogo);
      const row = await repo.findOneBy({ variant });
      if (!row) return null;
      await repo.delete({ variant });
      await this.audit.record(
        { action: 'branding.logo_removed', actorId, targetType: 'setting', targetId: `logo.${variant}`, ip: meta.ip },
        m,
      );
      return row.storedName;
    });
    if (stored) await rm(pathOf(stored), { force: true }).catch(() => undefined);
  }

  async read(variant: LogoVariant): Promise<{ data: Buffer; version: string } | null> {
    const row = await this.dataSource.getRepository(OrganizationLogo).findOneBy({ variant });
    if (!row) return null;
    return { data: await readFile(pathOf(row.storedName)), version: String(row.updatedAt.getTime()) };
  }
}
