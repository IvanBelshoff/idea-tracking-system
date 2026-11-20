import type { EntityManager } from 'typeorm';
import { Role, RolePermission } from './entities/role.entity.js';
import { ALL_PERMISSIONS, type Permission } from './permissions.js';

export type SystemRoleKey = 'collaborator' | 'analyst' | 'manager' | 'validator' | 'admin';

interface FactoryRole {
  key: SystemRoleKey;
  /** Nome e descrição com que o perfil nasce (pt-BR, o idioma padrão). */
  name: string;
  description: string;
  /** Os mesmos em inglês, para uma instalação em inglês (os nomes que a Ajuda em inglês usa). */
  en: { name: string; description: string };
  permissions: readonly Permission[];
}

const COLLABORATOR: Permission[] = ['idea.submit', 'idea.comment'];

/** Perfis de fábrica (§3.1 das regras). Editáveis pelo admin; o seed não sobrescreve edições. */
export const FACTORY_ROLES: readonly FactoryRole[] = [
  {
    key: 'collaborator',
    name: 'Colaborador',
    description: 'Envia ideias, acompanha e comenta as suas.',
    en: { name: 'Employee', description: 'Submits ideas, follows them and comments on their own.' },
    permissions: COLLABORATOR,
  },
  {
    key: 'analyst',
    name: 'Analista',
    description: 'Tria, aprova ou recusa e conduz a execução das ideias das entidades que gerencia.',
    en: {
      name: 'Analyst',
      description: 'Triages, approves or rejects and runs the ideas of the entities they manage.',
    },
    permissions: [
      ...COLLABORATOR,
      'idea.view_scope',
      'idea.comment_internal',
      'idea.triage',
      'idea.register_for_other',
      'idea.archive',
      'idea.converge',
      'step.manage',
      'hall.moderate',
      'mural.manage',
    ],
  },
  {
    key: 'manager',
    name: 'Gestor',
    description: 'Acompanha as ideias e os indicadores das suas entidades, cria campanhas e destaca ideias.',
    en: {
      name: 'Manager',
      description: 'Follows the ideas and indicators of their entities, creates campaigns and features ideas.',
    },
    permissions: [
      ...COLLABORATOR,
      'idea.view_scope',
      'idea.comment_internal',
      'report.view',
      'campaign.manage',
      'reward.register',
      'hall.highlight_entity',
    ],
  },
  {
    key: 'validator',
    name: 'Validador de resultados',
    description: 'Valida o ganho financeiro declarado (controladoria ou finanças).',
    en: { name: 'Results validator', description: 'Validates the declared financial gain (controlling or finance).' },
    permissions: ['gain.validate', 'report.view'],
  },
  {
    key: 'admin',
    name: 'Administrador',
    description: 'Tudo: usuários, perfis, entidades, categorias, configurações e auditoria.',
    en: {
      name: 'Administrator',
      description: 'Everything: users, roles, entities, categories, settings and the audit log.',
    },
    permissions: ALL_PERMISSIONS,
  },
];

/**
 * Cria os perfis de fábrica que faltam (reconhecidos por `system_key`). Idempotente.
 * - Não altera permissões de perfis existentes: o admin pode tê-los editado (CA-RN-01.7).
 * - Exceção: o Administrador recebe toda permissão nova que surgir em versões futuras.
 */
export async function seedFactoryRoles(manager: EntityManager): Promise<void> {
  const roles = manager.getRepository(Role);
  const grants = manager.getRepository(RolePermission);

  for (const def of FACTORY_ROLES) {
    const existing = await roles.findOneBy({ systemKey: def.key });
    if (!existing) {
      const created = await roles.save(
        roles.create({ name: def.name, description: def.description, isSystem: true, systemKey: def.key }),
      );
      await grants.insert(def.permissions.map((permission) => ({ roleId: created.id, permission })));
    } else if (def.key === 'admin') {
      await grants
        .createQueryBuilder()
        .insert()
        .values(ALL_PERMISSIONS.map((permission) => ({ roleId: existing.id, permission })))
        .orIgnore()
        .execute();
    }
  }
}

/**
 * Põe os perfis de fábrica no idioma da instalação (RN-43). Roda no assistente de instalação, quando
 * ninguém pôde editá-los ainda; mesmo assim, só troca o perfil que continua com o nome e a descrição
 * de fábrica, para nunca apagar uma edição do administrador. Em pt-BR não há o que trocar.
 */
export async function localizeFactoryRoles(manager: EntityManager, locale: 'pt-BR' | 'en'): Promise<void> {
  if (locale === 'pt-BR') return;
  const roles = manager.getRepository(Role);
  for (const def of FACTORY_ROLES) {
    await roles.update(
      { systemKey: def.key, name: def.name, description: def.description },
      { name: def.en.name, description: def.en.description },
    );
  }
}
