import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { unwrap } from '@/api/errors';
import type { components } from '@/api/schema';

export type MuralCard = components['schemas']['MuralCard'];
export type MuralPage = components['schemas']['MuralPage'];
export type MuralComment = components['schemas']['MuralCommentView'];
export type MuralPerson = components['schemas']['MuralPerson'];
export type MuralPublication = components['schemas']['MuralPublicationView'];
export type ReportItem = components['schemas']['ReportQueueItem'];
export type ReactionCounts = components['schemas']['ReactionCounts'];

/** As 5 reações fixas (RN-152), na ordem em que aparecem, com o ícone escolhido pelo dono. */
export const REACTIONS = ['like', 'congrats', 'support', 'brilliant', 'inspiring'] as const;
export type Reaction = (typeof REACTIONS)[number];

export interface FeedFilters {
  sort: 'recent' | 'reactions';
  status: '' | 'in_progress' | 'implemented';
  categoryId: string;
  entityId: string;
}

export const muralKeys = {
  all: ['mural'] as const,
  feed: (f: FeedFilters) => ['mural', 'feed', f] as const,
  page: (ref: string) => ['mural', 'page', ref] as const,
  publication: (ref: string) => ['mural', 'publication', ref] as const,
  reactors: (ref: string, kind: string) => ['mural', 'reactors', ref, kind] as const,
  revisions: (id: string) => ['mural', 'revisions', id] as const,
  people: (search: string) => ['mural', 'people', search] as const,
  reports: ['mural', 'reports'] as const,
};

/** A lista do mural, por cursor (RN-150): "Carregar mais" pede a próxima página. */
export function useMuralFeed(f: FeedFilters) {
  return useInfiniteQuery({
    queryKey: muralKeys.feed(f),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      unwrap(
        api.GET('/api/mural', {
          params: {
            query: {
              sort: f.sort,
              ...(f.status ? { status: [f.status] } : {}),
              ...(f.categoryId ? { categoryId: f.categoryId } : {}),
              ...(f.entityId ? { entityId: f.entityId } : {}),
              ...(pageParam ? { cursor: pageParam } : {}),
            },
          },
        }),
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useMuralPage(ref: string) {
  return useQuery({
    queryKey: muralKeys.page(ref),
    queryFn: () => unwrap(api.GET('/api/mural/ideas/{ref}', { params: { path: { ref } } })),
    retry: false,
  });
}

export function useMuralPublication(ref: string, enabled: boolean) {
  return useQuery({
    queryKey: muralKeys.publication(ref),
    queryFn: () => unwrap(api.GET('/api/mural/ideas/{ref}/publication', { params: { path: { ref } } })),
    enabled,
  });
}

export function useReactors(ref: string, kind: Reaction | '', enabled: boolean) {
  return useQuery({
    queryKey: muralKeys.reactors(ref, kind),
    queryFn: () =>
      unwrap(
        api.GET('/api/mural/ideas/{ref}/reactions', {
          params: { path: { ref }, query: kind ? { kind } : {} },
        }),
      ),
    enabled,
  });
}

export function useRevisions(id: string | null) {
  return useQuery({
    queryKey: muralKeys.revisions(id ?? ''),
    queryFn: () => unwrap(api.GET('/api/mural/comments/{id}/revisions', { params: { path: { id: id ?? '' } } })),
    enabled: id !== null,
  });
}

export function useMuralPeople(search: string, enabled: boolean) {
  return useQuery({
    queryKey: muralKeys.people(search),
    queryFn: () => unwrap(api.GET('/api/mural/people', { params: { query: { search } } })),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

export function useMuralReports() {
  return useQuery({ queryKey: muralKeys.reports, queryFn: () => unwrap(api.GET('/api/mural/reports')) });
}
