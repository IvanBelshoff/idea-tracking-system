// Gera a geometria do símbolo do ITS (três pás) e os arquivos que dependem dela.
// Uso: node scripts/gen-symbol.mjs   (rode de novo só se mudar a silhueta abaixo)
//
// Saídas:
//   src/components/brand/its-symbol-path.ts  caminho de uma pá (as outras são rotações de 120°)
//   public/favicon.svg                       pás brancas sobre o quadrado na cor da marca
import { writeFileSync } from 'node:fs';

const N = 3; // número de pás: ideia → ação → resultado
const R = 14.8; // raio do aro na grade 32×32
const f = (v) => Math.round(v * 100) / 100;
const pt = (r, deg) => {
  const a = (deg * Math.PI) / 180;
  return [16 + r * Math.sin(a), 16 - r * Math.cos(a)];
};
const xy = (p) => `${f(p[0])} ${f(p[1])}`;
const dist = (u, v) => Math.hypot(u[0] - v[0], u[1] - v[1]);

// Silhueta da pá, reinterpretada do símbolo antigo. [graus a partir da cauda (para 5 pás; o script
// abre proporcionalmente), raio em fração do aro, 1 = canto vivo].
const SILHUETA = [
  [0, 1, 1], // ponta da cauda, no aro
  [14, 1],
  [33, 0.985],
  [50, 0.94],
  [66, 0.87],
  [78, 0.8],
  [85, 0.72], // nariz redondo
  [87, 0.665],
  [85, 0.615],
  [77, 0.585],
  [62, 0.535],
  [45, 0.49],
  [23, 0.455],
  [7, 0.44],
  [-5, 0.43, 1], // ponta de dentro, apontando para trás
  [4, 0.5],
  [19, 0.575],
  [29, 0.65],
  [32, 0.7], // fundo do encaixe, onde entra o nariz da pá anterior
  [29, 0.765],
  [22, 0.855],
  [12, 0.94],
];

const k = 360 / N / 72;
const pts = SILHUETA.map(([a, r, c]) => ({ p: pt(R * r, a * k), c: c === 1 }));
const L = pts.length;
const at = (i) => pts[(i + L) % L];
// Catmull-Rom com tangente unitária ponderada pelo comprimento (sem "calombos"); zero nos cantos.
const dir = (i) => {
  if (at(i).c) return [0, 0];
  const a = at(i - 1).p;
  const b = at(i + 1).p;
  const l = dist(a, b);
  return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
};
let d = `M${xy(at(0).p)}`;
for (let i = 0; i < L; i++) {
  const p0 = at(i).p;
  const p1 = at(i + 1).p;
  const h = dist(p0, p1) / 3;
  const t0 = dir(i);
  const t1 = dir(i + 1);
  d += `C${xy([p0[0] + t0[0] * h, p0[1] + t0[1] * h])} ${xy([p1[0] - t1[0] * h, p1[1] - t1[1] * h])} ${xy(p1)}`;
}
d += 'Z';

const root = new URL('../', import.meta.url);
writeFileSync(
  new URL('src/components/brand/its-symbol-path.ts', root),
  `// Gerado por scripts/gen-symbol.mjs. Não edite à mão.\nexport const ITS_PA = '${d}';\nexport const ITS_PAS = ${N};\n`,
);
// O backend desenha os ícones do app na cor da organização (src/organization/app-icons.ts).
writeFileSync(
  new URL('../backend/src/organization/its-symbol-path.ts', root),
  `// Gerado por frontend/scripts/gen-symbol.mjs (cópia do caminho usado no frontend). Não edite à mão.\nexport const ITS_PA =\n  '${d}';\nexport const ITS_PAS = ${N};\n`,
);

const OPACITY = [1, 0.68, 0.36];
const pas = OPACITY.map(
  (o, i) => `    <path d="${d}" transform="rotate(${(360 / N) * i} 16 16)"${o < 1 ? ` opacity="${o}"` : ''}/>`,
).join('\n');
writeFileSync(
  new URL('public/favicon.svg', root),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" role="img">
  <title>ITS</title>
  <!-- Gerado por scripts/gen-symbol.mjs. Símbolo do ITS: três pás (ideia, ação, resultado) em ciclo. -->
  <rect width="32" height="32" rx="8" fill="#5458c8"/>
  <g fill="#fff" transform="translate(3.2 3.2) scale(0.8)">
${pas}
  </g>
</svg>
`,
);
console.log('ok');
