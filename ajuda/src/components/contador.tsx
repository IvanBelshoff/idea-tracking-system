'use client';

import { usePathname } from 'next/navigation';
import Script from 'next/script';
import { useEffect } from 'react';
import { contarVisita } from '~/rastrear';
import { GOATCOUNTER_CODE } from '~/site';

/**
 * Contagem de visitas do site público (GoatCounter, sem cookie e sem dado pessoal). Conta as páginas
 * vistas, inclusive as trocas de página da documentação (o script sozinho só contaria a primeira), e os
 * cliques marcados com `data-goatcounter-click`. Sem o código do site (build da instalação, ou variável
 * vazia), o script nem entra na página. O endereço local (localhost, 127.0.0.1) nunca conta.
 */
export function Contador() {
  const pathname = usePathname();
  useEffect(() => {
    if (pathname) contarVisita();
  }, [pathname]);
  if (!GOATCOUNTER_CODE) return null;
  return (
    <Script
      src="https://gc.zgo.at/count.v4.js"
      integrity="sha384-nRw6qfbWyJha9LhsOtSb2YJDyZdKvvCFh0fJYlkquSFjUxp9FVNugbfy8q1jdxI+"
      crossOrigin="anonymous"
      data-goatcounter={`https://${GOATCOUNTER_CODE}.goatcounter.com/count`}
      data-goatcounter-settings='{"no_onload":true}'
      strategy="afterInteractive"
      onLoad={() => {
        contarVisita();
        window.goatcounter?.bind_events?.();
      }}
    />
  );
}
