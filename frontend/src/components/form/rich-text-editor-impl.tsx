import { ListItem } from '@tiptap/extension-list';
import { type Editor, EditorContent, useEditor, useEditorState } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { cn } from 'cn';
import { Bold, Italic, Link2, List, ListOrdered, Quote, Redo2, Undo2, Unlink } from 'lucide-react';
import { type KeyboardEvent, type ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { type RichDoc, safeHref, toPlainText } from '@/lib/rich';

/**
 * Item de lista sem Tab/Shift+Tab (que prenderiam o foco dentro do campo, WCAG 2.1.2): Enter divide o
 * item e recuar/avançar é por Ctrl+] e Ctrl+[ (ou ⌘).
 */
const FreeTabListItem = ListItem.extend({
  addKeyboardShortcuts() {
    return {
      Enter: () => this.editor.commands.splitListItem(this.name),
      'Mod-]': () => this.editor.commands.sinkListItem(this.name),
      'Mod-[': () => this.editor.commands.liftListItem(this.name),
    };
  },
});

const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const keys = (k: string) => (MAC ? k.replace('Ctrl', '⌘') : k);

export interface RichTextEditorProps {
  /** Mesmo `id` do `Field`: o rótulo é `${id}-label` e liga o campo a ele. */
  id?: string;
  /** Documento inicial (o editor não é controlado: depois de montar, quem manda é quem digita). */
  value: RichDoc | null;
  onChange: (doc: RichDoc) => void;
  /** Linhas visíveis no mínimo (altura inicial). */
  rows?: number;
  /** Limite de caracteres do texto puro: mostra o contador perto do fim. */
  max?: number;
  autoFocus?: boolean;
  ariaLabel?: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
}

/**
 * Editor de texto formatado (RN-136): TipTap restrito à lista que o servidor aceita (parágrafo, negrito,
 * itálico, listas, citação, link http/https/mailto). Colar de outro lugar passa pelo mesmo esquema, então
 * o que não é da lista some já aqui; o servidor limpa de novo (CA-RN-136.2).
 */
export default function RichTextEditorImpl({
  id,
  value,
  onChange,
  rows = 4,
  max,
  autoFocus,
  ariaLabel,
  'aria-invalid': invalid,
  'aria-describedby': describedBy,
}: RichTextEditorProps) {
  const { t } = useTranslation();
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Atributos do campo editável (rótulo, erro, descrição). Mudam depois de montar (erro do servidor), então
  // ficam fora do useEditor e são repassados por setOptions.
  const attributes = useMemo(
    () => ({
      ...(id ? { id } : {}),
      role: 'textbox',
      'aria-multiline': 'true',
      ...(id ? { 'aria-labelledby': `${id}-label` } : ariaLabel ? { 'aria-label': ariaLabel } : {}),
      ...(invalid ? { 'aria-invalid': 'true' } : {}),
      ...(describedBy ? { 'aria-describedby': describedBy } : {}),
      class: cn(
        'rich-text px-2.5 py-2 text-base outline-none md:text-sm',
        '[&_p]:min-h-[1lh] [&_p+p]:mt-2 [&_blockquote]:border-s-2 [&_blockquote]:border-border [&_blockquote]:ps-3',
        '[&_blockquote]:text-muted-foreground [&_ul]:list-disc [&_ul]:ps-5 [&_ol]:list-decimal [&_ol]:ps-5',
        '[&_li>p]:mt-0 [&_a]:font-medium [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2',
      ),
      style: `min-height: ${rows * 1.5 + 1}rem`,
    }),
    [id, ariaLabel, invalid, describedBy, rows],
  );

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        code: false,
        codeBlock: false,
        strike: false,
        underline: false,
        horizontalRule: false,
        listItem: false,
        link: {
          openOnClick: false,
          autolink: true,
          linkOnPaste: true,
          protocols: ['http', 'https', 'mailto'],
          defaultProtocol: 'https',
          HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: null },
        },
      }),
      FreeTabListItem,
    ],
    content: value ?? undefined,
    autofocus: autoFocus ? 'end' : false,
    shouldRerenderOnTransaction: false,
    onUpdate: ({ editor: e }) => onChangeRef.current(e.getJSON() as RichDoc),
    editorProps: { attributes },
  });

  useEffect(() => {
    editor?.setOptions({ editorProps: { attributes } });
  }, [editor, attributes]);

  // Clicar no rótulo leva o foco ao campo, como num campo comum.
  useEffect(() => {
    if (!editor || !id) return;
    const label = document.getElementById(`${id}-label`);
    const focus = () => editor.commands.focus();
    label?.addEventListener('click', focus);
    return () => label?.removeEventListener('click', focus);
  }, [editor, id]);

  const length = useEditorState({
    editor,
    selector: ({ editor: e }) => (e ? toPlainText(e.getJSON() as RichDoc).length : 0),
  });

  if (!editor) return null;
  return (
    <div className="rounded-lg border border-input bg-transparent transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 has-[[aria-invalid=true]]:border-destructive has-[[aria-invalid=true]]:ring-3 has-[[aria-invalid=true]]:ring-destructive/20 dark:bg-input/30">
      <Toolbar editor={editor} />
      <EditorContent editor={editor} />
      {max !== undefined && length >= max * 0.8 && (
        <p
          className={cn('px-2.5 pb-1.5 text-xs text-muted-foreground', length > max && 'font-medium text-destructive')}
        >
          {t('richText.counter', { count: length, max })}
        </p>
      )}
    </div>
  );
}

interface ToolState {
  bold: boolean;
  italic: boolean;
  bulletList: boolean;
  orderedList: boolean;
  blockquote: boolean;
  link: boolean;
  canUndo: boolean;
  canRedo: boolean;
}

function Toolbar({ editor }: { editor: Editor }) {
  const { t } = useTranslation();
  const [linkOpen, setLinkOpen] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);
  const [focusIndex, setFocusIndex] = useState(0);

  const state = useEditorState<ToolState>({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      bulletList: e.isActive('bulletList'),
      orderedList: e.isActive('orderedList'),
      blockquote: e.isActive('blockquote'),
      link: e.isActive('link'),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });

  const buttons = (): HTMLButtonElement[] =>
    Array.from(barRef.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? []);

  // Uma só parada de Tab na barra; as setas andam entre os botões (padrão de barra de ferramentas).
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const list = buttons();
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    let next = at;
    if (e.key === 'ArrowRight') next = (at + 1) % list.length;
    else if (e.key === 'ArrowLeft') next = (at - 1 + list.length) % list.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = list.length - 1;
    else return;
    e.preventDefault();
    list[next]?.focus();
    setFocusIndex(next);
  }

  const run = (fn: (c: ReturnType<Editor['chain']>) => ReturnType<Editor['chain']>) => () =>
    fn(editor.chain().focus()).run();

  const items: {
    key: string;
    label: string;
    shortcut?: string;
    icon: ReactNode;
    active?: boolean;
    disabled?: boolean;
    onClick: () => void;
  }[] = [
    {
      key: 'bold',
      label: t('richText.bold'),
      shortcut: 'Ctrl+B',
      icon: <Bold />,
      active: state.bold,
      onClick: run((c) => c.toggleBold()),
    },
    {
      key: 'italic',
      label: t('richText.italic'),
      shortcut: 'Ctrl+I',
      icon: <Italic />,
      active: state.italic,
      onClick: run((c) => c.toggleItalic()),
    },
    {
      key: 'bullet',
      label: t('richText.bulletList'),
      shortcut: 'Ctrl+Shift+8',
      icon: <List />,
      active: state.bulletList,
      onClick: run((c) => c.toggleBulletList()),
    },
    {
      key: 'ordered',
      label: t('richText.orderedList'),
      shortcut: 'Ctrl+Shift+7',
      icon: <ListOrdered />,
      active: state.orderedList,
      onClick: run((c) => c.toggleOrderedList()),
    },
    {
      key: 'quote',
      label: t('richText.quote'),
      shortcut: 'Ctrl+Shift+B',
      icon: <Quote />,
      active: state.blockquote,
      onClick: run((c) => c.toggleBlockquote()),
    },
    {
      key: 'link',
      label: state.link ? t('richText.linkRemove') : t('richText.link'),
      icon: state.link ? <Unlink /> : <Link2 />,
      active: state.link || linkOpen,
      onClick: () => {
        if (state.link) editor.chain().focus().extendMarkRange('link').unsetLink().run();
        else setLinkOpen((v) => !v);
      },
    },
    {
      key: 'undo',
      label: t('richText.undo'),
      shortcut: 'Ctrl+Z',
      icon: <Undo2 />,
      disabled: !state.canUndo,
      onClick: run((c) => c.undo()),
    },
    {
      key: 'redo',
      label: t('richText.redo'),
      shortcut: 'Ctrl+Shift+Z',
      icon: <Redo2 />,
      disabled: !state.canRedo,
      onClick: run((c) => c.redo()),
    },
  ];

  return (
    <>
      <div
        ref={barRef}
        role="toolbar"
        aria-label={t('richText.toolbar')}
        aria-orientation="horizontal"
        onKeyDown={onKeyDown}
        className="flex flex-wrap items-center gap-0.5 border-b border-input px-1 py-1"
      >
        {items.map((item, i) => (
          <Button
            key={item.key}
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={item.label}
            aria-pressed={item.active === undefined ? undefined : item.active}
            aria-keyshortcuts={item.shortcut?.replace('Ctrl', 'Control')}
            title={item.shortcut ? `${item.label} (${keys(item.shortcut)})` : item.label}
            disabled={item.disabled}
            tabIndex={i === focusIndex ? 0 : -1}
            onFocus={() => setFocusIndex(i)}
            onClick={item.onClick}
            className="aria-pressed:bg-secondary aria-pressed:text-secondary-foreground"
          >
            {item.icon}
          </Button>
        ))}
      </div>
      {linkOpen && (
        <LinkForm
          editor={editor}
          onClose={() => {
            setLinkOpen(false);
            editor.commands.focus();
          }}
        />
      )}
    </>
  );
}

function LinkForm({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const { t } = useTranslation();
  const [url, setUrl] = useState('');
  const [error, setError] = useState(false);
  const inputId = useId();

  function apply() {
    const typed = url.trim();
    // "exemplo.com" sem protocolo vira https://exemplo.com; o resto passa pela lista de protocolos.
    const href = safeHref(/^[a-z][a-z0-9+.-]*:/i.test(typed) ? typed : `https://${typed}`);
    if (!href) {
      setError(true);
      return;
    }
    if (editor.state.selection.empty) {
      editor
        .chain()
        .focus()
        .insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] })
        .run();
    } else {
      editor.chain().focus().setLink({ href }).run();
    }
    onClose();
  }

  return (
    <div className="grid gap-1 border-b border-input p-2">
      <label htmlFor={inputId} className="text-xs font-medium">
        {t('richText.linkLabel')}
      </label>
      <div className="flex items-center gap-2">
        <Input
          id={inputId}
          autoFocus
          type="url"
          inputMode="url"
          autoComplete="off"
          value={url}
          aria-invalid={error || undefined}
          aria-describedby={`${inputId}-hint`}
          onChange={(e) => {
            setUrl(e.target.value);
            setError(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              apply();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              onClose();
            }
          }}
        />
        <Button type="button" size="sm" onClick={apply}>
          {t('richText.linkApply')}
        </Button>
      </div>
      <p
        id={`${inputId}-hint`}
        className={cn('text-xs', error ? 'font-medium text-destructive' : 'text-muted-foreground')}
      >
        {error ? t('richText.linkInvalid') : t('richText.linkHint')}
      </p>
    </div>
  );
}
