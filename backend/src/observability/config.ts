/**
 * Interruptor da medição (RN-92): `METRICS_ENABLED=false` desliga a contagem e a gravação das
 * métricas. A saúde e os batimentos continuam. Lido a cada chamada, para os testes poderem alternar.
 */
export const metricsEnabled = (): boolean => process.env.METRICS_ENABLED?.trim().toLowerCase() !== 'false';

/** Quando este processo subiu (a tela mostra "no ar desde"). */
export const processStartedAt = new Date();
