import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { errorText, unwrap } from '@/api/errors';
import { Field, NativeSelect } from '@/components/form/field';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { FormError } from '../../auth/auth-layout';
import { Section } from '../shared';
import { type AccessView, accessKeys } from './queries';

/** Criação automática de conta no primeiro login corporativo (RN-98): desligada de fábrica. */
export function ProvisioningSection({ sso }: { sso: AccessView['sso'] }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const autoId = useId();
  const [autoCreate, setAutoCreate] = useState(sso.autoCreate);
  const [roleId, setRoleId] = useState(sso.defaultRoleId ?? '');
  const [entityId, setEntityId] = useState(sso.defaultEntityId ?? '');
  useEffect(() => {
    setAutoCreate(sso.autoCreate);
    setRoleId(sso.defaultRoleId ?? '');
    setEntityId(sso.defaultEntityId ?? '');
  }, [sso.autoCreate, sso.defaultRoleId, sso.defaultEntityId]);

  const save = useMutation({
    meta: { success: t('admin.access.provisioning.saved') },
    mutationFn: () =>
      unwrap(
        api.PUT('/api/admin/access/provisioning', {
          body: { autoCreate, roleId: roleId || null, entityId: entityId || null },
        }),
      ),
    onSuccess: (data) => qc.setQueryData(accessKeys.view, data),
  });
  const reset = () => save.reset();

  return (
    <Section title={t('admin.access.provisioning.title')} intro={t('admin.access.provisioning.intro')}>
      <div className="max-w-xl space-y-4">
        <label htmlFor={autoId} className="flex items-start gap-3 text-sm">
          <Checkbox
            id={autoId}
            checked={autoCreate}
            onCheckedChange={(v) => {
              reset();
              setAutoCreate(v === true);
            }}
            className="mt-0.5"
          />
          <span>
            <span className="block font-medium">{t('admin.access.provisioning.autoCreate')}</span>
            <span className="block text-muted-foreground">{t('admin.access.provisioning.autoCreateHint')}</span>
          </span>
        </label>
        <Field label={t('admin.access.provisioning.role')} hint={t('admin.access.provisioning.roleHint')}>
          <NativeSelect
            value={roleId}
            onChange={(e) => {
              reset();
              setRoleId(e.target.value);
            }}
          >
            <option value="">{t('admin.access.provisioning.choose')}</option>
            {sso.roleOptions
              .filter((r) => !r.administrative)
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
          </NativeSelect>
        </Field>
        <Field label={t('admin.access.provisioning.entity')}>
          <NativeSelect
            value={entityId}
            onChange={(e) => {
              reset();
              setEntityId(e.target.value);
            }}
          >
            <option value="">{t('admin.access.provisioning.choose')}</option>
            {sso.entityOptions.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <p className="text-xs text-muted-foreground">{t('admin.access.provisioning.limit')}</p>
        <FormError message={save.isError ? errorText(t, save.error) : null} />
        <div className="flex flex-wrap items-center gap-3">
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? t('admin.access.provisioning.saving') : t('admin.access.provisioning.save')}
          </Button>
        </div>
      </div>
    </Section>
  );
}
