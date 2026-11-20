import 'reflect-metadata';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditLog } from '../../src/audit/audit-log.entity.js';
import { Role } from '../../src/identity-access/entities/role.entity.js';
import { User } from '../../src/identity-access/entities/user.entity.js';
import { UserAvatar } from '../../src/identity-access/entities/user-avatar.entity.js';
import { UserRoleScope } from '../../src/identity-access/entities/user-role-scope.entity.js';
import { hashPassword } from '../../src/identity-access/password.js';
import { OrgEntity } from '../../src/organization/entities/org-entity.entity.js';
import { Client, createTestApp, INSTALL_INPUT, STRONG_PASSWORD, type TestApp } from '../support/test-app.js';

interface Me {
  id: string;
  photoVersion: string | null;
}

const avatarFiles = () => {
  try {
    return readdirSync(join(process.env.STORAGE_DIR ?? '', 'avatars'));
  } catch {
    return [];
  }
};

/** Fotos de teste, geradas na hora (nenhum arquivo real no repositório). */
const base = (w = 400, h = 300) => sharp({ create: { width: w, height: h, channels: 3, background: '#4f46e5' } });
const jpegWithExif = () =>
  base()
    .jpeg()
    .withMetadata({ exif: { IFD0: { Copyright: 'Segredo do fotógrafo', Artist: 'Fulano' } } })
    .toBuffer();
const png = () => base().png().toBuffer();
const webp = () => base(120, 120).webp().toBuffer();
const noise = async (side: number) => {
  const raw = Buffer.alloc(side * side * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = Math.floor(Math.random() * 256);
  return sharp(raw, { raw: { width: side, height: side, channels: 3 } })
    .png({ compressionLevel: 0 })
    .toBuffer();
};

describe('Foto do perfil (M5, RN-91)', () => {
  let t: TestApp;
  let admin: Client;
  const c: Record<string, Client> = {};
  const uid: Record<string, string> = {};

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
  const put = (who: Client, userId: string, name: string, bytes: Buffer, type = 'image/jpeg') =>
    who.upload<{ version?: string; code?: string }>(`/users/${userId}/photo`, name, bytes, type, 'PUT');
  const photo = (who: Client, userId: string) => who.raw(`/users/${userId}/photo`);

  beforeAll(async () => {
    t = await createTestApp();
    admin = new Client(t.baseUrl);
    expect((await admin.post('/install', INSTALL_INPUT)).status).toBe(200);
    const org = await t.db.dataSource.getRepository(OrgEntity).findOneByOrFail({ name: 'Org' });
    await user('colab1', 'collaborator', org.id);
    await user('colab2', 'collaborator', org.id);
    await user('oculto', 'collaborator', org.id);
  });
  afterAll(async () => {
    await t?.close();
  });

  it('CA-RN-91.1 JPG, PNG e WebP são aceitos; a foto sai em WebP 256×256, sem metadados', async () => {
    const original = await jpegWithExif();
    expect((await sharp(original).metadata()).exif).toBeDefined(); // o original TEM metadados
    const res = await put(c.colab1!, uid.colab1!, 'foto.jpg', original);
    expect(res.status).toBe(200);
    expect(res.body.version).toMatch(/^u\d+$/); // origem (u = enviada, RN-144) + carimbo

    const got = await photo(c.colab1!, uid.colab1!);
    expect(got.status).toBe(200);
    expect(got.headers.get('content-type')).toBe('image/webp');
    expect(got.headers.get('x-content-type-options')).toBe('nosniff');
    const saved = Buffer.from(await got.arrayBuffer());
    const meta = await sharp(saved).metadata();
    expect(meta).toMatchObject({ format: 'webp', width: 256, height: 256 });
    expect(meta.exif).toBeUndefined();
    expect(meta.icc).toBeUndefined();
    expect(saved.includes(Buffer.from('Segredo do fotógrafo'))).toBe(false);

    expect((await put(c.colab2!, uid.colab2!, 'foto.png', await png(), 'image/png')).status).toBe(200);
    expect((await put(c.colab2!, uid.colab2!, 'foto.webp', await webp(), 'image/webp')).status).toBe(200);
  });

  it('CA-RN-91.2 SVG, PDF e executável renomeado como .jpg → 415; o tipo vem do conteúdo, não da extensão', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>',
    );
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF');
    const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200, 1)]);
    const cases: [string, Buffer, string][] = [
      ['logo.svg', svg, 'image/svg+xml'],
      ['logo.jpg', svg, 'image/jpeg'], // SVG disfarçado de JPG, com o tipo mentindo
      ['doc.pdf', pdf, 'application/pdf'],
      ['doc.jpg', pdf, 'image/jpeg'],
      ['programa.jpg', exe, 'image/jpeg'],
      ['vazio.png', Buffer.alloc(0), 'image/png'],
      ['lixo.webp', Buffer.from('isto não é uma imagem'), 'image/webp'],
    ];
    for (const [name, bytes, type] of cases) {
      const res = await put(c.colab1!, uid.colab1!, name, bytes, type);
      expect([name, res.status]).toEqual([name, 415]);
    }
    // A foto anterior continua valendo depois das tentativas recusadas.
    expect((await photo(c.colab1!, uid.colab1!)).status).toBe(200);
  });

  it('CA-RN-91.2 acima do limite configurado → 413 (e o limite é configurável)', async () => {
    const big = await noise(1000); // ~3 MB sem compressão
    expect(big.length).toBeGreaterThan(2 * 1024 * 1024);
    const refused = await put(c.colab1!, uid.colab1!, 'grande.png', big, 'image/png');
    expect(refused.status).toBe(413);
    expect((await admin.request('PATCH', '/settings', { values: { 'profile.photo_max_mb': 5 } })).status).toBe(200);
    expect((await put(c.colab1!, uid.colab1!, 'grande.png', big, 'image/png')).status).toBe(200);
    expect((await admin.request('PATCH', '/settings', { values: { 'profile.photo_max_mb': 2 } })).status).toBe(200);
    expect((await admin.request('PATCH', '/settings', { values: { 'profile.photo_max_mb': 99 } })).status).toBe(400);
    expect((await admin.get<{ profilePhotoMaxMb: number }>('/settings/public')).body.profilePhotoMaxMb).toBe(2);
  });

  it('CA-RN-91.3 trocar a foto apaga o arquivo anterior; no máximo 1 registro por usuário', async () => {
    const countRows = (id: string) => t.db.dataSource.getRepository(UserAvatar).countBy({ userId: id });
    const before = avatarFiles();
    const oldName = (await t.db.dataSource.getRepository(UserAvatar).findOneByOrFail({ userId: uid.colab1! }))
      .storedName;
    expect(before).toContain(oldName);
    expect((await put(c.colab1!, uid.colab1!, 'nova.png', await png(), 'image/png')).status).toBe(200);
    const now = await t.db.dataSource.getRepository(UserAvatar).findOneByOrFail({ userId: uid.colab1! });
    expect(now.storedName).not.toBe(oldName);
    expect(avatarFiles()).not.toContain(oldName);
    expect(avatarFiles()).toContain(now.storedName);
    expect(await countRows(uid.colab1!)).toBe(1);
    expect(avatarFiles()).toHaveLength(2); // colab1 e colab2: um arquivo por pessoa
    // O nome gravado é gerado (nunca o enviado) e a tabela guarda o que foi salvo.
    expect(now).toMatchObject({ mime: 'image/webp', width: 256, height: 256 });
    expect(now.storedName).toMatch(/^[0-9a-f-]{36}\.webp$/);
    expect(now.sizeBytes).toBeGreaterThan(0);
  });

  it('CA-RN-91.4 colab1 não altera a foto de colab2 (403); o administrador altera; remover vale só para quem pode', async () => {
    expect((await put(c.colab1!, uid.colab2!, 'x.png', await png(), 'image/png')).status).toBe(403);
    expect((await c.colab1!.request('DELETE', `/users/${uid.colab2}/photo`)).status).toBe(403);
    expect((await put(admin, uid.colab2!, 'rh.png', await png(), 'image/png')).status).toBe(200);
    expect((await put(admin, '3b241101-e2bb-4255-8caf-4136c566a962', 'x.png', await png(), 'image/png')).status).toBe(
      404,
    );
    expect((await put(new Client(t.baseUrl), uid.colab1!, 'x.png', await png(), 'image/png')).status).toBe(401);
    const noFile = await c.colab1!.request('PUT', `/users/${uid.colab1}/photo`, {});
    expect([415, 422, 400]).toContain(noFile.status);
  });

  it('CA-RN-91.5 a rota exige login; quem ocultou o nome só aparece para si e para a administração', async () => {
    expect((await new Client(t.baseUrl).raw(`/users/${uid.colab1}/photo`)).status).toBe(401);
    expect((await photo(c.colab2!, uid.colab1!)).status).toBe(200); // logado vê a foto de outra pessoa

    expect((await put(c.oculto!, uid.oculto!, 'o.png', await png(), 'image/png')).status).toBe(200);
    await t.db.dataSource.getRepository(User).update(uid.oculto!, { hideName: true });
    expect((await photo(c.colab1!, uid.oculto!)).status).toBe(404); // a tela mostra as iniciais
    expect((await photo(c.oculto!, uid.oculto!)).status).toBe(200);
    expect((await photo(admin, uid.oculto!)).status).toBe(200);
    // Quem nunca enviou foto também recebe 404 (a tela mostra as iniciais).
    const adminId = (await admin.get<Me>('/auth/me')).body.id;
    expect((await photo(c.colab1!, adminId)).status).toBe(404);
  });

  it('o "me" informa a versão da foto (nulo sem foto) e ela muda a cada troca', async () => {
    const fresh = new Client(t.baseUrl);
    expect(
      (await fresh.post<Me>('/auth/login', { email: 'admin@example.test', password: STRONG_PASSWORD })).body
        .photoVersion,
    ).toBeNull();
    const v1 = (await c.colab2!.get<Me>('/auth/me')).body.photoVersion;
    expect(v1).toMatch(/^u\d+$/);
    await new Promise((r) => setTimeout(r, 15));
    await put(c.colab2!, uid.colab2!, 'outra.png', await png(), 'image/png');
    expect((await c.colab2!.get<Me>('/auth/me')).body.photoVersion).not.toBe(v1);
  });

  it('remover a foto apaga registro e arquivo; a auditoria registra sem guardar a imagem', async () => {
    const stored = (await t.db.dataSource.getRepository(UserAvatar).findOneByOrFail({ userId: uid.colab2! }))
      .storedName;
    expect((await c.colab2!.request('DELETE', `/users/${uid.colab2}/photo`)).status).toBe(204);
    expect(avatarFiles()).not.toContain(stored);
    expect(await t.db.dataSource.getRepository(UserAvatar).countBy({ userId: uid.colab2! })).toBe(0);
    expect((await photo(c.colab2!, uid.colab2!)).status).toBe(404);
    expect((await c.colab2!.get<Me>('/auth/me')).body.photoVersion).toBeNull();
    const actions = (await t.db.dataSource.getRepository(AuditLog).find()).map((a) => a.action);
    expect(actions).toContain('user.photo_changed');
    expect(actions).toContain('user.photo_removed');
    expect(JSON.stringify(await t.db.dataSource.getRepository(AuditLog).find())).not.toContain('Segredo do fotógrafo');
  });

  it('CA-RN-91.6 / CA-RN-40.1 anonimizar apaga a foto (registro e arquivo)', async () => {
    const stored = (await t.db.dataSource.getRepository(UserAvatar).findOneByOrFail({ userId: uid.oculto! }))
      .storedName;
    expect(avatarFiles()).toContain(stored);
    expect((await admin.post(`/users/${uid.oculto}/disable`)).status).toBe(200);
    const res = await admin.post<{ name: string; status: string }>(`/users/${uid.oculto}/anonymize`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: 'Ex-colaborador', status: 'anonymized' });
    expect(await t.db.dataSource.getRepository(UserAvatar).countBy({ userId: uid.oculto! })).toBe(0);
    expect(avatarFiles()).not.toContain(stored);
    expect((await photo(admin, uid.oculto!)).status).toBe(404);
  });
});
