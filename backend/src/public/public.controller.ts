import { Controller, Get, Header, Param, Req, UseFilters } from '@nestjs/common';
import { ApiNotFoundResponse, ApiOkResponse, ApiParam, ApiTags, ApiTooManyRequestsResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { ApiErrorBody } from '../common/api-error.js';
import { Public } from '../identity-access/auth-context.js';
import { PublicIdeaView } from './public.dto.js';
import { PublicService } from './public.service.js';
import { RetryAfterFilter } from './retry-after.filter.js';

@ApiTags('public')
@Controller('public')
@Public()
export class PublicController {
  constructor(private readonly publicService: PublicService) {}

  @Get('ideas/:code')
  @UseFilters(RetryAfterFilter)
  @Header('Cache-Control', 'no-store')
  @Header('X-Robots-Tag', 'noindex, nofollow')
  @ApiParam({ name: 'code', description: 'Código de acompanhamento (não é o código ITS-AAAA-NNNN)' })
  @ApiOkResponse({ type: PublicIdeaView, description: 'Somente os campos permitidos (RN-35).' })
  @ApiNotFoundResponse({
    type: ApiErrorBody,
    description: 'Código inexistente, consulta desativada pela ideia ou desligada na instalação: resposta idêntica.',
  })
  @ApiTooManyRequestsResponse({ type: ApiErrorBody, description: 'Limite por IP; cabeçalho Retry-After.' })
  lookup(@Param('code') code: string, @Req() req: Request): Promise<PublicIdeaView> {
    return this.publicService.lookup(code, req.ip ?? null);
  }
}
