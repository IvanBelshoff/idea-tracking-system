import { type EntityManager, In } from 'typeorm';
import { type PhotoChoice, type PhotoSource, User } from './entities/user.entity.js';
import { UserAvatar } from './entities/user-avatar.entity.js';

/** O que importa de cada foto guardada para decidir qual mostrar. */
export interface StoredPhoto {
  source: PhotoSource;
  createdAt: Date;
}

/**
 * Qual foto mostrar (RN-144): `default` → nenhuma (iniciais); a origem escolhida, se existir; senão a
 * enviada, se houver. Assim, escolher a do provedor e ela ainda não ter chegado (ou ter sido apagada) cai
 * na enviada, e nunca numa foto que a pessoa não escolheu.
 */
export function activePhoto<T extends StoredPhoto>(rows: readonly T[], choice: PhotoChoice): T | null {
  if (choice === 'default') return null;
  return rows.find((r) => r.source === choice) ?? rows.find((r) => r.source === 'upload') ?? null;
}

/** A versão de uma foto: muda a cada troca e renova o cache do navegador (`?v=`). */
export const versionOfPhoto = (row: StoredPhoto): string => `${row.source[0]}${row.createdAt.getTime()}`;

/**
 * A versão da foto mostrada de várias pessoas de uma vez (RN-142): `userId → versão`. Quem não tem foto
 * (ou escolheu a padrão) não aparece no mapa, e a tela mostra as iniciais.
 */
export async function photoVersions(
  m: EntityManager,
  userIds: readonly (string | null)[],
): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter((id): id is string => !!id))];
  if (ids.length === 0) return new Map();
  const [rows, users] = await Promise.all([
    m
      .getRepository(UserAvatar)
      .find({ where: { userId: In(ids) }, select: { id: true, userId: true, source: true, createdAt: true } }),
    m.getRepository(User).find({ where: { id: In(ids) }, select: { id: true, photoChoice: true } }),
  ]);
  const out = new Map<string, string>();
  for (const u of users) {
    const active = activePhoto(
      rows.filter((r) => r.userId === u.id),
      u.photoChoice,
    );
    if (active) out.set(u.id, versionOfPhoto(active));
  }
  return out;
}
