import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import { ApiNotFoundResponse, ApiOkResponse, ApiParam, ApiProduces, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ApiErrorBody, apiError } from '../common/api-error.js';
import { AllowBeforeInstall, Public } from '../identity-access/auth-context.js';
import { APP_ICONS, appManifest, iconVersion, isAppIconFile, renderAppIcon } from './app-icons.js';
import { deriveBrand } from './brand-color.js';
import { SettingsService } from './settings.service.js';

/** Ícones já desenhados, por arquivo e cor (são poucos: 4 arquivos × cores usadas). */
const MAX_CACHED = 32;

/**
 * App instalável na cor da organização (RN-83): manifesto e ícones gerados a partir da cor da
 * marca. Públicos e já antes da instalação: o navegador os busca ao abrir qualquer página, inclusive
 * a do assistente, e um manifesto com erro deixaria o app "não instalável".
 */
@ApiTags('settings')
@AllowBeforeInstall()
@Controller('branding')
export class AppIconsController {
  private readonly cache = new Map<string, Buffer>();

  constructor(private readonly settings: SettingsService) {}

  private async brandHex(): Promise<string> {
    const [color, dark] = await Promise.all([
      this.settings.get('branding.color'),
      this.settings.get('branding.color_dark'),
    ]);
    return deriveBrand(color, dark).lightHex;
  }

  @Get('manifest.webmanifest')
  @Public()
  @ApiProduces('application/manifest+json')
  @ApiOkResponse({ description: 'Manifesto do app instalável, com a cor e os ícones da organização.' })
  async manifest(@Res() res: Response): Promise<void> {
    const body = appManifest(await this.brandHex());
    res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
    // Sem cache: a cor nova precisa chegar na próxima checagem do navegador.
    res.setHeader('Cache-Control', 'no-cache');
    res.send(JSON.stringify(body));
  }

  @Get('icons/:file')
  @Public()
  @ApiParam({ name: 'file', enum: Object.keys(APP_ICONS) })
  @ApiQuery({ name: 'v', required: false, description: 'Versão (a cor, sem "#"); com ela, cache longo' })
  @ApiProduces('image/png')
  @ApiOkResponse({ description: 'Ícone do app (PNG) com o símbolo do ITS na cor da organização.' })
  @ApiNotFoundResponse({ type: ApiErrorBody })
  async icon(@Param('file') file: string, @Query('v') v: string | undefined, @Res() res: Response): Promise<void> {
    if (!isAppIconFile(file)) throw apiError(404, 'not_found', 'Ícone não encontrado.');
    const hex = await this.brandHex();
    const key = `${file}:${hex}`;
    let png = this.cache.get(key);
    if (!png) {
      png = await renderAppIcon(file, hex);
      if (this.cache.size >= MAX_CACHED) this.cache.clear();
      this.cache.set(key, png);
    }
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Com a versão certa na URL, o arquivo nunca muda; sem ela (ícone do iPhone), sempre revalida.
    res.setHeader(
      'Cache-Control',
      v === iconVersion(hex) ? 'public, max-age=31536000, immutable' : 'public, max-age=0, must-revalidate',
    );
    res.send(png);
  }
}
