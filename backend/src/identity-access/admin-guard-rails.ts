import type { EntityManager } from 'typeorm';
import { apiError } from '../common/api-error.js';

const ADMIN_GUARD_LOCK = 7_262_003;

/**
 * Trava de segurança: sempre resta ao menos um usuário ATIVO com o perfil Administrador na
 * entidade raiz, incluindo as sub-entidades. Sem isso, um admin poderia se desativar ou tirar o
 * próprio perfil e trancar todo mundo para fora. Chame dentro da transação, depois da mudança:
 * se falhar, a transação inteira é desfeita.
 */
export async function assertAdminRemains(m: EntityManager): Promise<void> {
  // Serializa a checagem: se dois admins se desativam ao mesmo tempo, o segundo (já depois do
  // commit do primeiro, em READ COMMITTED) enxerga o resultado e é recusado.
  await m.query('SELECT pg_advisory_xact_lock($1)', [ADMIN_GUARD_LOCK]);
  const [row] = (await m.query(
    `SELECT count(DISTINCT s.user_id)::int AS admins
       FROM user_role_scope s
       JOIN role r ON r.id = s.role_id AND r.system_key = 'admin'
       JOIN entity e ON e.id = s.entity_id AND e.parent_id IS NULL
       JOIN "user" u ON u.id = s.user_id AND u.status = 'active'
      WHERE s.include_children`,
  )) as { admins: number }[];
  if (!row || row.admins < 1) {
    throw apiError(409, 'last_admin', 'A operação deixaria o sistema sem nenhum administrador ativo.');
  }
}
