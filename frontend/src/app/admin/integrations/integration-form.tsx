import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { errorText, fieldErrors, unwrap } from '@/api/errors';
import { Field } from '@/components/form/field';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { FormError } from '../../auth/auth-layout';
import { useDates } from '../../use-dates';
import {
  type IntegrationsView,
  type IntegrationView,
  integrationKeys,
  MODULE_IDS,
  type ModuleId,
  WRITE_MODULE_IDS,
} from './queries';
import { orderedTree } from './scope-tree';

interface ScopeEntry {
  entityId: string;
  includeChildren: boolean;
}

/** Cria ou altera uma integração (RN-103). Na criação também se escolhe a validade do primeiro token (RN-104). */
export function IntegrationForm({
  view,
  integration,
  onClose,
  onCreated,
}: {
  view: IntegrationsView;
  /** Nulo = criar. */
  integration: IntegrationView | null;
  onClose: () => void;
  /** Só na criação: o token vem aqui, uma única vez. */
  onCreated: (token: string, created: IntegrationView) => void;
}) {
  const { t } = useTranslation();
  const dates = useDates();
  const qc = useQueryClient();
  const uid = useId();
  const [name, setName] = useState(integration?.name ?? '');
  const [owner, setOwner] = useState(integration?.owner ?? '');
  const [modules, setModules] = useState<string[]>(integration?.modules ?? []);
  const [scope, setScope] = useState<ScopeEntry[]>(
    integration?.scope.map((s) => ({ entityId: s.entityId, includeChildren: s.includeChildren })) ?? [],
  );
  const [rate, setRate] = useState(String(integration?.ratePerMinute ?? view.limits.defaultRatePerMinute));
  const [ips, setIps] = useState((integration?.ipAllowlist ?? []).join('\n'));
  const [includeEmail, setIncludeEmail] = useState(integration?.includeEmail ?? false);
  const [days, setDays] = useState(String(view.limits.suggestedTokenDays));

  const tree = orderedTree(view.entityOptions);
  const available = view.modules.filter((m) => m.enabled || modules.includes(m.id));
  const daysNumber = Number(days);
  const daysValid = Number.isInteger(daysNumber) && daysNumber >= 1 && daysNumber <= view.limits.maxTokenDays;
  const expiryDay = daysValid ? dates.dayFromToday(daysNumber) : null;

  const save = useMutation({
    meta: {
      success: (d: { token: string | null }) =>
        d.token ? t('feedback.integrations.created') : t('feedback.integrations.updated'),
    },
    mutationFn: async (): Promise<{ token: string | null; integration: IntegrationView }> => {
      const body = {
        name: name.trim(),
        owner: owner.trim(),
        modules: modules.filter((m): m is ModuleId => (MODULE_IDS as readonly string[]).includes(m)),
        scope,
        ratePerMinute: Number(rate),
        ipAllowlist: ips
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean),
        includeEmail,
      };
      if (integration) {
        const updated = await unwrap(
          api.PUT('/api/admin/integrations/{id}', { params: { path: { id: integration.id } }, body }),
        );
        return { token: null, integration: updated };
      }
      const created = await unwrap(
        api.POST('/api/admin/integrations', {
          body: { ...body, expiresAt: dates.dayStartIso(dates.dayFromToday(daysNumber)) ?? '' },
        }),
      );
      return { token: created.token, integration: created.integration };
    },
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: integrationKeys.view });
      if (data.token) onCreated(data.token, data.integration);
      onClose();
    },
  });

  const errors = fieldErrors(save.error);
  const toggleModule = (id: string, on: boolean) => setModules((m) => (on ? [...m, id] : m.filter((x) => x !== id)));
  const entry = (id: string) => scope.find((s) => s.entityId === id);
  const toggleEntity = (id: string, on: boolean) =>
    setScope((s) => (on ? [...s, { entityId: id, includeChildren: false }] : s.filter((x) => x.entityId !== id)));
  const setChildren = (id: string, includeChildren: boolean) =>
    setScope((s) => s.map((x) => (x.entityId === id ? { ...x, includeChildren } : x)));
  const canSave = name.trim() !== '' && (integration !== null || daysValid) && !save.isPending;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent closeLabel={t('admin.common.close')} className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {integration ? t('admin.integrations.form.editTitle') : t('admin.integrations.form.createTitle')}
          </DialogTitle>
        </DialogHeader>
        <form
          noValidate
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSave) save.mutate();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('admin.integrations.form.name')} error={errors.name}>
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
            </Field>
            <Field
              label={t('admin.integrations.form.owner')}
              hint={t('admin.integrations.form.ownerHint')}
              optionalLabel={t('common.optional')}
            >
              <Input value={owner} onChange={(e) => setOwner(e.target.value)} maxLength={200} />
            </Field>
          </div>

          <fieldset>
            <legend className="text-sm font-medium">{t('admin.integrations.form.modules')}</legend>
            <p className="mt-1 text-xs text-muted-foreground">{t('admin.integrations.form.modulesHint')}</p>
            {available.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">{t('admin.integrations.form.modulesNone')}</p>
            ) : (
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {MODULE_IDS.filter((id) => available.some((m) => m.id === id)).map((id) => (
                  <label key={id} htmlFor={`${uid}-m-${id}`} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      id={`${uid}-m-${id}`}
                      checked={modules.includes(id)}
                      onCheckedChange={(v) => toggleModule(id, v === true)}
                    />
                    <span>{t(`admin.integrations.modules.names.${id}`)}</span>
                    {id === 'users' && <Badge variant="destructive">{t('admin.integrations.modules.sensitive')}</Badge>}
                    {WRITE_MODULE_IDS.includes(id) && (
                      <Badge variant="secondary">{t('admin.integrations.modules.writes')}</Badge>
                    )}
                  </label>
                ))}
              </div>
            )}
          </fieldset>

          <fieldset>
            <legend className="text-sm font-medium">{t('admin.integrations.form.scope')}</legend>
            <p className="mt-1 text-xs text-muted-foreground">{t('admin.integrations.form.scopeHint')}</p>
            <div
              {...{ role: 'region', 'aria-label': t('admin.integrations.form.scope'), tabIndex: 0 }}
              className="mt-2 max-h-56 space-y-1.5 overflow-y-auto rounded-md border p-3 focus-visible:outline-2 focus-visible:outline-ring"
            >
              {tree.map(({ option: o, depth }) => {
                const chosen = entry(o.id);
                return (
                  <div
                    key={o.id}
                    className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm"
                    style={{ paddingLeft: `${depth * 1.25}rem` }}
                  >
                    <label htmlFor={`${uid}-e-${o.id}`} className="flex items-center gap-2">
                      <Checkbox
                        id={`${uid}-e-${o.id}`}
                        checked={!!chosen}
                        onCheckedChange={(v) => toggleEntity(o.id, v === true)}
                      />
                      <span>{o.name}</span>
                    </label>
                    {chosen && (
                      <label htmlFor={`${uid}-c-${o.id}`} className="flex items-center gap-2 text-muted-foreground">
                        <Checkbox
                          id={`${uid}-c-${o.id}`}
                          checked={chosen.includeChildren}
                          onCheckedChange={(v) => setChildren(o.id, v === true)}
                        />
                        <span>{t('admin.integrations.form.includeChildren')}</span>
                      </label>
                    )}
                  </div>
                );
              })}
            </div>
            {scope.length === 0 && (
              <p className="mt-2 text-sm text-(--st-late)">{t('admin.integrations.form.scopeEmpty')}</p>
            )}
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={t('admin.integrations.form.rate')}
              hint={t('admin.integrations.form.rateHint', { max: view.limits.maxRatePerMinute })}
              error={errors.ratePerMinute}
            >
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                max={view.limits.maxRatePerMinute}
                value={rate}
                onChange={(e) => setRate(e.target.value)}
              />
            </Field>
            {!integration && (
              <Field
                label={t('admin.integrations.form.tokenDays')}
                hint={
                  expiryDay
                    ? t('admin.integrations.form.tokenDaysHint', { date: dates.day(expiryDay) })
                    : t('admin.integrations.form.tokenDaysInvalid', { max: view.limits.maxTokenDays })
                }
                error={
                  daysValid
                    ? undefined
                    : t('admin.integrations.form.tokenDaysInvalid', { max: view.limits.maxTokenDays })
                }
              >
                <Input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={view.limits.maxTokenDays}
                  value={days}
                  onChange={(e) => setDays(e.target.value)}
                />
              </Field>
            )}
          </div>

          <Field
            label={t('admin.integrations.form.ips')}
            hint={t('admin.integrations.form.ipsHint', { max: view.limits.maxIpEntries })}
            optionalLabel={t('common.optional')}
          >
            <Textarea
              value={ips}
              onChange={(e) => setIps(e.target.value)}
              rows={3}
              spellCheck={false}
              className="font-mono text-xs"
              placeholder="203.0.113.7&#10;10.0.0.0/8"
            />
          </Field>

          <label htmlFor={`${uid}-email`} className="flex items-start gap-3 rounded-md border p-3 text-sm">
            <Checkbox
              id={`${uid}-email`}
              checked={includeEmail}
              onCheckedChange={(v) => setIncludeEmail(v === true)}
              className="mt-0.5"
            />
            <span>
              <span className="flex flex-wrap items-center gap-2 font-medium">
                {t('admin.integrations.form.includeEmail')}
                <Badge variant="destructive">{t('admin.integrations.modules.sensitive')}</Badge>
              </span>
              <span className="block text-muted-foreground">{t('admin.integrations.form.includeEmailHint')}</span>
            </span>
          </label>

          <FormError message={save.isError ? errorText(t, save.error) : null} />
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={!canSave}>
              {save.isPending
                ? t('admin.integrations.form.saving')
                : integration
                  ? t('admin.integrations.form.save')
                  : t('admin.integrations.form.create')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
