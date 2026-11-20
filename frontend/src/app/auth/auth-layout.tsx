import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { CoBrand } from '@/components/brand/co-brand';
import { HelpAnchor } from '../help';
import type { HelpTopic } from '../help-topics';
import { usePageTitle } from '../page-title';
import { usePublicSettings } from '../session';
import { AccessLayout } from './access-layout';

/**
 * Moldura das telas sem login: símbolo, nome da organização e um cartão central. Com `access` (entrar,
 * esqueci a senha, definir a senha), vira a tela de login da organização (M23, RN-176); o assistente de
 * instalação e a consulta pública ficam nesta moldura.
 */
export function AuthLayout(props: {
  pageTitle: string;
  title: string;
  intro?: ReactNode;
  wide?: boolean;
  access?: boolean;
  /** Página da ajuda do rodapé (fora das telas de acesso); sem ela, a página inicial da ajuda. */
  help?: HelpTopic;
  children: ReactNode;
}) {
  if (props.access) return <AccessLayout {...props} />;
  return <PlainLayout {...props} />;
}

function PlainLayout({
  pageTitle,
  title,
  intro,
  wide,
  help,
  children,
}: {
  pageTitle: string;
  title: string;
  intro?: ReactNode;
  wide?: boolean;
  help?: HelpTopic;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const { data: settings } = usePublicSettings();
  const organization = settings?.organizationName || t('common.appName');
  usePageTitle(pageTitle, settings?.organizationName);

  return (
    // Centralizado nos dois eixos; em tela baixa (ou formulário longo) rola normalmente a partir do topo.
    <div className="flex min-h-svh items-center justify-center bg-muted/40 px-4 py-10">
      <main className={`w-full ${wide ? 'max-w-xl' : 'max-w-sm'}`}>
        <div className="mb-8 flex flex-col items-center gap-2">
          <CoBrand name={organization} subtitle={t('common.appFullName')} logo={settings?.logo} size="lg" />
          {(settings?.logo?.light ?? null) !== null && (
            <span className="text-xs text-muted-foreground">{t('common.appFullName')}</span>
          )}
        </div>
        <div className="rounded-xl border bg-card p-6 shadow-sm sm:p-8">
          <h1 className="text-xl font-bold">{title}</h1>
          {intro && <div className="mt-2 text-sm text-muted-foreground">{intro}</div>}
          <div className="mt-6">{children}</div>
        </div>
        <p className="mt-6 text-center text-sm text-muted-foreground">
          <HelpAnchor topic={help ?? 'home'} className="underline underline-offset-4 hover:text-foreground">
            {t('help.needHelp')}
          </HelpAnchor>
        </p>
      </main>
    </div>
  );
}

/** Mensagem de erro do formulário, anunciada pelo leitor de tela. */
export function FormError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
    >
      {message}
    </p>
  );
}
