import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { csvCell, neutralize } from '../../src/common/csv.js';
import { Role } from '../../src/identity-access/entities/role.entity.js';
import { User } from '../../src/identity-access/entities/user.entity.js';
import { UserRoleScope } from '../../src/identity-access/entities/user-role-scope.entity.js';
import { hashPassword } from '../../src/identity-access/password.js';
import { Category } from '../../src/organization/entities/category.entity.js';
import { OrgEntity } from '../../src/organization/entities/org-entity.entity.js';
import { Client, createTestApp, INSTALL_INPUT, STRONG_PASSWORD, type TestApp } from '../support/test-app.js';

interface Detail {
  id: string;
  code: string;
  steps: { id: string }[];
}
interface Summary {
  total: number;
  byStatus: { status: string; count: number }[];
  process: {
    avgTriageSeconds: number | null;
    avgExecutionSeconds: number | null;
    approvalRate: number | null;
    decided: number;
    lateRate: number | null;
    inProgress: number;
    late: number;
    authors: number;
    ideasPerAuthor: number | null;
  };
  byCategory: { id: string | null; name: string; count: number }[];
  byEntity: { id: string; name: string; count: number }[];
}

const FORMULA_TITLE = '=HYPERLINK("http://example.test";"clique")';
const count = (s: Summary, status: string) => s.byStatus.find((x) => x.status === status)?.count;

/** Texto de um PDF sem compressão: pdfkit grava os textos em hexadecimal (WinAnsi ≈ latin1). */
function pdfText(buf: Buffer): string {
  const raw = buf.toString('latin1');
  // Cada operador de texto (Tj ou TJ) junta só os trechos <hex>; os números do TJ são espaçamento.
  return [...raw.matchAll(/((?:\[[^\]]*\]|<[0-9a-f]+>)\s*T[jJ])/gi)]
    .map((op) =>
      [...(op[1] ?? '').matchAll(/<([0-9a-f]+)>/gi)]
        .map((h) =>
          Buffer.from(h[1]?.match(/[0-9a-f]{2}/gi)?.map((x) => Number.parseInt(x, 16)) ?? []).toString('latin1'),
        )
        .join(''),
    )
    .join(' ');
}

describe('Indicadores, exportação e PDF (M5, RN-44 a RN-49)', () => {
  let t: TestApp;
  let admin: Client;
  const ent: Record<string, string> = {};
  const c: Record<string, Client> = {};
  const uid: Record<string, string> = {};
  let categoryId: string;
  let otherCategoryId: string;
  const ideas: Record<string, Detail> = {};

  async function user(key: string, roleKey: string, entityId: string) {
    const ds = t.db.dataSource;
    const repo = ds.getRepository(User);
    const u = await repo.save(
      repo.create({
        email: `${key}@example.test`,
        name: `Pessoa ${key}`,
        passwordHash: await hashPassword(STRONG_PASSWORD),
      }),
    );
    const role = await ds.getRepository(Role).findOneByOrFail({ systemKey: roleKey });
    await ds
      .getRepository(UserRoleScope)
      .save(ds.getRepository(UserRoleScope).create({ userId: u.id, roleId: role.id, entityId }));
    uid[key] = u.id;
    c[key] = new Client(t.baseUrl);
    expect((await c[key].post('/auth/login', { email: `${key}@example.test`, password: STRONG_PASSWORD })).status).toBe(
      200,
    );
  }
  const send = async (who: string, entityId: string, title: string, cat = categoryId) => {
    const res = await c[who]!.post<Detail>('/ideas', { title, description: 'Descrição', entityId, categoryId: cat });
    expect(res.status).toBe(201);
    return res.body;
  };
  const act = async (who: Client, code: string, action: string, body: Record<string, unknown> = {}) => {
    const res = await who.post<Detail>(`/ideas/${code}/${action}`, body);
    expect(res.status, `${action}: ${JSON.stringify(res.body)}`).toBe(200);
    return res.body;
  };
  const sql = (text: string, values: unknown[] = []) => t.db.dataSource.query(text, values);
  const summary = (who: Client, qs = '') => who.get<Summary>(`/reports/summary${qs}`);

  beforeAll(async () => {
    t = await createTestApp();
    admin = new Client(t.baseUrl);
    expect((await admin.post('/install', INSTALL_INPUT)).status).toBe(200);
    const ds = t.db.dataSource;
    const tree = ds.getTreeRepository(OrgEntity);
    const org = await ds.getRepository(OrgEntity).findOneByOrFail({ name: 'Org' });
    ent.org = org.id;
    const a = await tree.save(tree.create({ name: 'Unidade A', parent: org }));
    ent.A = a.id;
    ent.A1 = (await tree.save(tree.create({ name: 'Setor A1', parent: a }))).id;
    ent.B = (await tree.save(tree.create({ name: 'Unidade B', parent: org }))).id;
    const cats = ds.getRepository(Category);
    categoryId = (await cats.save(cats.create({ name: 'Segurança', color: '#dc2626' }))).id;
    otherCategoryId = (await cats.save(cats.create({ name: 'Qualidade', color: '#4f46e5' }))).id;
    await user('analista', 'analyst', ent.org);
    await user('gestor', 'manager', ent.A);
    await user('gestorB', 'manager', ent.B);
    await user('autor1', 'collaborator', ent.A1);
    await user('autor2', 'collaborator', ent.A1);
    await user('autorB', 'collaborator', ent.B);
    await user('colab', 'collaborator', ent.A1);

    // Fixture conhecida (A1): 2 enviadas, 1 em análise, 1 em andamento, 1 implementada, 1 não autorizada.
    ideas.s1 = await send('autor1', ent.A1, FORMULA_TITLE);
    ideas.s2 = await send('autor2', ent.A1, 'Enviada 2', otherCategoryId);
    ideas.rv = await send('autor1', ent.A1, 'Em análise');
    await act(c.analista!, ideas.rv.code, 'start-review');
    ideas.ip = await send('autor2', ent.A1, 'Em andamento');
    const approved = await act(c.analista!, ideas.ip.code, 'approve', {
      stepName: 'Executar',
      assigneeId: uid.analista,
      dueDate: '2099-12-31',
    });
    ideas.ip.steps = approved.steps;
    ideas.im = await send('autor1', ent.A1, 'Implementada');
    const imApproved = await act(c.analista!, ideas.im.code, 'approve', {
      stepName: 'Fazer',
      assigneeId: uid.analista,
      dueDate: '2099-12-31',
    });
    await act(c.analista!, ideas.im.code, `steps/${imApproved.steps[0]!.id}/complete`);
    await act(c.analista!, ideas.im.code, 'implement', { resultText: 'Feito' });
    ideas.rj = await send('autor2', ent.A1, 'Não autorizada');
    await act(c.analista!, ideas.rj.code, 'start-review');
    await act(c.analista!, ideas.rj.code, 'reject', { reason: 'Fora do escopo' });
    // Unidade B e uma arquivada (não conta).
    ideas.b1 = await send('autorB', ent.B, 'Da Unidade B');
    ideas.arq = await send('autor1', ent.A1, 'Arquivada');
    await act(c.analista!, ideas.arq.code, 'archive', {});

    // Tempos conhecidos: triagem de 2 h, 4 h e 6 h; execução da implementada: 10 h; uma etapa vencida.
    const at = (id: string, submitted: string, decided: string, implemented?: string) =>
      sql('UPDATE idea SET submitted_at = $2, decided_at = $3, implemented_at = $4 WHERE id = $1', [
        id,
        submitted,
        decided,
        implemented ?? null,
      ]);
    await at(ideas.ip.id, '2026-01-10T00:00:00Z', '2026-01-10T02:00:00Z');
    await at(ideas.im.id, '2026-01-10T00:00:00Z', '2026-01-10T04:00:00Z', '2026-01-10T14:00:00Z');
    await at(ideas.rj.id, '2026-01-10T00:00:00Z', '2026-01-10T06:00:00Z');
    await sql("UPDATE step SET start_date = '2000-01-01', due_date = '2000-01-02' WHERE idea_id = $1", [ideas.ip.id]);
  });
  afterAll(async () => {
    await t?.close();
  });

  it('CA-RN-44.1 as contagens batem com a fixture; arquivadas não entram (CA-RN-44.2)', async () => {
    const res = await summary(admin);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(7);
    expect(count(res.body, 'submitted')).toBe(3); // 2 do setor A1 + 1 da Unidade B
    expect(count(res.body, 'in_review')).toBe(1);
    expect(count(res.body, 'in_progress')).toBe(1);
    expect(count(res.body, 'implemented')).toBe(1);
    expect(count(res.body, 'rejected')).toBe(1);
    expect(res.body.byStatus.map((s) => s.status)).toEqual([
      'submitted',
      'in_review',
      'in_progress',
      'implemented',
      'rejected',
    ]);
    expect(res.body.byEntity.map((e) => [e.name, e.count])).toEqual([
      ['Setor A1', 6],
      ['Unidade B', 1],
    ]);
  });

  it('CA-RN-44.1 filtros por entidade (com descendentes), categoria e período reduzem corretamente', async () => {
    const unitA = await summary(admin, `?entityId=${ent.A}`);
    expect(unitA.body.total).toBe(6);
    expect((await summary(admin, `?entityId=${ent.B}`)).body.total).toBe(1);
    const cat = await summary(admin, `?categoryId=${otherCategoryId}`);
    expect(cat.body.total).toBe(1);
    expect(cat.body.byCategory).toMatchObject([{ id: otherCategoryId, name: 'Qualidade', count: 1 }]);
    // Período: as ideias de teste foram enviadas hoje; um dia depois ou antes não há nada.
    const today = new Date().toISOString().slice(0, 10);
    // (3 ideias da fixture tiveram a data de envio ajustada para janeiro de 2026)
    expect((await summary(admin, `?from=${today}&to=${today}`)).body.total).toBe(4);
    expect((await summary(admin, '?from=2099-01-01')).body.total).toBe(0);
    expect((await summary(admin, '?to=2000-01-01')).body.total).toBe(0);
    await sql("UPDATE idea SET submitted_at = '2020-06-15T12:00:00Z' WHERE id = $1", [ideas.s2!.id]);
    expect((await summary(admin, '?from=2020-06-15&to=2020-06-15')).body.total).toBe(1);
    expect((await summary(admin, '?from=2020-06-16')).body.total).toBe(6);
    await sql('UPDATE idea SET submitted_at = now() WHERE id = $1', [ideas.s2!.id]);
    expect((await summary(admin, '?from=2026-12-31&to=2026-01-01')).status).toBe(400);
  });

  it('CA-RN-45.1 / 45.2 indicadores de processo com tempos conhecidos', async () => {
    const { process } = (await summary(admin)).body;
    expect(process.avgTriageSeconds).toBe(4 * 3600); // (2 h + 4 h + 6 h) ÷ 3
    expect(process.avgExecutionSeconds).toBe(10 * 3600);
    expect(process.decided).toBe(3);
    expect(process.approvalRate).toBeCloseTo(2 / 3, 5); // em andamento + implementada ÷ decididas
    expect(process).toMatchObject({ inProgress: 1, late: 1, lateRate: 1 });
    expect(process.authors).toBe(3);
    expect(process.ideasPerAuthor).toBeCloseTo(7 / 3, 5);
  });

  it('CA-RN-45.1 sem dados → "sem dados" (nulo), nunca zero', async () => {
    const { process, total } = (await summary(admin, '?from=2099-01-01')).body;
    expect(total).toBe(0);
    expect(process).toMatchObject({
      avgTriageSeconds: null,
      avgExecutionSeconds: null,
      approvalRate: null,
      lateRate: null,
      ideasPerAuthor: null,
      decided: 0,
      inProgress: 0,
    });
  });

  it('CA-RN-49.1 gestor vê só o seu escopo; consultar outra unidade por parâmetro → 403', async () => {
    const own = await summary(c.gestor!);
    expect(own.status).toBe(200);
    expect(own.body.total).toBe(6);
    expect(own.body.byEntity.map((e) => e.name)).toEqual(['Setor A1']);
    expect((await summary(c.gestor!, `?entityId=${ent.A1}`)).body.total).toBe(6);
    expect((await summary(c.gestor!, `?entityId=${ent.B}`)).status).toBe(403);
    expect((await summary(c.gestor!, `?entityId=${ent.org}`)).status).toBe(403);
    expect((await summary(c.gestorB!)).body.total).toBe(1);
  });

  it('quem não tem report.view recebe 403 (analista, colaborador) e sem sessão 401', async () => {
    expect((await summary(c.analista!)).status).toBe(403);
    expect((await summary(c.colab!)).status).toBe(403);
    expect((await summary(new Client(t.baseUrl))).status).toBe(401);
  });

  it('CA-RN-48.2 valores iniciados por = + - @ são neutralizados; número e texto comum passam', () => {
    for (const bad of ['=1+1', '+SOMA(A1)', '-2+3', '@cmd', '\t=x', '\r=x']) {
      expect(neutralize(bad)).toBe(`'${bad}`);
    }
    expect(neutralize('Pintura normal')).toBe('Pintura normal');
    expect(csvCell(-5)).toBe('-5'); // número de verdade não é fórmula
    expect(csvCell('a;b')).toBe('"a;b"');
    expect(csvCell('diz "oi"')).toBe('"diz ""oi"""');
    expect(csvCell('linha1\nlinha2')).toBe('"linha1\nlinha2"');
    expect(csvCell(null)).toBe('');
    expect(csvCell('=A1;B1')).toBe('"\'=A1;B1"');
  });

  const csv = async (who: Client, qs = '') => {
    const res = await who.raw(`/ideas/export.csv${qs}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    // O BOM fica no início dos bytes; o texto é lido sem ele.
    return { res, bytes, text: `﻿${bytes.toString('utf8').replace(/^﻿/, '')}` };
  };

  it('CA-RN-48.1 o CSV tem as linhas que a lista mostraria, com BOM, cabeçalhos e fórmula neutralizada', async () => {
    const { res, text, bytes } = await csv(c.analista!);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(res.headers.get('content-disposition')).toContain('attachment');
    expect([...new Uint8Array(bytes.subarray(0, 3))]).toEqual([0xef, 0xbb, 0xbf]); // BOM UTF-8
    const lines = text.slice(1).trimEnd().split('\r\n');
    expect(lines[0]).toBe(
      'Código;Título;Situação;Entidade;Categoria;Autor;Responsável pela análise;Enviada em;Prazo;Atrasada',
    );
    expect(lines).toHaveLength(1 + 7); // arquivada fora
    expect(text).not.toContain('Arquivada');
    // A fórmula do título virou texto (apóstrofo na frente) e não começa a célula com "=".
    expect(text).toContain(`"'=HYPERLINK(""http://example.test"";""clique"")"`);
    expect(lines.some((l) => l.split(';')[1]?.startsWith('='))).toBe(false);
    const late = lines.find((l) => l.includes('Em andamento;'))!;
    expect(late.endsWith(';Sim')).toBe(true);
    expect(late).toContain('02/01/2000'); // prazo da etapa vencida, dd/MM/aaaa
  });

  it('CA-RN-48.1 filtros e escopo valem na exportação: a lista e o CSV mostram as mesmas ideias', async () => {
    const filtered = await csv(c.analista!, '?status=implemented');
    expect(filtered.text.slice(1).trimEnd().split('\r\n')).toHaveLength(2);
    expect(filtered.text).toContain(ideas.im!.code);

    const byEntity = await csv(c.analista!, `?entityId=${ent.B}`);
    expect(byEntity.text.slice(1).trimEnd().split('\r\n')).toHaveLength(2);
    expect(byEntity.text).toContain('Da Unidade B');

    // O gestor da Unidade A não vê a Unidade B, nem na lista nem no CSV.
    const list = await c.gestor!.get<{ items: { code: string }[] }>('/ideas?pageSize=100');
    const mine = await csv(c.gestor!);
    const codes = mine.text.match(/ITS-\d{4}-\d{4}/g) ?? [];
    expect([...new Set(codes)].sort()).toEqual(list.body.items.map((i) => i.code).sort());
    expect(mine.text).not.toContain('Da Unidade B');
    // Colaborador só enxerga as próprias.
    const own = await csv(c.autorB!);
    expect(own.text).toContain('Da Unidade B');
    expect(own.text).not.toContain('Enviada 2');
    expect((await csv(new Client(t.baseUrl))).res.status).toBe(401);
  });

  const pdf = async (who: Client, ref: string, qs = '') => {
    const res = await who.raw(`/ideas/${ref}/pdf${qs}`);
    return { res, buf: Buffer.from(await res.arrayBuffer()) };
  };

  it('CA-RN-47.1 o PDF tem dados, etapas e situação; sem histórico se não pedido', async () => {
    const { res, buf } = await pdf(c.analista!, ideas.im!.code);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toContain(`${ideas.im!.code}.pdf`);
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    const text = pdfText(buf);
    expect(text).toContain(ideas.im!.code);
    expect(text).toContain('Implementada');
    expect(text).toContain('Resultado obtido');
    expect(text).toContain('Feito');
    expect(text).toContain('Fazer'); // nome da etapa
    expect(text).toContain('Pessoa autor1');
    expect(text).not.toContain('Histórico');
  });

  it('CA-RN-47.1 histórico só se pedido; comentário interno nunca sai para o autor', async () => {
    await c.analista!.post(`/ideas/${ideas.im!.code}/comments`, { body: 'Sigilo da equipe', visibility: 'internal' });
    const team = pdfText((await pdf(c.analista!, ideas.im!.code, '?history=true')).buf);
    expect(team).toContain('Histórico');
    expect(team).toContain('Ideia enviada');
    expect(team).toContain('Comentário interno'); // a equipe vê que houve comentário interno
    const author = pdfText((await pdf(c.autor1!, ideas.im!.code, '?history=true')).buf);
    expect(author).toContain('Histórico');
    expect(author).toContain('Ideia enviada');
    expect(author).not.toContain('Comentário interno');
    expect(author).not.toContain('Sigilo da equipe');
    expect(team).not.toContain('Sigilo da equipe'); // o texto do comentário nunca vai no PDF
  });

  it('CA-RN-47.2 quem não enxerga a ideia recebe 404 ao pedir o PDF', async () => {
    expect((await pdf(c.colab!, ideas.im!.code)).res.status).toBe(404);
    expect((await pdf(c.gestor!, ideas.b1!.code)).res.status).toBe(404);
    expect((await pdf(c.analista!, 'ITS-2099-9999')).res.status).toBe(404);
    expect((await pdf(new Client(t.baseUrl), ideas.im!.code)).res.status).toBe(401);
  });

  // --- Engajamento (RN-81). Por último: converge uma ideia da Unidade B. ---
  interface Engagement {
    activeCollaborators: number;
    participants: number;
    participationRate: number | null;
    ideas: number;
    ideasPerCollaborator: number | null;
    implemented: number;
    implementationRate: number | null;
    monthly: { month: string; submitted: number; implemented: number; participants: number }[];
  }
  const engagement = (who: Client, qs = '') => who.get<Engagement>(`/reports/engagement${qs}`);

  it('CA-RN-81.1 participação, ideias por colaborador e taxa de implementação no escopo', async () => {
    // Unidade A (com A1): podem enviar admin e analista (raiz), gestor (A), autor1, autor2 e colab (A1).
    const a = await engagement(admin, `?entityId=${ent.A}`);
    expect(a.status).toBe(200);
    expect(a.body).toMatchObject({ activeCollaborators: 6, participants: 2, ideas: 6, implemented: 1 });
    expect(a.body.participationRate).toBeCloseTo(2 / 6, 5);
    expect(a.body.ideasPerCollaborator).toBeCloseTo(1, 5);
    expect(a.body.implementationRate).toBeCloseTo(1 / 6, 5);
    // Conta desativada sai do denominador.
    await sql(`UPDATE "user" SET status = 'disabled' WHERE id = $1`, [uid.colab]);
    expect((await engagement(admin, `?entityId=${ent.A}`)).body.activeCollaborators).toBe(5);
    await sql(`UPDATE "user" SET status = 'active' WHERE id = $1`, [uid.colab]);
  });

  it('CA-RN-81.1 sem ideias no período → taxas "sem dados" onde o denominador é zero', async () => {
    const res = await engagement(admin, '?from=2099-01-01');
    expect(res.body).toMatchObject({ participants: 0, ideas: 0, implemented: 0, implementationRate: null });
    expect(res.body.participationRate).toBe(0); // há colaboradores; ninguém participou
    expect(res.body.monthly).toEqual([]);
  });

  it('RN-81 evolução mensal no fuso da instalação, com os meses vazios presentes', async () => {
    const res = await engagement(admin, `?entityId=${ent.A}&from=2025-12-01&to=2026-02-28`);
    expect(res.body.monthly).toEqual([
      { month: '2025-12', submitted: 0, implemented: 0, participants: 0 },
      { month: '2026-01', submitted: 3, implemented: 1, participants: 2 },
      { month: '2026-02', submitted: 0, implemented: 0, participants: 0 },
    ]);
  });

  it('RN-81 ideia convergida conta como participação, mas não como ideia (CA-RN-84.2)', async () => {
    const extra = await send('gestorB', ent.B!, 'Mesma coisa da Unidade B');
    expect(
      (await admin.post(`/ideas/${extra.code}/converge`, { targetRef: ideas.b1!.code, reason: 'Igual' })).status,
    ).toBe(200);
    const b = await engagement(admin, `?entityId=${ent.B}`);
    // Unidade B: admin, analista, gestorB e autorB podem enviar; autorB e gestorB participaram.
    expect(b.body).toMatchObject({ activeCollaborators: 4, participants: 2, ideas: 1, implemented: 0 });
    expect(b.body.participationRate).toBe(0.5);
    expect(b.body.implementationRate).toBe(0);
    expect(b.body.monthly.at(-1)).toMatchObject({ submitted: 1, participants: 2 });
  });

  it('CA-RN-49.1 engajamento respeita o escopo do gestor; sem report.view → 403', async () => {
    expect((await engagement(c.gestor!, `?entityId=${ent.B}`)).status).toBe(403);
    const own = await engagement(c.gestor!);
    expect(own.status).toBe(200);
    expect(own.body.activeCollaborators).toBe(6);
    expect((await engagement(c.colab!)).status).toBe(403);
  });
});
