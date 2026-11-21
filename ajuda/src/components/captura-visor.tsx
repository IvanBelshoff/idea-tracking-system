'use client';

import Lightbox from 'yet-another-react-lightbox';
import Captions from 'yet-another-react-lightbox/plugins/captions';
import Zoom from 'yet-another-react-lightbox/plugins/zoom';
import 'yet-another-react-lightbox/styles.css';
import 'yet-another-react-lightbox/plugins/captions.css';
import { type Lang, MESSAGES } from '../i18n';

export interface CapturaAberta {
  src: string;
  alt: string;
  width: number;
  height: number;
  legenda?: string;
}

/**
 * A captura em tela cheia, sem sair da página: a mesma biblioteca do visualizador de anexos do ITS
 * (`yet-another-react-lightbox`), com zoom (roda do mouse, pinça no celular, duplo clique) para ler os
 * detalhes e o texto da captura embaixo. Esc ou clique fora fecham, e o foco volta para a captura.
 * Com movimento reduzido, sem animação.
 */
export default function CapturaVisor({
  captura,
  lang,
  fechar,
}: {
  captura: CapturaAberta;
  lang: Lang;
  fechar: () => void;
}) {
  const t = MESSAGES[lang].capture;
  const reduzido = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  return (
    <Lightbox
      open
      close={fechar}
      slides={[
        {
          src: captura.src,
          alt: captura.alt,
          width: captura.width,
          height: captura.height,
          description: captura.legenda ?? captura.alt,
        },
      ]}
      plugins={[Zoom, Captions]}
      // Uma captura só: sem anterior e próximo, e sem arrastar para os lados.
      carousel={{ finite: true }}
      render={{ buttonPrev: () => null, buttonNext: () => null }}
      zoom={{ maxZoomPixelRatio: 2, scrollToZoom: true }}
      captions={{ descriptionTextAlign: 'center', descriptionMaxLines: 3 }}
      animation={reduzido ? { fade: 0, swipe: 0, navigation: 0, zoom: 0 } : undefined}
      controller={{ closeOnBackdropClick: true }}
      // A captura não fica embaixo da barra (zoom e fechar) nem do texto: o slide desconta esse respiro.
      styles={{ slide: { padding: '64px 16px 112px' } }}
      labels={{
        Close: t.close,
        'Zoom in': t.zoomIn,
        'Zoom out': t.zoomOut,
        Lightbox: t.viewer,
        Carousel: t.viewer,
        Slide: t.viewer,
      }}
    />
  );
}
