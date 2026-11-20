import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { GripVertical } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Field } from '@/components/form/field';
import { Textarea } from '@/components/ui/textarea';
import { insertAt } from '@/lib/reorder';

const chipClass =
  'inline-flex items-center gap-1 rounded-md border bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground';

/** A variável como peça: arrasta com o ponteiro para o texto, ou se insere por clique, Enter ou Espaço. */
function VariableChip({ name, onInsert }: { name: string; onInsert: () => void }) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: name,
    attributes: { roleDescription: t('admin.email.templates.draggable') },
  });
  return (
    <button
      type="button"
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      // O teclado usa o clique (Enter e Espaço) para inserir; só o ponteiro arrasta.
      onKeyDown={undefined}
      onClick={onInsert}
      aria-label={t('admin.email.templates.insertVariable', { name })}
      className={`${chipClass} cursor-grab touch-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none ${
        isDragging ? 'opacity-40' : ''
      }`}
    >
      <GripVertical aria-hidden="true" className="size-3 text-muted-foreground" />
      {`{{${name}}}`}
    </button>
  );
}

/** A área do texto como alvo de soltar. Fica num componente à parte porque `useDroppable` só funciona DENTRO do DndContext. */
function BodyDropZone({ children }: { children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'template-body' });
  return (
    <div ref={setNodeRef} className={`rounded-lg ${isOver ? 'ring-2 ring-primary/60' : ''}`}>
      {children}
    </div>
  );
}

/**
 * O corpo de um modelo de e-mail com as variáveis do modelo como peças que se arrastam para o texto (RN-138).
 * O modelo continua TEXTO PURO: arrastar só escreve `{{variavel}}` na posição do cursor (RN-32). Sem arrastar,
 * o clique, Enter ou Espaço na peça faz o mesmo.
 */
export function TemplateBodyEditor({
  value,
  onChange,
  variables,
}: {
  value: string;
  onChange: (next: string) => void;
  variables: readonly string[];
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  // Sem teclado: o clique da peça é a alternativa ao arrastar. Só o ponteiro e o toque arrastam.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } }),
  );

  const insert = (variable: string) => {
    const ta = ref.current;
    const { text, cursor } = insertAt(value, variable, ta?.selectionStart ?? null, ta?.selectionEnd ?? null);
    onChange(text);
    // O cursor fica logo depois da variável, e o foco volta ao texto.
    requestAnimationFrame(() => {
      ta?.focus();
      ta?.setSelectionRange(cursor, cursor);
    });
  };

  return (
    <DndContext
      sensors={sensors}
      // Só o ponteiro arrasta: o leitor de tela recebe a instrução do clique, e o arrastar não anuncia nada.
      accessibility={{
        screenReaderInstructions: { draggable: t('admin.email.templates.dragInstructions') },
        announcements: {
          onDragStart: () => undefined,
          onDragOver: () => undefined,
          onDragEnd: () => undefined,
          onDragCancel: () => undefined,
        },
      }}
      onDragStart={({ active }) => setDragging(String(active.id))}
      onDragCancel={() => setDragging(null)}
      onDragEnd={({ active, over }) => {
        setDragging(null);
        if (over?.id === 'template-body') insert(String(active.id));
      }}
    >
      <BodyDropZone>
        <Field label={t('admin.email.templates.body')}>
          <Textarea
            ref={ref}
            value={value}
            rows={12}
            className="font-mono text-sm"
            onChange={(e) => onChange(e.target.value)}
          />
        </Field>
      </BodyDropZone>
      <div className="text-sm">
        <p className="text-muted-foreground">{t('admin.email.templates.variables')}</p>
        <p className="text-xs text-muted-foreground">{t('admin.email.templates.variablesHint')}</p>
        <ul className="mt-1.5 flex flex-wrap gap-1.5" aria-label={t('admin.email.templates.variables')}>
          {variables.map((v) => (
            <li key={v}>
              <VariableChip name={v} onInsert={() => insert(v)} />
            </li>
          ))}
        </ul>
      </div>
      <DragOverlay>
        {dragging ? <span className={`${chipClass} shadow-md`}>{`{{${dragging}}}`}</span> : null}
      </DragOverlay>
    </DndContext>
  );
}
