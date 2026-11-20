import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { unwrap } from '@/api/errors';
import type { components, paths } from '@/api/schema';

export type IdeaDetail = components['schemas']['IdeaDetail'];
export type IdeaSummary = components['schemas']['IdeaSummary'];
export type IdeaListQuery = NonNullable<paths['/api/ideas']['get']['parameters']['query']>;

export const ideaKeys = {
  all: ['ideas'] as const,
  list: (q: object) => ['ideas', 'list', q] as const,
  mine: (q: object) => ['ideas', 'mine', q] as const,
  detail: (ref: string) => ['ideas', 'detail', ref] as const,
  comments: (ref: string) => ['ideas', 'comments', ref] as const,
  timeline: (ref: string) => ['ideas', 'timeline', ref] as const,
  people: (search: string) => ['ideas', 'people', search] as const,
  categories: ['categories', false] as const,
};

export function useIdea(ref: string) {
  return useQuery({
    queryKey: ideaKeys.detail(ref),
    queryFn: () => unwrap(api.GET('/api/ideas/{ref}', { params: { path: { ref } } })),
  });
}

export function useIdeaList(query: IdeaListQuery) {
  return useQuery({
    queryKey: ideaKeys.list(query),
    queryFn: () => unwrap(api.GET('/api/ideas', { params: { query } })),
    placeholderData: keepPreviousData,
  });
}

export function useMyIdeas(query: { status?: IdeaListQuery['status']; page: number; pageSize: number }) {
  return useQuery({
    queryKey: ideaKeys.mine(query),
    queryFn: () => unwrap(api.GET('/api/ideas/mine', { params: { query } })),
    placeholderData: keepPreviousData,
  });
}

export function useComments(ref: string) {
  return useQuery({
    queryKey: ideaKeys.comments(ref),
    queryFn: () => unwrap(api.GET('/api/ideas/{ref}/comments', { params: { path: { ref } } })),
  });
}

export function useTimeline(ref: string) {
  return useQuery({
    queryKey: ideaKeys.timeline(ref),
    queryFn: () => unwrap(api.GET('/api/ideas/{ref}/timeline', { params: { path: { ref } } })),
  });
}

/** Categorias ativas (as inativas não recebem ideias; RN-26). */
export function useActiveCategories() {
  return useQuery({
    queryKey: ideaKeys.categories,
    queryFn: () => unwrap(api.GET('/api/categories')),
    staleTime: 60_000,
  });
}

export function usePeople(search: string, enabled = true) {
  return useQuery({
    queryKey: ideaKeys.people(search),
    queryFn: () => unwrap(api.GET('/api/ideas/people', { params: { query: { search } } })),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}
