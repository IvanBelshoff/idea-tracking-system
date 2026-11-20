import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { AlertService } from './alert.service.js';

/** De quanto em quanto tempo a API confere a saúde para o alerta (RN-94), em milissegundos. */
const CHECK_INTERVAL_MS = 5 * 60_000;
/**
 * A primeira conferência da API espera 3 minutos depois da subida: numa partida a frio o worker
 * ainda não deu o primeiro sinal, e o batimento velho de antes da parada viraria um falso alerta.
 */
const FIRST_CHECK_DELAY_MS = 3 * 60_000;

/**
 * A API também confere a saúde (RN-94), e não só o worker: assim, com o **worker parado**, é a API
 * que avisa; com a API parada, é o worker. Os dois usam o mesmo estado no banco e a mesma trava,
 * então um aviso nunca sai em duplicado. Se os dois caírem juntos, ninguém avisa (limite assumido).
 */
@Injectable()
export class AlertSchedulerService implements OnModuleInit, OnModuleDestroy {
  private first: NodeJS.Timeout | null = null;
  private every: NodeJS.Timeout | null = null;

  constructor(private readonly alerts: AlertService) {}

  onModuleInit(): void {
    this.first = setTimeout(() => {
      void this.alerts.check();
      this.every = setInterval(() => void this.alerts.check(), CHECK_INTERVAL_MS);
      this.every.unref();
    }, FIRST_CHECK_DELAY_MS);
    this.first.unref();
  }

  onModuleDestroy(): void {
    if (this.first) clearTimeout(this.first);
    if (this.every) clearInterval(this.every);
  }
}
