import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  checkPhotoSource,
  clamp,
  normalizeRotation,
  PHOTO_OUTPUT_SIZE,
  restrictCrop,
  rotatedSize,
} from './photo-crop.ts';

const MB = 1024 * 1024;

describe('Recorte da foto (RN-143)', () => {
  it('CA-RN-143.4 só JPG, PNG e WebP até 20 MB abrem o recorte', () => {
    assert.equal(checkPhotoSource({ type: 'image/jpeg', size: 5 * MB }), null);
    assert.equal(checkPhotoSource({ type: 'image/webp', size: 20 * MB }), null);
    assert.equal(checkPhotoSource({ type: 'image/png', size: 20 * MB + 1 }), 'tooBig');
    for (const type of ['image/svg+xml', 'application/pdf', 'image/gif', '']) {
      assert.equal(checkPhotoSource({ type, size: 10 }), 'wrongType', type);
    }
  });

  it('CA-RN-143.2 giro livre: qualquer ângulo vai para -180°..180°', () => {
    assert.equal(normalizeRotation(17), 17);
    assert.equal(normalizeRotation(-135), -135);
    assert.equal(normalizeRotation(270), -90);
    assert.equal(normalizeRotation(-270), 90);
    assert.equal(normalizeRotation(360), 0);
    assert.equal(normalizeRotation(180), 180);
    assert.equal(normalizeRotation(90 + 90 + 90 + 90), 0);
  });

  it('CA-RN-143.2 a caixa da imagem girada contém a imagem inteira (sem cortar os cantos)', () => {
    const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
    const r0 = rotatedSize(400, 300, 0);
    assert.ok(near(r0.width, 400) && near(r0.height, 300));
    const r90 = rotatedSize(400, 300, 90);
    assert.ok(near(r90.width, 300) && near(r90.height, 400));
    const r45 = rotatedSize(100, 100, 45);
    assert.ok(near(r45.width, Math.SQRT2 * 100) && near(r45.height, Math.SQRT2 * 100));
    const r17 = rotatedSize(400, 300, 17);
    assert.ok(r17.width > 400 && r17.height > 300);
  });

  it('CA-RN-143.3 mover pelos botões não deixa a imagem descobrir a área de recorte', () => {
    const media = { width: 300, height: 200 };
    const crop = { width: 200, height: 200 };
    // Zoom 1: sobra 100 px na largura (50 de cada lado) e nada na altura.
    assert.deepEqual(restrictCrop({ x: 80, y: 30 }, media, crop, 1, 0), { x: 50, y: 0 });
    assert.deepEqual(restrictCrop({ x: -80, y: -30 }, media, crop, 1, 0), { x: -50, y: 0 });
    // Zoom 2: sobra mais.
    assert.deepEqual(restrictCrop({ x: 80, y: 30 }, media, crop, 2, 0), { x: 80, y: 30 });
    // Girada 90°, largura e altura trocam.
    assert.deepEqual(restrictCrop({ x: 80, y: 80 }, media, crop, 1, 90), { x: 0, y: 50 });
  });

  it('o zoom fica entre 1x e 3x e a saída é um quadrado de 512 px', () => {
    assert.equal(clamp(0.5, 1, 3), 1);
    assert.equal(clamp(5, 1, 3), 3);
    assert.equal(clamp(2.2, 1, 3), 2.2);
    assert.equal(PHOTO_OUTPUT_SIZE, 512);
  });
});
