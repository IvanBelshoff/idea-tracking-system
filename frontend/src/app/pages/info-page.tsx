import { ExternalLink } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { HelpAnchor } from '../help';
import type { HelpTopic } from '../help-topics';
import { usePageTitle } from '../page-title';
import { usePublicSettings } from '../session';

/** Versão do ITS, lida do package.json no build (vite.config.ts). */
declare const __APP_VERSION__: string;

const GUIDES: { topic: HelpTopic; key: 'home' | 'statuses' | 'glossary' | 'rules' }[] = [
  { topic: 'home', key: 'home' },
  { topic: 'statuses', key: 'statuses' },
  { topic: 'glossary', key: 'glossary' },
  { topic: 'rules', key: 'rules' },
];

/** "Informações": onde aprender a usar o ITS e os dados desta instalação. */
export function InfoPage() {
  const { t } = useTranslation();
  const { data: settings } = usePublicSettings();
  usePageTitle(t('info.pageTitle'), settings?.organizationName);

  return (
    <div className="mx-auto max-w-[72rem]">
      <h1 className="text-[1.75rem] leading-tight font-bold">{t('info.title')}</h1>
      <p className="mt-1 max-w-[70ch] text-muted-foreground">{t('info.intro')}</p>

      <section aria-labelledby="ajuda" className="mt-8">
        <h2 id="ajuda" className="text-[1.25rem] font-bold">
          {t('info.help.title')}
        </h2>
        <p className="mt-1 max-w-[70ch] text-sm text-muted-foreground">{t('info.help.intro')}</p>
        <ul className="mt-4 divide-y rounded-lg border bg-card">
          {GUIDES.map((g) => (
            <li key={g.key}>
              <HelpAnchor
                topic={g.topic}
                className="flex items-start gap-3 px-4 py-3 hover:bg-foreground/[0.03] focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{t(`info.help.${g.key}.title`)}</span>
                  <span className="block text-sm text-muted-foreground">{t(`info.help.${g.key}.text`)}</span>
                </span>
                <ExternalLink aria-hidden="true" className="mt-1 size-4 shrink-0 text-muted-foreground" />
                <span className="sr-only">{t('info.help.newTab')}</span>
              </HelpAnchor>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="sobre" className="mt-10">
        <h2 id="sobre" className="text-[1.25rem] font-bold">
          {t('info.about.title')}
        </h2>
        <dl className="mt-4 grid max-w-xl grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          {settings?.organizationName && (
            <>
              <dt className="text-muted-foreground">{t('info.about.organization')}</dt>
              <dd className="font-medium">{settings.organizationName}</dd>
            </>
          )}
          <dt className="text-muted-foreground">{t('info.about.system')}</dt>
          <dd className="font-medium">{t('common.appName')}</dd>
          <dt className="text-muted-foreground">{t('info.about.version')}</dt>
          <dd className="font-num font-medium">{__APP_VERSION__}</dd>
          <dt className="text-muted-foreground">{t('info.about.license')}</dt>
          <dd className="font-medium">MIT</dd>
        </dl>
        <p className="mt-4 max-w-[70ch] text-sm text-muted-foreground">{t('info.about.support')}</p>
      </section>
    </div>
  );
}
