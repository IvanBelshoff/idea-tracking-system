import { TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CopyField } from '../../shared';

/**
 * O segredo completo, mostrado UMA ÚNICA VEZ (RN-120): depois só o prefixo fica visível. Fechar o
 * diálogo apaga o valor da memória da tela; não há como recuperá-lo.
 */
export function SecretDialog({ secret, name, onClose }: { secret: string; name: string; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent closeLabel={t('admin.common.close')} className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('admin.integrations.webhooks.secret.title', { name })}</DialogTitle>
          <DialogDescription>{t('admin.integrations.webhooks.secret.intro')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <p role="alert" className="flex items-start gap-2 rounded-md border border-(--st-late)/40 p-3 text-sm">
            <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-(--st-late)" />
            {t('admin.integrations.webhooks.secret.warning')}
          </p>
          <CopyField label={t('admin.integrations.webhooks.secret.label')} value={secret} />
          <p className="text-xs text-muted-foreground">{t('admin.integrations.webhooks.secret.use')}</p>
          <div className="flex justify-end">
            <Button onClick={onClose}>{t('admin.integrations.webhooks.secret.done')}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
