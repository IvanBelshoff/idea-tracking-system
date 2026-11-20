import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource, EntityManager } from 'typeorm';
import { Setting } from './entities/setting.entity.js';
import { SETTING_DEFAULTS, type SettingKey, type SettingValue } from './settings.js';

/** Lê uma configuração com o gerenciador dado (usado também pelo worker, fora do NestJS). */
export async function getSetting<K extends SettingKey>(manager: EntityManager, key: K): Promise<SettingValue<K>> {
  const row = await manager.getRepository(Setting).findOneBy({ key });
  return (row ? row.value : SETTING_DEFAULTS[key]) as SettingValue<K>;
}

/** Leitura e gravação das configurações, com o padrão do registro quando não há valor salvo. */
@Injectable()
export class SettingsService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async get<K extends SettingKey>(key: K, manager: EntityManager = this.dataSource.manager): Promise<SettingValue<K>> {
    return getSetting(manager, key);
  }

  async getMany<K extends SettingKey>(keys: readonly K[]): Promise<{ [P in K]: SettingValue<P> }> {
    const entries = await Promise.all(keys.map(async (k) => [k, await this.get(k)] as const));
    return Object.fromEntries(entries) as { [P in K]: SettingValue<P> };
  }

  async set<K extends SettingKey>(
    key: K,
    value: SettingValue<K>,
    updatedById: string | null,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<void> {
    // O banco guarda só o que foi alterado: voltar ao valor de fábrica apaga a linha (e um padrão
    // nulo, como a cor da marca, nunca vira NULL numa coluna que não aceita).
    if (JSON.stringify(value) === JSON.stringify(SETTING_DEFAULTS[key])) {
      await manager.getRepository(Setting).delete({ key });
      return;
    }
    await manager.getRepository(Setting).save({ key, value, updatedById });
  }
}
