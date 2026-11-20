import { TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CopyField } from '../shared';

/**
 * O token completo, mostrado UMA ÚNICA VEZ (RN-104): depois só o prefixo fica visível. Fechar o
 * diálogo apaga o valor da memória da tela; não há como recuperá-lo.
 */
export function TokenDialog({ token, name, onClose }: { token: string; name: string; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent closeLabel={t('admin.common.close')} className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('admin.integrations.token.title', { name })}</DialogTitle>
          <DialogDescription>{t('admin.integrations.token.intro')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <p role="alert" className="flex items-start gap-2 rounded-md border border-(--st-late)/40 p-3 text-sm">
            <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-(--st-late)" />
            {t('admin.integrations.token.warning')}
          </p>
          <CopyField label={t('admin.integrations.token.label')} value={token} />
          <p className="text-xs text-muted-foreground">{t('admin.integrations.token.use')}</p>
          <div className="flex justify-end">
            <Button onClick={onClose}>{t('admin.integrations.token.done')}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
