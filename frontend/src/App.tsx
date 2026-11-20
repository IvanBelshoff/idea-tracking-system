import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { ApiError } from '@/api/errors';
import { ToastHost } from '@/components/toast/toast-host';
import { TooltipProvider } from '@/components/ui/tooltip';
import { BrandingSync } from './app/branding';
import { FontSync } from './app/fonts';
import { LanguageSync } from './app/language-sync';
import { createMutationCache, createQueryCache } from './app/mutation-feedback';
import { PwaStatus } from './app/pwa-status';
import { createAppRouter } from './app/router';
import { ThemeProvider } from './app/theme';
import './i18n';

const queryClient: QueryClient = new QueryClient({
  // Aviso na tela de toda ação (M23, RN-174): o erro sempre, o sucesso quando a ação declara o texto.
  mutationCache: createMutationCache(() => queryClient),
  queryCache: createQueryCache(() => queryClient),
  defaultOptions: {
    queries: {
      // Erro de regra (4xx) não melhora tentando de novo; só falha de rede ou do servidor.
      retry: (count, error) => count < 2 && !(error instanceof ApiError && error.status >= 400 && error.status < 500),
      refetchOnWindowFocus: false,
    },
  },
});

const router = createAppRouter(queryClient);

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <RouterProvider router={router} />
          <PwaStatus />
          <ToastHost />
          <BrandingSync router={router} />
          <FontSync router={router} />
          <LanguageSync />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
