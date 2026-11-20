import { Lock } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorText } from '@/api/errors';
import { Field, NativeSelect } from '@/components/form/field';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { FormError } from '../auth/auth-layout';
import { type NotificationPreferences, useNotificationPreferences, useSaveNotificationPreferences } from './queries';

type EventPrefs = NotificationPreferences['events'];

const DAY_OPTIONS = Array.from({ length: 31 }, (_, n) => n);

/**
 * Preferências de notificação (RN-30): por evento, na aplicação e por e-mail. Decisões sobre a
 * própria ideia ficam travadas (sempre chegam). Dias de antecedência do alerta de prazo (RN-29).
 */
export function NotificationPreferencesForm() {
  const { t } = useTranslation();
  const prefs = useNotificationPreferences();
  const save = useSaveNotificationPreferences();
  const [events, setEvents] = useState<EventPrefs>([]);
  const [days, setDays] = useState<string>('');

  useEffect(() => {
    if (!prefs.data) return;
    setEvents(prefs.data.events);
    setDays(prefs.data.deadlineAlertDays === null ? '' : String(prefs.data.deadlineAlertDays));
  }, [prefs.data]);

  if (!prefs.data) return prefs.isError ? <FormError message={errorText(t, prefs.error)} /> : null;
  const { emailActive, defaultDeadlineAlertDays } = prefs.data;

  const toggle = (type: string, channel: 'inApp' | 'email', value: boolean) => {
    save.reset();
    setEvents((list) => list.map((e) => (e.type === type ? { ...e, [channel]: value } : e)));
  };
  // O grupo do mural só vem da API com o módulo ligado (RN-156); grupo vazio não aparece.
  const groups = (['author', 'team', 'mural', 'store'] as const)
    .map((group) => ({ group, items: events.filter((e) => e.group === group) }))
    .filter((g) => g.items.length > 0);

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate({
          events: events.map(({ type, inApp, email }) => ({ type, inApp, email })),
          deadlineAlertDays: days === '' ? null : Number(days),
        });
      }}
      className="space-y-5"
    >
      {!emailActive && <p className="text-sm text-muted-foreground">{t('notifications.prefs.emailOff')}</p>}
      {groups.map(({ group, items }) => (
        <details key={group} className="rounded-md border">
          <summary className="cursor-pointer px-3 py-2.5 text-sm font-medium select-none">
            {t(`notifications.prefs.groups.${group}`)}
          </summary>
          <section
            aria-label={t(`notifications.prefs.groups.${group}`)}
            // biome-ignore lint/a11y/noNoninteractiveTabindex: região rolável precisa de foco para o teclado (axe)
            tabIndex={0}
            className="max-h-80 overflow-auto border-t focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <div>
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-medium">
                      {t('notifications.prefs.event')}
                    </th>
                    <th scope="col" className="w-28 px-3 py-2 text-center font-medium">
                      {t('notifications.prefs.inApp')}
                    </th>
                    <th scope="col" className="w-28 px-3 py-2 text-center font-medium">
                      {t('notifications.prefs.email')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((e) => {
                    const label = t(`notifications.prefs.types.${e.type}` as never) as string;
                    return (
                      <tr key={e.type} className="border-t">
                        <th scope="row" className="px-3 py-2 text-left font-normal">
                          <span className="flex items-center gap-1.5">
                            {label}
                            {e.mandatory && (
                              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                                <Lock aria-hidden="true" className="size-3" />
                                {t('notifications.prefs.mandatory')}
                              </span>
                            )}
                          </span>
                        </th>
                        {(['inApp', 'email'] as const).map((channel) => (
                          <td key={channel} className="px-3 py-2 text-center">
                            <Checkbox
                              aria-label={`${label}: ${t(`notifications.prefs.${channel}`)}`}
                              checked={e.mandatory || e[channel]}
                              disabled={e.mandatory}
                              onCheckedChange={(v) => toggle(e.type, channel, v === true)}
                            />
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </details>
      ))}

      <Field label={t('notifications.prefs.days')} hint={t('notifications.prefs.daysHint')} className="max-w-xs">
        <NativeSelect
          value={days}
          onChange={(e) => {
            save.reset();
            setDays(e.target.value);
          }}
        >
          <option value="">{t('notifications.prefs.daysDefault', { count: defaultDeadlineAlertDays })}</option>
          {DAY_OPTIONS.map((n) => (
            <option key={n} value={String(n)}>
              {n === 0 ? t('notifications.prefs.daysOnlyDue') : t('notifications.prefs.daysCount', { count: n })}
            </option>
          ))}
        </NativeSelect>
      </Field>

      <FormError message={save.isError ? errorText(t, save.error) : null} />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? t('common.saving') : t('notifications.prefs.save')}
        </Button>
      </div>
    </form>
  );
}
