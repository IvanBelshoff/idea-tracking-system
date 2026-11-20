/**
 * Recorte da foto do perfil no navegador (RN-143).
 * O navegador entrega um quadrado de 512 px em WebP; o servidor continua sendo a barreira (RN-91).
 */
export const PHOTO_OUTPUT_SIZE = 512;
export const PHOTO_OUTPUT_TYPE = 'image/webp';
export const PHOTO_OUTPUT_QUALITY = 0.9;
/** O original só é lido no navegador; o que sobe é o recorte. */
export const PHOTO_SOURCE_MAX_MB = 20;
export const PHOTO_SOURCE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 3;
export const ROTATION_MIN = -180;
export const ROTATION_MAX = 180;

export interface Area {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type PhotoProblem = 'wrongType' | 'tooBig';

/** Confere o arquivo escolhido antes de abrir o recorte (CA-RN-143.4). */
export function checkPhotoSource(file: { type: string; size: number }): PhotoProblem | null {
  if (!PHOTO_SOURCE_TYPES.has(file.type)) return 'wrongType';
  if (file.size > PHOTO_SOURCE_MAX_MB * 1024 * 1024) return 'tooBig';
  return null;
}

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Giro livre: qualquer ângulo vira o equivalente entre -180° e 180° (girar 90° quatro vezes volta a 0°). */
export function normalizeRotation(degrees: number): number {
  const r = ((((degrees + 180) % 360) + 360) % 360) - 180;
  return r === -180 && degrees > 0 ? 180 : r;
}

const radians = (degrees: number) => (degrees * Math.PI) / 180;

/** Tamanho da caixa que contém a imagem girada (para não cortar os cantos). */
export function rotatedSize(width: number, height: number, rotation: number): { width: number; height: number } {
  const r = radians(rotation);
  return {
    width: Math.abs(Math.cos(r) * width) + Math.abs(Math.sin(r) * height),
    height: Math.abs(Math.sin(r) * width) + Math.abs(Math.cos(r) * height),
  };
}

/**
 * Mantém a imagem cobrindo a área de recorte ao mover pelos botões (o mesmo limite que o arrastar já
 * respeita): o deslocamento máximo é metade da sobra da imagem (girada e com zoom) sobre a área.
 */
export function restrictCrop(
  point: { x: number; y: number },
  media: { width: number; height: number },
  cropSize: { width: number; height: number },
  zoom: number,
  rotation: number,
): { x: number; y: number } {
  const box = rotatedSize(media.width, media.height, rotation);
  // Arredondado ao milésimo de pixel: seno e cosseno de 90° não dão zero exato.
  const round = (n: number) => Math.round(n * 1000) / 1000;
  const maxX = Math.max(0, round((box.width * zoom - cropSize.width) / 2));
  const maxY = Math.max(0, round((box.height * zoom - cropSize.height) / 2));
  // `|| 0` troca o -0 por 0 (o centro é o mesmo, mas comparações estritas diferem).
  return { x: clamp(point.x, -maxX, maxX) || 0, y: clamp(point.y, -maxY, maxY) || 0 };
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener('load', () => resolve(image));
    image.addEventListener('error', () => reject(new Error('unreadable')));
    image.src = url;
  });
}

/** Gera o recorte (área em pixels da imagem já girada) como WebP 512 × 512. */
export async function cropPhoto(imageUrl: string, area: Area, rotation: number): Promise<Blob> {
  const image = await loadImage(imageUrl);
  const box = rotatedSize(image.naturalWidth, image.naturalHeight, rotation);
  const rotated = document.createElement('canvas');
  rotated.width = Math.round(box.width);
  rotated.height = Math.round(box.height);
  const rc = rotated.getContext('2d');
  if (!rc) throw new Error('unreadable');
  rc.translate(rotated.width / 2, rotated.height / 2);
  rc.rotate(radians(rotation));
  rc.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2);

  const out = document.createElement('canvas');
  out.width = PHOTO_OUTPUT_SIZE;
  out.height = PHOTO_OUTPUT_SIZE;
  const oc = out.getContext('2d');
  if (!oc) throw new Error('unreadable');
  oc.imageSmoothingQuality = 'high';
  oc.drawImage(rotated, area.x, area.y, area.width, area.height, 0, 0, PHOTO_OUTPUT_SIZE, PHOTO_OUTPUT_SIZE);
  return new Promise((resolve, reject) =>
    out.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('unreadable'))),
      PHOTO_OUTPUT_TYPE,
      PHOTO_OUTPUT_QUALITY,
    ),
  );
}
