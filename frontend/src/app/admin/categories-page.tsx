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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, GripVertical, Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { errorText, unwrap } from '@/api/errors';
import type { components } from '@/api/schema';
import { Field } from '@/components/form/field';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { moveBy, moveTo } from '@/lib/reorder';
import { FormError } from '../auth/auth-layout';
import { adminKeys } from './queries';
import { AdminPage, Section } from './shared';

type CategoryView = components['schemas']['CategoryView'];
type CategorySet = components['schemas']['ImportCategoriesRequest']['set'];
const SETS: CategorySet[] = ['safety_qdcep', 'generic'];
const HEX = /^#[0-9a-fA-F]{6}$/;

function CategoryDialog({
  category,
  nextOrder,
  onClose,
}: {
  category: CategoryView | null;
  /** A categoria nova entra no fim da ordem (a ordem se muda arrastando; RN-137). */
  nextOrder: number;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [name, setName] = useState(category?.name ?? '');
  const [color, setColor] = useState(category?.color ?? '#4f46e5');
  const valid = name.trim() && HEX.test(color);

  const save = useMutation({
    meta: { success: category ? t('feedback.categories.updated') : t('feedback.categories.created') },
    mutationFn: () => {
      const body = { name: name.trim(), color };
      return category
        ? unwrap(api.PATCH('/api/categories/{id}', { params: { path: { id: category.id } }, body }))
        : unwrap(api.POST('/api/categories', { body: { ...body, sortOrder: nextOrder } }));
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['categories'] });
      onClose();
    },
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent closeLabel={t('admin.common.close')}>
        <DialogHeader>
          <DialogTitle>{category ? t('admin.categories.editTitle') : t('admin.categories.createTitle')}</DialogTitle>
        </DialogHeader>
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) save.mutate();
          }}
          className="space-y-4"
        >
          <Field label={t('admin.categories.name')}>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} autoFocus />
          </Field>
          <div className="grid gap-4">
            <Field label={t('admin.categories.color')}>
              <div className="flex gap-2">
                <input
                  type="color"
                  value={HEX.test(color) ? color : '#000000'}
                  onChange={(e) => setColor(e.target.value)}
                  aria-label={t('admin.categories.color')}
                  className="h-8 w-10 shrink-0 cursor-pointer rounded-md border bg-transparent p-0.5"
                />
                <Input value={color} onChange={(e) => setColor(e.target.value)} maxLength={7} className="font-mono" />
              </div>
            </Field>
          </div>
          <FormError message={save.isError ? errorText(t, save.error) : null} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={save.isPending || !valid}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Uma linha da lista: alça para arrastar (também com o teclado), botões de subir e descer e as ações. */
function SortableRow({
  category: c,
  index,
  total,
  busy,
  onMove,
  onEdit,
  onToggle,
}: {
  category: CategoryView;
  index: number;
  total: number;
  busy: boolean;
  onMove: (delta: number) => void;
  onEdit: () => void;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: c.id,
    attributes: { roleDescription: t('admin.categories.sortable') },
  });
  return (
    <TableRow
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={isDragging ? 'relative z-10 bg-muted shadow-md' : undefined}
    >
      <TableCell className="w-28">
        <span className="flex items-center gap-0.5">
          <button
            type="button"
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            aria-label={t('admin.categories.dragHandle', { name: c.name })}
            className="grid size-8 cursor-grab touch-none place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none active:cursor-grabbing"
          >
            <GripVertical aria-hidden="true" className="size-4" />
          </button>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={busy || index === 0}
            onClick={() => onMove(-1)}
            aria-label={t('admin.categories.moveUp', { name: c.name })}
          >
            <ArrowUp aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={busy || index === total - 1}
            onClick={() => onMove(1)}
            aria-label={t('admin.categories.moveDown', { name: c.name })}
          >
            <ArrowDown aria-hidden="true" />
          </Button>
        </span>
      </TableCell>
      <TableCell>
        <span className="flex items-center gap-2">
          <span aria-hidden="true" className="size-3 shrink-0 rounded-full" style={{ backgroundColor: c.color }} />
          <span className={c.active ? 'font-medium' : 'text-muted-foreground'}>{c.name}</span>
        </span>
      </TableCell>
      <TableCell>
        <Badge variant={c.active ? 'secondary' : 'destructive'}>
          {c.active ? t('admin.common.active') : t('admin.common.inactive')}
        </Badge>
      </TableCell>
      <TableCell className="text-right whitespace-nowrap">
        <Button variant="ghost" size="sm" onClick={onEdit} aria-label={`${t('admin.common.edit')}: ${c.name}`}>
          <Pencil aria-hidden="true" />
          <span className="hidden sm:inline">{t('admin.common.edit')}</span>
        </Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={onToggle}>
          {c.active ? t('admin.categories.deactivate') : t('admin.categories.activate')}
        </Button>
      </TableCell>
    </TableRow>
  );
}

export function CategoriesPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<CategoryView | 'new' | null>(null);
  const key = adminKeys.categories(true);
  const categories = useQuery({
    queryKey: key,
    queryFn: () => unwrap(api.GET('/api/categories', { params: { query: { includeInactive: 'true' } } })),
  });
  const list = categories.data ?? [];

  const toggle = useMutation({
    meta: {
      success: (_d, c: CategoryView) =>
        c.active ? t('feedback.categories.deactivated') : t('feedback.categories.activated'),
    },
    mutationFn: (c: CategoryView) =>
      unwrap(api.PATCH('/api/categories/{id}', { params: { path: { id: c.id } }, body: { active: !c.active } })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['categories'] }),
  });
  const importSet = useMutation({
    meta: {
      success: (d: { created: unknown[]; skipped: number }) =>
        t('admin.categories.importResult', { created: d.created.length, skipped: d.skipped }),
    },
    mutationFn: (set: CategorySet) => unwrap(api.POST('/api/categories/import', { body: { set } })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['categories'] }),
  });
  // A ordem nova aparece na hora (otimista) e vale para a lista toda no servidor; se falhar, volta (RN-137).
  const reorder = useMutation({
    meta: { silent: true },
    mutationFn: (ids: string[]) => unwrap(api.PUT('/api/categories/order', { body: { ids } })),
    onMutate: async (ids) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<CategoryView[]>(key);
      const byId = new Map((previous ?? []).map((c) => [c.id, c]));
      qc.setQueryData(
        key,
        ids.map((id) => byId.get(id)).filter((c): c is CategoryView => c !== undefined),
      );
      return { previous };
    },
    onError: (_error, _ids, context) => {
      if (context?.previous) qc.setQueryData(key, context.previous);
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: ['categories'] }),
  });
  const error = categories.error ?? toggle.error ?? importSet.error ?? reorder.error;
  const ids = list.map((c) => c.id);
  const nextOrder = Math.min(9990, Math.max(0, ...list.map((c) => c.sortOrder)) + 10);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const nameOf = (id: string | number) => list.find((c) => c.id === id)?.name ?? '';
  const where = (id: string | number) => `${ids.indexOf(String(id)) + 1}/${ids.length}`;
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    reorder.mutate(moveTo(ids, String(active.id), String(over.id)));
  };

  return (
    <AdminPage
      title={t('admin.categories.pageTitle')}
      intro={t('admin.categories.intro')}
      help="adminCategories"
      actions={
        <Button onClick={() => setEditing('new')}>
          <Plus aria-hidden="true" />
          {t('admin.categories.new')}
        </Button>
      }
    >
      <div className="grid gap-6">
        {error && <FormError message={errorText(t, error)} />}
        <p className="text-sm text-muted-foreground">{t('admin.categories.orderIntro')}</p>
        <div className="overflow-x-auto rounded-lg border bg-card">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onDragEnd}
            accessibility={{
              screenReaderInstructions: { draggable: t('admin.categories.dnd.instructions') },
              announcements: {
                onDragStart: ({ active }) =>
                  t('admin.categories.dnd.start', { name: nameOf(active.id), where: where(active.id) }),
                onDragOver: ({ active, over }) =>
                  over ? t('admin.categories.dnd.over', { name: nameOf(active.id), where: where(over.id) }) : undefined,
                onDragEnd: ({ active, over }) =>
                  over
                    ? t('admin.categories.dnd.end', { name: nameOf(active.id), where: where(over.id) })
                    : t('admin.categories.dnd.cancel', { name: nameOf(active.id) }),
                onDragCancel: ({ active }) => t('admin.categories.dnd.cancel', { name: nameOf(active.id) }),
              },
            }}
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-28">{t('admin.categories.columns.order')}</TableHead>
                  <TableHead>{t('admin.categories.columns.name')}</TableHead>
                  <TableHead className="w-28">{t('admin.categories.columns.status')}</TableHead>
                  <TableHead className="w-48 text-right">
                    <span className="sr-only">{t('admin.common.actions')}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <SortableContext items={ids} strategy={verticalListSortingStrategy}>
                  {list.map((c, index) => (
                    <SortableRow
                      key={c.id}
                      category={c}
                      index={index}
                      total={list.length}
                      busy={reorder.isPending || toggle.isPending}
                      onMove={(delta) => reorder.mutate(moveBy(ids, c.id, delta))}
                      onEdit={() => setEditing(c)}
                      onToggle={() => toggle.mutate(c)}
                    />
                  ))}
                </SortableContext>
                {list.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                      {t('admin.common.empty')}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </DndContext>
        </div>

        <Section title={t('admin.categories.importTitle')} intro={t('admin.categories.importIntro')}>
          <div className="flex flex-wrap gap-2">
            {SETS.map((s) => (
              <Button key={s} variant="outline" disabled={importSet.isPending} onClick={() => importSet.mutate(s)}>
                {t('admin.categories.importButton', { set: t(`admin.categories.sets.${s}`) })}
              </Button>
            ))}
          </div>
        </Section>
      </div>
      {editing && (
        <CategoryDialog
          category={editing === 'new' ? null : editing}
          nextOrder={nextOrder}
          onClose={() => setEditing(null)}
        />
      )}
    </AdminPage>
  );
}
