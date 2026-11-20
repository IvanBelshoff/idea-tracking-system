import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ImageUp, Trash2, TriangleAlert } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { errorText, unwrap } from '@/api/errors';
import { CoBrand, type LogoVariant, type LogoVersions, logoUrl } from '@/components/brand/co-brand';
import { ItsSymbol } from '@/components/brand/its-symbol';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FormError } from '../auth/auth-layout';
import type { Branding } from '../branding';
import { BRAND_FONTS, type BrandFont, FONT_FAMILY, isBrandFont, loadFont } from '../fonts';
import { keys, usePublicSettings } from '../session';
import { LoginScreenSection } from './login-screen-section';
import { adminKeys } from './queries';
import { AdminPage, Section } from './shared';

const HEX = /^#[0-9a-f]{6}$/i;
/** Índigo do ITS em hex: valor inicial do seletor quando a organização ainda não escolheu. */
const ITS_HEX = '#5458c8';
/** Igual ao limite do servidor (que confere de novo, pelo conteúdo do arquivo). */
const LOGO_MAX_BYTES = 2 * 1024 * 1024;
const LOGO_TYPES = ['image/png', 'image/webp'];

/** Fundos espelhados de tokens.css só para as amostras (a interface real usa os tokens). */
const SURFACE = {
  light: {
    bg: 'oklch(0.99 0.002 270)',
    card: 'oklch(1 0 0)',
    shell: 'oklch(0.97 0.004 270)',
    fg: 'oklch(0.21 0.015 270)',
    muted: 'oklch(0.49 0.015 270)',
    border: 'oklch(0.9 0.006 270)',
  },
  dark: {
    bg: 'oklch(0.165 0.008 270)',
    card: 'oklch(0.2 0.01 270)',
    shell: 'oklch(0.14 0.008 270)',
    fg: 'oklch(0.95 0.005 270)',
    muted: 'oklch(0.72 0.012 270)',
    border: 'oklch(0.3 0.01 270)',
  },
};

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

/** Amostra de um tema com a cor derivada: botão, link, item ativo do menu, símbolo e barra de rolagem. */
function ThemeSample({ theme, pair }: { theme: LogoVariant; pair: Branding['light'] }) {
  const { t } = useTranslation();
  const s = SURFACE[theme];
  return (
    <figure
      className="rounded-lg border p-4"
      style={{ background: s.bg, color: s.fg, borderColor: s.border }}
      aria-label={t(`admin.branding.sample.${theme}` as never)}
    >
      <figcaption className="text-xs font-medium" style={{ color: s.muted }}>
        {t(`admin.branding.sample.${theme}` as never)}
      </figcaption>
      <div className="mt-3 flex items-center gap-2 rounded-md px-2 py-1.5" style={{ background: s.card }}>
        <span style={{ color: pair.brand }}>
          <ItsSymbol size={22} />
        </span>
        <span className="text-sm font-semibold">{t('admin.branding.sample.menu')}</span>
      </div>
      <div className="mt-3 space-y-3 rounded-md p-3" style={{ background: s.card, border: `1px solid ${s.border}` }}>
        <span
          className="inline-flex h-8 items-center rounded-md px-3 text-sm font-medium"
          style={{ background: pair.brand, color: pair.brandFg }}
        >
          {t('admin.branding.sample.button')}
        </span>
        <p className="text-sm">
          <span className="underline underline-offset-4" style={{ color: pair.brand }}>
            {t('admin.branding.sample.link')}
          </span>
        </p>
        <div className="flex items-center gap-2" aria-hidden="true">
          <div className="h-16 flex-1 rounded-md" style={{ background: s.bg }} />
          <div
            className="h-16 w-2 rounded-full"
            style={{ background: `color-mix(in oklch, ${pair.brand} 85%, transparent)` }}
          />
        </div>
      </div>
    </figure>
  );
}

/**
 * Amostra do co-branding num tema, nas proporções reais: o cabeçalho do menu na largura útil do
 * trilho e a tela de entrada sobre o fundo aberto (como na tela de verdade, sem cartão em volta).
 */
function CoBrandSample({
  theme,
  pair,
  logo,
  name,
}: {
  theme: LogoVariant;
  pair: Branding['light'] | undefined;
  logo: LogoVersions;
  name: string;
}) {
  const { t } = useTranslation();
  const s = SURFACE[theme];
  return (
    <figure
      className="overflow-hidden rounded-lg border"
      style={{ background: s.bg, color: s.fg, borderColor: s.border }}
      aria-label={t(`admin.branding.sample.${theme}` as never)}
    >
      <figcaption className="px-4 pt-3 pb-2.5 text-xs font-medium" style={{ color: s.muted }}>
        {t(`admin.branding.sample.${theme}` as never)}
      </figcaption>
      <div className="border-y px-4 pt-2.5 pb-4" style={{ background: s.shell, borderColor: s.border }}>
        <p className="mb-3 text-xs" style={{ color: s.muted }}>
          {t('admin.branding.logo.sampleMenu')}
        </p>
        <div className="max-w-44">
          <CoBrand name={name} logo={logo} theme={theme} pair={pair} />
        </div>
      </div>
      <div className="px-4 pt-2.5 pb-6">
        <p className="text-xs" style={{ color: s.muted }}>
          {t('admin.branding.logo.sampleLogin')}
        </p>
        <div className="mt-4 flex flex-col items-center gap-2">
          <CoBrand name={name} logo={logo} theme={theme} pair={pair} size="lg" />
          {logo.light && (
            <span className="text-xs" style={{ color: s.muted }}>
              {t('common.appFullName')}
            </span>
          )}
        </div>
      </div>
    </figure>
  );
}

/** Um envio de logo (claro ou escuro): miniatura no fundo do tema, enviar/trocar e remover. */
function LogoSlot({
  variant,
  version,
  name,
  onUploaded,
}: {
  variant: LogoVariant;
  version: string | null;
  name: string;
  onUploaded: (suggestedColor: string | null) => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const s = SURFACE[variant];
  const refresh = () => qc.invalidateQueries({ queryKey: keys.publicSettings });
  const upload = useMutation({
    meta: { success: t('feedback.branding.logoUploaded') },
    mutationFn: (file: File) =>
      unwrap(
        api.PUT('/api/branding/logo/{variant}', {
          params: { path: { variant } },
          body: { file: file as unknown as string },
          bodySerializer: () => {
            const form = new FormData();
            form.append('file', file);
            return form;
          },
        }),
      ),
    onSuccess: async (data) => {
      await refresh();
      onUploaded(data.suggestedColor);
    },
  });
  const remove = useMutation({
    meta: { success: t('feedback.branding.logoRemoved') },
    mutationFn: () => unwrap(api.DELETE('/api/branding/logo/{variant}', { params: { path: { variant } } })),
    onSuccess: refresh,
  });
  const error =
    localError ?? (upload.isError ? errorText(t, upload.error) : remove.isError ? errorText(t, remove.error) : null);
  const id = `logo-${variant}`;

  return (
    <div className="min-w-0 space-y-2">
      <h3 id={`${id}-titulo`} className="text-sm font-medium">
        {t(`admin.branding.logo.${variant}.label` as never)}
      </h3>
      <div
        className="grid h-24 place-items-center rounded-lg border px-4"
        style={{ background: s.card, borderColor: s.border, color: s.muted }}
      >
        {version ? (
          <img
            src={logoUrl(variant, version)}
            alt={t('admin.branding.logo.current', { name })}
            className="max-h-12 w-auto max-w-full object-contain"
          />
        ) : (
          <span className="text-sm">{t('admin.branding.logo.none')}</span>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{t(`admin.branding.logo.${variant}.hint` as never)}</p>
      <div className="flex flex-wrap gap-2">
        <input
          ref={input}
          id={id}
          type="file"
          accept="image/png,image/webp"
          className="sr-only"
          aria-labelledby={`${id}-titulo`}
          tabIndex={-1}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            setLocalError(null);
            if (file.type && !LOGO_TYPES.includes(file.type)) {
              setLocalError(t('admin.branding.logo.wrongType'));
              return;
            }
            if (file.size > LOGO_MAX_BYTES) {
              setLocalError(t('admin.branding.logo.tooLarge'));
              return;
            }
            upload.mutate(file);
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={upload.isPending}
          onClick={() => input.current?.click()}
          aria-describedby={`${id}-titulo`}
        >
          <ImageUp aria-hidden="true" />
          {upload.isPending
            ? t('admin.branding.logo.uploading')
            : version
              ? t('admin.branding.logo.change')
              : t('admin.branding.logo.add')}
        </Button>
        {version && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={remove.isPending}
            onClick={() => remove.mutate()}
            aria-describedby={`${id}-titulo`}
          >
            <Trash2 aria-hidden="true" />
            {t('admin.branding.logo.remove')}
          </Button>
        )}
      </div>
      <FormError message={error} />
    </div>
  );
}

/**
 * Fonte da interface: as quatro opções, cada uma com uma amostra real na própria fonte (o código de
 * ideia fica em Geist Mono, como na interface). Salvar vale para todos.
 */
function FontSection() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: adminKeys.settings, queryFn: () => unwrap(api.GET('/api/settings')) });
  const savedValue = settings.data?.find((s) => s.key === 'branding.font')?.value;
  const saved: BrandFont = isBrandFont(savedValue) ? savedValue : 'geist';
  const [font, setFont] = useState<BrandFont | null>(null);
  const current = font ?? saved;
  useEffect(() => {
    for (const f of BRAND_FONTS) void loadFont(f);
  }, []);
  const save = useMutation({
    meta: { success: t('feedback.branding.fontSaved') },
    mutationFn: (value: BrandFont) =>
      unwrap(api.PATCH('/api/settings', { body: { values: { 'branding.font': value } } })),
    onSuccess: (data) => {
      qc.setQueryData(adminKeys.settings, data);
      setFont(null);
      void qc.invalidateQueries({ queryKey: keys.publicSettings });
    },
  });

  return (
    <Section title={t('admin.branding.font.title')} intro={t('admin.branding.font.intro')}>
      <fieldset>
        <legend className="sr-only">{t('admin.branding.font.title')}</legend>
        <div className="grid gap-3 md:grid-cols-2">
          {BRAND_FONTS.map((f) => (
            <label
              key={f}
              className="flex cursor-pointer gap-3 rounded-lg border p-4 transition-colors hover:bg-muted/40 has-checked:border-primary has-checked:bg-primary/5 has-focus-visible:ring-3 has-focus-visible:ring-ring/50"
            >
              <input
                type="radio"
                name="fonte"
                value={f}
                checked={current === f}
                onChange={() => setFont(f)}
                className="mt-1 size-4 shrink-0 accent-primary"
              />
              <span className="min-w-0 space-y-1.5">
                <span className="block text-base font-semibold" style={{ fontFamily: FONT_FAMILY[f] }}>
                  {t(`admin.branding.font.options.${f}.name` as never)}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {t(`admin.branding.font.options.${f}.hint` as never)}
                </span>
                <span className="block text-sm" style={{ fontFamily: FONT_FAMILY[f] }} lang="pt-BR">
                  {t('admin.branding.font.sample')} <span className="font-mono text-xs">ITS-2026-0042</span>{' '}
                  <span style={{ fontVariantNumeric: 'tabular-nums' }}>· R$ 1.234,56</span>
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <p className="mt-3 text-xs text-muted-foreground">{t('admin.branding.font.codeNote')}</p>
      <FormError message={save.isError ? errorText(t, save.error) : null} />
      <div className="mt-5 flex flex-wrap gap-2">
        <Button
          disabled={current === saved || save.isPending || !settings.isSuccess}
          onClick={() => save.mutate(current)}
        >
          {t('admin.branding.font.save')}
        </Button>
        {save.isSuccess && font === null && (
          <span className="self-center text-sm text-muted-foreground">{t('admin.branding.font.saved')}</span>
        )}
      </div>
    </Section>
  );
}

/** Deixar cada pessoa escolher a cor (da paleta curada) e a fonte da própria tela (RN-145); desligado de fábrica. */
function UserThemeSection() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: adminKeys.settings, queryFn: () => unwrap(api.GET('/api/settings')) });
  const on = settings.data?.find((s) => s.key === 'branding.user_theme')?.value === true;
  const save = useMutation({
    meta: { success: t('feedback.branding.userThemeSaved') },
    mutationFn: (value: boolean) =>
      unwrap(api.PATCH('/api/settings', { body: { values: { 'branding.user_theme': value } } })),
    onSuccess: (data) => {
      qc.setQueryData(adminKeys.settings, data);
      void qc.invalidateQueries({ queryKey: keys.me });
    },
  });
  return (
    <Section title={t('admin.branding.userTheme.title')} intro={t('admin.branding.userTheme.intro')}>
      <div className="flex items-start gap-2 text-sm">
        <Checkbox
          id="tema-por-pessoa"
          checked={on}
          disabled={!settings.data || save.isPending}
          onCheckedChange={(v) => save.mutate(v === true)}
        />
        <label htmlFor="tema-por-pessoa">
          {t('admin.branding.userTheme.label')}
          <span className="block text-xs text-muted-foreground">{t('admin.branding.userTheme.hint')}</span>
        </label>
      </div>
      <FormError message={save.isError ? errorText(t, save.error) : null} />
    </Section>
  );
}

/**
 * Identidade visual (M10): cor da marca e logo da organização. O admin escolhe uma cor; o backend
 * deriva o tema claro e o escuro com contraste garantido, e as amostras mostram o que vai valer.
 * O logo fica AO LADO do símbolo do ITS, que nunca é substituído.
 */
export function BrandingPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data: publicSettings } = usePublicSettings();
  const settings = useQuery({ queryKey: adminKeys.settings, queryFn: () => unwrap(api.GET('/api/settings')) });
  const saved = (key: string) =>
    (settings.data?.find((s) => s.key === key)?.value as string | null | undefined) ?? null;
  const [color, setColor] = useState<string | null>(null);
  const [darkOn, setDarkOn] = useState(false);
  const [dark, setDark] = useState('#7a8cff');
  const [hexDraft, setHexDraft] = useState('');
  const [suggested, setSuggested] = useState<string | null>(null);
  const colorInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const list = settings.data;
    if (!list) return;
    const value = (key: string) => (list.find((x) => x.key === key)?.value as string | null | undefined) ?? null;
    const c = value('branding.color');
    const d = value('branding.color_dark');
    setColor(c);
    setHexDraft(c ?? '');
    setDarkOn(!!d);
    if (d) setDark(d);
  }, [settings.data]);

  const request = useDebounced({ color, colorDark: darkOn && color ? dark : null }, 250);
  const preview = useQuery({
    queryKey: ['branding-preview', request],
    queryFn: () => unwrap(api.POST('/api/settings/branding/preview', { body: request })),
    enabled: settings.isSuccess,
    placeholderData: (prev) => prev,
  });
  const save = useMutation({
    meta: { success: t('feedback.branding.colorsSaved') },
    mutationFn: (values: Record<string, string | null>) => unwrap(api.PATCH('/api/settings', { body: { values } })),
    onSuccess: (data) => {
      qc.setQueryData(adminKeys.settings, data);
      void qc.invalidateQueries({ queryKey: keys.publicSettings });
    },
  });
  const dirty =
    settings.isSuccess &&
    (color !== saved('branding.color') || (darkOn && color ? dark : null) !== saved('branding.color_dark'));
  const p = preview.data;
  const logo: LogoVersions = publicSettings?.logo ?? { light: null, dark: null };
  const name = publicSettings?.organizationName || t('common.appName');

  const applySuggested = (hex: string) => {
    setColor(hex);
    setHexDraft(hex);
    setSuggested(null);
    colorInput.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    colorInput.current?.focus({ preventScroll: true });
  };

  return (
    <AdminPage title={t('admin.branding.title')} intro={t('admin.branding.intro')} help="adminBranding">
      <div className="space-y-6">
        <Section title={t('admin.branding.color.title')} intro={t('admin.branding.color.intro')}>
          <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
            <div className="space-y-4">
              <div>
                <Label htmlFor="cor-marca">{t('admin.branding.color.label')}</Label>
                <div className="mt-1.5 flex items-center gap-2">
                  <input
                    ref={colorInput}
                    id="cor-marca"
                    type="color"
                    value={color ?? ITS_HEX}
                    onChange={(e) => {
                      setColor(e.target.value.toLowerCase());
                      setHexDraft(e.target.value.toLowerCase());
                    }}
                    className="h-9 w-12 cursor-pointer rounded-md border bg-card p-1"
                  />
                  <Input
                    aria-label={t('admin.branding.color.hex')}
                    value={hexDraft}
                    placeholder={ITS_HEX}
                    maxLength={7}
                    className="font-mono"
                    onChange={(e) => {
                      const v = e.target.value.trim();
                      setHexDraft(v);
                      if (HEX.test(v)) setColor(v.toLowerCase());
                    }}
                  />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {color ? t('admin.branding.color.custom') : t('admin.branding.color.default')}
                </p>
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm">
                  <Checkbox
                    id="ajustar-escuro"
                    checked={darkOn}
                    disabled={!color}
                    onCheckedChange={(v) => setDarkOn(v === true)}
                  />
                  <label htmlFor="ajustar-escuro">{t('admin.branding.color.darkToggle')}</label>
                </div>
                {darkOn && color && (
                  <div className="flex items-center gap-2 pl-6">
                    <input
                      type="color"
                      aria-label={t('admin.branding.color.darkLabel')}
                      value={dark}
                      onChange={(e) => setDark(e.target.value.toLowerCase())}
                      className="h-9 w-12 cursor-pointer rounded-md border bg-card p-1"
                    />
                    <span className="font-mono text-sm">{dark}</span>
                  </div>
                )}
                <p className="text-xs text-muted-foreground">{t('admin.branding.color.darkHint')}</p>
              </div>
              {p && (p.adjusted.light || p.adjusted.dark) && (
                <p role="status" className="flex items-start gap-2 rounded-md border border-(--st-late)/40 p-3 text-sm">
                  <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-(--st-late)" />
                  <span>
                    {p.adjusted.light && p.adjusted.dark
                      ? t('admin.branding.color.adjustedBoth')
                      : p.adjusted.light
                        ? t('admin.branding.color.adjustedLight')
                        : t('admin.branding.color.adjustedDark')}
                  </span>
                </p>
              )}
            </div>
            <div className="grid gap-4 sm:grid-cols-2" aria-live="polite">
              {p && (
                <>
                  <ThemeSample theme="light" pair={p.light} />
                  <ThemeSample theme="dark" pair={p.dark} />
                </>
              )}
            </div>
          </div>
          <FormError
            message={save.isError ? errorText(t, save.error) : settings.isError ? errorText(t, settings.error) : null}
          />
          <div className="mt-5 flex flex-wrap gap-2">
            <Button
              disabled={!dirty || save.isPending}
              onClick={() =>
                save.mutate({ 'branding.color': color, 'branding.color_dark': darkOn && color ? dark : null })
              }
            >
              {t('admin.branding.color.save')}
            </Button>
            <Button
              variant="outline"
              disabled={save.isPending || (!saved('branding.color') && !color)}
              onClick={() => {
                setColor(null);
                setHexDraft('');
                setDarkOn(false);
                save.mutate({ 'branding.color': null, 'branding.color_dark': null });
              }}
            >
              {t('admin.branding.color.reset')}
            </Button>
            {save.isSuccess && !dirty && (
              <span className="self-center text-sm text-muted-foreground">{t('admin.branding.saved')}</span>
            )}
          </div>
          <p className="mt-4 max-w-[70ch] text-xs text-muted-foreground">{t('admin.branding.color.appIconNote')}</p>
        </Section>

        <Section title={t('admin.branding.logo.title')} intro={t('admin.branding.logo.intro')}>
          <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
            <div className="space-y-6">
              <LogoSlot
                variant="light"
                version={logo.light}
                name={name}
                onUploaded={(hex) => setSuggested(hex && hex !== color ? hex : null)}
              />
              <LogoSlot variant="dark" version={logo.dark} name={name} onUploaded={() => undefined} />
              {suggested && (
                <div role="status" className="space-y-2 rounded-md border p-3 text-sm">
                  <p className="flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="size-4 shrink-0 rounded-sm border"
                      style={{ background: suggested }}
                    />
                    <span>{t('admin.branding.logo.suggested', { hex: suggested })}</span>
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" size="sm" variant="outline" onClick={() => applySuggested(suggested)}>
                      {t('admin.branding.logo.useSuggested')}
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setSuggested(null)}>
                      {t('admin.branding.logo.ignoreSuggested')}
                    </Button>
                  </div>
                </div>
              )}
            </div>
            <div className="grid content-start gap-4 sm:grid-cols-2">
              <CoBrandSample theme="light" pair={p?.light} logo={logo} name={name} />
              <CoBrandSample theme="dark" pair={p?.dark} logo={logo} name={name} />
            </div>
          </div>
        </Section>

        <LoginScreenSection />
        <FontSection />
        <UserThemeSection />
      </div>
    </AdminPage>
  );
}
