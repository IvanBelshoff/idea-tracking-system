import {
  closestCenter,
  DndContext,
  DragOverlay,
  type KeyboardCoordinateGetter,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Building2, EllipsisVertical, FolderTree, GripVertical } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { errorText, unwrap } from '@/api/errors';
import { Field, NativeSelect } from '@/components/form/field';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { FormError } from '../auth/auth-layout';
import { keys } from '../session';
import { adminKeys, useEntities } from './queries';
import { AdminPage, type EntityView, entityOptionLabel, orderTree } from './shared';

type Action =
  | { kind: 'create'; parent: EntityView }
  | { kind: 'rename'; entity: EntityView }
  | { kind: 'move'; entity: EntityView }
  | { kind: 'drop'; entity: EntityView; target: EntityView }
  | { kind: 'delete'; entity: EntityView };

/** A entidade e todas as que estão abaixo dela (destinos proibidos ao mover: formariam ciclo). */
function subtree(id: string, list: EntityView[]): Set<string> {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const e of list) {
      if (e.parentId && out.has(e.parentId) && !out.has(e.id)) {
        out.add(e.id);
        grew = true;
      }
    }
  }
  return out;
}

function NameDialog({
  action,
  onClose,
}: {
  action: Extract<Action, { kind: 'create' | 'rename' }>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [name, setName] = useState(action.kind === 'rename' ? action.entity.name : '');
  const save = useMutation({
    meta: { success: action.kind === 'create' ? t('feedback.entities.created') : t('feedback.entities.renamed') },
    mutationFn: () =>
      action.kind === 'create'
        ? unwrap(api.POST('/api/entities', { body: { name: name.trim(), parentId: action.parent.id } }))
        : unwrap(
            api.PATCH('/api/entities/{id}', {
              params: { path: { id: action.entity.id } },
              body: { name: name.trim() },
            }),
          ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: adminKeys.entities });
      void qc.invalidateQueries({ queryKey: keys.publicSettings }); // a raiz é o nome da organização
      onClose();
    },
  });
  const title =
    action.kind === 'create'
      ? t('admin.entities.createTitle', { parent: action.parent.name })
      : t('admin.entities.renameTitle', { name: action.entity.name });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent closeLabel={t('admin.common.close')}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) save.mutate();
          }}
          className="space-y-4"
        >
          <Field label={t('admin.entities.name')}>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} autoFocus />
          </Field>
          <FormError message={save.isError ? errorText(t, save.error) : null} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={save.isPending || !name.trim()}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function MoveDialog({ entity, list, onClose }: { entity: EntityView; list: EntityView[]; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const blocked = subtree(entity.id, list);
  const targets = orderTree(list).filter((e) => !blocked.has(e.id) && e.canManage);
  const [parentId, setParentId] = useState(entity.parentId ?? '');
  const move = useMutation({
    meta: { success: t('feedback.entities.moved') },
    mutationFn: () =>
      unwrap(api.PATCH('/api/entities/{id}', { params: { path: { id: entity.id } }, body: { parentId } })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: adminKeys.entities });
      onClose();
    },
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent closeLabel={t('admin.common.close')}>
        <DialogHeader>
          <DialogTitle>{t('admin.entities.moveTitle', { name: entity.name })}</DialogTitle>
          <DialogDescription>{t('admin.entities.moveHint')}</DialogDescription>
        </DialogHeader>
        <Field label={t('admin.entities.moveTo')}>
          <NativeSelect value={parentId} onChange={(e) => setParentId(e.target.value)}>
            {targets.map((e) => (
              <option key={e.id} value={e.id}>
                {entityOptionLabel(e)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <FormError message={move.isError ? errorText(t, move.error) : null} />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button disabled={move.isPending || parentId === entity.parentId} onClick={() => move.mutate()}>
            {t('admin.entities.move')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Teclado do arrastar da árvore (RN-141): seta para baixo ou para cima pula para a próxima entidade de destino
 * válida (as inválidas estão desabilitadas e ficam de fora), em vez de andar alguns pixels.
 */
const rowCoordinates: KeyboardCoordinateGetter = (
  event,
  { context: { active, droppableRects, droppableContainers, collisionRect } },
) => {
  if (event.code !== 'ArrowDown' && event.code !== 'ArrowUp') return undefined;
  event.preventDefault();
  if (!active || !collisionRect) return undefined;
  const down = event.code === 'ArrowDown';
  const center = collisionRect.top + collisionRect.height / 2;
  const targets = droppableContainers
    .getEnabled()
    .map((c) => ({ id: c.id, rect: droppableRects.get(c.id) }))
    .filter((t): t is { id: typeof t.id; rect: NonNullable<typeof t.rect> } => !!t.rect && t.id !== active.id)
    .map((t) => ({ ...t, mid: t.rect.top + t.rect.height / 2 }))
    .filter((t) => (down ? t.mid > center + 1 : t.mid < center - 1))
    .sort((a, b) => (down ? a.mid - b.mid : b.mid - a.mid));
  const next = targets[0];
  return next ? { x: next.rect.left, y: next.rect.top } : undefined;
};

/** Uma linha da árvore: alvo e fonte do arrastar, com o menu de ações de sempre. */
function EntityRow({
  entity: e,
  activeId,
  blocked,
  onAction,
  onToggle,
}: {
  entity: EntityView;
  activeId: string | null;
  /** Entidades que NÃO podem receber a que está sendo arrastada (ela mesma e a subárvore: formariam ciclo). */
  blocked: Set<string>;
  onAction: (action: Action) => void;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const isRoot = e.parentId === null;
  const canDrag = !isRoot && e.canManage;
  const drag = useDraggable({
    id: e.id,
    disabled: !canDrag,
    attributes: { roleDescription: t('admin.entities.draggable') },
  });
  // Destino inválido: a própria entidade, a subárvore dela, quem não se administra e o pai atual (nada mudaria).
  const invalidTarget = activeId !== null && (blocked.has(e.id) || !e.canManage || e.id === e.parentId);
  const drop = useDroppable({ id: e.id, disabled: activeId === null || blocked.has(e.id) || !e.canManage });
  const dragged = drag.isDragging;
  const valid = activeId !== null && !invalidTarget;
  return (
    <li
      ref={(node) => {
        drag.setNodeRef(node);
        drop.setNodeRef(node);
      }}
      className={`flex items-center gap-3 border-b px-3 py-2.5 transition-colors last:border-b-0 sm:px-4 ${
        drop.isOver && valid ? 'bg-primary/10 ring-2 ring-primary/60 ring-inset' : ''
      } ${dragged ? 'opacity-40' : ''} ${activeId !== null && !dragged && !valid ? 'opacity-50' : ''}`}
    >
      {canDrag ? (
        <button
          type="button"
          ref={drag.setActivatorNodeRef}
          {...drag.attributes}
          {...drag.listeners}
          aria-label={t('admin.entities.dragHandle', { name: e.name })}
          className="grid size-8 shrink-0 cursor-grab touch-none place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none active:cursor-grabbing"
        >
          <GripVertical aria-hidden="true" className="size-4" />
        </button>
      ) : (
        <span aria-hidden="true" className="size-8 shrink-0" />
      )}
      <span style={{ paddingLeft: `${e.depth * 1.25}rem` }} className="flex min-w-0 flex-1 items-center gap-2">
        {isRoot ? (
          <Building2 aria-hidden="true" className="size-4 shrink-0 text-primary" />
        ) : (
          <FolderTree aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        )}
        <span
          className={`truncate ${isRoot ? 'font-semibold' : ''} ${e.active ? '' : 'text-muted-foreground line-through'}`}
        >
          {e.name}
        </span>
        {isRoot && <Badge variant="outline">{t('admin.entities.root')}</Badge>}
        {!e.active && <Badge variant="destructive">{t('admin.entities.inactive')}</Badge>}
      </span>
      {e.canManage && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={t('admin.entities.rowActions', { name: e.name })}>
              <EllipsisVertical aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onSelect={() => onAction({ kind: 'create', parent: e })}>
              {t('admin.entities.newChild')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onAction({ kind: 'rename', entity: e })}>
              {t('admin.entities.rename')}
            </DropdownMenuItem>
            {!isRoot && (
              <>
                <DropdownMenuItem onSelect={() => onAction({ kind: 'move', entity: e })}>
                  {t('admin.entities.move')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={onToggle}>
                  {e.active ? t('admin.entities.deactivate') : t('admin.entities.activate')}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => onAction({ kind: 'delete', entity: e })}>
                  {t('admin.common.delete')}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </li>
  );
}

export function EntitiesPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const entities = useEntities();
  const [action, setAction] = useState<Action | null>(null);
  const list = entities.data ?? [];
  const ordered = orderTree(list);
  const [activeId, setActiveId] = useState<string | null>(null);
  const activeEntity = list.find((x) => x.id === activeId) ?? null;
  const blocked = activeId ? subtree(activeId, list) : new Set<string>();
  const nameOf = (id: string | number) => list.find((x) => x.id === id)?.name ?? '';
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: rowCoordinates }),
  );

  const toggle = useMutation({
    meta: {
      success: (_d, e: EntityView) =>
        e.active ? t('feedback.entities.deactivated') : t('feedback.entities.activated'),
    },
    mutationFn: (e: EntityView) =>
      unwrap(api.PATCH('/api/entities/{id}', { params: { path: { id: e.id } }, body: { active: !e.active } })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: adminKeys.entities }),
  });
  // Soltar uma entidade sobre outra a move para dentro dela, depois da confirmação (RN-141). É o mesmo PATCH do seletor.
  const drop = useMutation({
    meta: { success: t('feedback.entities.moved') },
    mutationFn: ({ entity, target }: { entity: EntityView; target: EntityView }) =>
      unwrap(api.PATCH('/api/entities/{id}', { params: { path: { id: entity.id } }, body: { parentId: target.id } })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: adminKeys.entities });
      setAction(null);
    },
  });
  const remove = useMutation({
    meta: { success: t('feedback.entities.removed') },
    mutationFn: (e: EntityView) => unwrap(api.DELETE('/api/entities/{id}', { params: { path: { id: e.id } } })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: adminKeys.entities });
      setAction(null);
    },
  });

  return (
    <AdminPage title={t('admin.entities.pageTitle')} intro={t('admin.entities.intro')} help="adminEntities">
      {(entities.isError || toggle.isError) && <FormError message={errorText(t, entities.error ?? toggle.error)} />}
      <p className="mb-3 text-sm text-muted-foreground">{t('admin.entities.dragIntro')}</p>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={({ active }) => setActiveId(String(active.id))}
        onDragCancel={() => setActiveId(null)}
        onDragEnd={({ active, over }) => {
          setActiveId(null);
          const entity = list.find((x) => x.id === active.id);
          const target = over ? list.find((x) => x.id === over.id) : undefined;
          if (entity && target && target.id !== entity.parentId) {
            drop.reset();
            setAction({ kind: 'drop', entity, target });
          }
        }}
        accessibility={{
          screenReaderInstructions: { draggable: t('admin.entities.dnd.instructions') },
          announcements: {
            onDragStart: ({ active }) => t('admin.entities.dnd.start', { name: nameOf(active.id) }),
            onDragOver: ({ active, over }) =>
              over ? t('admin.entities.dnd.over', { name: nameOf(active.id), target: nameOf(over.id) }) : undefined,
            onDragEnd: ({ active, over }) =>
              over
                ? t('admin.entities.dnd.end', { name: nameOf(active.id), target: nameOf(over.id) })
                : t('admin.entities.dnd.cancel', { name: nameOf(active.id) }),
            onDragCancel: ({ active }) => t('admin.entities.dnd.cancel', { name: nameOf(active.id) }),
          },
        }}
      >
        <ul className="overflow-hidden rounded-lg border bg-card">
          {ordered.map((e) => (
            <EntityRow
              key={e.id}
              entity={e}
              activeId={activeId}
              blocked={blocked}
              onAction={setAction}
              onToggle={() => toggle.mutate(e)}
            />
          ))}
        </ul>
        <DragOverlay>
          {activeEntity ? (
            <span className="inline-flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm font-medium shadow-lg">
              <FolderTree aria-hidden="true" className="size-4 text-muted-foreground" />
              {activeEntity.name}
            </span>
          ) : null}
        </DragOverlay>
      </DndContext>

      {(action?.kind === 'create' || action?.kind === 'rename') && (
        <NameDialog action={action} onClose={() => setAction(null)} />
      )}
      {action?.kind === 'move' && <MoveDialog entity={action.entity} list={list} onClose={() => setAction(null)} />}
      <ConfirmDialog
        open={action?.kind === 'drop'}
        onOpenChange={(o) => {
          if (!o) {
            setAction(null);
            drop.reset();
          }
        }}
        title={
          action?.kind === 'drop'
            ? t('admin.entities.dropTitle', { name: action.entity.name, target: action.target.name })
            : ''
        }
        description={t('admin.entities.dropText')}
        confirmLabel={t('admin.entities.move')}
        cancelLabel={t('common.cancel')}
        pending={drop.isPending}
        onConfirm={() => action?.kind === 'drop' && drop.mutate({ entity: action.entity, target: action.target })}
      >
        <FormError message={drop.isError ? errorText(t, drop.error) : null} />
      </ConfirmDialog>
      <ConfirmDialog
        open={action?.kind === 'delete'}
        onOpenChange={(o) => {
          if (!o) {
            setAction(null);
            remove.reset();
          }
        }}
        title={t('admin.entities.deleteTitle', { name: action?.kind === 'delete' ? action.entity.name : '' })}
        description={t('admin.entities.deleteText')}
        confirmLabel={t('admin.common.delete')}
        cancelLabel={t('common.cancel')}
        destructive
        pending={remove.isPending}
        onConfirm={() => action?.kind === 'delete' && remove.mutate(action.entity)}
      >
        <FormError message={remove.isError ? errorText(t, remove.error) : null} />
      </ConfirmDialog>
    </AdminPage>
  );
}
