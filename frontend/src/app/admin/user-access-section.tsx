import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { errorText, unwrap } from '@/api/errors';
import type { components } from '@/api/schema';
import { ProviderLogo } from '@/components/brand/provider-logos';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { FormError } from '../auth/auth-layout';
import { useDates } from '../use-dates';
import { adminKeys } from './queries';

type UserDetail = components['schemas']['UserDetail'];

/**
 * Como a pessoa entra (RN-96, RN-97): as contas corporativas vinculadas e, no modo "Só SSO", o
 * aviso de que ela não usa senha. O administrador pode desvincular (o vínculo se refaz no próximo
 * login corporativo, pelo e-mail).
 */
export function UserAccessSection({ user }: { user: UserDetail }) {
  const { t } = useTranslation();
  const dates = useDates();
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState<string | null>(null);
  const unlink = useMutation({
    meta: { success: t('feedback.users.unlinked') },
    mutationFn: (provider: string) =>
      unwrap(api.DELETE('/api/users/{id}/identities/{provider}', { params: { path: { id: user.id, provider } } })),
    onSuccess: (u) => {
      qc.setQueryData(adminKeys.user(user.id), u);
      void qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      setConfirm(null);
    },
  });
  const name = (provider: string) => t(`admin.access.providers.${provider === 'google' ? 'google' : 'microsoft'}`);

  return (
    <div className="space-y-3">
      <p className="text-sm">
        {user.canUsePassword ? t('admin.users.access.password') : t('admin.users.access.ssoOnly')}
      </p>
      {user.identities.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('admin.users.access.none')}</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {user.identities.map((i) => (
            <li key={i.provider} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5">
              <span className="flex items-center gap-2.5 text-sm">
                <ProviderLogo provider={i.provider} className="size-4 shrink-0" />
                <span>
                  <span className="block font-medium">{name(i.provider)}</span>
                  <span className="block text-xs text-muted-foreground">
                    {t('admin.users.access.linkedAt', { when: dates.dateTime(i.linkedAt) })} ·{' '}
                    {i.lastLoginAt
                      ? t('admin.users.access.lastLogin', { when: dates.dateTime(i.lastLoginAt) })
                      : t('admin.users.access.neverLogin')}
                  </span>
                </span>
              </span>
              <Button variant="outline" size="sm" onClick={() => setConfirm(i.provider)}>
                {t('admin.users.access.unlink')}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">{t('admin.users.access.emailKey')}</p>
      <FormError message={unlink.isError ? errorText(t, unlink.error) : null} />
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={t('admin.users.access.unlinkTitle', { provider: confirm ? name(confirm) : '' })}
        description={t('admin.users.access.unlinkText')}
        confirmLabel={t('admin.users.access.unlink')}
        cancelLabel={t('common.cancel')}
        destructive
        pending={unlink.isPending}
        onConfirm={() => confirm && unlink.mutate(confirm)}
      />
    </div>
  );
}
