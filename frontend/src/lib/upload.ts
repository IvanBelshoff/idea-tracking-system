/**
 * Envio de arquivo com progresso (RN-146). O `fetch` não informa o progresso do envio; o XHR informa.
 * Mesma origem: o cookie da sessão vai junto. Devolve o status e o corpo (JSON, se houver); nunca lança
 * por resposta de erro, só por falha de rede.
 */
export interface UploadResult<T = unknown> {
  status: number;
  body: T | { code?: string; message?: string } | null;
}

export function uploadWithProgress<T>(
  url: string,
  file: File,
  onProgress: (percent: number) => void,
): Promise<UploadResult<T>> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.responseType = 'text';
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    });
    xhr.addEventListener('load', () => {
      let body: UploadResult<T>['body'] = null;
      try {
        body = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        body = null;
      }
      resolve({ status: xhr.status, body });
    });
    xhr.addEventListener('error', () => reject(new Error('network')));
    xhr.addEventListener('abort', () => reject(new Error('network')));
    const form = new FormData();
    form.append('file', file);
    xhr.send(form);
  });
}

/** Confere no navegador o que o servidor também confere (RN-21), para avisar antes de enviar. */
export function checkAttachment(
  file: { name: string; size: number },
  rules: { maxMb: number; allowedExtensions: readonly string[] },
): 'file_too_large' | 'file_type_not_allowed' | null {
  const dot = file.name.lastIndexOf('.');
  const ext = dot > 0 ? file.name.slice(dot + 1).toLowerCase() : '';
  if (!ext || !rules.allowedExtensions.includes(ext)) return 'file_type_not_allowed';
  if (file.size > rules.maxMb * 1024 * 1024) return 'file_too_large';
  return null;
}

/** Tamanho legível ("820 KB", "3.4 MB"). */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const PREVIEW_IMAGE = ['png', 'jpg', 'jpeg', 'webp', 'gif'];
const PREVIEW_VIDEO = ['mp4', 'webm'];

/**
 * O que dá para ver ANTES de enviar, ainda na memória do navegador (blob): imagem e vídeo no visualizador,
 * PDF num iframe na própria página. O resto só aparece na lista.
 */
export function previewKind(file: { name: string; type: string }): 'image' | 'video' | 'pdf' | null {
  const dot = file.name.lastIndexOf('.');
  const ext = dot > 0 ? file.name.slice(dot + 1).toLowerCase() : '';
  if (file.type === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (PREVIEW_IMAGE.includes(ext)) return 'image';
  if (PREVIEW_VIDEO.includes(ext)) return 'video';
  return null;
}
