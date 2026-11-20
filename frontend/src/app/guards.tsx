import { type ErrorComponentProps, useRouter } from '@tanstack/react-router';
import type { ComponentType, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { errorText } from '@/api/errors';
import { ItsSymbol } from '@/components/brand/its-symbol';
import { Button } from '@/components/ui/button';
import { ForbiddenPage } from './pages/status-pages';
import { type Permission, useCan } from './session';

function FullPageMessage({ children }: { children: ReactNode }) {
  return (
    <div role="status" className="grid min-h-[50svh] place-items-center p-6 text-sm text-muted-foreground">
      {children}
    </div>
  );
}

/**
 * Enquanto a rota prepara os dados ou uma tela sob demanda carrega: o símbolo da marca no estado
 * "carregando" (um terço de volta por vez, com pausa; parado com movimento reduzido, DESIGN.md) e o
 * texto, que é o que o leitor de tela anuncia. Entra com atraso curto para não piscar em carga rápida.
 */
export function PageLoading() {
  const { t } = useTranslation();
  return (
    <div role="status" className="page-loading grid min-h-[50svh] place-items-center p-6">
      <div className="flex flex-col items-center gap-3">
        <ItsSymbol size={44} motion="loop" free className="text-primary" />
        <span className="text-sm text-muted-foreground">{t('common.loading')}</span>
      </div>
    </div>
  );
}

/** Falha ao preparar a rota (ex.: servidor fora do ar): mensagem e "Tentar de novo". */
export function LoadError({ error, reset }: ErrorComponentProps) {
  const { t } = useTranslation();
  const router = useRouter();
  return (
    <FullPageMessage>
      <div className="max-w-sm text-center">
        <p role="alert" className="text-foreground">
          {errorText(t, error)}
        </p>
        <Button
          variant="outline"
          className="mt-4"
          onClick={() => {
            reset();
            void router.invalidate();
          }}
        >
          {t('common.retry')}
        </Button>
      </div>
    </FullPageMessage>
  );
}

/**
 * Tela que exige permissão: quem abre o endereço direto sem ter acesso vê "Sem permissão"
 * (CA-RN-01.6). É só conforto: a API também nega (CA-RN-01.1).
 */
export function withPermission(anyOf: Permission[], Page: ComponentType) {
  return function Guarded() {
    const can = useCan();
    return can(...anyOf) ? <Page /> : <ForbiddenPage />;
  };
}
