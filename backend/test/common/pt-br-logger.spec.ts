import { describe, expect, it } from 'vitest';
import { translateLevel, translateMessage } from '../../src/common/pt-br-logger.js';

describe('Logs em pt-BR', () => {
  it('traduz as mensagens de inicialização do NestJS', () => {
    expect(translateMessage('Starting Nest application...')).toBe('Iniciando a aplicação...');
    expect(translateMessage('Nest application successfully started')).toBe('Aplicação iniciada');
    expect(translateMessage('AppModule dependencies initialized')).toBe('AppModule: dependências inicializadas');
    expect(translateMessage('Mapped {/api/health, GET} route')).toBe('Rota mapeada: GET /api/health');
    expect(translateMessage('HealthController {/api/health}:')).toBe('HealthController em /api/health:');
  });

  it('mantém mensagens desconhecidas e traduz os níveis', () => {
    expect(translateMessage('[worker] pronto')).toBe('[worker] pronto');
    expect(translateLevel('log')).toBe('INFO');
    expect(translateLevel('error')).toBe('ERRO');
    expect(translateLevel('warn')).toBe('AVISO');
  });
});
