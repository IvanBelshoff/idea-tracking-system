import { Module } from '@nestjs/common';
import { AppIconsController } from './app-icons.controller.js';
import { BrandingController } from './branding.controller.js';
import { BrandingService } from './branding.service.js';
import { CategoriesService } from './categories.service.js';
import { EntitiesService } from './entities.service.js';
import { LoginScreenController } from './login-screen.controller.js';
import { LoginScreenService } from './login-screen.service.js';
import { CategoriesController, EntitiesController } from './organization.controller.js';
import { SettingsController } from './settings.controller.js';
import { SettingsAdminService } from './settings-admin.service.js';

/**
 * Organização: entidades em árvore, categorias (RN-24 a RN-26) e a tela de configurações (§16).
 * A leitura de configurações (SettingsService) e a gravação de auditoria vêm do módulo global.
 */
@Module({
  controllers: [
    EntitiesController,
    CategoriesController,
    SettingsController,
    BrandingController,
    LoginScreenController,
    AppIconsController,
  ],
  providers: [EntitiesService, CategoriesService, SettingsAdminService, BrandingService, LoginScreenService],
  exports: [EntitiesService, CategoriesService],
})
export class OrganizationModule {}
