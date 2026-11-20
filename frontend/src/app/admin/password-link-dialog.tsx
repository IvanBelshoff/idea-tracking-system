import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useDates } from '../use-dates';
import { CopyField, passwordLinkUrl } from './shared';

/** Mostra o link de "definir senha" UMA vez, para o admin copiar e entregar (sem e-mail no M1). */
export function PasswordLinkDialog({
  link,
  onClose,
}: {
  link: { token: string; expiresAt: string } | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const dates = useDates();
  return (
    <Dialog open={!!link} onOpenChange={(open) => !open && onClose()}>
      <DialogContent closeLabel={t('admin.common.close')}>
        <DialogHeader>
          <DialogTitle>{t('admin.users.linkTitle')}</DialogTitle>
          <DialogDescription>{t('admin.users.linkIntro', { date: dates.dateTime(link?.expiresAt) })}</DialogDescription>
        </DialogHeader>
        {link && <CopyField label={t('admin.users.linkLabel')} value={passwordLinkUrl(link.token)} />}
        <DialogFooter>
          <Button onClick={onClose}>{t('admin.common.close')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
