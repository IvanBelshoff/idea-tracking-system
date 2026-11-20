import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { ApiError, errorText, unwrap } from '@/api/errors';
import { Button } from '@/components/ui/button';
import { FormError } from '../../auth/auth-layout';
import { keys } from '../../session';
import { Section } from '../shared';
import { type AccessView, accessKeys } from './queries';

type Mode = AccessView['sso']['mode'];
const MODES: Mode[] = ['password', 'password_sso', 'sso'];

/** Como as pessoas entram: só senha, senha e SSO, ou só SSO (RN-97). */
export function ModeSection({ sso }: { sso: AccessView['sso'] }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const group = useId();
  const [mode, setMode] = useState<Mode>(sso.mode);
  useEffect(() => setMode(sso.mode), [sso.mode]);

  const save = useMutation({
    meta: { success: t('admin.access.mode.saved') },
    mutationFn: () => unwrap(api.PUT('/api/admin/access/mode', { body: { mode } })),
    onSuccess: (data) => {
      qc.setQueryData(accessKeys.view, data);
      void qc.invalidateQueries({ queryKey: keys.publicSettings });
    },
  });

  // O que impede cada modo (o servidor confere de novo): "Só senha" nunca bloqueia.
  const blockers = (m: Mode): string[] => {
    if (m === 'password') return [];
    const out = [...sso.modeBlockers];
    if (m === 'sso' && !sso.actorLinked) out.push('admin_not_linked');
    return out;
  };
  const serverBlockers =
    save.error instanceof ApiError && save.error.code === 'sso_mode_blocked'
      ? ((save.error.details as { blockers?: string[] } | undefined)?.blockers ?? [])
      : [];

  return (
    <Section title={t('admin.access.mode.title')} intro={t('admin.access.mode.intro')}>
      <fieldset className="max-w-xl space-y-3">
        <legend className="sr-only">{t('admin.access.mode.title')}</legend>
        {MODES.map((m) => {
          const missing = blockers(m);
          const disabled = missing.length > 0 && m !== sso.mode;
          const id = `${group}-${m}`;
          return (
            <div key={m} className="rounded-md border p-3">
              <label htmlFor={id} className="flex items-start gap-3">
                <input
                  id={id}
                  type="radio"
                  name={group}
                  checked={mode === m}
                  disabled={disabled}
                  onChange={() => {
                    save.reset();
                    setMode(m);
                  }}
                  className="mt-1 size-4 accent-primary"
                />
                <span className="text-sm">
                  <span className="block font-medium">{t(`admin.access.mode.${m}.label`)}</span>
                  <span className="block text-muted-foreground">{t(`admin.access.mode.${m}.text`)}</span>
                </span>
              </label>
              {disabled && (
                <div className="mt-2 pl-7 text-xs text-muted-foreground">
                  <p className="font-medium">{t('admin.access.mode.blocked')}</p>
                  <ul className="list-disc pl-4">
                    {missing.map((b) => (
                      <li key={b}>{t(`admin.access.mode.modeBlockers.${b}` as never)}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          );
        })}
      </fieldset>
      {serverBlockers.length > 0 && (
        <ul className="mt-3 list-disc pl-5 text-sm text-destructive">
          {serverBlockers.map((b) => (
            <li key={b}>{t(`admin.access.mode.modeBlockers.${b}` as never)}</li>
          ))}
        </ul>
      )}
      <div className="mt-4 space-y-3">
        <FormError message={save.isError && serverBlockers.length === 0 ? errorText(t, save.error) : null} />
        <div className="flex flex-wrap items-center gap-3">
          <Button disabled={save.isPending || mode === sso.mode} onClick={() => save.mutate()}>
            {save.isPending ? t('admin.access.mode.saving') : t('admin.access.mode.save')}
          </Button>
        </div>
      </div>
    </Section>
  );
}
