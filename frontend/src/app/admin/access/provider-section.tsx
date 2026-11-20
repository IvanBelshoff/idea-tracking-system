import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Power, PowerOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { errorText, unwrap } from '@/api/errors';
import { ProviderLogo } from '@/components/brand/provider-logos';
import { Field } from '@/components/form/field';
import { PasswordInput } from '@/components/form/password';
import { SensitiveInput } from '@/components/form/sensitive';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { FormError } from '../../auth/auth-layout';
import { keys } from '../../session';
import { useDates } from '../../use-dates';
import { CopyField, Section, SuccessNote } from '../shared';
import { type AccessView, accessKeys } from './queries';

type Provider = AccessView['sso']['providers'][number];

/** Traduz um código `sso_*` (da API ou do retorno do provedor) para a pessoa. */
export function ssoReason(t: (key: never) => string, code: string | null): string {
  if (!code) return '';
  const key = `errors.${code}`;
  const text = t(key as never);
  return text === key ? t('errors.unknown' as never) : text;
}

function ProviderCard({ provider, sso }: { provider: Provider; sso: AccessView['sso'] }) {
  const { t } = useTranslation();
  const dates = useDates();
  const qc = useQueryClient();
  const isMs = provider.provider === 'microsoft';
  const name = t(`admin.access.providers.${provider.provider}`);
  const [clientId, setClientId] = useState(provider.clientId);
  const [tenantId, setTenantId] = useState(provider.tenantId ?? '');
  const [secret, setSecret] = useState('');
  const [expires, setExpires] = useState(provider.secretExpiresOn ?? '');
  const [addressResult, setAddressResult] = useState<{ ok: boolean; error: string | null } | null>(null);

  useEffect(() => {
    setClientId(provider.clientId);
    setTenantId(provider.tenantId ?? '');
    setSecret('');
    setExpires(provider.secretExpiresOn ?? '');
  }, [provider.clientId, provider.tenantId, provider.secretExpiresOn]);

  const done = (data: AccessView) => {
    qc.setQueryData(accessKeys.view, data);
    void qc.invalidateQueries({ queryKey: keys.publicSettings });
  };
  const path = { params: { path: { provider: provider.provider } } };
  const save = useMutation({
    meta: { success: t('admin.access.provider.saved') },
    mutationFn: () =>
      unwrap(
        api.PUT('/api/admin/access/providers/{provider}', {
          ...path,
          body: {
            clientId: clientId.trim(),
            tenantId: isMs ? tenantId.trim() : null,
            ...(secret ? { clientSecret: secret } : {}),
            // Segredo novo com a data antiga: omite a data, e o servidor a apaga (era a do segredo antigo; RN-100).
            ...(secret && expires === (provider.secretExpiresOn ?? '') ? {} : { secretExpiresOn: expires || null }),
          },
        }),
      ),
    onSuccess: (data) => {
      setSecret('');
      setAddressResult(null);
      done(data);
    },
  });
  const testAddress = useMutation({
    meta: { silent: true },
    mutationFn: () => unwrap(api.POST('/api/admin/access/providers/{provider}/test-address', path)),
    onSuccess: setAddressResult,
  });
  const toggle = useMutation({
    meta: { success: (_d, on: boolean) => (on ? t('feedback.access.providerOn') : t('feedback.access.providerOff')) },
    mutationFn: (on: boolean) =>
      unwrap(
        on
          ? api.POST('/api/admin/access/providers/{provider}/enable', path)
          : api.POST('/api/admin/access/providers/{provider}/disable', path),
      ),
    onSuccess: done,
  });

  const photo = useMutation({
    meta: {
      success: (_d, enabled: boolean) =>
        t(enabled ? 'admin.access.provider.photoOn' : 'admin.access.provider.photoOff'),
    },
    mutationFn: (enabled: boolean) =>
      unwrap(api.PUT('/api/admin/access/providers/{provider}/photo', { ...path, body: { enabled } })),
    onSuccess: done,
  });

  const status = provider.enabled ? 'statusOn' : provider.configured ? 'statusOff' : 'statusMissing';
  const error = [save, testAddress, toggle, photo].find((m) => m.isError)?.error;
  const photoId = `foto-${provider.provider}`;

  return (
    <Section title={name}>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <ProviderLogo provider={provider.provider} className="size-5" />
        {provider.enabled ? (
          <Badge className="bg-(--st-done-fill) text-(--st-done-on)">{t(`admin.access.provider.${status}`)}</Badge>
        ) : (
          <Badge variant="secondary">{t(`admin.access.provider.${status}`)}</Badge>
        )}
      </div>

      <div className="mb-4 max-w-xl space-y-1.5">
        <p className="text-sm font-medium">{t('admin.access.provider.redirect')}</p>
        {provider.redirectUri ? (
          <CopyField label={t('admin.access.provider.redirect')} value={provider.redirectUri} />
        ) : (
          <p className="text-sm text-muted-foreground">{t('admin.access.provider.redirectMissing')}</p>
        )}
      </div>

      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
        className="max-w-xl space-y-4"
      >
        <Field label={t('admin.access.provider.clientId')}>
          <SensitiveInput
            fieldLabel={t('admin.access.provider.clientId')}
            hideOn={save.isSuccess}
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
          />
        </Field>
        {isMs && (
          <Field label={t('admin.access.provider.tenantId')} hint={t('admin.access.provider.tenantHint')}>
            <SensitiveInput
              fieldLabel={t('admin.access.provider.tenantId')}
              hideOn={save.isSuccess}
              value={tenantId}
              onChange={(e) => setTenantId(e.target.value)}
            />
          </Field>
        )}
        <Field label={t('admin.access.provider.clientSecret')} hint={t('admin.access.provider.secretHint')}>
          <PasswordInput
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            autoComplete="new-password"
            placeholder={
              provider.clientSecretSet ? t('admin.access.provider.secretSet') : t('admin.access.provider.secretEmpty')
            }
          />
        </Field>
        <Field label={t('admin.access.provider.secretExpiresOn')} hint={t('admin.access.provider.secretExpiresHint')}>
          <Input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} className="max-w-48" />
        </Field>
        {!sso.secretKeyReady && <FormError message={t('errors.secret_key_missing')} />}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={save.isPending || clientId.trim() === ''}>
            {save.isPending ? t('admin.access.provider.saving') : t('admin.access.provider.save')}
          </Button>
        </div>
      </form>

      <div className="mt-6 max-w-xl space-y-3 border-t pt-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="outline"
            disabled={!provider.configured || testAddress.isPending}
            onClick={() => testAddress.mutate()}
          >
            {t('admin.access.provider.testAddress')}
          </Button>
          <Button
            variant="outline"
            disabled={!provider.configured}
            onClick={() => {
              window.location.href = `/api/auth/sso/${provider.provider}/start?teste=1`;
            }}
          >
            <ProviderLogo provider={provider.provider} className="size-4" />
            {t('admin.access.provider.testLogin')}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">{t('admin.access.provider.testLoginHint')}</p>
        {addressResult &&
          (addressResult.ok ? (
            <SuccessNote message={t('admin.access.provider.testAddressOk')} />
          ) : (
            <FormError
              message={t('admin.access.provider.testAddressFail', { reason: ssoReason(t, addressResult.error) })}
            />
          ))}
        <p className="text-sm text-muted-foreground">
          {provider.lastTestAt
            ? provider.lastTestOk
              ? t('admin.access.provider.lastTestOk', { when: dates.dateTime(provider.lastTestAt) })
              : t('admin.access.provider.lastTestFail', {
                  when: dates.dateTime(provider.lastTestAt),
                  reason: ssoReason(t, provider.lastTestError),
                })
            : t('admin.access.provider.neverTested')}
        </p>
      </div>

      {/* Foto do perfil vinda do provedor (RN-144): desligada de fábrica. */}
      <div className="mt-4 max-w-xl space-y-1.5 border-t pt-4">
        <div className="flex items-center gap-2 text-sm">
          <Checkbox
            id={photoId}
            checked={provider.photoEnabled}
            disabled={!provider.configured || photo.isPending}
            onCheckedChange={(v) => photo.mutate(v === true)}
            aria-describedby={`${photoId}-hint`}
          />
          <label htmlFor={photoId} className="font-medium">
            {t('admin.access.provider.photoLabel')}
          </label>
        </div>
        <div id={`${photoId}-hint`} className="space-y-1 text-xs text-muted-foreground">
          <p>{t('admin.access.provider.photoHint')}</p>
          {isMs && <p>{t('admin.access.provider.photoHintMicrosoft')}</p>}
        </div>
      </div>

      <div className="mt-4 max-w-xl space-y-3 border-t pt-4">
        {!provider.enabled && provider.blockers.length > 0 && (
          <div className="text-sm">
            <p className="font-medium">{t('admin.access.provider.missingTitle')}</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted-foreground">
              {provider.blockers.map((b) => (
                <li key={b}>{t(`admin.access.blockers.${b}` as never)}</li>
              ))}
            </ul>
          </div>
        )}
        <FormError message={error ? errorText(t, error) : null} />
        {provider.enabled ? (
          <Button variant="outline" disabled={toggle.isPending} onClick={() => toggle.mutate(false)}>
            <PowerOff aria-hidden="true" />
            {t('admin.access.provider.turnOff')}
          </Button>
        ) : (
          <Button disabled={provider.blockers.length > 0 || toggle.isPending} onClick={() => toggle.mutate(true)}>
            <Power aria-hidden="true" />
            {t('admin.access.provider.turnOn')}
          </Button>
        )}
      </div>
    </Section>
  );
}

/** Um bloco por provedor (Microsoft e Google): cliente, segredo, teste e ligar (RN-96, RN-97). */
export function ProvidersSection({ sso }: { sso: AccessView['sso'] }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-semibold">{t('admin.access.providers.title')}</h2>
        <p className="mt-1 max-w-[70ch] text-sm text-muted-foreground">{t('admin.access.providers.intro')}</p>
      </div>
      {sso.providers.map((p) => (
        <ProviderCard key={p.provider} provider={p} sso={sso} />
      ))}
    </div>
  );
}
