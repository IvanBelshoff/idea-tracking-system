import { Pause, Play } from 'lucide-react';
import { type CSSProperties, type ReactNode, type RefObject, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { components } from '@/api/schema';
import { CoBrand } from '@/components/brand/co-brand';
import {
  fillStyle,
  focusPosition,
  type LoginBackground,
  mediaUrl,
  overlayStyle,
  pickText,
  showsBackground,
  videoAllowed,
} from '@/lib/login-screen';
import { HelpAnchor } from '../help';
import { usePageTitle } from '../page-title';
import { usePublicSettings } from '../session';
import { ThemeMenu } from './theme-menu';

type LoginScreen = components['schemas']['LoginScreenPublicView'];

const VIDEO_PAUSED_KEY = 'its-login-video-paused';

/**
 * Telas de acesso (entrar, esqueci a senha, definir a senha) com a identidade da organização (M23,
 * RN-176 a RN-181): 6 layouts, fundo de cor, gradiente, imagem ou vídeo, título e subtítulo próprios e
 * o botão de tema. O formulário fica SEMPRE numa superfície sólida (o contraste nunca depende do fundo),
 * e nada vem de fora da instalação (CA-T.27).
 */
export function AccessLayout({
  pageTitle,
  ...props
}: {
  pageTitle: string;
  title: string;
  intro?: ReactNode;
  wide?: boolean;
  children: ReactNode;
}) {
  const { data: settings } = usePublicSettings();
  usePageTitle(pageTitle, settings?.organizationName);
  return <AccessScreen {...props} />;
}

/**
 * A tela de acesso em si. Responde à largura do CONTÊINER (container queries), e não da janela: assim a
 * prévia da configuração (RN-180) mostra o computador e o celular dentro da própria página.
 */
export function AccessScreen({
  title,
  intro,
  wide,
  override,
  preview,
  children,
}: {
  title: string;
  intro?: ReactNode;
  wide?: boolean;
  /** A configuração ainda não salva (prévia). */
  override?: LoginScreen;
  /** Prévia: altura do quadro e se ele simula uma tela estreita (o vídeo dá lugar à capa). */
  preview?: { narrow: boolean };
  children: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const { data: settings } = usePublicSettings();
  const organization = settings?.organizationName || t('common.appName');

  const login: LoginScreen | undefined = override ?? settings?.login;
  const layout = login?.layout ?? 'card';
  const bg = login?.background as LoginBackground | undefined;
  const brandHex = settings?.branding.lightHex ?? '#5458c8';
  const withBackground = !!bg && showsBackground(layout) && (bg.type !== 'none' || layout === 'band');
  const headline = pickText(login?.title, i18n.language);
  const subline = pickText(login?.subtitle, i18n.language);
  const hasTexts = Boolean(headline || subline);
  // Na faixa da marca sem fundo escolhido, a faixa usa a cor da marca com o texto da marca (sempre legível).
  const bandBrand = layout === 'band' && bg?.type === 'none';
  const textsOnBackground = hasTexts && withBackground && (bandBrand || !!login?.text.onBackground);
  const video = useLoginVideo(withBackground && bg?.type === 'video' && !!bg.videoVersion, preview?.narrow);
  // Na prévia, a altura é a do quadro; na tela de verdade, a da janela.
  const fullH = preview ? 'min-h-full' : 'min-h-svh';
  const wideFullH = preview ? '@min-[64rem]:min-h-full' : '@min-[64rem]:min-h-svh';

  const brand = (
    <div className="flex flex-col items-start gap-2">
      <CoBrand name={organization} subtitle={t('common.appFullName')} logo={settings?.logo} size="lg" />
      {(settings?.logo?.light ?? null) !== null && (
        <span className="text-xs text-muted-foreground">{t('common.appFullName')}</span>
      )}
    </div>
  );
  const surfaceTexts = hasTexts && !textsOnBackground && (
    <Texts headline={headline} subline={subline} className="mt-6 text-foreground" />
  );
  const form = (
    <>
      <h1 className="text-xl font-bold">{title}</h1>
      {intro && <div className="mt-2 text-sm text-muted-foreground">{intro}</div>}
      <div className="mt-6">{children}</div>
    </>
  );
  const help = (
    <p className="mt-6 text-sm text-muted-foreground">
      <HelpAnchor topic="home" className="underline underline-offset-4 hover:text-foreground">
        {t('help.needHelp')}
      </HelpAnchor>
    </p>
  );
  const controls = (
    <div className="absolute top-4 right-4 z-20 flex gap-2">
      {video.playing !== null && (
        <button
          type="button"
          onClick={video.toggle}
          aria-pressed={!video.playing}
          aria-label={video.playing ? t('login.screen.pauseVideo') : t('login.screen.playVideo')}
          title={video.playing ? t('login.screen.pauseVideo') : t('login.screen.playVideo')}
          className="grid size-10 place-items-center rounded-full border bg-background/90 text-foreground shadow-sm backdrop-blur hover:bg-muted"
        >
          {video.playing ? (
            <Pause className="size-4" aria-hidden="true" />
          ) : (
            <Play className="size-4" aria-hidden="true" />
          )}
        </button>
      )}
      <ThemeMenu />
    </div>
  );
  const backdrop = (className: string) =>
    bg && <Backdrop bg={bg} brandHex={brandHex} bandBrand={bandBrand} video={video} className={className} />;
  // Sem contraste direto, o texto ganha uma placa atrás que garante 4,5:1 (RN-177; conta do servidor).
  const plate = bandBrand ? null : (login?.text.plate ?? null);
  const bgTexts = (className = '') =>
    textsOnBackground && (
      <Texts
        headline={headline}
        subline={subline}
        large
        className={`${bandBrand ? 'text-primary-foreground' : login?.text.tone === 'light' ? 'text-white' : 'text-[#17171c]'} ${plate !== null ? 'w-fit max-w-full rounded-xl px-5 py-4' : ''} ${className}`}
        style={
          plate !== null
            ? { background: login?.text.tone === 'light' ? `rgb(0 0 0 / ${plate})` : `rgb(255 255 255 / ${plate})` }
            : undefined
        }
      />
    );
  const width = wide ? 'max-w-xl' : 'max-w-sm';

  // 1. Cartão central (o de hoje) e 6. minimalista: sem fundo.
  const frame = (node: ReactNode) => <div className={`@container ${preview ? 'h-full' : ''}`}>{node}</div>;

  if (layout === 'minimal') {
    return frame(
      <div
        className={`relative flex ${fullH} items-center justify-center bg-background px-4 py-10`}
        data-layout={layout}
      >
        {controls}
        <main className={`w-full ${width}`}>
          {brand}
          {surfaceTexts}
          <div className="mt-8">{form}</div>
          {help}
        </main>
      </div>,
    );
  }

  if (layout === 'full' && withBackground) {
    return frame(
      <div className={`relative isolate flex ${fullH} items-center justify-center px-4 py-10`} data-layout={layout}>
        {backdrop('absolute inset-0 -z-10')}
        {controls}
        <main className={`w-full ${width}`}>
          {bgTexts('mx-auto mb-6 text-center')}
          <Card>
            {brand}
            {surfaceTexts}
            <div className="mt-6">{form}</div>
            {help}
          </Card>
        </main>
      </div>,
    );
  }

  if ((layout === 'split' || layout === 'band') && withBackground) {
    const formFirst = login?.side === 'left';
    return frame(
      <div
        className={`relative grid ${fullH} ${layout === 'band' ? '@min-[64rem]:grid-cols-[5fr_7fr]' : '@min-[64rem]:grid-cols-2'}`}
        data-layout={layout}
      >
        {controls}
        <section
          className={`relative isolate flex min-h-32 items-end overflow-hidden px-6 py-8 @min-[40rem]:min-h-44 ${wideFullH} @min-[64rem]:items-center @min-[64rem]:px-12 ${
            formFirst ? '@min-[64rem]:order-2' : '@min-[64rem]:order-1'
          } ${layout === 'band' ? '@min-[64rem]:items-end @min-[64rem]:pb-16' : ''}`}
        >
          {backdrop('absolute inset-0 -z-10')}
          {bgTexts('max-w-xl')}
        </section>
        <main
          className={`flex items-center justify-center bg-background px-4 py-10 ${formFirst ? '@min-[64rem]:order-1' : '@min-[64rem]:order-2'}`}
        >
          <div className={`w-full ${width}`}>
            {brand}
            {surfaceTexts}
            <div className="mt-8">{form}</div>
            {help}
          </div>
        </main>
      </div>,
    );
  }

  if (layout === 'panel' && withBackground) {
    const formLeft = login?.side === 'left';
    return frame(
      <div
        className={`relative isolate flex ${fullH} flex-col @min-[64rem]:flex-row ${formLeft ? '@min-[64rem]:flex-row-reverse' : ''}`}
        data-layout={layout}
      >
        {backdrop('absolute inset-0 -z-10')}
        {controls}
        <div className="flex min-h-32 flex-1 items-end px-6 py-8 @min-[40rem]:min-h-44 @min-[64rem]:p-16">
          {bgTexts('max-w-xl')}
        </div>
        <main
          className={`flex w-full flex-col justify-center bg-background px-6 py-10 shadow-xl ${wideFullH} @min-[64rem]:w-[28rem] @min-[64rem]:shrink-0 @min-[64rem]:px-10`}
        >
          <div className={`mx-auto w-full ${width}`}>
            {brand}
            {surfaceTexts}
            <div className="mt-8">{form}</div>
            {help}
          </div>
        </main>
      </div>,
    );
  }

  // Cartão central: o de hoje (também a forma de qualquer layout enquanto a configuração carrega).
  return frame(
    <div className={`relative flex ${fullH} items-center justify-center bg-muted/40 px-4 py-10`} data-layout="card">
      {controls}
      <main className={`w-full ${width}`}>
        <div className="mb-8 flex flex-col items-center gap-2">
          <CoBrand name={organization} subtitle={t('common.appFullName')} logo={settings?.logo} size="lg" />
          {(settings?.logo?.light ?? null) !== null && (
            <span className="text-xs text-muted-foreground">{t('common.appFullName')}</span>
          )}
        </div>
        {hasTexts && <Texts headline={headline} subline={subline} className="mb-6 text-center text-foreground" />}
        <Card>{form}</Card>
        <p className="mt-6 text-center text-sm text-muted-foreground">
          <HelpAnchor topic="home" className="underline underline-offset-4 hover:text-foreground">
            {t('help.needHelp')}
          </HelpAnchor>
        </p>
      </main>
    </div>,
  );
}

function Card({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border bg-card p-6 text-card-foreground shadow-sm @min-[40rem]:p-8">{children}</div>
  );
}

/** O título e o subtítulo da organização (texto simples: o React escapa, nada é interpretado). */
function Texts({
  headline,
  subline,
  large,
  className = '',
  style,
}: {
  headline: string;
  subline: string;
  large?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div className={className} style={style}>
      {headline && (
        <p
          className={`font-bold tracking-tight text-balance ${large ? 'text-2xl @min-[40rem]:text-3xl @min-[64rem]:text-4xl' : 'text-2xl'}`}
        >
          {headline}
        </p>
      )}
      {subline && (
        <p className={`mt-2 text-pretty ${large ? 'text-base @min-[64rem]:text-lg' : 'text-sm'}`}>{subline}</p>
      )}
    </div>
  );
}

type LoginVideo = {
  /** Nulo: não há vídeo tocando aqui (sem vídeo, ou só a capa). */
  playing: boolean | null;
  canPlay: boolean;
  ref: RefObject<HTMLVideoElement | null>;
  toggle: () => void;
};

const readVideoEnv = () => ({
  reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  narrow: window.matchMedia('(max-width: 767px)').matches,
  saveData: Boolean((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData),
});

/** Menos movimento, economia de dados e tela estreita mostram só a capa (RN-178). */
function useVideoEnv() {
  const [env, setEnv] = useState(readVideoEnv);
  useEffect(() => {
    const queries = ['(prefers-reduced-motion: reduce)', '(max-width: 767px)'].map((q) => window.matchMedia(q));
    const update = () => setEnv(readVideoEnv());
    for (const q of queries) q.addEventListener('change', update);
    return () => {
      for (const q of queries) q.removeEventListener('change', update);
    };
  }, []);
  return env;
}

function storedPaused(): boolean {
  try {
    return localStorage.getItem(VIDEO_PAUSED_KEY) === '1';
  } catch {
    return false;
  }
}

/** O vídeo de fundo e o botão de pausar, com a escolha guardada neste navegador (WCAG 2.2.2). */
function useLoginVideo(hasVideo: boolean, narrow?: boolean): LoginVideo {
  const env = useVideoEnv();
  const canPlay = hasVideo && videoAllowed(narrow === undefined ? env : { ...env, narrow });
  const ref = useRef<HTMLVideoElement | null>(null);
  const [paused, setPaused] = useState(storedPaused);
  const toggle = () => {
    const next = !paused;
    setPaused(next);
    try {
      if (next) localStorage.setItem(VIDEO_PAUSED_KEY, '1');
      else localStorage.removeItem(VIDEO_PAUSED_KEY);
    } catch {
      // Sem armazenamento, a escolha vale até fechar a aba.
    }
    if (next) ref.current?.pause();
    else void ref.current?.play().catch(() => undefined);
  };
  return { playing: canPlay ? !paused : null, canPlay, ref, toggle };
}

/** O fundo: decorativo (`aria-hidden`); o vídeo nem é montado quando só a capa deve aparecer. */
function Backdrop({
  bg,
  brandHex,
  bandBrand,
  video,
  className,
}: {
  bg: LoginBackground;
  brandHex: string;
  bandBrand: boolean;
  video: LoginVideo;
  className: string;
}) {
  const fill = fillStyle(bg);
  const overlay = overlayStyle(bg, brandHex);
  const media = bg.type === 'image' || bg.type === 'video';
  const still = bg.type === 'image' ? mediaUrl('image', bg.imageVersion) : mediaUrl('poster', bg.posterVersion);
  const look = {
    objectPosition: focusPosition(bg),
    filter: bg.blur > 0 ? `blur(${bg.blur}px)` : undefined,
    // Com desfoque, a borda clareia: um pouco de zoom a esconde.
    transform: bg.blur > 0 ? 'scale(1.06)' : undefined,
  };
  return (
    <div
      aria-hidden="true"
      className={`overflow-hidden ${bandBrand ? 'bg-primary' : ''} ${className}`}
      style={fill ? { background: fill } : undefined}
    >
      {media && video.canPlay && bg.type === 'video' ? (
        <video
          ref={video.ref}
          className="size-full object-cover"
          style={look}
          src={mediaUrl('video', bg.videoVersion) ?? undefined}
          poster={still ?? undefined}
          autoPlay={video.playing === true}
          muted
          loop
          playsInline
          preload="metadata"
          tabIndex={-1}
        />
      ) : (
        media && still && <img src={still} alt="" className="size-full object-cover" style={look} />
      )}
      {overlay && <div className="absolute inset-0" style={overlay} />}
    </div>
  );
}
