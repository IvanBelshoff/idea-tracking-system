import { HttpException, Injectable } from '@nestjs/common';
import type { Access } from '../identity-access/access.js';
import type { BatchInput, BatchItemResult } from './idea-batch.dto.js';
import { IdeasService } from './ideas.service.js';
import { IdeasWorkflowService } from './ideas-workflow.service.js';

/**
 * Ações em lote do analista (RN-59): atribuir, mudar a categoria ou recusar com a mesma
 * justificativa. **Atômicas por item, não por lote** (CA-RN-59.1): cada ideia passa pelo MESMO
 * caminho da ação individual (escopo, permissão, trava de linha, histórico e avisos), na sua própria
 * transação. O que falhar não desfaz o resto, e o resultado diz qual falhou e por quê.
 */
@Injectable()
export class IdeaBatchService {
  constructor(
    private readonly ideas: IdeasService,
    private readonly workflow: IdeasWorkflowService,
  ) {}

  async run(access: Access, input: BatchInput): Promise<BatchItemResult[]> {
    const results: BatchItemResult[] = [];
    for (const ref of input.refs) {
      try {
        const detail =
          input.action === 'assign'
            ? await this.workflow.assign(access, ref, input.assigneeId ?? null)
            : input.action === 'category'
              ? await this.ideas.update(access, ref, { categoryId: input.categoryId ?? null })
              : await this.workflow.reject(access, ref, input.reason ?? '');
        results.push({ ref, ok: true, code: detail.code, error: null, message: null });
      } catch (error) {
        if (!(error instanceof HttpException)) throw error;
        const body = error.getResponse() as { code?: string; message?: string };
        results.push({ ref, ok: false, code: null, error: body.code ?? 'error', message: body.message ?? null });
      }
    }
    return results;
  }
}
