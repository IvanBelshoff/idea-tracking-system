import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  RotateCcw,
  RotateCcwSquare,
  RotateCwSquare,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import Cropper, { type Area, type MediaSize, type Point, type Size } from 'react-easy-crop';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  clamp,
  cropPhoto,
  normalizeRotation,
  ROTATION_MAX,
  ROTATION_MIN,
  restrictCrop,
  ZOOM_MAX,
  ZOOM_MIN,
} from '@/lib/photo-crop';

const MOVE_STEP = 12;
const ZOOM_STEP = 0.1;

/**
 * Diálogo de recorte da foto (RN-143): quadrado com prévia redonda, zoom de 1x a 3x
 * e giro livre. Tudo o que se faz arrastando também se faz pelos botões e pelo teclado (WCAG 2.5.7).
 * Devolve a foto pronta (WebP 512 × 512) em `onConfirm`; cancelar não envia nada.
 */
export function PhotoCropDialog({
  file,
  saving,
  error,
  onCancel,
  onConfirm,
}: {
  /** O arquivo escolhido; nulo = diálogo fechado. */
  file: File | null;
  saving: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (photo: Blob) => void;
}) {
  const { t } = useTranslation();
  const ids = useId();
  const [url, setUrl] = useState<string | null>(null);
  const [crop, setCrop] = useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const area = useRef<Area | null>(null);
  const media = useRef<MediaSize | null>(null);
  const cropSize = useRef<Size | null>(null);

  useEffect(() => {
    if (!file) return;
    const next = URL.createObjectURL(file);
    setUrl(next);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setRotation(0);
    setProblem(null);
    area.current = null;
    return () => URL.revokeObjectURL(next);
  }, [file]);

  const move = (dx: number, dy: number) =>
    setCrop((c) => {
      const next = { x: c.x + dx, y: c.y + dy };
      return media.current && cropSize.current
        ? restrictCrop(next, media.current, cropSize.current, zoom, rotation)
        : next;
    });
  const zoomBy = (delta: number) => setZoom((z) => clamp(Math.round((z + delta) * 10) / 10, ZOOM_MIN, ZOOM_MAX));
  const rotateBy = (delta: number) => setRotation((r) => normalizeRotation(r + delta));
  const reset = () => {
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setRotation(0);
  };

  async function confirm() {
    if (!url || !area.current) return;
    setBusy(true);
    try {
      onConfirm(await cropPhoto(url, area.current, rotation));
    } catch {
      setProblem(t('account.photo.crop.unreadable'));
    } finally {
      setBusy(false);
    }
  }

  const message = problem ?? error;
  return (
    <Dialog open={file !== null} onOpenChange={(open) => !open && !saving && onCancel()}>
      <DialogContent closeLabel={t('common.cancel')} className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('account.photo.crop.title')}</DialogTitle>
          <DialogDescription>{t('account.photo.crop.description')}</DialogDescription>
        </DialogHeader>

        <div className="relative aspect-square w-full overflow-hidden rounded-lg bg-muted">
          {url && (
            <Cropper
              image={url}
              crop={crop}
              zoom={zoom}
              rotation={rotation}
              aspect={1}
              cropShape="round"
              showGrid={false}
              minZoom={ZOOM_MIN}
              maxZoom={ZOOM_MAX}
              zoomWithScroll
              restrictPosition
              keyboardStep={MOVE_STEP}
              onCropChange={setCrop}
              onZoomChange={(z) => setZoom(clamp(z, ZOOM_MIN, ZOOM_MAX))}
              onRotationChange={(r) => setRotation(normalizeRotation(r))}
              onCropComplete={(_, pixels) => {
                area.current = pixels;
              }}
              onMediaLoaded={(size) => {
                media.current = size;
              }}
              onCropSizeChange={(size) => {
                cropSize.current = size;
              }}
              cropperProps={{ role: 'group', 'aria-label': t('account.photo.crop.area') }}
              mediaProps={{ onError: () => setProblem(t('account.photo.crop.unreadable')) }}
            />
          )}
        </div>

        <div className="grid gap-3 text-sm">
          <div className="flex items-center gap-2">
            <label htmlFor={`${ids}-zoom`} className="w-12 shrink-0 font-medium">
              {t('account.photo.crop.zoom')}
            </label>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              aria-label={t('account.photo.crop.zoomOut')}
              onClick={() => zoomBy(-ZOOM_STEP)}
              disabled={zoom <= ZOOM_MIN}
            >
              <ZoomOut />
            </Button>
            <input
              id={`${ids}-zoom`}
              type="range"
              min={ZOOM_MIN}
              max={ZOOM_MAX}
              step={ZOOM_STEP}
              value={zoom}
              onChange={(e) => setZoom(clamp(Number(e.target.value), ZOOM_MIN, ZOOM_MAX))}
              aria-valuetext={`${zoom.toFixed(1)}x`}
              className="min-w-0 flex-1 accent-primary"
            />
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              aria-label={t('account.photo.crop.zoomIn')}
              onClick={() => zoomBy(ZOOM_STEP)}
              disabled={zoom >= ZOOM_MAX}
            >
              <ZoomIn />
            </Button>
            <span className="w-10 text-right tabular-nums text-muted-foreground">{zoom.toFixed(1)}x</span>
          </div>

          <div className="flex items-center gap-2">
            <label htmlFor={`${ids}-rotation`} className="w-12 shrink-0 font-medium">
              {t('account.photo.crop.rotation')}
            </label>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              aria-label={t('account.photo.crop.rotateLeft')}
              onClick={() => rotateBy(-90)}
            >
              <RotateCcwSquare />
            </Button>
            <input
              id={`${ids}-rotation`}
              type="range"
              min={ROTATION_MIN}
              max={ROTATION_MAX}
              step={1}
              value={rotation}
              onChange={(e) => setRotation(normalizeRotation(Number(e.target.value)))}
              aria-valuetext={`${rotation}°`}
              className="min-w-0 flex-1 accent-primary"
            />
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              aria-label={t('account.photo.crop.rotateRight')}
              onClick={() => rotateBy(90)}
            >
              <RotateCwSquare />
            </Button>
            <span className="w-10 text-right tabular-nums text-muted-foreground">{rotation}°</span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              aria-label={t('account.photo.crop.moveLeft')}
              onClick={() => move(-MOVE_STEP, 0)}
            >
              <ArrowLeft />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              aria-label={t('account.photo.crop.moveUp')}
              onClick={() => move(0, -MOVE_STEP)}
            >
              <ArrowUp />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              aria-label={t('account.photo.crop.moveDown')}
              onClick={() => move(0, MOVE_STEP)}
            >
              <ArrowDown />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              aria-label={t('account.photo.crop.moveRight')}
              onClick={() => move(MOVE_STEP, 0)}
            >
              <ArrowRight />
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={reset} className="ms-auto">
              <RotateCcw aria-hidden="true" />
              {t('account.photo.crop.reset')}
            </Button>
          </div>
        </div>

        {message && (
          <p role="alert" className="text-sm font-medium text-destructive">
            {message}
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button type="button" onClick={() => void confirm()} disabled={saving || busy || !url}>
            {saving || busy ? t('account.photo.crop.saving') : t('account.photo.crop.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
