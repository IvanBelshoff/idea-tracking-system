import 'reflect-metadata';
import {
  Column,
  type DataSource,
  Entity,
  type EntityManager,
  JoinColumn,
  PrimaryColumn,
  Tree,
  TreeChildren,
  TreeParent,
} from 'typeorm';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../support/test-db.js';

/**
 * SPIKE 1 – Árvore de entidades com materialized-path (RN-25; CA-RN-25.1 e 25.2).
 * Perguntas:
 *  (a) o TypeORM resolve descendentes/ancestrais sem CTE recursiva escrita à mão?
 *  (b) o TypeORM reescreve o caminho dos descendentes quando o pai muda (mover subárvore)?
 *      -> RESULTADO: sim (TypeORM 1.1.2); só a proteção contra ciclo precisa de código próprio.
 */
@Entity('org_entity')
@Tree('materialized-path')
class OrgEntity {
  @PrimaryColumn('uuid') id!: string;
  @Column({ type: 'varchar' }) name!: string;
  @TreeParent({ onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'parent_id' })
  parent!: OrgEntity | null;
  @TreeChildren() children!: OrgEntity[];
}

class CycleError extends Error {}

/** `mpath` é criada pelo TypeORM mas não é mapeada na entidade; lê-se pelo QueryBuilder. */
async function pathOf(m: EntityManager | DataSource, id: string): Promise<string> {
  const row = await m
    .createQueryBuilder(OrgEntity, 'e')
    .select('e.mpath', 'mpath')
    .where('e.id = :id', { id })
    .getRawOne<{ mpath: string }>();
  return row!.mpath;
}

async function create(ds: DataSource, name: string, parent: OrgEntity | null): Promise<OrgEntity> {
  const repo = ds.getTreeRepository(OrgEntity);
  const node = repo.create({ id: uuidv7(), name, parent });
  return repo.save(node);
}

/**
 * Mover subárvore. O TypeORM 1.x reescreve sozinho o caminho do nó e dos descendentes no save()
 * (confirmado pelo teste "mover pelo save() ..."); o que NÃO vem pronto é a proteção contra ciclo,
 * feita aqui comparando caminhos (sem recursão, sem SQL).
 */
async function moveEntity(ds: DataSource, id: string, newParentId: string | null): Promise<void> {
  await ds.transaction(async (m: EntityManager) => {
    const repo = m.getTreeRepository(OrgEntity);
    const node = await repo.findOneByOrFail({ id });
    const newParent = newParentId ? await repo.findOneByOrFail({ id: newParentId }) : null;
    if (newParent && (await pathOf(m, newParent.id)).startsWith(await pathOf(m, node.id))) {
      throw new CycleError('mover para dentro de si mesma ou de um descendente');
    }
    node.parent = newParent;
    await repo.save(node);
  });
}

const names = (nodes: OrgEntity[]) => nodes.map((n) => n.name).sort();

describe('Spike 1 – árvore de entidades', () => {
  let db: TestDatabase;
  let org: OrgEntity, unitA: OrgEntity, sectorA1: OrgEntity, unitB: OrgEntity;

  beforeAll(async () => {
    db = await createTestDatabase({ entities: [OrgEntity] });
    org = await create(db.dataSource, 'Org', null);
    unitA = await create(db.dataSource, 'Unidade A', org);
    sectorA1 = await create(db.dataSource, 'Setor A1', unitA);
    unitB = await create(db.dataSource, 'Unidade B', org);
  });
  afterAll(async () => {
    await db.drop();
  });

  it('CA-RN-25.2 descendentes e ancestrais saem do TreeRepository (sem CTE manual)', async () => {
    const repo = db.dataSource.getTreeRepository(OrgEntity);
    expect(names(await repo.findDescendants(unitA))).toEqual(['Setor A1', 'Unidade A']); // inclui o próprio nó
    expect(names(await repo.findDescendants(org))).toEqual(['Org', 'Setor A1', 'Unidade A', 'Unidade B']);
    expect(names(await repo.findAncestors(sectorA1))).toEqual(['Org', 'Setor A1', 'Unidade A']);
  });

  it('o escopo vira uma lista de ids (para entity_id IN (...))', async () => {
    const repo = db.dataSource.getTreeRepository(OrgEntity);
    const ids = (await repo.findDescendants(unitA)).map((n) => n.id);
    expect(ids.sort()).toEqual([unitA.id, sectorA1.id].sort());
  });

  it('mover pelo save() do TypeORM 1.x já reescreve o caminho do nó e dos descendentes', async () => {
    const repo = db.dataSource.getTreeRepository(OrgEntity);
    const probe = await create(db.dataSource, 'Sonda', unitA);
    const child = await create(db.dataSource, 'Filha da sonda', probe);

    const reloaded = await repo.findOneByOrFail({ id: probe.id });
    reloaded.parent = unitB;
    await repo.save(reloaded);

    const unitBPath = await pathOf(db.dataSource, unitB.id);
    expect(await pathOf(db.dataSource, probe.id)).toBe(`${unitBPath}${probe.id}.`);
    expect(await pathOf(db.dataSource, child.id)).toBe(`${unitBPath}${probe.id}.${child.id}.`);
  });

  it('CA-RN-25.1 mover subárvore atualiza o caminho de todos os descendentes', async () => {
    const repo = db.dataSource.getTreeRepository(OrgEntity);
    await moveEntity(db.dataSource, unitA.id, unitB.id); // Unidade A (com Setor A1) para dentro de Unidade B
    const reloadedB = await repo.findOneByOrFail({ id: unitB.id });
    expect(names(await repo.findDescendants(reloadedB))).toEqual(
      expect.arrayContaining(['Unidade B', 'Unidade A', 'Setor A1']),
    );
    const ancestors = await repo.findAncestors(await repo.findOneByOrFail({ id: sectorA1.id }));
    expect(names(ancestors)).toEqual(['Org', 'Setor A1', 'Unidade A', 'Unidade B']);
  });

  it('CA-RN-25.1 mover para dentro de si mesma ou de um descendente é recusado', async () => {
    await expect(moveEntity(db.dataSource, unitA.id, unitA.id)).rejects.toBeInstanceOf(CycleError);
    await expect(moveEntity(db.dataSource, unitB.id, sectorA1.id)).rejects.toBeInstanceOf(CycleError);
  });
});
