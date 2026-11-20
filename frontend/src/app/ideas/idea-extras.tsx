import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FileDown } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { errorText, unwrap } from '@/api/errors';
import { Field, NativeSelect } from '@/components/form/field';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { CopyField } from '../admin/shared';
import { FormError } from '../auth/auth-layout';
import { usePublicSettings } from '../session';
import { type IdeaDetail, ideaKeys } from './queries';

const LEVELS = ['veryLow', 'low', 'medium', 'high', 'veryHigh'] as const;

/**
 * Priorização (RN-56): quem tria informa impacto e esforço (1 a 5). Apoio à decisão: não muda a
 * situação. A equipe vê; o autor não (a API nem manda os números para ele).
 */
export function PriorityCard({ idea }: { idea: IdeaDetail }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [impact, setImpact] = useState(idea.impact ? String(idea.impact) : '');
  const [effort, setEffort] = useState(idea.effort ? String(idea.effort) : '');
  const closed = idea.status === 'implemented' || idea.status === 'rejected';
  const editable = idea.can.triage && !closed;
  const save = useMutation({
    meta: { success: t('feedback.ideas.prioritySaved') },
    mutationFn: () =>
      unwrap(
        api.POST('/api/ideas/{ref}/priority', {
          params: { path: { ref: idea.code } },
          body: {
            impact: impact ? Number(impact) : null,
            effort: effort ? Number(effort) : null,
            expectedStatus: idea.status,
          },
        }),
      ),
    onSuccess: (data) => {
      qc.setQueryData(ideaKeys.detail(idea.code), data);
      void qc.invalidateQueries({ queryKey: ['ideas', 'timeline', idea.code] });
    },
  });
  if (!editable && (idea.impact === null || idea.effort === null)) return null;
  const score = idea.impact && idea.effort ? idea.impact / idea.effort : null;
  const changed =
    impact !== (idea.impact ? String(idea.impact) : '') || effort !== (idea.effort ? String(idea.effort) : '');
  return (
    <section aria-labelledby="prioridade" className="rounded-lg border bg-card p-5">
      <h2 id="prioridade" className="font-semibold">
        {t('ideas.priority.title')}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{t('ideas.priority.text')}</p>
      {editable ? (
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
          className="mt-3 space-y-3"
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('ideas.priority.impact')}>
              <NativeSelect value={impact} onChange={(e) => setImpact(e.target.value)}>
                <option value="">—</option>
                {LEVELS.map((level, i) => (
                  <option key={level} value={String(i + 1)}>
                    {i + 1} · {t(`ideas.priority.scale.${level}`)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label={t('ideas.priority.effort')}>
              <NativeSelect value={effort} onChange={(e) => setEffort(e.target.value)}>
                <option value="">—</option>
                {LEVELS.map((level, i) => (
                  <option key={level} value={String(i + 1)}>
                    {i + 1} · {t(`ideas.priority.scale.${level}`)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          <FormError message={save.isError ? errorText(t, save.error) : null} />
          <Button type="submit" size="sm" variant="outline" disabled={!changed || save.isPending}>
            {t('ideas.priority.save')}
          </Button>
        </form>
      ) : (
        <p className="mt-3 text-sm">
          {t('ideas.priority.chipTitle', { impact: String(idea.impact), effort: String(idea.effort) })}
        </p>
      )}
      {score !== null && (
        <p className="mt-2 text-xs text-muted-foreground">
          {t('ideas.priority.score', {
            score: new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(score),
          })}
        </p>
      )}
    </section>
  );
}

/** Relatório da ideia em PDF (RN-47): sem e com histórico. Quem vê a ideia pode baixar. */
export function PdfCard({ idea }: { idea: IdeaDetail }) {
  const { t } = useTranslation();
  const base = `/api/ideas/${encodeURIComponent(idea.code)}/pdf`;
  return (
    <section aria-labelledby="pdf" className="rounded-lg border bg-card p-5">
      <h2 id="pdf" className="font-semibold">
        {t('ideas.pdf.title')}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{t('ideas.pdf.text')}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button asChild variant="outline" size="sm">
          <a href={base} download>
            <FileDown aria-hidden="true" />
            {t('ideas.pdf.summary')}
          </a>
        </Button>
        <Button asChild variant="outline" size="sm">
          <a href={`${base}?history=true`} download>
            <FileDown aria-hidden="true" />
            {t('ideas.pdf.withHistory')}
          </a>
        </Button>
      </div>
    </section>
  );
}

/**
 * Consulta pública da ideia (RN-33 a RN-37): só o AUTOR vê este cartão. Liga ou desliga a consulta
 * da própria ideia e copia o link para quem acompanha de fora (que nunca vê nome, comentário ou anexo).
 */
export function PublicLookupCard({ idea }: { idea: IdeaDetail }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data: settings } = usePublicSettings();
  const toggle = useMutation({
    meta: {
      success: (_d, enabled: boolean) => (enabled ? t('feedback.ideas.lookupOn') : t('feedback.ideas.lookupOff')),
    },
    mutationFn: (enabled: boolean) =>
      unwrap(api.PUT('/api/ideas/{ref}/public-lookup', { params: { path: { ref: idea.code } }, body: { enabled } })),
    onSuccess: (data) => qc.setQueryData(ideaKeys.detail(idea.code), data),
  });
  if (!idea.publicLookup) return null;
  const { enabled, code } = idea.publicLookup;
  const installed = settings?.publicLookupEnabled === true;
  return (
    <section aria-labelledby="consulta-publica" className="rounded-lg border bg-card p-5">
      <h2 id="consulta-publica" className="font-semibold">
        {t('ideas.publicLookup.title')}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {installed ? t('ideas.publicLookup.text') : t('ideas.publicLookup.off')}
      </p>
      <div className="mt-3 flex items-center gap-2 text-sm">
        <Checkbox
          id="consulta-ativa"
          checked={enabled}
          disabled={toggle.isPending}
          onCheckedChange={(v) => toggle.mutate(v === true)}
        />
        <label htmlFor="consulta-ativa">{t('ideas.publicLookup.allow')}</label>
      </div>
      {installed && enabled && (
        <div className="mt-3">
          <CopyField label={t('ideas.publicLookup.link')} value={`${window.location.origin}/consulta/${code}`} />
        </div>
      )}
      <div className="mt-3">
        <FormError message={toggle.isError ? errorText(t, toggle.error) : null} />
      </div>
    </section>
  );
}
