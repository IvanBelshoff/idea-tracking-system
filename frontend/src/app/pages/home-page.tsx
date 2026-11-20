import { Link } from '@tanstack/react-router';
import { Inbox, Lightbulb, ListChecks, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ActiveCampaigns } from '../campaigns/campaigns-ui';
import { MuralFeed } from '../mural/mural-pages';
import { usePageTitle } from '../page-title';
import { type Permission, useCan, useMe, usePublicSettings } from '../session';

interface Shortcut {
  to: '/ideias/nova' | '/minhas-ideias' | '/ideias';
  title: string;
  text: string;
  Icon: LucideIcon;
  anyOf: Permission[];
}

export function HomePage() {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const can = useCan();
  const { data: settings } = usePublicSettings();
  usePageTitle(t('home.pageTitle'), settings?.organizationName);

  const shortcuts: Shortcut[] = [
    {
      to: '/ideias/nova',
      title: t('shell.nav.submit'),
      text: t('home.submitText'),
      Icon: Lightbulb,
      anyOf: ['idea.submit'],
    },
    {
      to: '/minhas-ideias',
      title: t('shell.nav.mine'),
      text: t('home.mineText'),
      Icon: ListChecks,
      anyOf: ['idea.submit'],
    },
    { to: '/ideias', title: t('shell.nav.queue'), text: t('home.queueText'), Icon: Inbox, anyOf: ['idea.view_scope'] },
  ];
  const visible = shortcuts.filter((s) => can(...s.anyOf));

  // Mural ligado (RN-148): o Início vira o mural, com "Minhas ideias e tarefas" ao lado (acima no celular).
  if (settings?.mural.enabled) {
    return (
      <div className="mx-auto max-w-6xl">
        <h1 className="text-[1.75rem] leading-tight font-bold">
          {t('home.greeting', { name: me?.name.split(' ')[0] ?? '' })}
        </h1>
        <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_20rem]">
          <aside aria-labelledby="minhas-tarefas" className="grid content-start gap-4 lg:order-2">
            <h2 id="minhas-tarefas" className="font-semibold">
              {t('mural.home.mine')}
            </h2>
            {visible.length > 0 && (
              <ul className="grid gap-3">
                {visible.map((s) => (
                  <li key={s.to}>
                    <Link
                      to={s.to}
                      className="flex items-start gap-3 rounded-lg border bg-card p-4 transition-colors hover:border-primary"
                    >
                      <s.Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-primary" />
                      <span>
                        <span className="block font-semibold">{s.title}</span>
                        <span className="mt-0.5 block text-sm text-muted-foreground">{s.text}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <ActiveCampaigns />
          </aside>
          <div className="min-w-0 lg:order-1">
            <MuralFeed />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-[1.75rem] leading-tight font-bold">
        {t('home.greeting', { name: me?.name.split(' ')[0] ?? '' })}
      </h1>
      <p className="mt-1 text-muted-foreground">{t('home.intro')}</p>
      {visible.length > 0 && (
        <section aria-labelledby="atalhos" className="mt-8">
          <h2 id="atalhos" className="sr-only">
            {t('home.shortcuts')}
          </h2>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {visible.map((s) => (
              <li key={s.to}>
                <Link
                  to={s.to}
                  className="flex h-full flex-col rounded-lg border bg-card p-5 transition-colors hover:border-primary"
                >
                  <s.Icon aria-hidden="true" className="size-5 text-primary" />
                  <span className="mt-3 font-semibold">{s.title}</span>
                  <span className="mt-1 text-sm text-muted-foreground">{s.text}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      <ActiveCampaigns />
    </div>
  );
}
