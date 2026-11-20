import { type EntityManager, In } from 'typeorm';
import { apiError } from '../common/api-error.js';
import { Idea } from '../ideas/entities/idea.entity.js';
import { IdeaParticipant, ParticipantRole } from '../ideas/entities/idea-related.entity.js';
import { type User, UserStatus } from '../identity-access/entities/user.entity.js';
import { MuralConsent, MuralPost, MuralStatus } from './entities.js';
import type { MuralPerson } from './mural.dto.js';
import { muralShowsName } from './mural-rules.js';

const CODE = /^[A-Z][A-Z0-9]{1,7}-\d{4}-\d{4,}$/;
const UUID = /^[0-9a-f-]{36}$/i;

export const ideaNotFound = () => apiError(404, 'not_found', 'Ideia não encontrada.');

export type ParticipantRoleName = 'author' | 'co_author';
export type ConsentValue = 'pending' | 'accepted' | 'declined';

/** A ideia pelo código ou pelo id; 404 se não existe. */
export async function findIdeaByRef(m: EntityManager, ref: string): Promise<Idea> {
  const value = ref.trim();
  const where = UUID.test(value)
    ? { id: value }
    : CODE.test(value.toUpperCase())
      ? { code: value.toUpperCase() }
      : null;
  const idea = where ? await m.getRepository(Idea).findOneBy(where) : null;
  if (!idea) throw ideaNotFound();
  return idea;
}

/**
 * A ideia que está no mural agora (RN-150). Retirada → 404 `mural_withdrawn` (a tela mostra "Esta ideia
 * não está mais no mural", RN-155); nunca publicada ou inexistente → 404 `not_found`.
 */
export async function findPublished(m: EntityManager, ref: string): Promise<{ idea: Idea; post: MuralPost }> {
  const idea = await findIdeaByRef(m, ref);
  const post = await m.getRepository(MuralPost).findOneBy({ ideaId: idea.id });
  if (!post) throw ideaNotFound();
  if (post.status !== MuralStatus.Published) {
    throw apiError(404, 'mural_withdrawn', 'Esta ideia não está mais no mural.');
  }
  return { idea, post };
}

/**
 * Participantes ATUAIS de cada ideia (o autor e os co-autores, RN-69 e RN-86): calculados na hora, para
 * quem entrou depois da publicação também ficar anônimo até consentir (RN-151).
 */
export async function participantsOf(
  m: EntityManager,
  ideas: readonly Pick<Idea, 'id' | 'authorId'>[],
): Promise<Map<string, Map<string, ParticipantRoleName>>> {
  const out = new Map<string, Map<string, ParticipantRoleName>>();
  for (const i of ideas) out.set(i.id, new Map(i.authorId ? [[i.authorId, 'author' as const]] : []));
  if (ideas.length === 0) return out;
  const rows = await m.getRepository(IdeaParticipant).find({
    select: { ideaId: true, userId: true, role: true },
    where: { ideaId: In(ideas.map((i) => i.id)), role: In([ParticipantRole.Author, ParticipantRole.CoAuthor]) },
  });
  for (const r of rows) {
    const map = out.get(r.ideaId);
    if (map && !map.has(r.userId)) map.set(r.userId, r.role === ParticipantRole.Author ? 'author' : 'co_author');
  }
  return out;
}

/** Consentimentos gravados: `ideaId → userId → estado`. Sem linha = sem resposta (anônimo). */
export async function consentsOf(
  m: EntityManager,
  ideaIds: readonly string[],
): Promise<Map<string, Map<string, ConsentValue>>> {
  const out = new Map<string, Map<string, ConsentValue>>();
  if (ideaIds.length === 0) return out;
  for (const c of await m.getRepository(MuralConsent).findBy({ ideaId: In([...ideaIds]) })) {
    const map = out.get(c.ideaId) ?? new Map<string, ConsentValue>();
    map.set(c.userId, c.status);
    out.set(c.ideaId, map);
  }
  return out;
}

type PersonUser = Pick<User, 'id' | 'name' | 'status' | 'hideName'>;

/**
 * Como uma pessoa aparece na conversa ou na lista de reações (RN-151 a RN-153):
 * - anonimizada → "Ex-colaborador", sem nome nem foto;
 * - participante da ideia sem consentimento (ou com opt-out) → "Autor/Coautor da ideia", sem nome,
 *   id nem foto; a equipe (`reveal`) vê o nome, marcado como revelado;
 * - qualquer outra pessoa → nome e foto (reagir e comentar são ações de quem age; o opt-out da RN-70
 *   vale para ser mostrado como autor ou destaque).
 */
export function personView(
  user: PersonUser | null,
  ctx: {
    participant: ParticipantRoleName | null;
    consent: ConsentValue | null;
    reveal: boolean;
    photos: ReadonlyMap<string, string>;
  },
): MuralPerson {
  if (!user || user.status === UserStatus.Anonymized) {
    return { name: null, userId: null, photoVersion: null, label: 'former', revealed: false };
  }
  const shown = { name: user.name, userId: user.id, photoVersion: ctx.photos.get(user.id) ?? null };
  if (ctx.participant) {
    const visible = muralShowsName(ctx.consent, { hideName: user.hideName, active: user.status === UserStatus.Active });
    if (!visible) {
      return ctx.reveal
        ? { ...shown, label: ctx.participant, revealed: true }
        : { name: null, userId: null, photoVersion: null, label: ctx.participant, revealed: false };
    }
  }
  return { ...shown, label: null, revealed: false };
}

/**
 * Decodifica o cursor da lista (base64url de JSON); inválido → 422. `p` é a data da publicação em
 * microssegundos desde 1970 (a precisão do Postgres; em milissegundos o cursor pularia cartões).
 */
export function decodeCursor(cursor: string | undefined): { p: string; id: string; t?: number } | null {
  if (!cursor) return null;
  try {
    const v = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      p?: unknown;
      id?: unknown;
      t?: unknown;
    };
    if (typeof v.p !== 'string' || !/^\d{1,20}$/.test(v.p) || typeof v.id !== 'string' || !UUID.test(v.id)) {
      throw new Error('cursor');
    }
    if (v.t !== undefined && (typeof v.t !== 'number' || !Number.isInteger(v.t) || v.t < 0)) throw new Error('cursor');
    return { p: v.p, id: v.id, ...(v.t === undefined ? {} : { t: v.t }) };
  } catch {
    throw apiError(422, 'invalid_cursor', 'Cursor inválido.');
  }
}

export function encodeCursor(v: { p: string; id: string; t?: number }): string {
  return Buffer.from(JSON.stringify(v), 'utf8').toString('base64url');
}
