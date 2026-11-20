import { useTranslation } from 'react-i18next';
import Lightbox, { type Slide } from 'yet-another-react-lightbox';
import Counter from 'yet-another-react-lightbox/plugins/counter';
import Video from 'yet-another-react-lightbox/plugins/video';
import Zoom from 'yet-another-react-lightbox/plugins/zoom';
import 'yet-another-react-lightbox/styles.css';
import 'yet-another-react-lightbox/plugins/counter.css';

export interface MediaItem {
  /** Endereço de exibição (a rota `/view`, que confere o conteúdo). */
  src: string;
  type: 'image' | 'video';
  /** Tipo do vídeo (`video/mp4`, `video/webm`). */
  mime: string;
  title: string;
}

export interface MediaViewerProps {
  items: MediaItem[];
  /** Índice aberto; nulo = fechado. */
  index: number | null;
  onClose: () => void;
}

/**
 * Visualizador de foto e vídeo (RN-147), com `yet-another-react-lightbox` (Zoom, Video
 * e Counter): anterior/próximo, contador, zoom, vídeo com os controles do navegador e sem tocar sozinho.
 * Esc fecha e o foco volta para quem abriu (o próprio componente cuida disso).
 */
export default function MediaViewerImpl({ items, index, onClose }: MediaViewerProps) {
  const { t } = useTranslation();
  const slides: Slide[] = items.map((item) =>
    item.type === 'video'
      ? { type: 'video', sources: [{ src: item.src, type: item.mime }], title: item.title }
      : { src: item.src, alt: item.title, title: item.title },
  );
  const several = slides.length > 1;
  return (
    <Lightbox
      open={index !== null}
      index={index ?? 0}
      close={onClose}
      slides={slides}
      plugins={several ? [Zoom, Video, Counter] : [Zoom, Video]}
      carousel={{ finite: !several }}
      // Um anexo só: sem anterior e próximo.
      render={several ? undefined : { buttonPrev: () => null, buttonNext: () => null }}
      video={{ autoPlay: false, controls: true, preload: 'metadata', playsInline: true }}
      controller={{ closeOnBackdropClick: true }}
      labels={
        {
          Previous: t('media.previous'),
          Next: t('media.next'),
          Close: t('media.close'),
          Lightbox: t('media.viewer'),
          Carousel: t('media.carousel'),
          Slide: t('media.slide'),
          'Photo gallery': t('media.gallery'),
          '{index} of {total}': t('media.position'),
          'Zoom in': t('media.zoomIn'),
          'Zoom out': t('media.zoomOut'),
        } as Record<string, string>
      }
    />
  );
}
