import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { buttonVariants } from '@/components/ui/button';
import { usePageTitle } from '../page-title';

function StatusPage({ code, title, text }: { code: string; title: string; text: string }) {
  const { t } = useTranslation();
  usePageTitle(title);
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <p className="font-mono text-sm text-muted-foreground">{code}</p>
      <h1 className="mt-2 text-2xl font-bold">{title}</h1>
      <p className="mt-2 text-muted-foreground">{text}</p>
      <Link to="/" className={`${buttonVariants({ variant: 'outline' })} mt-6`}>
        {t('common.goHome')}
      </Link>
    </div>
  );
}

export function NotFoundPage() {
  const { t } = useTranslation();
  return <StatusPage code="404" title={t('pages.notFoundTitle')} text={t('pages.notFoundText')} />;
}

export function ForbiddenPage() {
  const { t } = useTranslation();
  return <StatusPage code="403" title={t('pages.forbiddenTitle')} text={t('pages.forbiddenText')} />;
}
