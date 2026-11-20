import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { unwrap } from '@/api/errors';
import type { components } from '@/api/schema';

export type Catalog = components['schemas']['CatalogView'];
export type CatalogItem = components['schemas']['CatalogItem'];
export type StoreOrder = components['schemas']['StoreOrderView'];
export type StoreItem = components['schemas']['StoreItemView'];
export type LedgerLine = components['schemas']['LedgerLineView'];
export type StoreAccount = components['schemas']['StoreAccountView'];
export type OrderStatus = 'pending' | 'approved' | 'delivered' | 'paid' | 'rejected' | 'cancelled';

export const storeKeys = {
  all: ['store'] as const,
  catalog: ['store', 'catalog'] as const,
  myOrders: (page: number) => ['store', 'my-orders', page] as const,
  myLedger: (page: number) => ['store', 'my-ledger', page] as const,
  queue: (status: string, page: number) => ['store', 'queue', status, page] as const,
  items: ['store', 'items'] as const,
  bonuses: (status: string) => ['store', 'bonuses', status] as const,
  accounts: (search: string, page: number) => ['store', 'accounts', search, page] as const,
  ledgerOf: (userId: string, page: number) => ['store', 'ledger-of', userId, page] as const,
};

/** Foto do item (RN-163), com a versão para o cache. */
export const itemPhotoUrl = (id: string, version: string) => `/api/store/items/${id}/photo?v=${version}`;

export function useCatalog() {
  return useQuery({ queryKey: storeKeys.catalog, queryFn: () => unwrap(api.GET('/api/store/catalog')) });
}

export function useMyOrders(page: number) {
  return useQuery({
    queryKey: storeKeys.myOrders(page),
    queryFn: () => unwrap(api.GET('/api/store/me/orders', { params: { query: { page, pageSize: 20 } } })),
    placeholderData: keepPreviousData,
  });
}

export function useMyLedger(page: number) {
  return useQuery({
    queryKey: storeKeys.myLedger(page),
    queryFn: () => unwrap(api.GET('/api/store/me/ledger', { params: { query: { page, pageSize: 20 } } })),
    placeholderData: keepPreviousData,
  });
}

export function useOrderQueue(status: OrderStatus | '', page: number) {
  return useQuery({
    queryKey: storeKeys.queue(status, page),
    queryFn: () =>
      unwrap(
        api.GET('/api/store/orders', {
          params: { query: { page, pageSize: 20, ...(status ? { status } : {}) } },
        }),
      ),
    placeholderData: keepPreviousData,
  });
}

export function useStoreItems() {
  return useQuery({ queryKey: storeKeys.items, queryFn: () => unwrap(api.GET('/api/store/items')) });
}

export function useBonuses(status: 'approved' | 'paid' | 'all') {
  return useQuery({
    queryKey: storeKeys.bonuses(status),
    queryFn: () => unwrap(api.GET('/api/store/bonuses', { params: { query: { status } } })),
  });
}

export function useAccounts(search: string, page: number) {
  return useQuery({
    queryKey: storeKeys.accounts(search, page),
    queryFn: () => unwrap(api.GET('/api/store/accounts', { params: { query: { search, page, pageSize: 20 } } })),
    placeholderData: keepPreviousData,
  });
}

export function useLedgerOf(userId: string | null, page: number) {
  return useQuery({
    queryKey: storeKeys.ledgerOf(userId ?? '', page),
    queryFn: () =>
      unwrap(
        api.GET('/api/store/accounts/{userId}/ledger', {
          params: { path: { userId: userId ?? '' }, query: { page, pageSize: 20 } },
        }),
      ),
    enabled: userId !== null,
  });
}
