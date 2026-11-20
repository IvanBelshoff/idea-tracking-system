'use client';

import { Check } from 'lucide-react';
import regras from '../simuladores/regras.json';
import { useLang } from './use-lang';

/** Nome de cada permissão em inglês (o português vem do backend, src/identity-access/permissions.ts). */
export const PERMISSION_EN: Record<string, string> = {
  'idea.submit': 'Submit ideas',
  'idea.view_scope': 'See every idea in the entities in scope',
  'idea.comment': 'Comment on visible ideas',
  'idea.comment_internal': 'See and write internal comments',
  'idea.triage': 'Triage, approve and reject ideas',
  'idea.register_for_other': 'Register an idea on behalf of someone else (RN-04)',
  'idea.reopen': 'Reopen a closed idea (RN-09)',
  'idea.archive': 'Archive an idea (RN-11)',
  'idea.delete': 'Delete an idea permanently (RN-11; administrator only)',
  'idea.converge': 'Merge similar ideas (RN-85)',
  'step.manage': 'Create and manage steps and attachments',
  'report.view': 'See indicators and reports in scope',
  'gain.validate': 'Validate financial gains (RN-63)',
  'campaign.manage': 'Create and manage campaigns',
  'hall.highlight_entity': 'Feature ideas in the entity Hall',
  'hall.highlight_org': 'Feature ideas in the organization Hall',
  'hall.moderate': 'Moderate Hall praise',
  'mural.manage': 'Publish on the idea wall and moderate the conversation (RN-148)',
  'store.manage': 'Manage the store: items, orders, bonuses and balance adjustments (RN-159)',
  'reward.register': 'Record rewards given (informational; RN-71)',
  'user.manage': 'Manage users and their roles',
  'role.manage': 'Manage roles and permissions',
  'entity.manage': 'Manage entities',
  'category.manage': 'Manage categories',
  'setting.manage': 'Change installation settings',
  'email.manage': 'Set up email sending, templates and see deliveries (RN-90)',
  'audit.view': 'Read the audit log',
  'ops.view': 'See system health and metrics (RN-92)',
  'sso.manage': 'Set up corporate access: domains and Microsoft/Google sign-in (RN-95 to RN-98)',
  'integration.manage':
    'Manage integrations (API and webhooks): master switch, modules, integrations, tokens and webhooks (RN-102, RN-117)',
};

const ROLE_EN: Record<string, string> = {
  collaborator: 'Employee',
  analyst: 'Analyst',
  manager: 'Manager',
  validator: 'Results validator',
  admin: 'Administrator',
};

const TEXT = {
  'pt-BR': { caption: 'Permissões de cada perfil de fábrica', permission: 'Permissão', yes: 'tem', no: 'não tem' },
  en: { caption: 'Permissions of each factory role', permission: 'Permission', yes: 'has it', no: 'does not' },
};

/** Matriz perfis de fábrica × permissões, direto do backend (os perfis podem ser editados depois). */
export function TabelaDePerfis() {
  const lang = useLang();
  const t = TEXT[lang];
  const perms = regras.permissions as Record<string, string>;
  return (
    <div className="table-wrap">
      <table>
        <caption className="sr-only">{t.caption}</caption>
        <thead>
          <tr>
            <th scope="col">{t.permission}</th>
            {regras.roles.map((r) => (
              <th key={r.key} scope="col" className="text-center">
                {lang === 'en' ? (ROLE_EN[r.key] ?? r.name) : r.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Object.keys(perms).map((code) => (
            <tr key={code}>
              <th scope="row" className="font-normal">
                {lang === 'en' ? (PERMISSION_EN[code] ?? code) : perms[code]}
              </th>
              {regras.roles.map((r) => {
                const has = r.permissions.includes(code);
                return (
                  <td key={r.key} className="text-center">
                    {has ? (
                      <Check aria-label={t.yes} className="mx-auto size-4 text-(--st-done)" />
                    ) : (
                      <span className="sr-only">{t.no}</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
