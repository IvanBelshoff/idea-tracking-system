import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, Trash2 } from 'lucide-react';
import { lazy, Suspense, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { errorText, unwrap } from '@/api/errors';
import type { components } from '@/api/schema';
import { type AvatarPerson, PersonAvatar } from '@/components/person-avatar';
import { Button } from '@/components/ui/button';
import { checkPhotoSource, PHOTO_SOURCE_MAX_MB } from '@/lib/photo-crop';
import { FormError } from '../auth/auth-layout';
import { keys, type Me, useMe } from '../session';

// O recorte (react-easy-crop) só baixa quando alguém escolhe uma foto.
const PhotoCropDialog = lazy(() =>
  import('@/components/form/photo-crop-dialog').then((m) => ({ default: m.PhotoCropDialog })),
);

type PhotoOptions = components['schemas']['PhotoOptionsView'];
type Choice = PhotoOptions['choice'];

/**
 * Qual foto mostrar (RN-144): aparece quando há foto do login corporativo guardada. Cada opção tem a
 * prévia; nada troca sozinho, só por aqui.
 */
function PhotoChoice({
  person,
  options,
  onChosen,
}: {
  person: AvatarPerson & { id: string; name: string };
  options: PhotoOptions;
  onChosen: (version: string | null) => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const legendId = useId();
  const choose = useMutation({
    meta: { success: t('feedback.account.photoChosen') },
    mutationFn: (choice: Choice) =>
      unwrap(api.PUT('/api/users/{id}/photo/choice', { params: { path: { id: person.id } }, body: { choice } })),
    onSuccess: (data) => {
      qc.setQueryData(photoOptionsKey(person.id), data);
      onChosen(data.sources.find((s) => s.source === data.choice)?.version ?? null);
    },
  });
  const items: { choice: Choice; version: string | null }[] = [
    ...options.sources.map((s) => ({ choice: s.source as Choice, version: s.version })),
    { choice: 'default', version: null },
  ];
  // Escolhida uma origem sem foto (ex.: a enviada foi removida), a tela mostra o que vale: as iniciais.
  const current = items.some((i) => i.choice === options.choice && i.version) ? options.choice : 'default';
  return (
    <fieldset className="mt-5 max-w-xl space-y-2" aria-describedby={`${legendId}-hint`}>
      <legend id={legendId} className="text-sm font-medium">
        {t('account.photo.choice.legend')}
      </legend>
      <p id={`${legendId}-hint`} className="text-xs text-muted-foreground">
        {t('account.photo.choice.hint')}
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {items.map((item) => (
          <label
            key={item.choice}
            className="flex cursor-pointer items-center gap-3 rounded-lg border p-2.5 text-sm has-checked:border-primary has-checked:bg-primary/5 has-focus-visible:ring-3 has-focus-visible:ring-ring/50"
          >
            <input
              type="radio"
              name={`${legendId}-choice`}
              className="accent-primary"
              checked={current === item.choice}
              disabled={choose.isPending}
              onChange={() => choose.mutate(item.choice)}
            />
            {item.version ? (
              <img
                src={`/api/users/${person.id}/photo/sources/${item.choice}?v=${item.version}`}
                alt=""
                className="size-10 rounded-full object-cover"
              />
            ) : (
              <PersonAvatar person={{ name: person.name }} />
            )}
            <span>{t(`account.photo.choice.${item.choice}`)}</span>
          </label>
        ))}
      </div>
      <FormError message={choose.isError ? errorText(t, choose.error) : null} />
      <span className="sr-only" role="status">
        {choose.isSuccess ? t('account.photo.choice.saved') : ''}
      </span>
    </fieldset>
  );
}

const photoOptionsKey = (id: string) => ['users', id, 'photo-options'] as const;

/** Avatar da própria pessoa: a foto, ou as iniciais sobre a cor da marca (RN-142). */
export function MyAvatar({ me, size = 'sm' }: { me: Me; size?: 'sm' | 'default' | 'lg' }) {
  return <PersonAvatar person={me} size={size} />;
}

/**
 * Foto do perfil (RN-91): escolher, recortar (RN-143), trocar e remover. Serve à própria pessoa (sem
 * `person`) e ao administrador na tela do usuário (com `person` e `onChanged`). O servidor confere o tipo
 * pelo conteúdo, redimensiona e tira os metadados.
 */
export function PhotoSection({
  person,
  onChanged,
}: {
  person?: AvatarPerson & { id: string; name: string };
  onChanged?: (version: string | null) => void;
} = {}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const target = person ?? me;
  const options = useQuery({
    queryKey: photoOptionsKey(target?.id ?? ''),
    queryFn: () => unwrap(api.GET('/api/users/{id}/photo/options', { params: { path: { id: target?.id ?? '' } } })),
    enabled: !!target?.id,
  });
  const changed = (version: string | null) => {
    if (target?.id) void qc.invalidateQueries({ queryKey: photoOptionsKey(target.id) });
    if (onChanged) onChanged(version);
    else qc.setQueryData<Me | null>(keys.me, (current) => (current ? { ...current, photoVersion: version } : current));
  };

  const upload = useMutation({
    meta: { success: t('feedback.account.photoSaved') },
    mutationFn: (photo: Blob) =>
      unwrap(
        api.PUT('/api/users/{id}/photo', {
          params: { path: { id: target?.id ?? '' } },
          body: { file: photo as unknown as string },
          bodySerializer: () => {
            const form = new FormData();
            form.append('file', photo, 'foto.webp');
            return form;
          },
        }),
      ),
    onSuccess: (data) => {
      changed(data.version);
      setFile(null);
    },
  });
  const remove = useMutation({
    meta: { success: t('feedback.account.photoRemoved') },
    mutationFn: () => unwrap(api.DELETE('/api/users/{id}/photo', { params: { path: { id: target?.id ?? '' } } })),
    onSuccess: () => changed(null),
  });
  if (!target) return null;
  const error = remove.isError ? remove.error : null;

  const hasProviderPhoto = options.data?.sources.some((s) => s.source !== 'upload') ?? false;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-5">
        <PersonAvatar person={target} size="lg" className="data-[size=lg]:size-16 text-lg" />
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap gap-2">
            <input
              ref={input}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              aria-label={t('account.photo.choose')}
              tabIndex={-1}
              onChange={(e) => {
                const chosen = e.target.files?.[0];
                e.target.value = '';
                if (!chosen) return;
                const problem = checkPhotoSource(chosen);
                setPickError(problem ? t(`account.photo.crop.${problem}`, { mb: PHOTO_SOURCE_MAX_MB }) : null);
                if (!problem) {
                  upload.reset();
                  setFile(chosen);
                }
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={upload.isPending}
              onClick={() => input.current?.click()}
            >
              <Camera aria-hidden="true" />
              {target.photoVersion ? t('account.photo.change') : t('account.photo.add')}
            </Button>
            {target.photoVersion && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={remove.isPending}
                onClick={() => remove.mutate()}
              >
                <Trash2 aria-hidden="true" />
                {t('account.photo.remove')}
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{t('account.photo.hint', { mb: PHOTO_SOURCE_MAX_MB })}</p>
          <FormError message={pickError ?? (error ? errorText(t, error) : null)} />
        </div>
      </div>
      {hasProviderPhoto && options.data && <PhotoChoice person={target} options={options.data} onChosen={changed} />}
      {file && (
        <Suspense fallback={null}>
          <PhotoCropDialog
            file={file}
            saving={upload.isPending}
            error={upload.isError ? errorText(t, upload.error) : null}
            onCancel={() => setFile(null)}
            onConfirm={(photo) => upload.mutate(photo)}
          />
        </Suspense>
      )}
    </div>
  );
}
