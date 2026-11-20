import { useTranslation } from 'react-i18next';
import { errorText } from '@/api/errors';
import { Button } from '@/components/ui/button';
import { FormError } from '../../auth/auth-layout';

/** Falha ao ler um bloco da tela: o motivo e um botão para tentar de novo, sem derrubar os outros blocos. */
export function LoadFailure({
  message,
  error,
  retrying,
  onRetry,
}: {
  message: string;
  error: unknown;
  retrying: boolean;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3">
      <FormError message={`${message} ${errorText(t, error)}`} />
      <Button variant="outline" onClick={onRetry} disabled={retrying}>
        {t('common.retry')}
      </Button>
    </div>
  );
}
