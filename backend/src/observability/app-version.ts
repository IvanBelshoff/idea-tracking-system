import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** A versão do ITS, lida do `package.json` do processo (a mesma que a tela "Informações" mostra). */
export const appVersion: string = (() => {
  try {
    const { version } = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as {
      version?: string;
    };
    return version ?? 'desconhecida';
  } catch {
    return 'desconhecida';
  }
})();
