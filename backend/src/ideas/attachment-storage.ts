import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { Injectable } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';

/**
 * Armazenamento dos anexos num volume local (docs/STACK-E-ARQUITETURA.md: "volume local atrás de
 * uma interface", trocável por S3 no futuro). O nome no disco é GERADO; o nome enviado nunca vira
 * caminho (CA-RN-21.5).
 */
@Injectable()
export class AttachmentStorage {
  private readonly dir = resolve(process.env.STORAGE_DIR ?? 'storage', 'attachments');

  /** Nome seguro no disco: id + extensão já validada contra a lista permitida. */
  static storedName(extension: string): string {
    return `${uuidv7()}.${extension}`;
  }

  private path(storedName: string): string {
    // Defesa extra: só aceita o formato que nós mesmos geramos.
    if (!/^[0-9a-f-]{36}\.[a-z0-9]{1,10}$/.test(storedName) || basename(storedName) !== storedName) {
      throw new Error('Nome de armazenamento inválido.');
    }
    return join(this.dir, storedName);
  }

  async save(storedName: string, content: Buffer): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.path(storedName), content, { flag: 'wx' });
  }

  read(storedName: string): Promise<Buffer> {
    return readFile(this.path(storedName));
  }

  /** Remoção em melhor esforço (depois do commit): arquivo órfão não quebra a operação. */
  async remove(storedNames: string[]): Promise<void> {
    await Promise.all(storedNames.map((n) => rm(this.path(n), { force: true }).catch(() => undefined)));
  }
}

/** Caractere imprimível (sem controle C0 nem DEL). */
const printable = (ch: string) => {
  const code = ch.charCodeAt(0);
  return code >= 32 && code !== 127;
};

/** Limpa o nome enviado para exibir e baixar: sem caminho, sem caracteres de controle, até 255. */
export function cleanFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'arquivo';
  const cleaned = [...base].filter(printable).join('').replace(/^\.+/, '').trim();
  return (cleaned || 'arquivo').slice(0, 255);
}

const WINDOWS_FORBIDDEN = '<>:"/\\|?*';

/** Versão só ASCII do nome, para o `filename=` do cabeçalho (o `filename*=` leva o nome completo). */
export function asciiFileName(name: string): string {
  return [...name]
    .map((ch) => {
      const code = ch.charCodeAt(0);
      // ASCII imprimível e aceito como nome de arquivo no Windows (sem < > : " / \ | ? *).
      return code >= 32 && code <= 126 && !WINDOWS_FORBIDDEN.includes(ch) ? ch : '_';
    })
    .join('');
}

/** Extensão em minúsculas (sem o ponto), ou vazio. */
export function extensionOf(name: string): string {
  const m = /\.([A-Za-z0-9]{1,10})$/.exec(name);
  return m?.[1]?.toLowerCase() ?? '';
}

/** Tipo de conteúdo decidido pela extensão permitida, nunca pelo que o navegador declarou. */
const MIME: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  mp4: 'video/mp4',
  webm: 'video/webm',
  txt: 'text/plain',
  csv: 'text/csv',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  zip: 'application/zip',
};
export function mimeFor(extension: string): string {
  return MIME[extension] ?? 'application/octet-stream';
}
