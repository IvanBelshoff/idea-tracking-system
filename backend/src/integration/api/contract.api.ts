import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ApiErrorBody } from '../../common/api-error.js';
import { AllowBeforeInstall, Public } from '../../identity-access/auth-context.js';
import { IntegrationDocsService } from '../admin/integration-docs.service.js';
import { CONTRACT_TAG } from '../contract-filter.js';
import { IntegrationGuard } from '../integration.guard.js';
import { CurrentIntegration, type IntegrationPrincipal } from '../principal.js';
import { bi } from './bilingual.js';

/** O próprio contrato (RN-106): exige token e mostra só os módulos daquela integração. */
@Controller('integration/v1')
@Public()
@AllowBeforeInstall()
@UseGuards(IntegrationGuard)
@ApiTags(CONTRACT_TAG)
@ApiBearerAuth()
@ApiUnauthorizedResponse({ type: ApiErrorBody, description: 'Token ausente, inválido, vencido ou revogado.' })
@ApiTooManyRequestsResponse({ type: ApiErrorBody, description: 'Limite de chamadas por minuto (Retry-After).' })
export class ContractApiController {
  constructor(private readonly docs: IntegrationDocsService) {}

  @Get('openapi.json')
  @ApiOperation({
    summary: 'OpenAPI contract',
    ...bi(
      'The OpenAPI document of this API, only with the modules of the calling integration.',
      'O documento OpenAPI desta API, só com os módulos da integração que chama.',
    ),
  })
  @ApiOkResponse({ description: 'OpenAPI 3 document.' })
  contract(@CurrentIntegration() principal: IntegrationPrincipal): Promise<object> {
    return this.docs.contractFor(principal.id);
  }
}
