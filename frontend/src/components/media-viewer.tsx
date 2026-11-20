import { lazy, Suspense } from 'react';
import type { MediaItem, MediaViewerProps } from './media-viewer-impl';

// O visualizador só baixa quando alguém abre um anexo (CA-RN-147.6).
const Impl = lazy(() => import('./media-viewer-impl'));

/** Visualizador de foto e vídeo (RN-147), carregado sob demanda. */
export function MediaViewer(props: MediaViewerProps) {
  if (props.index === null) return null;
  return (
    <Suspense fallback={null}>
      <Impl {...props} />
    </Suspense>
  );
}

export type { MediaItem, MediaViewerProps };

/** Monta os itens do visualizador a partir dos anexos que a tela pode abrir. */
export function mediaItems(
  code: string,
  attachments: readonly { id: string; originalName: string; mime: string; viewable: boolean }[],
): { items: MediaItem[]; indexOf: (id: string) => number } {
  const viewable = attachments.filter((a) => a.viewable);
  const items = viewable.map((a) => ({
    src: `/api/ideas/${encodeURIComponent(code)}/attachments/${a.id}/view`,
    type: a.mime.startsWith('video/') ? ('video' as const) : ('image' as const),
    mime: a.mime,
    title: a.originalName,
  }));
  return { items, indexOf: (id) => viewable.findIndex((a) => a.id === id) };
}
