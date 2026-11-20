import { newPublicCode } from '../../src/public/public.service.js';
import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Idea, IdeaStatus } from '../../src/ideas/entities/idea.entity.js';
import { IdeaEvent, Step, Visibility } from '../../src/ideas/entities/idea-related.entity.js';
import { nextIdeaCode } from '../../src/ideas/idea-code.js';
import { User } from '../../src/identity-access/entities/user.entity.js';
import { OrgEntity } from '../../src/organization/entities/org-entity.entity.js';
import { createMigratedTestDatabase, type TestDatabase } from '../support/test-db.js';

describe('Ideias: banco e identificador (M2, fatia 1)', () => {
  let db: TestDatabase;
  let entityId: string;
  let userId: string;

  async function insertIdea(code: string, patch: Partial<Idea> = {}) {
    const repo = db.dataSource.getRepository(Idea);
    return repo.save(
      repo.create({
        code,
        publicCode: newPublicCode(),
        title: 'Ideia',
        description: 'Descrição',
        entityId,
        authorId: userId,
        submittedAt: new Date(),
        ...patch,
      }),
    );
  }

  beforeAll(async () => {
    db = await createMigratedTestDatabase();
    const ds = db.dataSource;
    const tree = ds.getTreeRepository(OrgEntity);
    entityId = (await tree.save(tree.create({ name: 'Org', parent: null }))).id;
    userId = (await ds.getRepository(User).save(ds.getRepository(User).create({ email: 'a@example.test', name: 'A' })))
      .id;
  });
  afterAll(async () => {
    await db?.drop();
  });

  describe('identificador (RN-22)', () => {
    it('CA-RN-22.1 duas ideias seguidas no ano → 0001 e 0002', async () => {
      const codes = [];
      for (let i = 0; i < 2; i++) codes.push(await db.dataSource.transaction((m) => nextIdeaCode(m, 'ITS', 2030)));
      expect(codes).toEqual(['ITS-2030-0001', 'ITS-2030-0002']);
    });

    it('CA-RN-22.2 50 criações simultâneas → 50 identificadores distintos, sem lacuna', async () => {
      const codes = await Promise.all(
        Array.from({ length: 50 }, () =>
          db.dataSource.transaction(async (m) => {
            const code = await nextIdeaCode(m, 'ITS', 2031);
            await m.getRepository(Idea).save(
              m.getRepository(Idea).create({
                code,
                publicCode: newPublicCode(),
                title: 'X',
                description: 'Y',
                entityId,
                authorId: userId,
                submittedAt: new Date(),
              }),
            );
            return code;
          }),
        ),
      );
      const numbers = codes.map((c) => Number(c.slice(-4))).sort((a, b) => a - b);
      expect(new Set(codes).size).toBe(50);
      expect(numbers).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    });

    it('falha depois de reservar o número não deixa lacuna (o incremento volta)', async () => {
      await expect(
        db.dataSource.transaction(async (m) => {
          await nextIdeaCode(m, 'ITS', 2032);
          throw new Error('falha simulada');
        }),
      ).rejects.toThrow('falha simulada');
      expect(await db.dataSource.transaction((m) => nextIdeaCode(m, 'ITS', 2032))).toBe('ITS-2032-0001');
    });

    it('CA-RN-22.3 a virada de ano reinicia a sequência e o código não muda depois de criado', async () => {
      expect(await db.dataSource.transaction((m) => nextIdeaCode(m, 'ITS', 2033))).toBe('ITS-2033-0001');
      const idea = await insertIdea('ITS-2099-0001');
      await db.dataSource.getRepository(Idea).save({ ...idea, code: 'ITS-2099-9999' });
      expect((await db.dataSource.getRepository(Idea).findOneByOrFail({ id: idea.id })).code).toBe('ITS-2099-0001');
    });
  });

  describe('garantias no banco', () => {
    it('Não autorizada sem justificativa e Implementada sem resultado são recusadas', async () => {
      await expect(insertIdea('ITS-2098-0001', { status: IdeaStatus.Rejected })).rejects.toThrow(/ck_idea_rejected/);
      await expect(
        insertIdea('ITS-2098-0002', { status: IdeaStatus.Implemented, implementedAt: new Date() }),
      ).rejects.toThrow(/ck_idea_implemented/);
    });

    it('etapa com prevista antes do início e posição repetida são recusadas', async () => {
      const idea = await insertIdea('ITS-2098-0003');
      const steps = db.dataSource.getRepository(Step);
      const base = { ideaId: idea.id, name: 'E', assigneeId: userId, startDate: '2026-05-10' };
      await expect(steps.save(steps.create({ ...base, position: 1, dueDate: '2026-05-01' }))).rejects.toThrow(
        /ck_step_dates/,
      );
      await steps.save(steps.create({ ...base, position: 1, dueDate: '2026-05-20' }));
      await expect(steps.save(steps.create({ ...base, position: 1, dueDate: '2026-05-20' }))).rejects.toThrow(
        /uq_step_position/,
      );
    });
  });

  describe('histórico imutável (RN-38)', () => {
    async function event(ideaId: string) {
      const repo = db.dataSource.getRepository(IdeaEvent);
      return repo.save(
        repo.create({ ideaId, type: 'created', actorId: userId, data: {}, visibility: Visibility.Public }),
      );
    }

    it('CA-RN-38.2 UPDATE, DELETE e TRUNCATE no histórico falham por causa do trigger', async () => {
      const idea = await insertIdea('ITS-2097-0001');
      const ev = await event(idea.id);
      const repo = db.dataSource.getRepository(IdeaEvent);
      await expect(repo.update({ id: ev.id }, { reason: 'alterado' })).rejects.toThrow(/somente inserção/);
      await expect(repo.delete({ id: ev.id })).rejects.toThrow(/somente inserção/);
      await expect(db.dataSource.query('TRUNCATE idea_event CASCADE')).rejects.toThrow(/somente inserção/);
      // Apagar a ideia também não leva o histórico junto, fora da exclusão autorizada.
      await expect(db.dataSource.getRepository(Idea).delete({ id: idea.id })).rejects.toThrow(/somente inserção/);
    });

    it('RN-11 só a exclusão física autorizada (marcada na transação, para aquela ideia) apaga o histórico', async () => {
      const target = await insertIdea('ITS-2097-0002');
      const other = await insertIdea('ITS-2097-0003');
      await event(target.id);
      await event(other.id);

      // Marcada para outra ideia: continua recusada.
      await expect(
        db.dataSource.transaction(async (m) => {
          await m.query("SELECT set_config('its.purge_idea', $1, true)", [other.id]);
          await m.getRepository(Idea).delete({ id: target.id });
        }),
      ).rejects.toThrow(/somente inserção/);

      await db.dataSource.transaction(async (m) => {
        await m.query("SELECT set_config('its.purge_idea', $1, true)", [target.id]);
        await m.getRepository(Idea).delete({ id: target.id });
      });
      expect(await db.dataSource.getRepository(Idea).countBy({ id: target.id })).toBe(0);
      expect(await db.dataSource.getRepository(IdeaEvent).countBy({ ideaId: other.id })).toBe(1);

      // A marca vale só dentro da transação: fora dela, volta a recusar.
      await expect(db.dataSource.getRepository(Idea).delete({ id: other.id })).rejects.toThrow(/somente inserção/);
    });
  });
});
