import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { unwrap } from '@/api/errors';
import { keys } from '../session';
import { type FieldForm, useFieldsOf, useMyFields, userFieldKeys } from './queries';
import { type ValueEntry, ValuesForm } from './values-form';

/** Os próprios campos, em Minha conta (RN-196): o travado aparece só para leitura. */
export function MyFieldsSection() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const form = useMyFields();
  const save = useMutation({
    meta: { success: t('userFields.feedback.valuesSaved') },
    mutationFn: (values: ValueEntry[]) => unwrap(api.PUT('/api/me/fields', { body: { values } })),
    onSuccess: (data: FieldForm) => {
      qc.setQueryData(userFieldKeys.mine, data);
      void qc.invalidateQueries({ queryKey: keys.me });
    },
  });
  if (!form.data) return null;
  if (form.data.fields.length === 0)
    return <p className="text-sm text-muted-foreground">{t('userFields.values.empty')}</p>;
  return (
    <ValuesForm
      fields={form.data.fields}
      missing={form.data.missing}
      pending={save.isPending}
      error={save.error}
      hideOn={save.isSuccess ? save.submittedAt : 0}
      submitLabel={t('userFields.values.save')}
      onSave={(values) => save.mutate(values)}
    />
  );
}

/** Os campos de um usuário, pela administração (RN-196, RN-198): os obrigatórios vazios aparecem marcados. */
export function UserFieldsSection({ userId }: { userId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const form = useFieldsOf(userId);
  const save = useMutation({
    meta: { success: t('userFields.feedback.valuesSaved') },
    mutationFn: (values: ValueEntry[]) =>
      unwrap(api.PUT('/api/users/{id}/fields', { params: { path: { id: userId } }, body: { values } })),
    onSuccess: (data: FieldForm) => {
      qc.setQueryData(userFieldKeys.of(userId), data);
      void qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      void qc.invalidateQueries({ queryKey: keys.me });
    },
  });
  if (!form.data) return null;
  if (form.data.fields.length === 0)
    return <p className="text-sm text-muted-foreground">{t('userFields.values.empty')}</p>;
  return (
    <ValuesForm
      fields={form.data.fields}
      missing={form.data.missing}
      pending={save.isPending}
      error={save.error}
      hideOn={save.isSuccess ? save.submittedAt : 0}
      submitLabel={t('userFields.values.save')}
      onSave={(values) => save.mutate(values)}
    />
  );
}
