import { Module } from '@nestjs/common';
import { StoreController } from './store.controller.js';
import { StoreService } from './store.service.js';
import { StoreItemsService } from './store-items.service.js';
import { StoreOrdersService } from './store-orders.service.js';
import { StorePhotoStorage } from './store-photo.js';
import { StoreShopController } from './store-shop.controller.js';

/** Loja e bonificação (M22, RN-159 a RN-173). */
@Module({
  controllers: [StoreController, StoreShopController],
  providers: [StoreService, StoreItemsService, StoreOrdersService, StorePhotoStorage],
})
export class StoreModule {}
