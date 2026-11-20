import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArrowDown, ArrowUp, GripVertical } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { moveBy, moveTo } from '@/lib/reorder';

/**
 * Lista que se ordena arrastando (dnd-kit, M19), com a alternativa pelos botões subir e descer e pelo
 * teclado, e os anúncios para o leitor de tela (WCAG 2.5.7).
 */
export function SortableList<T extends { id: string }>({
  items,
  nameOf,
  busy,
  onOrder,
  render,
  className,
}: {
  items: T[];
  nameOf: (item: T) => string;
  busy: boolean;
  onOrder: (ids: string[]) => void;
  render: (item: T) => ReactNode;
  className?: string;
}) {
  const { t } = useTranslation();
  const ids = items.map((i) => i.id);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const name = (id: string | number) => {
    const item = items.find((i) => i.id === id);
    return item ? nameOf(item) : '';
  };
  const where = (id: string | number) => `${ids.indexOf(String(id)) + 1}/${ids.length}`;
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    onOrder(moveTo(ids, String(active.id), String(over.id)));
  };
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
      accessibility={{
        screenReaderInstructions: { draggable: t('userFields.admin.dnd.instructions') },
        announcements: {
          onDragStart: ({ active }) =>
            t('userFields.admin.dnd.start', { name: name(active.id), where: where(active.id) }),
          onDragOver: ({ active, over }) =>
            over ? t('userFields.admin.dnd.over', { name: name(active.id), where: where(over.id) }) : undefined,
          onDragEnd: ({ active, over }) =>
            over
              ? t('userFields.admin.dnd.end', { name: name(active.id), where: where(over.id) })
              : t('userFields.admin.dnd.cancel', { name: name(active.id) }),
          onDragCancel: ({ active }) => t('userFields.admin.dnd.cancel', { name: name(active.id) }),
        },
      }}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ul className={className}>
          {items.map((item, index) => (
            <Row
              key={item.id}
              id={item.id}
              name={nameOf(item)}
              first={index === 0}
              last={index === items.length - 1}
              busy={busy}
              onMove={(delta) => onOrder(moveBy(ids, item.id, delta))}
            >
              {render(item)}
            </Row>
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

function Row({
  id,
  name,
  first,
  last,
  busy,
  onMove,
  children,
}: {
  id: string;
  name: string;
  first: boolean;
  last: boolean;
  busy: boolean;
  onMove: (delta: number) => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id,
    attributes: { roleDescription: t('userFields.admin.sortable') },
  });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-start gap-2 border-b px-3 py-3 last:border-b-0 ${isDragging ? 'relative z-10 bg-muted shadow-md' : ''}`}
    >
      <span className="flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={t('userFields.admin.dragHandle', { name })}
          className="grid size-8 cursor-grab touch-none place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none active:cursor-grabbing"
        >
          <GripVertical aria-hidden="true" className="size-4" />
        </button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={busy || first}
          onClick={() => onMove(-1)}
          aria-label={t('userFields.admin.moveUp', { name })}
        >
          <ArrowUp aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={busy || last}
          onClick={() => onMove(1)}
          aria-label={t('userFields.admin.moveDown', { name })}
        >
          <ArrowDown aria-hidden="true" />
        </Button>
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </li>
  );
}
