import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Languages } from 'lucide-react';
import { type CSSProperties, type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { unwrap } from '@/api/errors';
import type { components } from '@/api/schema';
import { Field, NativeSelect } from '@/components/form/field';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  canSuggestTranslation,
  LOGIN_TEXT_PRESETS,
  mediaUrl,
  showsBackground,
  suggestTranslation,
} from '@/lib/login-screen';
import { AccessScreen } from '../auth/access-layout';
import { HelpAnchor } from '../help';
import { keys, usePublicSettings } from '../session';
import { Section } from './shared';

type Config = components['schemas']['LoginScreenConfigView'];
type AdminView = components['schemas']['LoginScreenAdminView'];
type PublicView = components['schemas']['LoginScreenPublicView'];
type MediaKind = 'image' | 'poster' | 'video';

const LAYOUTS = ['card', 'split', 'full', 'panel', 'band', 'minimal'] as const;
const BACKGROUNDS = ['none', 'color', 'gradient', 'image', 'video'] as const;
const OVERLAYS = ['black', 'white', 'brand'] as const;
const VIEW_KEY = ['admin', 'login-screen'] as const;
const TITLE_MAX = 80;
const SUBTITLE_MAX = 200;

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

/**
 * Tela de login (M23, RN-176 a RN-180), em Identidade visual: layout, fundo, arquivos e textos, com a
 * prévia ao vivo (computador e celular, claro e escuro) do que ainda não foi salvo.
 */
export function LoginScreenSection() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const view = useQuery({ queryKey: VIEW_KEY, queryFn: () => unwrap(api.GET('/api/branding/login')) });
  const [draft, setDraft] = useState<Config | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  useEffect(() => {
    if (view.data && draft === null) setDraft(view.data.config);
  }, [view.data, draft]);

  const debounced = useDebounced(draft, 300);
  const mediaKey = JSON.stringify(view.data?.media ?? null);
  const preview = useQuery({
    queryKey: ['admin', 'login-screen', 'preview', debounced, mediaKey],
    queryFn: () => unwrap(api.POST('/api/branding/login/preview', { body: debounced as Config })),
    enabled: debounced !== null,
    placeholderData: (previous) => previous,
  });

  const applyView = (data: AdminView, resetDraft: boolean) => {
    qc.setQueryData(VIEW_KEY, data);
    void qc.invalidateQueries({ queryKey: keys.publicSettings });
    if (resetDraft) setDraft(data.config);
  };
  const save = useMutation({
    meta: { success: t('feedback.loginScreen.saved') },
    mutationFn: (body: Config) => unwrap(api.PUT('/api/branding/login', { body })),
    onSuccess: (data) => applyView(data, true),
  });
  const reset = useMutation({
    meta: { success: t('feedback.loginScreen.reset') },
    mutationFn: () => unwrap(api.POST('/api/branding/login/reset')),
    onSuccess: (data) => {
      applyView(data, true);
      setConfirmReset(false);
    },
  });

  if (!draft || !view.data) return null;
  const saved = view.data.config;
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const set = (change: Partial<Config>) => setDraft({ ...draft, ...change });
  const setBg = (change: Partial<Config['background']>) =>
    setDraft({ ...draft, background: { ...draft.background, ...change } });
  const bgType = draft.background.type;
  const media = view.data.media;
  const hasTexts = Boolean(draft.title.ptBR || draft.subtitle.ptBR);
  const textOverBackground = showsBackground(draft.layout) && bgType !== 'none';
  // Sem contraste direto, o servidor põe uma placa atrás do texto (RN-177): a tela avisa.
  const usesPlate = hasTexts && textOverBackground && preview.data?.text.plate != null;

  return (
    <Section title={t('loginScreen.title')} intro={t('loginScreen.intro')}>
      <p className="-mt-2 mb-4 text-sm">
        <HelpAnchor topic="loginScreen" className="text-primary underline underline-offset-4">
          {t('loginScreen.helpLink')}
        </HelpAnchor>
      </p>
      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="min-w-0 space-y-8">
          <ChoiceGroup legend={t('loginScreen.layout')}>
            <div className="grid gap-2 sm:grid-cols-2">
              {LAYOUTS.map((layout) => (
                <Choice
                  key={layout}
                  name="login-layout"
                  checked={draft.layout === layout}
                  onChange={() => set({ layout })}
                  label={t(`loginScreen.layouts.${layout}`)}
                  hint={t(`loginScreen.layoutHints.${layout}`)}
                  icon={<LayoutIcon layout={layout} />}
                />
              ))}
            </div>
          </ChoiceGroup>

          {(draft.layout === 'split' || draft.layout === 'panel') && (
            <ChoiceGroup legend={t('loginScreen.side')}>
              <div className="flex flex-wrap gap-2">
                {(['left', 'right'] as const).map((side) => (
                  <Choice
                    key={side}
                    name="login-side"
                    checked={draft.side === side}
                    onChange={() => set({ side })}
                    label={t(`loginScreen.sides.${side}`)}
                  />
                ))}
              </div>
            </ChoiceGroup>
          )}

          <ChoiceGroup legend={t('loginScreen.background')}>
            {!showsBackground(draft.layout) && (
              <p className="mb-2 text-sm text-muted-foreground">{t('loginScreen.noBackgroundHere')}</p>
            )}
            {showsBackground(draft.layout) && draft.layout !== 'band' && bgType === 'none' && (
              <p className="mb-2 text-sm text-muted-foreground">{t('loginScreen.needsBackground')}</p>
            )}
            <div className="flex flex-wrap gap-2">
              {BACKGROUNDS.map((type) => (
                <Choice
                  key={type}
                  name="login-background"
                  checked={bgType === type}
                  onChange={() => setBg({ type })}
                  label={t(`loginScreen.backgrounds.${type}`)}
                />
              ))}
            </div>
          </ChoiceGroup>

          {(bgType === 'color' || bgType === 'gradient') && (
            <div className="grid gap-4 sm:grid-cols-2">
              <ColorField
                label={t('loginScreen.color1')}
                brandLabel={t('loginScreen.useBrand')}
                value={draft.background.color1}
                onChange={(color1) => setBg({ color1 })}
              />
              {bgType === 'gradient' && (
                <ColorField
                  label={t('loginScreen.color2')}
                  brandLabel={t('loginScreen.useBrandDark')}
                  value={draft.background.color2}
                  onChange={(color2) => setBg({ color2 })}
                />
              )}
            </div>
          )}

          {bgType === 'image' && (
            <MediaSlot
              kind="image"
              label={t('loginScreen.image')}
              hint={t('loginScreen.imageHint')}
              media={media.image}
              onView={(d) => applyView(d, false)}
            />
          )}
          {bgType === 'video' && (
            <div className="space-y-4">
              <MediaSlot
                kind="video"
                label={t('loginScreen.video')}
                hint={t('loginScreen.videoHint')}
                media={media.video}
                onView={(d) => applyView(d, false)}
              />
              <MediaSlot
                kind="poster"
                label={t('loginScreen.poster')}
                hint={t('loginScreen.posterHint')}
                media={media.poster}
                onView={(d) => applyView(d, false)}
              />
            </div>
          )}

          {(bgType === 'image' || bgType === 'video') && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Range
                label={t('loginScreen.focusX')}
                hint={t('loginScreen.focusHint')}
                min={0}
                max={100}
                value={draft.background.focusX}
                onChange={(focusX) => setBg({ focusX })}
                format={(v) => t('loginScreen.percent', { value: v })}
              />
              <Range
                label={t('loginScreen.focusY')}
                min={0}
                max={100}
                value={draft.background.focusY}
                onChange={(focusY) => setBg({ focusY })}
                format={(v) => t('loginScreen.percent', { value: v })}
              />
              <Field label={t('loginScreen.overlay')}>
                <NativeSelect
                  value={draft.background.overlayColor}
                  onChange={(e) => setBg({ overlayColor: e.target.value as Config['background']['overlayColor'] })}
                >
                  {OVERLAYS.map((o) => (
                    <option key={o} value={o}>
                      {t(`loginScreen.overlays.${o}`)}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Range
                label={t('loginScreen.opacity')}
                min={0}
                max={90}
                value={draft.background.overlayOpacity}
                onChange={(overlayOpacity) => setBg({ overlayOpacity })}
                format={(v) => t('loginScreen.percent', { value: v })}
              />
              <Range
                label={t('loginScreen.blur')}
                min={0}
                max={20}
                value={draft.background.blur}
                onChange={(blur) => setBg({ blur })}
                format={(v) => t('loginScreen.px', { value: v })}
              />
            </div>
          )}
          {textOverBackground && (
            <ChoiceGroup legend={t('loginScreen.textTone')}>
              <p className="mb-2 text-sm text-muted-foreground">{t('loginScreen.textToneHint')}</p>
              <div className="flex flex-wrap gap-2">
                {(['auto', 'light', 'dark'] as const).map((tone) => (
                  <Choice
                    key={tone}
                    name="login-text-tone"
                    checked={draft.textTone === tone}
                    onChange={() => set({ textTone: tone })}
                    label={t(`loginScreen.textTones.${tone}`)}
                  />
                ))}
              </div>
            </ChoiceGroup>
          )}
          {usesPlate && (
            <p role="status" className="rounded-md border border-(--st-review)/40 bg-(--st-review)/5 px-3 py-2 text-sm">
              {t('loginScreen.textPlate')}
            </p>
          )}

          <TextsEditor draft={draft} onChange={(title, subtitle) => set({ title, subtitle })} />
        </div>

        <div className="min-w-0 space-y-3 xl:sticky xl:top-4 xl:self-start">
          <Preview login={preview.data} />
        </div>
      </div>

      <div className="mt-8 flex flex-wrap items-center gap-3 border-t pt-4">
        <Button disabled={!dirty || save.isPending} onClick={() => save.mutate(draft)}>
          {save.isPending ? t('loginScreen.saving') : t('loginScreen.save')}
        </Button>
        {dirty && (
          <>
            <Button variant="outline" onClick={() => setDraft(saved)}>
              {t('loginScreen.discard')}
            </Button>
            <span className="text-sm text-muted-foreground">{t('loginScreen.unsaved')}</span>
          </>
        )}
        <Button variant="ghost" className="ml-auto" onClick={() => setConfirmReset(true)}>
          {t('loginScreen.reset')}
        </Button>
      </div>
      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title={t('loginScreen.resetTitle')}
        description={t('loginScreen.resetText')}
        confirmLabel={t('loginScreen.resetConfirm')}
        cancelLabel={t('loginScreen.cancel')}
        destructive
        pending={reset.isPending}
        onConfirm={() => reset.mutate()}
      />
    </Section>
  );
}

function ChoiceGroup({ legend, children }: { legend: string; children: ReactNode }) {
  return (
    <fieldset className="min-w-0">
      <legend className="mb-2 text-sm font-medium">{legend}</legend>
      {children}
    </fieldset>
  );
}

/** Opção de rádio com rótulo clicável inteiro e foco visível (o rádio nativo fica acessível). */
function Choice({
  name,
  checked,
  onChange,
  label,
  hint,
  icon,
}: {
  name: string;
  checked: boolean;
  onChange: () => void;
  label: string;
  hint?: string;
  icon?: ReactNode;
}) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2 text-sm transition-colors has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50 ${
        checked ? 'border-primary bg-primary/5' : 'hover:bg-muted'
      }`}
    >
      <input type="radio" name={name} checked={checked} onChange={onChange} className="mt-1 accent-(--brand)" />
      {icon}
      <span className="min-w-0">
        <span className="block font-medium">{label}</span>
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
    </label>
  );
}

/** Desenho mínimo de cada layout (decorativo; o nome e a dica dizem o que é). */
function LayoutIcon({ layout }: { layout: (typeof LAYOUTS)[number] }) {
  const bg = 'bg-primary/35';
  const form = 'bg-background ring-1 ring-border';
  return (
    <span
      aria-hidden="true"
      className="relative mt-0.5 block h-9 w-14 shrink-0 overflow-hidden rounded border bg-muted"
    >
      {layout === 'card' && <span className={`absolute inset-x-4 inset-y-2 rounded-sm ${form}`} />}
      {layout === 'split' && (
        <>
          <span className={`absolute inset-y-0 left-0 w-1/2 ${bg}`} />
          <span className={`absolute inset-y-2 right-1.5 w-4 rounded-sm ${form}`} />
        </>
      )}
      {layout === 'full' && (
        <>
          <span className={`absolute inset-0 ${bg}`} />
          <span className={`absolute inset-x-4 inset-y-2 rounded-sm ${form}`} />
        </>
      )}
      {layout === 'panel' && (
        <>
          <span className={`absolute inset-0 ${bg}`} />
          <span className={`absolute inset-y-0 right-0 w-5 ${form}`} />
        </>
      )}
      {layout === 'band' && (
        <>
          <span className="absolute inset-y-0 left-0 w-5 bg-primary" />
          <span className={`absolute inset-y-2 right-2 w-5 rounded-sm ${form}`} />
        </>
      )}
      {layout === 'minimal' && (
        <>
          <span className="absolute top-2 left-3 h-1 w-6 rounded bg-foreground/40" />
          <span className="absolute top-4 left-3 h-1 w-8 rounded bg-foreground/25" />
          <span className="absolute top-6 left-3 h-1 w-7 rounded bg-foreground/25" />
        </>
      )}
    </span>
  );
}

function ColorField({
  label,
  brandLabel,
  value,
  onChange,
}: {
  label: string;
  brandLabel: string;
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  const id = useId();
  const [last, setLast] = useState(value ?? '#5458c8');
  return (
    <div className="grid content-start gap-2">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <div className="flex items-center gap-3">
        <input
          id={id}
          type="color"
          value={value ?? last}
          disabled={value === null}
          onChange={(e) => {
            setLast(e.target.value);
            onChange(e.target.value);
          }}
          className="h-9 w-14 cursor-pointer rounded border bg-transparent disabled:cursor-not-allowed disabled:opacity-50"
        />
        <span className="font-mono text-sm text-muted-foreground">{value ?? ''}</span>
      </div>
      <div className="flex items-center gap-2 text-sm">
        <Checkbox
          id={`${id}-brand`}
          checked={value === null}
          onCheckedChange={(on) => onChange(on === true ? null : last)}
        />
        <label htmlFor={`${id}-brand`}>{brandLabel}</label>
      </div>
    </div>
  );
}

function Range({
  label,
  hint,
  min,
  max,
  value,
  onChange,
  format,
}: {
  label: string;
  hint?: string;
  min: number;
  max: number;
  value: number;
  onChange: (value: number) => void;
  format: (value: number) => string;
}) {
  const id = useId();
  return (
    <div className="grid content-start gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        <output htmlFor={id} className="text-sm tabular-nums text-muted-foreground">
          {format(value)}
        </output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        aria-valuetext={format(value)}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-(--brand)"
      />
      {hint && (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}

/** Um arquivo do fundo: enviar, trocar e remover (vale na hora; o fundo só muda ao salvar). */
function MediaSlot({
  kind,
  label,
  hint,
  media,
  onView,
}: {
  kind: MediaKind;
  label: string;
  hint: string;
  media: components['schemas']['LoginMediaItemView'] | null;
  onView: (data: AdminView) => void;
}) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const upload = useMutation({
    meta: { success: t('feedback.loginScreen.mediaSaved') },
    mutationFn: (file: File) =>
      unwrap(
        api.PUT('/api/branding/login/media/{kind}', {
          params: { path: { kind } },
          body: { file: file as unknown as string },
          bodySerializer: () => {
            const form = new FormData();
            form.append('file', file);
            return form;
          },
        }),
      ),
    onSuccess: onView,
  });
  const remove = useMutation({
    meta: { success: t('feedback.loginScreen.mediaRemoved') },
    mutationFn: () => unwrap(api.DELETE('/api/branding/login/media/{kind}', { params: { path: { kind } } })),
    onSuccess: onView,
  });
  const thumb = kind === 'video' ? null : mediaUrl(kind, media?.version ?? null);
  return (
    <div className="grid gap-2 rounded-lg border p-3">
      <span id={id} className="text-sm font-medium">
        {label}
      </span>
      <p className="text-xs text-muted-foreground">{hint}</p>
      <div className="flex flex-wrap items-center gap-3">
        {thumb ? (
          <img src={thumb} alt="" className="h-14 w-24 rounded border object-cover" />
        ) : (
          <span className="text-sm text-muted-foreground">
            {media
              ? t('loginScreen.sizeMb', { size: (media.sizeBytes / 1024 / 1024).toFixed(1) })
              : t('loginScreen.noFile')}
          </span>
        )}
        <input
          ref={input}
          type="file"
          className="sr-only"
          tabIndex={-1}
          aria-labelledby={id}
          accept={kind === 'video' ? 'video/mp4,video/webm' : 'image/png,image/jpeg,image/webp'}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) upload.mutate(file);
            e.target.value = '';
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={upload.isPending}
          onClick={() => input.current?.click()}
        >
          {upload.isPending ? t('loginScreen.uploading') : media ? t('loginScreen.replace') : t('loginScreen.upload')}
        </Button>
        {media && (
          <Button type="button" variant="ghost" size="sm" disabled={remove.isPending} onClick={() => remove.mutate()}>
            {t('loginScreen.remove')}
          </Button>
        )}
      </div>
    </div>
  );
}

function TextsEditor({
  draft,
  onChange,
}: {
  draft: Config;
  onChange: (title: Config['title'], subtitle: Config['subtitle']) => void;
}) {
  const { t } = useTranslation();
  const [canTranslate, setCanTranslate] = useState(false);
  useEffect(() => {
    let alive = true;
    void canSuggestTranslation().then((ok) => alive && setCanTranslate(ok));
    return () => {
      alive = false;
    };
  }, []);
  return (
    <fieldset className="min-w-0 space-y-4">
      <legend className="text-sm font-medium">{t('loginScreen.texts')}</legend>
      <p className="text-sm text-muted-foreground">{t('loginScreen.textsIntro')}</p>
      <Field label={t('loginScreen.presets')}>
        <NativeSelect
          value=""
          onChange={(e) => {
            const preset = LOGIN_TEXT_PRESETS[Number(e.target.value)];
            if (preset) onChange({ ...preset.title }, { ...preset.subtitle });
          }}
        >
          <option value="">{t('loginScreen.presetPlaceholder')}</option>
          {LOGIN_TEXT_PRESETS.map((p, i) => (
            <option key={p.title.ptBR} value={i}>
              {p.title.ptBR}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label={t('loginScreen.titlePt')}
          max={TITLE_MAX}
          value={draft.title.ptBR}
          onChange={(ptBR) => onChange({ ...draft.title, ptBR }, draft.subtitle)}
        />
        <TextField
          label={t('loginScreen.titleEn')}
          max={TITLE_MAX}
          hint={t('loginScreen.enHint')}
          value={draft.title.en}
          onChange={(en) => onChange({ ...draft.title, en }, draft.subtitle)}
          suggestFrom={canTranslate ? draft.title.ptBR : undefined}
        />
        <TextField
          multiline
          label={t('loginScreen.subtitlePt')}
          max={SUBTITLE_MAX}
          value={draft.subtitle.ptBR}
          onChange={(ptBR) => onChange(draft.title, { ...draft.subtitle, ptBR })}
        />
        <TextField
          multiline
          label={t('loginScreen.subtitleEn')}
          max={SUBTITLE_MAX}
          hint={t('loginScreen.enHint')}
          value={draft.subtitle.en}
          onChange={(en) => onChange(draft.title, { ...draft.subtitle, en })}
          suggestFrom={canTranslate ? draft.subtitle.ptBR : undefined}
        />
      </div>
    </fieldset>
  );
}

function TextField({
  label,
  max,
  value,
  onChange,
  hint,
  multiline,
  suggestFrom,
}: {
  label: string;
  max: number;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  multiline?: boolean;
  /** O texto em português de onde sugerir a tradução (só quando o navegador traduz). */
  suggestFrom?: string;
}) {
  const { t } = useTranslation();
  const [state, setState] = useState<'idle' | 'busy' | 'failed'>('idle');
  const suggest = async () => {
    setState('busy');
    try {
      const text = await suggestTranslation(suggestFrom ?? '');
      if (text) onChange(text.slice(0, max));
      setState('idle');
    } catch {
      setState('failed');
    }
  };
  const help = [hint, t('loginScreen.counter', { count: value.length, max })].filter(Boolean).join(' · ');
  return (
    <div className="grid content-start gap-2">
      <Field label={label} hint={help}>
        {multiline ? (
          <Textarea rows={2} maxLength={max} value={value} onChange={(e) => onChange(e.target.value)} />
        ) : (
          <Input maxLength={max} value={value} onChange={(e) => onChange(e.target.value)} />
        )}
      </Field>
      {suggestFrom !== undefined && (
        <div className="space-y-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!suggestFrom.trim() || state === 'busy'}
            onClick={() => void suggest()}
          >
            <Languages aria-hidden="true" />
            {state === 'busy' ? t('loginScreen.suggesting') : t('loginScreen.suggest')}
          </Button>
          <p className="text-xs text-muted-foreground" role={state === 'failed' ? 'alert' : undefined}>
            {state === 'failed' ? t('loginScreen.suggestFailed') : t('loginScreen.suggestHint')}
          </p>
        </div>
      )}
    </div>
  );
}

const FRAMES = { desktop: { w: 1280, h: 800 }, mobile: { w: 390, h: 760 } } as const;

/**
 * A prévia (RN-180): a própria tela de acesso, num quadro reduzido, com a configuração ainda não salva. É
 * só para ver (`inert`): o leitor de tela lê a descrição do quadro.
 */
function Preview({ login }: { login: PublicView | undefined }) {
  const { t } = useTranslation();
  const { data: settings } = usePublicSettings();
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(560);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry?.contentRect.width ?? 560));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const frame = FRAMES[device];
  const scale = Math.min(1, width / frame.w, device === 'mobile' ? 480 / frame.h : 1);
  const brand = settings?.branding;
  // O tema do quadro é só dele: `dark` ou `theme-light` recalculam os tokens (tokens.css), e a cor da
  // marca vem do par daquele tema.
  const pair = brand ? brand[theme] : null;
  const vars = {
    ...(pair ? { '--brand': pair.brand, '--brand-fg': pair.brandFg } : {}),
    colorScheme: theme,
  } as CSSProperties;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{t('loginScreen.preview')}</h3>
        <div className="flex flex-wrap gap-2">
          <Toggle
            value={device}
            onChange={setDevice}
            options={['desktop', 'mobile']}
            label={(v) => t(`loginScreen.deviceButtons.${v}`)}
          />
          <Toggle
            value={theme}
            onChange={setTheme}
            options={['light', 'dark']}
            label={(v) => t(`loginScreen.themeButtons.${v}`)}
          />
        </div>
      </div>
      <div ref={box} className="w-full">
        <div
          role="img"
          aria-label={t('loginScreen.previewLabel', {
            device: t(`loginScreen.devices.${device}`),
            theme: t(`loginScreen.themeNames.${theme}`),
          })}
          className="relative mx-auto overflow-hidden rounded-lg border shadow-sm"
          style={{ width: frame.w * scale, height: frame.h * scale }}
        >
          <div
            inert
            className={`origin-top-left bg-background text-foreground ${theme === 'dark' ? 'dark' : 'theme-light'}`}
            style={{ ...vars, width: frame.w, height: frame.h, transform: `scale(${scale})` }}
          >
            {login && (
              <AccessScreen title={t('login.title')} override={login} preview={{ narrow: device === 'mobile' }}>
                <FakeLoginForm />
              </AccessScreen>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Toggle<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: readonly T[];
  label: (v: T) => string;
}) {
  return (
    <div className="inline-flex rounded-lg border p-0.5">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={value === option}
          onClick={() => onChange(option)}
          className={`rounded-md px-2.5 py-1 text-xs font-medium ${
            value === option ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {label(option)}
        </button>
      ))}
    </div>
  );
}

/** Um formulário de entrada só para a prévia (o quadro é `inert`: nada aqui recebe foco nem clique). */
function FakeLoginForm() {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <Field label={t('login.email')}>
        <Input type="email" readOnly tabIndex={-1} />
      </Field>
      <Field label={t('login.password')}>
        <Input type="password" readOnly tabIndex={-1} />
      </Field>
      <Button type="button" className="w-full" tabIndex={-1}>
        {t('login.submit')}
      </Button>
    </div>
  );
}
