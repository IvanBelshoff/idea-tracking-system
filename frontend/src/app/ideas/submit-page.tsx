import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { CircleCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { errorText, fieldErrors, unwrap } from '@/api/errors';
import { Field, NativeSelect } from '@/components/form/field';
import { RichTextEditor } from '@/components/form/rich-text-editor';
import { Button, buttonVariants } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { isEmptyDoc, type RichDoc, richPayload } from '@/lib/rich';
import { useEntities } from '../admin/queries';
import { entityOptionLabel, orderTree, AdminPage as Page, Section } from '../admin/shared';
import { FormError } from '../auth/auth-layout';
import { CampaignField } from '../campaigns/campaigns-ui';
import { useCan, usePublicSettings } from '../session';
import { useDates } from '../use-dates';
import { SimilarIdeas } from './convergence-ui';
import { AttachmentPicker, sendIdeaAttachments, UploadList, type UploadState } from './idea-attachments';
import { PersonPicker } from './person-picker';
import { ideaKeys, useActiveCategories } from './queries';
import { IdCode } from './ui';

interface FormState {
  title: string;
  description: RichDoc | null;
  entityId: string;
  categoryId: string;
  tagIds: string[];
  proposedSolution: RichDoc | null;
  expectedGain: string;
  externalRef: string;
  onBehalfOfUserId: string;
  approveNow: boolean;
  campaignId: string;
  stepName: string;
  assigneeId: string;
  dueDate: string;
}

/** Envio de ideia (RN-02 a RN-04). A API valida tudo de novo; aqui só ajudamos a preencher. */
export function SubmitIdeaPage() {
  const { t } = useTranslation();
  const dates = useDates();
  const qc = useQueryClient();
  const can = useCan();
  const entities = useEntities();
  const categories = useActiveCategories();
  const { data: settings } = usePublicSettings();
  const categoryRequired = settings?.ideas.categoryRequired ?? true;
  const allowed = orderTree(entities.data ?? []).filter((e) => e.canSubmit);
  const teamCanOnBehalf = can('idea.register_for_other');
  const teamCanApprove = can('idea.triage');

  const blank = (): FormState => ({
    title: '',
    description: null,
    entityId: allowed.length === 1 ? (allowed[0]?.id ?? '') : '',
    categoryId: '',
    campaignId: '',
    tagIds: [],
    proposedSolution: null,
    expectedGain: '',
    externalRef: '',
    onBehalfOfUserId: '',
    approveNow: false,
    stepName: t('ideas.actions.stepNameDefault'),
    assigneeId: '',
    dueDate: dates.dayFromToday(14),
  });
  const [form, setForm] = useState<FormState>(blank);
  const [local, setLocal] = useState<Record<string, string>>({});
  const [supported, setSupported] = useState<string | null>(null);
  // Anexos (RN-146): escolhidos no formulário, enviados um a um depois que a ideia existe.
  const [files, setFiles] = useState<File[]>([]);
  const [uploads, setUploads] = useState<UploadState[]>([]);
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));
  const entityId = form.entityId || (allowed.length === 1 ? (allowed[0]?.id ?? '') : '');

  const submit = useMutation({
    meta: { success: t('feedback.ideas.submitted') },
    mutationFn: () =>
      unwrap(
        api.POST('/api/ideas', {
          body: {
            title: form.title,
            description: richPayload(form.description).text,
            descriptionRich: richPayload(form.description).rich,
            entityId,
            categoryId: form.categoryId || null,
            tagIds: form.tagIds,
            proposedSolution: richPayload(form.proposedSolution).text || null,
            proposedSolutionRich: richPayload(form.proposedSolution).rich,
            expectedGain: form.expectedGain || null,
            externalRef: form.externalRef || null,
            onBehalfOfUserId: form.onBehalfOfUserId || null,
            campaignId: form.campaignId || null,
            approveNow: form.approveNow
              ? { stepName: form.stepName, assigneeId: form.assigneeId, dueDate: form.dueDate, stepDescription: null }
              : null,
          },
        }),
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ideaKeys.all }),
  });
  const createdCode = submit.data?.code;
  // biome-ignore lint/correctness/useExhaustiveDependencies: envia uma vez, quando a ideia acaba de ser criada
  useEffect(() => {
    if (!createdCode || files.length === 0) return;
    const chosen = files;
    setFiles([]);
    void sendIdeaAttachments(t, createdCode, chosen, setUploads).then(() =>
      qc.invalidateQueries({ queryKey: ideaKeys.all }),
    );
  }, [createdCode]);

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!form.title.trim()) e.title = t('validation.required');
    if (isEmptyDoc(form.description)) e.description = t('validation.required');
    if (!entityId) e.entityId = t('validation.required');
    if (categoryRequired && !form.categoryId) e.categoryId = t('validation.required');
    if (form.approveNow) {
      if (!form.stepName.trim()) e['approveNow.stepName'] = t('validation.required');
      if (!form.assigneeId) e['approveNow.assigneeId'] = t('validation.required');
      if (!form.dueDate) e['approveNow.dueDate'] = t('validation.required');
    }
    setLocal(e);
    return Object.keys(e).length === 0;
  };
  const errors = { ...fieldErrors(submit.error), ...local };

  if (supported) {
    return (
      <Page title={t('ideas.similar.supportedTitle')} narrow>
        <div className="max-w-xl rounded-lg border bg-card p-6" role="status">
          <p className="flex items-start gap-2">
            <CircleCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-(--st-done)" />
            <span>{t('ideas.similar.supportedText', { code: supported })}</span>
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            <Link to="/ideias/$ref" params={{ ref: supported }} className={buttonVariants()}>
              {t('ideas.submit.viewIdea')}
            </Link>
            <Button
              variant="outline"
              onClick={() => {
                setForm(blank());
                setSupported(null);
              }}
            >
              {t('ideas.submit.another')}
            </Button>
          </div>
        </div>
      </Page>
    );
  }

  if (submit.isSuccess) {
    return (
      <Page title={t('ideas.submit.successTitle')} narrow>
        <div className="max-w-xl rounded-lg border bg-card p-6" role="status">
          <p className="flex items-start gap-2">
            <CircleCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-(--st-done)" />
            <span>{t('ideas.submit.successText', { code: submit.data.code })}</span>
          </p>
          <p className="mt-2">
            <IdCode code={submit.data.code} size="lg" />
          </p>
          {uploads.length > 0 && (
            <div className="mt-4">
              <p className="text-sm font-medium">{t('ideas.attachments.sendingTitle')}</p>
              <UploadList states={uploads} />
              {uploads.some((u) => u.status === 'failed') && (
                <p className="mt-2 text-xs text-muted-foreground">{t('ideas.attachments.retryHint')}</p>
              )}
            </div>
          )}
          <div className="mt-6 flex flex-wrap gap-2">
            <Link to="/ideias/$ref" params={{ ref: submit.data.code }} className={buttonVariants()}>
              {t('ideas.submit.viewIdea')}
            </Link>
            <Button
              variant="outline"
              onClick={() => {
                setForm(blank());
                setUploads([]);
                submit.reset();
              }}
            >
              {t('ideas.submit.another')}
            </Button>
          </div>
        </div>
      </Page>
    );
  }

  if (entities.isSuccess && allowed.length === 0) {
    return (
      <Page title={t('ideas.submit.title')} narrow>
        <p className="max-w-xl rounded-lg border bg-card p-6 text-sm">{t('ideas.submit.noEntity')}</p>
      </Page>
    );
  }

  const otherCategories = (categories.data ?? []).filter((c) => c.id !== form.categoryId);

  return (
    <Page title={t('ideas.submit.title')} intro={t('ideas.submit.intro')} help="submitIdea" narrow>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (validate()) submit.mutate();
        }}
        className="grid max-w-3xl gap-6"
      >
        <Section title={t('ideas.submit.title')}>
          <div className="grid gap-4">
            <Field label={t('ideas.fields.title')} hint={t('ideas.fields.titleHint')} error={errors.title}>
              <Input value={form.title} onChange={(e) => set('title', e.target.value)} maxLength={200} />
            </Field>
            {!form.onBehalfOfUserId && (
              <SimilarIdeas title={form.title} entityId={entityId} onSupported={setSupported} />
            )}
            <Field
              label={t('ideas.fields.description')}
              hint={t('ideas.fields.descriptionHint')}
              error={errors.description}
            >
              <RichTextEditor
                rows={5}
                max={10_000}
                value={form.description}
                onChange={(doc) => set('description', doc)}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('ideas.fields.entity')} hint={t('ideas.fields.entityHint')} error={errors.entityId}>
                <NativeSelect value={entityId} onChange={(e) => set('entityId', e.target.value)}>
                  {allowed.length !== 1 && <option value="">—</option>}
                  {allowed.map((e) => (
                    <option key={e.id} value={e.id}>
                      {entityOptionLabel(e)}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field
                label={t('ideas.fields.category')}
                optionalLabel={categoryRequired ? undefined : t('common.optional')}
                error={errors.categoryId}
              >
                <NativeSelect value={form.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
                  <option value="">—</option>
                  {categories.data?.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </div>
            <CampaignField
              entityId={entityId}
              categoryId={form.categoryId}
              value={form.campaignId}
              onChange={(v) => set('campaignId', v)}
            />
            {otherCategories.length > 0 && (
              <fieldset>
                <legend className="text-sm font-medium">
                  {t('ideas.fields.tags')}{' '}
                  <span className="font-normal text-muted-foreground">({t('common.optional')})</span>
                </legend>
                <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
                  {otherCategories.map((c) => (
                    <div key={c.id} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        id={`tag-${c.id}`}
                        checked={form.tagIds.includes(c.id)}
                        onCheckedChange={(v) =>
                          set('tagIds', v === true ? [...form.tagIds, c.id] : form.tagIds.filter((x) => x !== c.id))
                        }
                      />
                      <label htmlFor={`tag-${c.id}`}>{c.name}</label>
                    </div>
                  ))}
                </div>
              </fieldset>
            )}
            <Field label={t('ideas.fields.proposedSolution')} optionalLabel={t('common.optional')}>
              <RichTextEditor
                rows={3}
                max={10_000}
                value={form.proposedSolution}
                onChange={(doc) => set('proposedSolution', doc)}
              />
            </Field>
            <div className="grid gap-1.5">
              <p className="text-sm font-medium">
                {t('ideas.attachments.title')}
                <span className="font-normal text-muted-foreground"> ({t('common.optional')})</span>
              </p>
              <AttachmentPicker files={files} onChange={setFiles} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('ideas.fields.expectedGain')} optionalLabel={t('common.optional')}>
                <Input
                  value={form.expectedGain}
                  onChange={(e) => set('expectedGain', e.target.value)}
                  maxLength={5000}
                />
              </Field>
              <Field
                label={t('ideas.fields.externalRef')}
                optionalLabel={t('common.optional')}
                hint={t('ideas.fields.externalRefHint')}
                error={errors.externalRef}
              >
                <Input value={form.externalRef} onChange={(e) => set('externalRef', e.target.value)} maxLength={100} />
              </Field>
            </div>
          </div>
        </Section>

        {(teamCanOnBehalf || teamCanApprove) && (
          <Section title={t('ideas.submit.teamSection')}>
            <div className="grid gap-4">
              {teamCanOnBehalf && (
                <PersonPicker
                  label={t('ideas.submit.onBehalf')}
                  searchLabel={t('ideas.submit.onBehalfSearch')}
                  hint={t('ideas.submit.onBehalfHint')}
                  value={form.onBehalfOfUserId}
                  onChange={(v) => set('onBehalfOfUserId', v)}
                  allowEmpty
                  error={errors.onBehalfOfUserId}
                />
              )}
              {teamCanApprove && (
                <>
                  <div className="flex items-center gap-2 text-sm">
                    <Checkbox
                      id="approve-now"
                      checked={form.approveNow}
                      onCheckedChange={(v) => set('approveNow', v === true)}
                    />
                    <label htmlFor="approve-now">{t('ideas.submit.approveNow')}</label>
                  </div>
                  {form.approveNow && (
                    <div className="grid gap-4 rounded-md border p-4 sm:grid-cols-2">
                      <Field label={t('ideas.actions.stepName')} error={errors['approveNow.stepName']}>
                        <Input
                          value={form.stepName}
                          onChange={(e) => set('stepName', e.target.value)}
                          maxLength={200}
                        />
                      </Field>
                      <Field label={t('ideas.actions.dueDate')} error={errors['approveNow.dueDate']}>
                        <Input
                          type="date"
                          min={dates.dayFromToday(0)}
                          value={form.dueDate}
                          onChange={(e) => set('dueDate', e.target.value)}
                        />
                      </Field>
                      <div className="sm:col-span-2">
                        <PersonPicker
                          label={t('ideas.actions.assignee')}
                          searchLabel={t('ideas.actions.assigneeSearch')}
                          value={form.assigneeId}
                          onChange={(v) => set('assigneeId', v)}
                          error={errors['approveNow.assigneeId']}
                        />
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </Section>
        )}

        <FormError message={submit.isError ? errorText(t, submit.error) : null} />
        <div>
          <Button type="submit" disabled={submit.isPending}>
            {submit.isPending ? t('ideas.submit.submitting') : t('ideas.submit.submit')}
          </Button>
        </div>
      </form>
    </Page>
  );
}
