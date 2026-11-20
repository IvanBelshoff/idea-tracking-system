import { CircleHelp } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { HELP_TOPICS, type HelpTopic } from './help-topics';
import { usePublicSettings } from './session';

/**
 * Endereço de uma página da ajuda, no idioma da pessoa. A base vem da configuração `help.docs_url`
 * (padrão /ajuda/, o serviço "docs" no mesmo endereço do ITS).
 */
export function useHelpHref(): (topic: HelpTopic) => string {
  const { i18n } = useTranslation();
  const { data } = usePublicSettings();
  const base = data?.helpUrl ?? '/ajuda/';
  const lang = i18n.language === 'en' ? 'en' : 'pt-BR';
  return (topic) => {
    const slug = HELP_TOPICS[topic];
    return `${base}${lang}/${slug ? `${slug}/` : ''}`;
  };
}

/** Link para a ajuda, sempre em outra aba: quem está no meio de uma tarefa não perde o que fazia. */
export function HelpAnchor({
  topic,
  className,
  children,
  'aria-label': label,
}: {
  topic: HelpTopic;
  className?: string;
  children: ReactNode;
  'aria-label'?: string;
}) {
  const href = useHelpHref();
  return (
    <a href={href(topic)} target="_blank" rel="noopener noreferrer" className={className} aria-label={label}>
      {children}
    </a>
  );
}

/** "?" discreto ao lado do título de uma tela: abre a página da ajuda sobre ela. */
export function HelpLink({ topic }: { topic: HelpTopic }) {
  const { t } = useTranslation();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <HelpAnchor
          topic={topic}
          aria-label={t('help.aboutScreen')}
          className="inline-grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-foreground/5 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <CircleHelp aria-hidden="true" className="size-[1.1rem]" />
        </HelpAnchor>
      </TooltipTrigger>
      <TooltipContent>{t('help.aboutScreen')}</TooltipContent>
    </Tooltip>
  );
}
