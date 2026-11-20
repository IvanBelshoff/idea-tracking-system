import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NativeSelect } from '@/components/form/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { fieldLabel } from '@/lib/user-fields';
import { usePeople } from './queries';

/**
 * Escolha de pessoa ativa (autor em nome de outro, responsável de etapa): busca por nome ou
 * e-mail e escolhe na lista. Sem dependência de componente de combobox.
 */
export function PersonPicker({
  label,
  searchLabel,
  value,
  onChange,
  allowEmpty,
  emptyLabel = '—',
  error,
  hint,
}: {
  label: string;
  searchLabel: string;
  value: string;
  onChange: (id: string) => void;
  allowEmpty?: boolean;
  emptyLabel?: string;
  error?: string;
  hint?: string;
}) {
  const id = useId();
  const { i18n } = useTranslation();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);
  const people = usePeople(debounced);
  // A pessoa escolhida continua na lista mesmo se a busca mudar.
  const [chosen, setChosen] = useState<{ id: string; label: string } | null>(null);
  const options =
    people.data?.map((p) => ({
      id: p.id,
      label: [p.name, p.email, ...p.fields.map((f) => `${fieldLabel(f, i18n.language)} ${f.value}`)].join(' · '),
    })) ?? [];
  if (chosen && chosen.id === value && !options.some((o) => o.id === chosen.id)) options.unshift(chosen);

  return (
    <div className="grid content-start gap-1.5">
      <Label htmlFor={`${id}-select`}>{label}</Label>
      <Input
        type="search"
        aria-label={searchLabel}
        placeholder={searchLabel}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <NativeSelect
        id={`${id}-select`}
        value={value}
        onChange={(e) => {
          const opt = options.find((o) => o.id === e.target.value);
          setChosen(opt ?? null);
          onChange(e.target.value);
        }}
        aria-invalid={error ? true : undefined}
        aria-describedby={[hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined}
      >
        {(allowEmpty || !value) && <option value="">{emptyLabel}</option>}
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </NativeSelect>
      {hint && (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-xs font-medium text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
