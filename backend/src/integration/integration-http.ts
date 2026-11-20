import type { RequestHandler } from 'express';
import type { SettingsService } from '../organization/settings.service.js';
import { allowOf, writeMethodsOf } from './write/write-routes.js';

/**
 * Regras HTTP de toda a superfície `/integration` (RN-106), antes das rotas e dos guards:
 *  - `Cache-Control: no-store` em toda resposta, inclusive 401, 404 e 429;
 *  - só `GET`, salvo as quatro rotas de escrita declaradas (M18, RN-126, `write/write-routes.ts`):
 *    qualquer outro método (inclusive `OPTIONS`) responde `405` com o `Allow` certo e nada é gravado;
 *    com a chave geral desligada responde `404`, como se a API não existisse (RN-102);
 *  - nenhum cabeçalho CORS: a API é para servidores, não para navegadores.
 */
export function createIntegrationHttp(getSettings: () => SettingsService): RequestHandler {
  return (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'GET' || req.method === 'HEAD') {
      next();
      return;
    }
    // `req.path` aqui é relativo ao ponto de montagem (`/integration`): reconstrói o caminho inteiro.
    const path = `${req.baseUrl}${req.path}`;
    const writes = writeMethodsOf(path);
    const isWrite = writes.includes(req.method);
    getSettings()
      .get('integration.enabled')
      .then((enabled) => {
        if (!enabled) {
          res.status(404).json({ code: 'not_found', message: 'Recurso não encontrado.' });
          return;
        }
        if (isWrite) {
          next();
          return;
        }
        res.status(405).setHeader('Allow', allowOf(path)).json({
          code: 'method_not_allowed',
          message: 'Método não permitido nesta rota da API de integração.',
        });
      })
      .catch(next);
  };
}
