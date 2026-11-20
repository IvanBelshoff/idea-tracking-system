import { Module } from '@nestjs/common';
import { UserFieldsController } from './user-fields.controller.js';
import { UserFieldsService } from './user-fields.service.js';
import { MyFieldsController, UserValuesController } from './user-values.controller.js';
import { UserValuesService } from './user-values.service.js';

/** Campos personalizados do usuário (M25, RN-193 a RN-202). */
@Module({
  controllers: [UserFieldsController, MyFieldsController, UserValuesController],
  providers: [UserFieldsService, UserValuesService],
  exports: [UserFieldsService, UserValuesService],
})
export class UserFieldsModule {}
