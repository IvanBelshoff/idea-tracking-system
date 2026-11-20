import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { errorText, unwrap } from '@/api/errors';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { FormError } from '../../auth/auth-layout';
import { Section } from '../shared';
import { type IntegrationsView, integrationKeys, MODULE_IDS, type ModuleId } from './queries';

/** A chave geral da API de integração (RN-102): desligada de fábrica; ligar exige o endereço em HTTPS. */
export function GeneralSection({ view }: { view: IntegrationsView }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const toggle = useMutation({
    meta: { success: (_d, on: boolean) => (on ? t('feedback.integrations.on') : t('feedback.integrations.off')) },
    mutationFn: (enabled: boolean) => unwrap(api.PUT('/api/admin/integrations/enabled', { body: { enabled } })),
    onSuccess: (data) => qc.setQueryData(integrationKeys.view, data),
  });
  const blocked = !view.enabled && view.blockers.length > 0;
  return (
    <Section title={t('admin.integrations.general.title')} intro={t('admin.integrations.general.intro')}>
      <div className="space-y-4">
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <Badge variant={view.enabled ? 'default' : 'outline'}>
            {view.enabled ? t('admin.integrations.general.on') : t('admin.integrations.general.off')}
          </Badge>
          <span className="text-muted-foreground">
            {view.enabled ? t('admin.integrations.general.onText') : t('admin.integrations.general.offText')}
          </span>
        </p>
        {blocked && (
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {view.blockers.map((b) => (
              <li key={b}>
                {t(
                  `admin.integrations.general.blockers.${b === 'https_required' ? 'https_required' : 'app_url_required'}`,
                )}
              </li>
            ))}
          </ul>
        )}
        {view.baseUrl && (
          <p className="text-sm">
            <span className="text-muted-foreground">{t('admin.integrations.general.baseUrl')}</span>{' '}
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{view.baseUrl}</code>
          </p>
        )}
        <FormError message={toggle.isError ? errorText(t, toggle.error) : null} />
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant={view.enabled ? 'outline' : 'default'}
            disabled={toggle.isPending || blocked}
            onClick={() => toggle.mutate(!view.enabled)}
          >
            {view.enabled ? t('admin.integrations.general.turnOff') : t('admin.integrations.general.turnOn')}
          </Button>
        </div>
      </div>
    </Section>
  );
}

/** Os módulos ligados (RN-102): cada um é uma capacidade da API; o de usuários é o sensível. */
export function ModulesSection({ view }: { view: IntegrationsView }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const base = useId();
  const initial = MODULE_IDS.filter((id) => view.modules.some((m) => m.id === id && m.enabled));
  const [selected, setSelected] = useState<ModuleId[]>(initial);
  const key = initial.join(',');
  // biome-ignore lint/correctness/useExhaustiveDependencies: recarrega só quando a lista salva muda
  useEffect(() => setSelected(initial), [key]);
  const save = useMutation({
    meta: { success: t('admin.integrations.modules.saved') },
    mutationFn: () => unwrap(api.PUT('/api/admin/integrations/modules', { body: { modules: selected } })),
    onSuccess: (data) => qc.setQueryData(integrationKeys.view, data),
  });
  const dirty = [...selected].sort().join(',') !== [...initial].sort().join(',');
  return (
    <Section title={t('admin.integrations.modules.title')} intro={t('admin.integrations.modules.intro')}>
      <div className="max-w-2xl space-y-4">
        <div className="space-y-3">
          {MODULE_IDS.map((id) => {
            const meta = view.modules.find((m) => m.id === id);
            return (
              <label key={id} htmlFor={`${base}-${id}`} className="flex items-start gap-3 text-sm">
                <Checkbox
                  id={`${base}-${id}`}
                  checked={selected.includes(id)}
                  onCheckedChange={(v) => {
                    save.reset();
                    setSelected((s) => (v === true ? [...s, id] : s.filter((x) => x !== id)));
                  }}
                  className="mt-0.5"
                />
                <span>
                  <span className="flex flex-wrap items-center gap-2 font-medium">
                    {t(`admin.integrations.modules.names.${id}`)}
                    {meta?.sensitive && (
                      <Badge variant="destructive">{t('admin.integrations.modules.sensitive')}</Badge>
                    )}
                    {meta?.writes && <Badge variant="secondary">{t('admin.integrations.modules.writes')}</Badge>}
                  </span>
                  <span className="block text-muted-foreground">{t(`admin.integrations.modules.hints.${id}`)}</span>
                </span>
              </label>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">{t('admin.integrations.modules.effect')}</p>
        <FormError message={save.isError ? errorText(t, save.error) : null} />
        <div className="flex flex-wrap items-center gap-3">
          <Button disabled={save.isPending || !dirty} onClick={() => save.mutate()}>
            {save.isPending ? t('admin.integrations.modules.saving') : t('admin.integrations.modules.save')}
          </Button>
        </div>
      </div>
    </Section>
  );
}
