import { ConsoleLogger, type LogLevel } from '@nestjs/common';
import { formatLogTimestamp } from './dates.js';

/**
 * Logger da aplicação com saída em pt-BR. As mensagens do próprio NestJS (inicialização, rotas,
 * módulos) vêm em inglês e são traduzidas aqui; as nossas já são escritas em português.
 * Mensagens desconhecidas passam sem alteração (erros de bibliotecas de terceiros, por exemplo).
 */

const LEVELS: Record<LogLevel, string> = {
  log: 'INFO',
  error: 'ERRO',
  warn: 'AVISO',
  debug: 'DEPURAÇÃO',
  verbose: 'DETALHE',
  fatal: 'FATAL',
};

const CONTEXTS: Record<string, string> = {
  NestFactory: 'Inicialização',
  NestApplication: 'Aplicação',
  InstanceLoader: 'Módulos',
  RoutesResolver: 'Rotas',
  RouterExplorer: 'Rotas',
  ExceptionsHandler: 'Erros',
};

const MESSAGES: [RegExp, string][] = [
  [/^Starting Nest application\.\.\.$/, 'Iniciando a aplicação...'],
  [/^Nest application successfully started$/, 'Aplicação iniciada'],
  [/^(.+) dependencies initialized$/, '$1: dependências inicializadas'],
  [/^Mapped \{(.+), (\w+)\} route$/, 'Rota mapeada: $2 $1'],
  [/^Mapped \{(.+), (\w+)\} \(version: (.+)\) route$/, 'Rota mapeada: $2 $1 (versão $3)'],
  [/^(\w+) \{(.+)\}:$/, '$1 em $2:'],
  [/^Error happened during shutdown$/, 'Erro durante o encerramento'],
];

export function translateMessage(message: string): string {
  for (const [pattern, replacement] of MESSAGES) {
    if (pattern.test(message)) return message.replace(pattern, replacement);
  }
  return message;
}

export function translateLevel(level: LogLevel): string {
  return LEVELS[level];
}

export class PtBrLogger extends ConsoleLogger {
  protected override formatPid(pid: number): string {
    return `[ITS] ${pid}  - `;
  }

  protected override getTimestamp(): string {
    return formatLogTimestamp();
  }

  protected override formatContext(context: string): string {
    return super.formatContext(CONTEXTS[context] ?? context);
  }

  protected override formatMessage(
    logLevel: LogLevel,
    message: unknown,
    pidMessage: string,
    _formattedLogLevel: string,
    contextMessage: string,
    timestampDiff: string,
    params?: Record<string, unknown>,
  ): string {
    const text = typeof message === 'string' ? translateMessage(message) : message;
    const level = translateLevel(logLevel).padStart(9, ' ');
    return super.formatMessage(logLevel, text, pidMessage, level, contextMessage, timestampDiff, params);
  }
}
