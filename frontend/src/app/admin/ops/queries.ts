import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { unwrap } from '@/api/errors';
import { adminKeys } from '../queries';
import { type Period, periodStart } from './ops-format';

/** O tráfego "agora" acompanha a API de perto; o histórico e o uso mudam devagar. */
const TRAFFIC_REFRESH_MS = 15_000;
const SLOW_REFRESH_MS = 60_000;

export function useTraffic() {
  return useQuery({
    queryKey: adminKeys.opsTraffic,
    queryFn: () => unwrap(api.GET('/api/ops/traffic')),
    refetchInterval: TRAFFIC_REFRESH_MS,
  });
}

export function useUsage() {
  return useQuery({
    queryKey: adminKeys.opsUsage,
    queryFn: () => unwrap(api.GET('/api/ops/usage')),
    refetchInterval: SLOW_REFRESH_MS,
  });
}

/** O histórico do período, das fatias mais antigas até agora (o pedido sai com o dia local da instalação). */
export function useHistory(period: Period, offsetMinutes: number) {
  return useQuery({
    queryKey: adminKeys.opsHistory(period, offsetMinutes),
    queryFn: () => {
      const now = Date.now();
      const query = {
        from: new Date(periodStart(period, now, offsetMinutes)).toISOString(),
        to: new Date(now).toISOString(),
      };
      return unwrap(api.GET('/api/ops/history', { params: { query } }));
    },
    refetchInterval: SLOW_REFRESH_MS,
    placeholderData: keepPreviousData,
  });
}
