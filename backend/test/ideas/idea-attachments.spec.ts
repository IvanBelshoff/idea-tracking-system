import 'reflect-metadata';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildScenario, type Scenario } from '../support/integration-support.js';
import { Client, createTestApp, INSTALL_INPUT, STRONG_PASSWORD, type TestApp } from '../support/test-app.js';

interface View {
  id: string;
  stepId: string | null;
  originalName: string;
  deletable: boolean;
}
interface List {
  items: View[];
  canUpload: boolean;
  limit: number;
}

const pdf = (n = 1) => Buffer.from(`%PDF-1.4 anexo ${n}`);

describe('Anexos da própria ideia (M20, RN-146)', () => {
  let t: TestApp;
  let admin: Client;
  let maria: Client;
  let analista: Client;
  let pedro: Client;
  let s: Scenario;
  const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

  const login = async (email: string) => {
    const c = new Client(t.baseUrl);
    expect((await c.post('/auth/login', { email, password: STRONG_PASSWORD })).status).toBe(200);
    return c;
  };
  const send = (who: Client, code: string, name = 'foto.pdf', bytes = pdf()) =>
    who.upload<View & { code?: string }>(`/ideas/${code}/attachments`, name, bytes, 'application/pdf');
  const list = async (who: Client, code: string) => who.get<List>(`/ideas/${code}/attachments`);
  const newIdea = async (title: string) => {
    const r = await maria.post<{ code: string }>('/ideas', {
      title,
      description: 'Situação com foto.',
      entityId: s.ent.A1,
      categoryId: s.cat.Qualidade,
    });
    expect(r.status).toBe(201);
    return r.body.code;
  };

  beforeAll(async () => {
    t = await createTestApp();
    admin = new Client(t.baseUrl);
    expect((await admin.post('/install', INSTALL_INPUT)).status).toBe(200);
    s = await buildScenario(t, admin);
    maria = await login('maria@example.test');
    analista = await login('analista@example.test');
    pedro = await login('pedro@example.test');
  }, 180_000);
  afterAll(async () => {
    await t?.close();
  });

  it('CA-RN-146.1 e .7 ao enviar a ideia, o autor anexa 3 arquivos; eles aparecem na ideia e no histórico', async () => {
    const code = await newIdea('Ideia com três anexos');
    for (const n of [1, 2, 3]) expect((await send(maria, code, `foto-${n}.pdf`, pdf(n))).status).toBe(201);
    const got = await list(maria, code);
    expect(got.status).toBe(200);
    expect(got.body.items.map((a) => [a.originalName, a.stepId, a.deletable])).toEqual([
      ['foto-1.pdf', null, true],
      ['foto-2.pdf', null, true],
      ['foto-3.pdf', null, true],
    ]);
    expect([got.body.canUpload, got.body.limit]).toEqual([true, 10]);
    const timeline = (
      await maria.get<{ type: string; data: { position: number | null; name: string } }[]>(`/ideas/${code}/timeline`)
    ).body.filter((e) => e.type === 'attachment_added');
    expect(timeline.map((e) => [e.data.position, e.data.name])).toEqual([
      [null, 'foto-1.pdf'],
      [null, 'foto-2.pdf'],
      [null, 'foto-3.pdf'],
    ]);
    // O download segue a mesma permissão de ver a ideia.
    const file = await maria.raw(`/ideas/${code}/attachments/${got.body.items[0]?.id}/download`);
    expect(file.status).toBe(200);
  });

  it('CA-RN-146.3 o 11º anexo, a extensão fora da lista e o arquivo grande demais são recusados (negativo)', async () => {
    const code = await newIdea('Ideia no limite');
    for (let n = 1; n <= 10; n++) expect((await send(maria, code, `a-${n}.pdf`, pdf(n))).status).toBe(201);
    const eleventh = await send(maria, code, 'a-11.pdf');
    expect([eleventh.status, eleventh.body.code]).toEqual([422, 'attachment_limit']);
    expect((await list(maria, code)).body.canUpload).toBe(false);
    const other = await newIdea('Ideia com arquivo errado');
    expect((await send(maria, other, 'script.exe', Buffer.from('MZ'))).status).toBe(415);
    expect((await admin.request('PATCH', '/settings', { values: { 'attachments.max_mb': 1 } })).status).toBe(200);
    expect((await send(maria, other, 'grande.pdf', Buffer.alloc(1024 * 1024 + 10, 1))).status).toBe(413);
    expect((await admin.request('PATCH', '/settings', { values: { 'attachments.max_mb': 10 } })).status).toBe(200);
  });

  it('CA-RN-146.4 o autor anexa só em Enviada ou Em análise; quem tria anexa até encerrar (negativo nos dois)', async () => {
    const code = await newIdea('Ideia que vai andar');
    expect((await send(maria, code)).status).toBe(201);
    const approved = await analista.post(`/ideas/${code}/approve`, {
      stepName: 'Executar',
      assigneeId: s.uid.analista,
      dueDate: day(10),
    });
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    expect((await send(maria, code)).status).toBe(403);
    expect((await list(maria, code)).body.canUpload).toBe(false);
    expect((await send(analista, code, 'da-equipe.pdf')).status).toBe(201);
    // Encerrada (i2 está implementada): ninguém anexa.
    expect((await send(admin, s.code.i2)).status).toBe(409);
  });

  it('CA-RN-146.5 remover: quem enviou (em Enviada ou Em análise) e quem tria; outra pessoa não (negativo)', async () => {
    const code = await newIdea('Ideia para remover anexos');
    const mine = (await send(maria, code, 'meu.pdf')).body;
    const team = (await send(analista, code, 'da-equipe.pdf')).body;
    // A autora vê o anexo da equipe sem poder removê-lo.
    const seen = (await list(maria, code)).body.items;
    expect(seen.map((a) => [a.originalName, a.deletable])).toEqual([
      ['meu.pdf', true],
      ['da-equipe.pdf', false],
    ]);
    expect((await maria.request('DELETE', `/ideas/${code}/attachments/${team.id}`)).status).toBe(403);
    expect((await maria.request('DELETE', `/ideas/${code}/attachments/${mine.id}`)).status).toBe(204);
    expect((await analista.request('DELETE', `/ideas/${code}/attachments/${team.id}`)).status).toBe(204);
    expect((await list(maria, code)).body.items).toHaveLength(0);
    const removed = (await maria.get<{ type: string }[]>(`/ideas/${code}/timeline`)).body.filter(
      (e) => e.type === 'attachment_removed',
    );
    expect(removed).toHaveLength(2);
  });

  it('CA-RN-147.3 e .7 imagem e vídeo abrem na tela, com faixa; extensões de fábrica têm mp4 e webm', async () => {
    const pub = await new Client(t.baseUrl).get<{ attachments: { allowedExtensions: string[] } }>('/settings/public');
    expect(pub.body.attachments.allowedExtensions).toEqual(expect.arrayContaining(['mp4', 'webm']));
    const code = await newIdea('Ideia com foto e vídeo');
    const png = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#0f766e' } })
      .png()
      .toBuffer();
    const photo = await maria.upload<View & { viewable: boolean }>(
      `/ideas/${code}/attachments`,
      'foto.png',
      png,
      'image/png',
    );
    expect([photo.status, photo.body.viewable]).toEqual([201, true]);
    const shown = await maria.raw(`/ideas/${code}/attachments/${photo.body.id}/view`);
    expect(shown.status).toBe(200);
    expect(shown.headers.get('content-type')).toBe('image/png');
    expect(shown.headers.get('content-disposition')).toBe('inline');
    expect(shown.headers.get('x-content-type-options')).toBe('nosniff');
    expect(shown.headers.get('content-security-policy')).toContain('sandbox');
    expect(shown.headers.get('cache-control')).toContain('private');
    expect(Buffer.from(await shown.arrayBuffer()).equals(png)).toBe(true);

    const mp4 = Buffer.concat([
      Buffer.from('\x00\x00\x00\x20ftypisom\x00\x00\x02\x00', 'latin1'),
      Buffer.alloc(4000, 7),
    ]);
    const video = await maria.upload<View & { viewable: boolean }>(
      `/ideas/${code}/attachments`,
      'v.mp4',
      mp4,
      'video/mp4',
    );
    expect([video.status, video.body.viewable]).toEqual([201, true]);
    const part = await fetch(`${t.baseUrl}/api/ideas/${code}/attachments/${video.body.id}/view`, {
      headers: { cookie: maria.cookie ?? '', range: 'bytes=0-99' },
    });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-type')).toBe('video/mp4');
    expect(part.headers.get('content-range')).toBe(`bytes 0-99/${mp4.length}`);
    expect((await part.arrayBuffer()).byteLength).toBe(100);
    const outside = await fetch(`${t.baseUrl}/api/ideas/${code}/attachments/${video.body.id}/view`, {
      headers: { cookie: maria.cookie ?? '', range: `bytes=${mp4.length + 10}-` },
    });
    expect(outside.status).toBe(416);
  });

  it('CA-RN-147.4 e .5 HTML com nome de imagem e PDF não abrem na tela; quem não vê a ideia não abre (negativo)', async () => {
    const code = await newIdea('Ideia com arquivo disfarçado');
    const fake = await maria.upload<View & { viewable: boolean }>(
      `/ideas/${code}/attachments`,
      'disfarce.png',
      Buffer.from('<html><body><script>alert(1)</script></body></html>'),
      'image/png',
    );
    expect(fake.status).toBe(201);
    const refused = await maria.raw(`/ideas/${code}/attachments/${fake.body.id}/view`);
    expect(refused.status).toBe(415);
    expect(refused.headers.get('content-disposition')).not.toBe('inline');
    const doc = await send(maria, code, 'doc.pdf');
    expect((doc.body as unknown as { viewable: boolean }).viewable).toBe(false);
    expect((await maria.raw(`/ideas/${code}/attachments/${doc.body.id}/view`)).status).toBe(415);
    // O download do disfarçado continua (como arquivo, nunca exibido).
    expect(
      (await maria.raw(`/ideas/${code}/attachments/${fake.body.id}/download`)).headers.get('content-disposition'),
    ).toContain('attachment');
    expect((await pedro.raw(`/ideas/${code}/attachments/${fake.body.id}/view`)).status).toBe(404);
  });

  it('CA-RN-146.6 quem não vê a ideia não lista, não envia, não baixa nem remove (negativo, CA-T.5)', async () => {
    const code = await newIdea('Ideia do setor A1 com anexo');
    const a = (await send(maria, code)).body;
    expect((await list(pedro, code)).status).toBe(404);
    expect((await send(pedro, code)).status).toBe(404);
    expect((await pedro.raw(`/ideas/${code}/attachments/${a.id}/download`)).status).toBe(404);
    expect((await pedro.request('DELETE', `/ideas/${code}/attachments/${a.id}`)).status).toBe(404);
  });
});
