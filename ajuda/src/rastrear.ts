declare global {
  interface Window {
    goatcounter?: {
      count?: (vars: { path: string; title?: string; event?: boolean }) => void;
      bind_events?: () => void;
    };
  }
}

let ultima = '';

/**
 * Conta a página aberta no GoatCounter do site público, uma vez por endereço (na carga e a cada troca de
 * página da documentação, que não recarrega). Sem o script (build da instalação, variável vazia,
 * bloqueador, teste local), não faz nada.
 */
export function contarVisita() {
  const path = location.pathname;
  if (!window.goatcounter?.count || path === ultima) return;
  ultima = path;
  window.goatcounter.count({ path });
}

/**
 * Conta um evento (ex.: `copiar-comando/subir/inicio`). O GoatCounter não guarda dados junto do evento:
 * o que importa vai no próprio nome, separado por "/". Nunca leva dado de quem visita.
 */
export function rastrear(evento: string) {
  window.goatcounter?.count?.({ path: evento, title: evento, event: true });
}
