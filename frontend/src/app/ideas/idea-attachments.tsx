import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { CircleAlert, CircleCheck, Download, Paperclip, Trash2, X } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { errorText, unwrap } from '@/api/errors';
import type { components } from '@/api/schema';
import { MediaViewer, mediaItems } from '@/components/media-viewer';
import { Button } from '@/components/ui/button';
import {
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { checkAttachment, formatSize, previewKind, uploadWithProgress } from '@/lib/upload';
import { FormError } from '../auth/auth-layout';
import { usePublicSettings } from '../session';
import { ideaKeys } from './queries';

export type AttachmentView = components['schemas']['AttachmentView'];
/** Até quantos anexos a própria ideia aceita (o servidor confere de novo; RN-146). */
export const IDEA_ATTACHMENT_LIMIT = 10;

export const ideaAttachmentsKey = (code: string) => ['ideas', 'attachments', code, 'idea'] as const;
export const downloadUrl = (code: string, id: string) =>
  `/api/ideas/${encodeURIComponent(code)}/attachments/${id}/download`;

const reason = (t: TFunction, code: string | undefined) => {
  const key = `errors.${code ?? 'unknown'}`;
  const text = t(key as never) as string;
  return text === key ? (t('errors.unknown') as string) : text;
};

/** Um arquivo a enviar e como ficou (progresso, enviado ou o motivo da recusa). */
export interface UploadState {
  key: string;
  name: string;
  percent: number;
  status: 'waiting' | 'sending' | 'sent' | 'failed';
  error?: string;
}

/**
 * Envia os arquivos um a um para a ideia, com o progresso de cada um. A ideia já existe: um arquivo que
 * falha não desfaz nada, só fica marcado com o motivo (RN-146).
 */
export async function sendIdeaAttachments(
  t: TFunction,
  code: string,
  files: File[],
  onChange: (states: UploadState[]) => void,
): Promise<UploadState[]> {
  const states: UploadState[] = files.map((f, i) => ({
    key: `${i}-${f.name}`,
    name: f.name,
    percent: 0,
    status: 'waiting',
  }));
  const emit = () => onChange(states.map((s) => ({ ...s })));
  emit();
  for (const [i, file] of files.entries()) {
    const state = states[i] as UploadState;
    state.status = 'sending';
    emit();
    try {
      const res = await uploadWithProgress(`/api/ideas/${encodeURIComponent(code)}/attachments`, file, (p) => {
        state.percent = p;
        emit();
      });
      if (res.status >= 200 && res.status < 300) {
        state.status = 'sent';
        state.percent = 100;
      } else {
        state.status = 'failed';
        state.error = reason(t, (res.body as { code?: string } | null)?.code);
      }
    } catch {
      state.status = 'failed';
      state.error = t('errors.network') as string;
    }
    emit();
  }
  return states;
}

/** A lista de envios: barra de progresso enquanto envia; depois, enviado ou o motivo. */
export function UploadList({ states }: { states: UploadState[] }) {
  const { t } = useTranslation();
  if (states.length === 0) return null;
  return (
    <ul className="mt-2 space-y-2 text-sm" aria-live="polite">
      {states.map((s) => (
        <li key={s.key} className="grid gap-1">
          <span className="flex items-center gap-2">
            {s.status === 'sent' && <CircleCheck aria-hidden="true" className="size-4 text-(--st-done)" />}
            {s.status === 'failed' && <CircleAlert aria-hidden="true" className="size-4 text-destructive" />}
            {(s.status === 'waiting' || s.status === 'sending') && (
              <Paperclip aria-hidden="true" className="size-4 text-muted-foreground" />
            )}
            <span className="min-w-0 flex-1 truncate">{s.name}</span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {s.status === 'sent' && t('ideas.attachments.sent')}
              {s.status === 'failed' && (
                <span className="font-medium text-destructive">
                  {t('ideas.attachments.notSent', { reason: s.error ?? '' })}
                </span>
              )}
              {s.status === 'sending' && `${s.percent}%`}
            </span>
          </span>
          {s.status === 'sending' && (
            <Progress
              value={s.percent}
              aria-label={t('ideas.attachments.progress', { name: s.name, percent: s.percent })}
            />
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * Escolha de arquivos ANTES de enviar a ideia (RN-146): confere tipo e tamanho na hora, mostra a lista e
 * deixa tirar um arquivo. O envio acontece depois que a ideia é criada (`sendIdeaAttachments`).
 */
export function AttachmentPicker({ files, onChange }: { files: File[]; onChange: (files: File[]) => void }) {
  const { t } = useTranslation();
  const { data: settings } = usePublicSettings();
  const input = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const [problem, setProblem] = useState<string | null>(null);
  const rules = settings?.attachments;
  const accept = rules?.allowedExtensions.map((e) => `.${e}`).join(',');
  // Prévia antes de enviar: o arquivo ainda está na memória do navegador (URL blob:, nada sai daqui).
  const urls = useMemo(() => files.map((f) => (previewKind(f) ? URL.createObjectURL(f) : null)), [files]);
  useEffect(
    () => () => {
      for (const u of urls) if (u) URL.revokeObjectURL(u);
    },
    [urls],
  );
  const [viewing, setViewing] = useState<number | null>(null);
  const [pdf, setPdf] = useState<number | null>(null);
  const mediaIndexes = files
    .map((f, i) => (previewKind(f) === 'image' || previewKind(f) === 'video' ? i : -1))
    .filter((i) => i >= 0);
  const media = mediaIndexes.map((i) => {
    const f = files[i] as File;
    const kind = previewKind(f);
    return {
      src: urls[i] as string,
      type: kind === 'video' ? ('video' as const) : ('image' as const),
      mime: f.type || (f.name.toLowerCase().endsWith('.webm') ? 'video/webm' : 'video/mp4'),
      title: f.name,
    };
  });
  const open = (i: number) => {
    const kind = previewKind(files[i] as File);
    if (kind === 'pdf') setPdf(i);
    else if (kind) setViewing(mediaIndexes.indexOf(i));
  };
  const pdfFile = pdf !== null ? files[pdf] : undefined;

  return (
    <div className="grid gap-1.5">
      <input
        ref={input}
        type="file"
        multiple
        accept={accept}
        className="sr-only"
        tabIndex={-1}
        aria-label={t('ideas.attachments.chooseMany')}
        onChange={(e) => {
          const chosen = Array.from(e.target.files ?? []);
          e.target.value = '';
          const bad = rules ? chosen.map((f) => [f, checkAttachment(f, rules)] as const).filter(([, p]) => p) : [];
          const ok = chosen.filter((f) => !bad.some(([b]) => b === f));
          const next = [...files, ...ok].slice(0, IDEA_ATTACHMENT_LIMIT);
          setProblem(
            bad.length > 0
              ? `${bad[0]?.[0].name}: ${reason(t, bad[0]?.[1] ?? undefined)}`
              : files.length + ok.length > IDEA_ATTACHMENT_LIMIT
                ? t('ideas.attachments.tooMany', { count: IDEA_ATTACHMENT_LIMIT })
                : null,
          );
          onChange(next);
        }}
      />
      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-describedby={hintId}
          disabled={files.length >= IDEA_ATTACHMENT_LIMIT}
          onClick={() => input.current?.click()}
        >
          <Paperclip aria-hidden="true" />
          {t('ideas.attachments.chooseMany')}
        </Button>
      </div>
      <p id={hintId} className="text-xs text-muted-foreground">
        {t('ideas.attachments.ideaHint', { count: IDEA_ATTACHMENT_LIMIT })}{' '}
        {rules && t('ideas.attachments.limits', { mb: rules.maxMb, types: rules.allowedExtensions.join(', ') })}
      </p>
      {files.length > 0 && (
        <ul className="mt-1 space-y-1 text-sm" aria-label={t('ideas.attachments.chosen')}>
          {files.map((f, i) => (
            <li key={`${f.name}-${f.size}-${f.lastModified}`} className="flex items-center gap-2">
              <Paperclip aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
              {previewKind(f) ? (
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate text-left hover:underline"
                  aria-label={t('ideas.attachments.preview', { name: f.name })}
                  onClick={() => open(i)}
                >
                  {f.name}
                </button>
              ) : (
                <span className="min-w-0 flex-1 truncate">{f.name}</span>
              )}
              <span className="shrink-0 text-xs text-muted-foreground">{formatSize(f.size)}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t('ideas.attachments.unchoose', { name: f.name })}
                onClick={() => onChange(files.filter((_, j) => j !== i))}
              >
                <X aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <FormError message={problem} />
      <MediaViewer items={media} index={viewing} onClose={() => setViewing(null)} />
      <Dialog open={pdf !== null} onOpenChange={(o) => !o && setPdf(null)}>
        <DialogContent
          closeLabel={t('media.close')}
          className="sm:max-w-4xl"
          // O foco começa no diálogo, não dentro do PDF (lá o Esc é do leitor de PDF, e o diálogo não fecharia).
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            (e.currentTarget as HTMLElement).focus();
          }}
        >
          <DialogHeader>
            <DialogTitle className="truncate pr-8">{pdfFile?.name}</DialogTitle>
            <DialogDescription>{t('ideas.attachments.previewHint')}</DialogDescription>
          </DialogHeader>
          {pdf !== null && urls[pdf] && (
            <iframe
              src={urls[pdf] as string}
              title={pdfFile?.name ?? ''}
              className="h-[75vh] w-full rounded-md border bg-muted"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Os anexos da própria ideia na página dela (RN-146): baixar, anexar mais e remover, conforme o direito. */
export function IdeaAttachmentsCard({ code }: { code: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data: settings } = usePublicSettings();
  const input = useRef<HTMLInputElement>(null);
  const [states, setStates] = useState<UploadState[]>([]);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<AttachmentView | null>(null);
  const [viewing, setViewing] = useState<number | null>(null);
  const list = useQuery({
    queryKey: ideaAttachmentsKey(code),
    queryFn: () => unwrap(api.GET('/api/ideas/{ref}/attachments', { params: { path: { ref: code } } })),
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ideaAttachmentsKey(code) });
    void qc.invalidateQueries({ queryKey: ideaKeys.timeline(code) });
  };
  const remove = useMutation({
    meta: { success: t('feedback.ideas.attachmentRemoved') },
    mutationFn: (id: string) =>
      unwrap(
        api.DELETE('/api/ideas/{ref}/attachments/{attachmentId}', {
          params: { path: { ref: code, attachmentId: id } },
        }),
      ),
    onSuccess: () => {
      setRemoving(null);
      refresh();
    },
  });
  const data = list.data;
  if (!data || (data.items.length === 0 && !data.canUpload)) return null;
  const accept = settings?.attachments.allowedExtensions.map((e) => `.${e}`).join(',');
  const media = mediaItems(code, data.items);

  return (
    <section aria-labelledby="anexos-ideia" className="rounded-lg border bg-card p-5">
      <h2 id="anexos-ideia" className="font-semibold">
        {t('ideas.attachments.ideaTitle')}
      </h2>
      {data.items.length === 0 && <p className="mt-2 text-sm text-muted-foreground">{t('ideas.attachments.empty')}</p>}
      <ul className="mt-2 space-y-1.5">
        {data.items.map((a) => (
          <li key={a.id} className="flex items-center gap-2 text-sm">
            <Paperclip aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
            {a.viewable ? (
              <button
                type="button"
                className="min-w-0 flex-1 truncate text-left hover:underline"
                aria-label={t('media.open', { name: a.originalName })}
                onClick={() => setViewing(media.indexOf(a.id))}
              >
                {a.originalName}
              </button>
            ) : (
              <a href={downloadUrl(code, a.id)} className="min-w-0 flex-1 truncate hover:underline">
                {a.originalName}
              </a>
            )}
            <span className="shrink-0 text-xs text-muted-foreground">{formatSize(a.sizeBytes)}</span>
            <a
              href={downloadUrl(code, a.id)}
              className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label={t('ideas.attachments.download', { name: a.originalName })}
            >
              <Download aria-hidden="true" className="size-3.5" />
            </a>
            {a.deletable && (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('ideas.attachments.remove', { name: a.originalName })}
                onClick={() => setRemoving(a)}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            )}
          </li>
        ))}
      </ul>
      {data.canUpload && (
        <div className="mt-3">
          <input
            ref={input}
            type="file"
            multiple
            accept={accept}
            className="sr-only"
            tabIndex={-1}
            aria-label={t('ideas.attachments.upload')}
            onChange={async (e) => {
              const files = Array.from(e.target.files ?? []).slice(0, data.limit - data.items.length);
              e.target.value = '';
              if (files.length === 0) return;
              setBusy(true);
              await sendIdeaAttachments(t, code, files, setStates);
              setBusy(false);
              refresh();
            }}
          />
          <Button variant="outline" size="sm" disabled={busy} onClick={() => input.current?.click()}>
            <Paperclip aria-hidden="true" />
            {busy ? t('ideas.attachments.uploading') : t('ideas.attachments.upload')}
          </Button>
          {settings && (
            <p className="mt-1 text-xs text-muted-foreground">
              {t('ideas.attachments.limits', {
                mb: settings.attachments.maxMb,
                types: settings.attachments.allowedExtensions.join(', '),
              })}
            </p>
          )}
        </div>
      )}
      <UploadList states={states} />
      <MediaViewer items={media.items} index={viewing} onClose={() => setViewing(null)} />
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={t('ideas.attachments.removeTitle', { name: removing?.originalName ?? '' })}
        description={t('ideas.attachments.removeText')}
        confirmLabel={t('admin.common.delete')}
        cancelLabel={t('common.cancel')}
        destructive
        pending={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing.id)}
      >
        <FormError message={remove.isError ? errorText(t, remove.error) : null} />
      </ConfirmDialog>
    </section>
  );
}
