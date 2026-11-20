'use client';

import { Eye, EyeOff } from 'lucide-react';
import { useId, useState } from 'react';
import { NativeSelect } from '@/components/form/field';
import { Checkbox } from '@/components/ui/checkbox';
import { Regra } from '../components/doc-parts';
import { useLang } from '../components/use-lang';
import type { Lang } from '../i18n';
import { roleHas, scopeCovers, TREE } from './regras';

const NAMES: Record<string, Record<Lang, string>> = {
  org: { 'pt-BR': 'Organização', en: 'Organization' },
  'unidade-a': { 'pt-BR': 'Unidade A', en: 'Site A' },
  expedicao: { 'pt-BR': 'Expedição', en: 'Shipping' },
  producao: { 'pt-BR': 'Produção', en: 'Production' },
  'unidade-b': { 'pt-BR': 'Unidade B', en: 'Site B' },
  'camaras-frias': { 'pt-BR': 'Câmaras frias', en: 'Cold rooms' },
};
const depth = (id: string) => (TREE.find((e) => e.id === id)?.mpath.split('.').length ?? 2) - 2;

const TEXT = {
  'pt-BR': {
    where: 'A ideia "Gabarito na prensa 3", de Carla, está em',
    roles: { collaborator: 'Colaborador', analyst: 'Analista', manager: 'Gestor' } as Record<string, string>,
    inEntity: (role: string, entity: string) => `${role} em ${entity}`,
    children: 'incluindo sub-entidades',
    childrenOf: (name: string) => `Incluir as sub-entidades no perfil de ${name}`,
    sees: 'Vê',
    doesNot: 'Não vê',
    why: {
      author: 'é a autora: quem envia sempre vê a própria ideia',
      coauthor: 'é co-autora (apoiou a ideia)',
      scope: 'o perfil inclui ver as ideias desta entidade',
      collaborator: 'colaborador só vê as próprias ideias e as que apoia',
      outside: 'o perfil não vale na entidade da ideia',
    },
  },
  en: {
    where: 'The idea "Jig on press 3", by Carla, is in',
    roles: { collaborator: 'Employee', analyst: 'Analyst', manager: 'Manager' } as Record<string, string>,
    inEntity: (role: string, entity: string) => `${role} in ${entity}`,
    children: 'including sub-entities',
    childrenOf: (name: string) => `Include sub-entities in ${name}’s role`,
    sees: 'Sees it',
    doesNot: 'Does not see it',
    why: {
      author: 'is the author: whoever submits always sees their own idea',
      coauthor: 'is a co-author (supported the idea)',
      scope: 'their role includes seeing ideas in this entity',
      collaborator: 'an employee only sees their own ideas and the ones they support',
      outside: 'the role does not apply to the idea’s entity',
    },
  },
} satisfies Record<Lang, unknown>;

interface Person {
  name: string;
  role: 'collaborator' | 'analyst' | 'manager';
  entity: string;
  children: boolean;
  author?: boolean;
  coauthor?: boolean;
}
const PEOPLE: Person[] = [
  { name: 'Carla', role: 'collaborator', entity: 'producao', children: false, author: true },
  { name: 'Davi', role: 'collaborator', entity: 'producao', children: false },
  { name: 'Eva', role: 'collaborator', entity: 'camaras-frias', children: false, coauthor: true },
  { name: 'Bruno', role: 'analyst', entity: 'unidade-a', children: true },
  { name: 'Gil', role: 'manager', entity: 'unidade-a', children: false },
  { name: 'Bia', role: 'analyst', entity: 'unidade-b', children: true },
];

/** Simulador de escopo: quem enxerga uma ideia, conforme perfil, entidade e subentidades. */
export function QuemEnxerga() {
  const lang = useLang();
  const t = TEXT[lang];
  const [ideaAt, setIdeaAt] = useState('producao');
  const [people, setPeople] = useState(PEOPLE);
  const selectId = useId();

  const verdict = (p: Person): [boolean, keyof typeof t.why] => {
    if (p.author) return [true, 'author'];
    if (p.coauthor) return [true, 'coauthor'];
    if (!roleHas(p.role, 'idea.view_scope')) return [false, 'collaborator'];
    return scopeCovers(p.entity, p.children, ideaAt) ? [true, 'scope'] : [false, 'outside'];
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label htmlFor={selectId}>{t.where}</label>
        <NativeSelect id={selectId} value={ideaAt} onChange={(e) => setIdeaAt(e.target.value)} className="w-auto">
          {TREE.map((e) => (
            <option key={e.id} value={e.id}>
              {`${'  '.repeat(depth(e.id))}${NAMES[e.id]?.[lang] ?? e.id}`}
            </option>
          ))}
        </NativeSelect>
        <Regra id="RN-01" />
      </div>
      <ul className="divide-y border-y" aria-live="polite">
        {people.map((p, i) => {
          const [ok, why] = verdict(p);
          const scoped = roleHas(p.role, 'idea.view_scope');
          return (
            <li key={p.name} className="flex flex-wrap items-center gap-x-4 gap-y-2 p-3">
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{p.name}</span>
                <span className="block text-xs text-muted-foreground">
                  {t.inEntity(t.roles[p.role] ?? p.role, NAMES[p.entity]?.[lang] ?? p.entity)}
                </span>
                {scoped && (
                  <span className="mt-1 flex items-center gap-2 text-xs">
                    <Checkbox
                      checked={p.children}
                      aria-label={t.childrenOf(p.name)}
                      onCheckedChange={(v) =>
                        setPeople((all) => all.map((x, j) => (j === i ? { ...x, children: v === true } : x)))
                      }
                    />
                    {t.children}
                  </span>
                )}
              </span>
              <span className="w-full text-sm sm:w-64">
                <span
                  className={`flex items-center gap-1.5 font-semibold ${ok ? 'text-(--st-done)' : 'text-muted-foreground'}`}
                >
                  {ok ? (
                    <Eye aria-hidden="true" className="size-4" />
                  ) : (
                    <EyeOff aria-hidden="true" className="size-4" />
                  )}
                  {ok ? t.sees : t.doesNot}
                </span>
                <span className="block text-xs text-muted-foreground">{t.why[why]}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
