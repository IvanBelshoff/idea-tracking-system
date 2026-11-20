import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { ApiError, errorText, unwrap } from '@/api/errors';
import { Field } from '@/components/form/field';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { FormError } from '../../auth/auth-layout';
import { Section } from '../shared';
import { type AccessView, accessKeys } from './queries';

/** Uma linha por domínio; vírgula e ponto e vírgula também separam; linhas vazias somem. */
function parseDomains(text: string): string[] {
  return text
    .split(/[\n,;]+/)
    .map((d) => d.trim())
    .filter((d) => d !== '');
}

/**
 * Domínios da organização e e-mail de fora (RN-95). Lista vazia = sem restrição; com a lista
 * preenchida, só se cadastra e-mail desses domínios, salvo se o e-mail de fora estiver aceito.
 */
export function DomainsSection({ access }: { access: AccessView }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [allowExternal, setAllowExternal] = useState(false);
  const externalId = useId();

  useEffect(() => {
    setText(access.policy.domains.join('\n'));
    setAllowExternal(access.policy.allowExternal);
  }, [access.policy]);

  const save = useMutation({
    meta: { success: t('admin.access.domains.saved') },
    mutationFn: () =>
      unwrap(api.PUT('/api/admin/access/policy', { body: { domains: parseDomains(text), allowExternal } })),
    onSuccess: (data) => qc.setQueryData(accessKeys.view, data),
  });
  const invalid = save.error instanceof ApiError && save.error.code === 'validation_failed';

  return (
    <Section title={t('admin.access.domains.title')} intro={t('admin.access.domains.intro')}>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
        className="max-w-xl space-y-4"
      >
        <Field label={t('admin.access.domains.list')} hint={t('admin.access.domains.listHint')}>
          <Textarea
            rows={3}
            value={text}
            spellCheck={false}
            autoCapitalize="none"
            onChange={(e) => {
              save.reset();
              setText(e.target.value);
            }}
          />
        </Field>
        <label htmlFor={externalId} className="flex items-start gap-3 text-sm">
          <Checkbox
            id={externalId}
            checked={allowExternal}
            onCheckedChange={(v) => {
              save.reset();
              setAllowExternal(v === true);
            }}
            className="mt-0.5"
          />
          <span>
            <span className="block font-medium">{t('admin.access.domains.allowExternal')}</span>
            <span className="block text-muted-foreground">{t('admin.access.domains.allowExternalHint')}</span>
          </span>
        </label>
        <FormError
          message={save.isError ? (invalid ? t('admin.access.domains.invalid') : errorText(t, save.error)) : null}
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? t('admin.access.domains.saving') : t('admin.access.domains.save')}
          </Button>
        </div>
      </form>

      {access.outsideTotal > 0 && (
        <div className="mt-6 max-w-xl border-t pt-4">
          <h3 className="text-sm font-medium">{t('admin.access.domains.outsideTitle')}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('admin.access.domains.outsideText', { count: access.outsideTotal })}
          </p>
          <ul className="mt-2 space-y-1 text-sm">
            {access.outsideUsers.map((u) => (
              <li key={u.id} className="flex flex-wrap gap-x-2">
                <span className="font-medium">{u.name}</span>
                <span className="text-muted-foreground">{u.email}</span>
              </li>
            ))}
          </ul>
          {access.outsideTotal > access.outsideUsers.length && (
            <p className="mt-2 text-xs text-muted-foreground">
              {t('admin.access.domains.outsideMore', { shown: access.outsideUsers.length })}
            </p>
          )}
        </div>
      )}
    </Section>
  );
}
