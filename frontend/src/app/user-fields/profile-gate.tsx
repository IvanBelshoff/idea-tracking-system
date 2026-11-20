import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { unwrap } from '@/api/errors';
import { Button } from '@/components/ui/button';
import { AuthLayout } from '../auth/auth-layout';
import { keys, useCan, useMe } from '../session';
import { AppShell, useSignOut } from '../shell/app-shell';
import { useMyFields, userFieldKeys } from './queries';
import { ValuesForm } from './values-form';

/**
 * Cadastro obrigatório (M25, RN-197): com um campo obrigatório vazio, a pessoa vê só esta tela, com os que
 * faltam, até preencher. O servidor recusa o resto (428). Quem tem `setting.manage` pode deixar para depois
 * (acesso de emergência), e a escolha vale até sair.
 */
function CompleteProfile({ onLater }: { onLater?: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const form = useMyFields();
  const signOut = useSignOut();
  const save = useMutation({
    meta: { success: t('userFields.feedback.valuesSaved') },
    mutationFn: (values: { fieldId: string; value?: string | null; optionId?: string | null }[]) =>
      unwrap(api.PUT('/api/me/fields', { body: { values } })),
    onSuccess: (data) => {
      qc.setQueryData(userFieldKeys.mine, data);
      void qc.invalidateQueries({ queryKey: keys.me });
    },
  });
  const missing = form.data?.missing ?? [];
  const fields = (form.data?.fields ?? []).filter((f) => missing.includes(f.id));

  return (
    <AuthLayout
      wide
      pageTitle={t('userFields.gate.pageTitle')}
      title={t('userFields.gate.title')}
      intro={t('userFields.gate.intro')}
    >
      {form.data && (
        <div className="grid gap-4">
          <ValuesForm
            fields={fields}
            missing={missing}
            markMissing={false}
            pending={save.isPending}
            error={save.error}
            submitLabel={t('userFields.gate.submit')}
            onSave={(values) => save.mutate(values)}
            extraActions={
              <>
                {onLater && (
                  <Button type="button" variant="outline" onClick={onLater}>
                    {t('userFields.gate.later')}
                  </Button>
                )}
                <Button type="button" variant="ghost" onClick={() => signOut.mutate()}>
                  {t('userFields.gate.signOut')}
                </Button>
              </>
            }
          />
          {onLater && <p className="text-xs text-muted-foreground">{t('userFields.gate.laterHint')}</p>}
          <p className="text-xs text-muted-foreground">{t('userFields.gate.who')}</p>
        </div>
      )}
    </AuthLayout>
  );
}

/** A moldura da área logada, atrás do portão do cadastro obrigatório. */
export function SessionShell() {
  const { data: me } = useMe();
  const can = useCan();
  const [later, setLater] = useState(false);
  if (me && me.missingFields > 0 && !later) {
    return <CompleteProfile onLater={can('setting.manage') ? () => setLater(true) : undefined} />;
  }
  return <AppShell />;
}
