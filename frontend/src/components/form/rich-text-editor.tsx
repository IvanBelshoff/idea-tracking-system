import { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import type { RichTextEditorProps } from './rich-text-editor-impl';

// O TipTap e o ProseMirror são o maior peso da tela: só baixam quando um campo formatado aparece (CA-RN-136.9).
const Impl = lazy(() => import('./rich-text-editor-impl'));

/**
 * Campo de texto formatado (RN-136), carregado sob demanda. Serve de filho do `Field` (recebe `id`,
 * `aria-invalid` e `aria-describedby`); o rótulo do campo é o `${id}-label` que o `Field` cria.
 */
export function RichTextEditor(props: RichTextEditorProps) {
  const { t } = useTranslation();
  return (
    <Suspense
      fallback={
        <div
          role="status"
          className="rounded-lg border border-input p-3 text-sm text-muted-foreground"
          style={{ minHeight: `${(props.rows ?? 4) * 1.5 + 3}rem` }}
        >
          {t('richText.loading')}
        </div>
      }
    >
      <Impl {...props} />
    </Suspense>
  );
}

export type { RichTextEditorProps };
