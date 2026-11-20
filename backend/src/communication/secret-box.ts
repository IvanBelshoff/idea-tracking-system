import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { apiError } from '../common/api-error.js';

/**
 * Cifra o que não pode ficar legível no banco: a configuração do provedor de e-mail (com a senha,
 * CA-RN-90.3) e o corpo dos e-mails (pode ter link de recuperação de senha).
 * AES-256-GCM com chave derivada (HKDF) de `APP_SECRET_KEY`, que vem do ambiente e nunca do banco.
 * Formato: versão (1 byte) | IV (12) | tag (16) | texto cifrado.
 */
const VERSION = 1;
const MIN_SECRET_LENGTH = 16;

export function secretKeyReady(): boolean {
  return (process.env.APP_SECRET_KEY ?? '').length >= MIN_SECRET_LENGTH;
}

function key(): Buffer {
  const secret = process.env.APP_SECRET_KEY ?? '';
  if (secret.length < MIN_SECRET_LENGTH) {
    throw apiError(
      503,
      'secret_key_missing',
      'Defina APP_SECRET_KEY (16 caracteres ou mais) no ambiente do servidor para guardar segredos.',
    );
  }
  return Buffer.from(hkdfSync('sha256', secret, 'its', 'secret-box-v1', 32));
}

export function seal(plain: string): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), encrypted]);
}

export function open(sealed: Buffer): string {
  if (sealed.length < 29 || sealed[0] !== VERSION) throw new Error('Formato cifrado desconhecido');
  const decipher = createDecipheriv('aes-256-gcm', key(), sealed.subarray(1, 13));
  decipher.setAuthTag(sealed.subarray(13, 29));
  return Buffer.concat([decipher.update(sealed.subarray(29)), decipher.final()]).toString('utf8');
}
