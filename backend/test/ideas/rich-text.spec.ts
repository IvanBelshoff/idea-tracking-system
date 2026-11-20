import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildScenario,
  createIntegration,
  enableIntegration,
  IntegrationClient,
  type Scenario,
} from '../support/integration-support.js';
import { Client, createTestApp, INSTALL_INPUT, STRONG_PASSWORD, type TestApp } from '../support/test-app.js';

const p = (...content: unknown[]) => ({ type: 'paragraph', content });
const t = (text: string, marks?: unknown[]) => ({ type: 'text', text, ...(marks ? { marks } : {}) });
const doc = (...content: unknown[]) => ({ type: 'doc', content });
const bold = [{ type: 'bold' }];

interface Detail {
  code: string;
  description: string;
  descriptionRich: { content: unknown[] } | null;
  proposedSolution: string | null;
  proposedSolutionRich: unknown;
  resultText: string | null;
  standardAdopted: string | null;
  standardAdoptedRich: unknown;
  steps: { description: string | null; descriptionRich: unknown }[];
}
interface Comment {
  body: string;
  bodyRich: unknown;
  visibility: string;
}

describe('Texto formatado (M19, RN-136)', () => {
  let t0: TestApp;
  let admin: Client;
  let maria: Client;
  let s: Scenario;
  const ds = () => t0.db.dataSource;
  const rows = <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> =>
    ds().query(sql, params);

  const submit = (over: Record<string, unknown>) =>
    maria.post<Detail & { code: string }>('/ideas', {
      title: 'Ideia com texto formatado',
      description: 'x',
      entityId: s.ent.A1,
      categoryId: s.cat.Qualidade,
      ...over,
    });

  beforeAll(async () => {
    t0 = await createTestApp();
    admin = new Client(t0.baseUrl);
    expect((await admin.post('/install', INSTALL_INPUT)).status).toBe(200);
    s = await buildScenario(t0, admin);
    maria = new Client(t0.baseUrl);
    expect((await maria.post('/auth/login', { email: 'maria@example.test', password: STRONG_PASSWORD })).status).toBe(
      200,
    );
  }, 180_000);
  afterAll(async () => {
    await t0?.close();
  });

  it('CA-RN-136.2 enviar direto pela API com HTML hostil: sai só o que a lista permite (negativo)', async () => {
    const hostile = doc(
      p(t('Palavra'), t(' negritada', bold), t(' <script>alert(1)</script>')),
      { type: 'image', attrs: { src: 'x', onerror: 'alert(1)' } },
      p(
        t('clique', [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }]),
        t(' seguro', [{ type: 'link', attrs: { href: 'https://exemplo.com' } }]),
      ),
    );
    const res = await submit({ descriptionRich: hostile, description: 'IGNORADO PELO SERVIDOR' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const stored = JSON.stringify(res.body.descriptionRich);
    for (const bad of ['image', 'onerror', 'javascript']) expect(stored, bad).not.toContain(bad);
    expect(stored).toContain('https://exemplo.com');
    // O texto puro é derivado do documento; o que veio em `description` é ignorado.
    expect(res.body.description).not.toContain('IGNORADO');
    expect(res.body.description).toContain('Palavra negritada');
    const [row] = await rows<{ description: string; description_rich: unknown }>(
      'SELECT description, description_rich FROM idea WHERE code = $1',
      [res.body.code],
    );
    expect(row?.description).toBe(res.body.description);
    expect(JSON.stringify(row?.description_rich)).not.toContain('javascript');
    // Um documento que não é documento → 422.
    expect((await submit({ descriptionRich: { type: 'paragraph' } })).status).toBe(422);
    expect((await submit({ descriptionRich: 'texto' })).status).toBe(422);
  });

  it('CA-RN-136.3 o texto puro derivado serve às ideias semelhantes: acha uma palavra que estava em negrito', async () => {
    const res = await submit({
      title: 'Ideia da palavra rara',
      descriptionRich: doc(p(t('Trocar o '), t('zelabrunco', bold), t(' da esteira'))),
    });
    expect(res.status).toBe(201);
    const similar = await maria.get<{ code: string }[]>('/ideas/similar?q=zelabrunco%20esteira');
    expect(similar.status).toBe(200);
    expect(similar.body.map((i) => i.code)).toContain(res.body.code);
  });

  it('CA-RN-136.4 e .6 ideia antiga (só texto puro) segue legível; texto puro novo zera o documento', async () => {
    const detail = (await admin.get<Detail>(`/ideas/${s.code.i1}`)).body;
    expect(detail.description.length).toBeGreaterThan(0);
    expect(detail.descriptionRich).toBeNull();
    const made = await submit({ descriptionRich: doc(p(t('com ', bold), t('formato'))) });
    expect(made.body.descriptionRich).not.toBeNull();
    // Editar mandando só texto puro: o documento antigo deixa de valer.
    const edited = await maria.request<Detail>('PATCH', `/ideas/${made.body.code}`, {
      description: 'Agora em texto puro.',
    });
    expect(edited.status).toBe(200);
    expect(edited.body.description).toBe('Agora em texto puro.');
    expect(edited.body.descriptionRich).toBeNull();
    // Editar mandando o documento: o texto puro é derivado.
    const again = await maria.request<Detail>('PATCH', `/ideas/${made.body.code}`, {
      descriptionRich: doc(p(t('De novo ', bold), t('com formato'))),
    });
    expect(again.body.description).toBe('De novo com formato');
    expect(again.body.descriptionRich).not.toBeNull();
  });

  it('CA-RN-136.5 o limite vale sobre o texto puro: 10 mil passa, 10 mil e um recusa (negativo)', async () => {
    const ok = await submit({ descriptionRich: doc(p(t('x'.repeat(10_000), bold))) });
    expect(ok.status).toBe(201);
    const tooBig = await submit({ descriptionRich: doc(p(t('x'.repeat(10_001), bold))) });
    expect(tooBig.status).toBe(422);
    // Documento vazio onde o texto é obrigatório → 422.
    expect((await submit({ descriptionRich: doc(p()) })).status).toBe(422);
  });

  it('CA-RN-136.6 a API de integração lê e grava texto puro: o documento não aparece e o texto puro entra como parágrafos', async () => {
    const made = await submit({
      title: 'Para a integração',
      descriptionRich: doc(p(t('Linha um')), {
        type: 'bulletList',
        content: [
          { type: 'listItem', content: [p(t('item a'))] },
          { type: 'listItem', content: [p(t('item b'))] },
        ],
      }),
    });
    await enableIntegration(t0, admin, ['ideas', 'ideas_write']);
    const reader = new IntegrationClient(
      t0.baseUrl,
      (
        await createIntegration(admin, {
          name: 'Leitor',
          modules: ['ideas', 'ideas_write'],
          scope: [{ entityId: s.ent.A, includeChildren: true }],
          ratePerMinute: 600,
        })
      ).token,
    );
    const read = await reader.get<{ description: string; descriptionRich?: unknown }>(`/ideas/${made.body.code}`);
    expect(read.status).toBe(200);
    expect(read.body.description).toBe('Linha um\n- item a\n- item b');
    expect(JSON.stringify(read.body)).not.toContain('Rich');
    // Gravação pela integração: texto puro, sem documento.
    const written = await reader.request<{ code: string }>('POST', '/ideas', {
      headers: { 'idempotency-key': 'rich-1' },
      body: {
        author_email: 'maria@example.test',
        title: 'Pela integração',
        description: 'Linha 1\nLinha 2',
        entity_id: s.ent.A1,
        category_id: s.cat.Qualidade,
      },
    });
    expect(written.status, JSON.stringify(written.body)).toBe(201);
    const [row] = await rows<{ description: string; description_rich: unknown }>(
      'SELECT description, description_rich FROM idea WHERE code = $1',
      [written.body.code],
    );
    expect(row).toEqual({ description: 'Linha 1\nLinha 2', description_rich: null });
  });

  it('CA-RN-136.7 comentário com formato: o interno continua visível só para a equipe', async () => {
    const made = await submit({ descriptionRich: doc(p(t('para comentar'))) });
    const code = made.body.code;
    const pub = await maria.post(`/ideas/${code}/comments`, {
      bodyRich: doc(p(t('público ', bold), t('formatado'))),
      body: 'x',
    });
    expect(pub.status).toBe(201);
    const internal = await admin.post(`/ideas/${code}/comments`, {
      bodyRich: doc(p(t('SEGREDO interno', bold))),
      body: 'x',
      visibility: 'internal',
    });
    expect(internal.status).toBe(201);
    const team = (await admin.get<Comment[]>(`/ideas/${code}/comments`)).body;
    const author = (await maria.get<Comment[]>(`/ideas/${code}/comments`)).body;
    expect(team.map((c) => c.body)).toEqual(['público formatado', 'SEGREDO interno']);
    expect(team[0]?.bodyRich).not.toBeNull();
    expect(author.map((c) => c.body)).toEqual(['público formatado']);
    expect(JSON.stringify(author)).not.toContain('SEGREDO');
  });

  it('a descrição da etapa e o objetivo da campanha aceitam o documento; a lição aprendida também', async () => {
    const made = await submit({ descriptionRich: doc(p(t('para aprovar'))) });
    const approved = await admin.post<Detail>(`/ideas/${made.body.code}/approve`, {
      stepName: 'Executar',
      assigneeId: s.uid.analista,
      dueDate: new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10),
      stepDescriptionRich: doc(p(t('Passo ', bold), t('a passo'))),
    });
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    expect(approved.body.steps[0]?.description).toBe('Passo a passo');
    expect(approved.body.steps[0]?.descriptionRich).not.toBeNull();

    const day = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
    const campaign = await admin.post<{ objective: string; objectiveRich: unknown }>('/campaigns', {
      name: 'Campanha formatada',
      objective: 'x',
      objectiveRich: doc(p(t('Reduzir ', bold), t('paradas'))),
      startsOn: day(1),
      endsOn: day(30),
      goalType: 'ideas',
      goalValue: 5,
      entityIds: [s.ent.A],
      categoryIds: [],
    });
    expect(campaign.status, JSON.stringify(campaign.body)).toBe(201);
    expect(campaign.body.objective).toBe('Reduzir paradas');
    expect(campaign.body.objectiveRich).not.toBeNull();

    // Lição aprendida de uma ideia já implementada do cenário (i2).
    const standard = await admin.put<Detail>(`/ideas/${s.code.i2}/standard`, {
      standardAdoptedRich: doc(p(t('Padrão ', bold), t('adotado'))),
      standardAdopted: 'x',
      isReplicable: true,
    });
    expect(standard.status, JSON.stringify(standard.body)).toBe(200);
    expect(standard.body.standardAdopted).toBe('Padrão adotado');
    expect(standard.body.standardAdoptedRich).not.toBeNull();
    const history = JSON.stringify(await rows(`SELECT data FROM idea_event WHERE type = 'standard_updated'`));
    expect(history).not.toContain('"type":"doc"');
  });

  it('CA-RN-136.10 o PDF de uma ideia com formato sai sem quebrar e traz o texto puro', async () => {
    const made = await submit({
      descriptionRich: doc(p(t('Texto do ', bold), t('PDF')), {
        type: 'orderedList',
        content: [{ type: 'listItem', content: [p(t('um'))] }],
      }),
    });
    const res = await admin.raw(`/ideas/${made.body.code}/pdf`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/pdf');
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(500);
  });
});
