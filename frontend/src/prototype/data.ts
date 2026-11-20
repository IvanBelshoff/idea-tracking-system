// DADOS FICTÍCIOS para os protótipos do M0V. Nenhum nome, empresa ou valor é real.
// Descartável: será substituído pela API a partir do M1.

export type IdeaStatus = 'submitted' | 'in_review' | 'in_progress' | 'implemented' | 'rejected';

export interface Step {
  position: number;
  name: string;
  assignee: string;
  startDate: string;
  dueDate: string;
  completedAt?: string;
}

export interface TimelineEvent {
  at: string;
  actor: string;
  text: string;
  internal?: boolean;
}

export interface Comment {
  at: string;
  author: string;
  body: string;
  internal: boolean;
}

export interface Idea {
  code: string;
  title: string;
  description: string;
  proposedSolution?: string;
  status: IdeaStatus;
  entity: string;
  category: string;
  author: string;
  coAuthors: string[];
  assignedTo?: string;
  submittedAt: string;
  slaDueAt?: string;
  impact?: number;
  effort?: number;
  supporters: number;
  steps: Step[];
  timeline: TimelineEvent[];
  comments: Comment[];
  rejectionReason?: string;
  result?: string;
}

export const TODAY = '2026-11-04';
export const CURRENT_USER = 'Ana Souza';

export const ENTITIES = ['Unidade Norte / Montagem', 'Unidade Norte / Expedição', 'Unidade Sul / Manutenção'];
export const CATEGORIES = ['Segurança', 'Qualidade', 'Entrega', 'Custo', 'Meio ambiente', 'Pessoas'];
export const CAMPAIGNS = ['Desafio Segurança em Primeiro Lugar (até 30/11)'];

export const IDEAS: Idea[] = [
  {
    code: 'ITS-2026-0042',
    title: 'Substituição de lâmpada no corredor B',
    description: 'A lâmpada do corredor B queima com frequência e o local fica escuro no turno da noite.',
    proposedSolution: 'Trocar por luminária LED com sensor de presença.',
    status: 'in_progress',
    entity: 'Unidade Norte / Expedição',
    category: 'Segurança',
    author: 'Ana Souza',
    coAuthors: ['Bruno Lima'],
    assignedTo: 'Carla Mendes',
    submittedAt: '2026-09-20',
    impact: 4,
    effort: 2,
    supporters: 2,
    steps: [
      {
        position: 1,
        name: 'Levantamento dos pontos de luz',
        assignee: 'Carla Mendes',
        startDate: '2026-10-01',
        dueDate: '2026-10-10',
        completedAt: '2026-10-09',
      },
      {
        position: 2,
        name: 'Compra das luminárias',
        assignee: 'Diego Alves',
        startDate: '2026-10-11',
        dueDate: '2026-10-30',
      },
    ],
    timeline: [
      { at: '2026-09-20', actor: 'Ana Souza', text: 'Ideia enviada' },
      { at: '2026-09-22', actor: 'Carla Mendes', text: 'Triagem iniciada' },
      { at: '2026-09-25', actor: 'Bruno Lima', text: 'Apoiou esta ideia (convergência)' },
      { at: '2026-09-30', actor: 'Carla Mendes', text: 'Ideia aprovada; 1ª etapa criada' },
      { at: '2026-10-09', actor: 'Carla Mendes', text: 'Etapa 1 concluída' },
      { at: '2026-10-11', actor: 'Carla Mendes', text: 'Prazo alterado de 10/10 para 30/10', internal: true },
    ],
    comments: [
      {
        at: '2026-09-23',
        author: 'Carla Mendes',
        body: 'Obrigada pela ideia! Vamos verificar com a manutenção.',
        internal: false,
      },
      { at: '2026-09-24', author: 'Carla Mendes', body: 'Orçamento de LED já previsto no trimestre.', internal: true },
    ],
  },
  {
    code: 'ITS-2026-0051',
    title: 'Checklist de setup da prensa',
    description: 'A troca de ferramenta da prensa demora muito porque cada turno faz de um jeito.',
    status: 'in_review',
    entity: 'Unidade Norte / Montagem',
    category: 'Entrega',
    author: 'Ana Souza',
    coAuthors: [],
    assignedTo: 'Carla Mendes',
    submittedAt: '2026-10-28',
    slaDueAt: '2026-11-07',
    impact: 3,
    effort: 1,
    supporters: 0,
    steps: [],
    timeline: [
      { at: '2026-10-28', actor: 'Ana Souza', text: 'Ideia enviada' },
      { at: '2026-10-30', actor: 'Carla Mendes', text: 'Triagem iniciada' },
    ],
    comments: [],
  },
  {
    code: 'ITS-2026-0047',
    title: 'Kit de limpeza no posto de solda',
    description: 'Falta material de limpeza perto do posto; o fim de turno atrasa.',
    status: 'implemented',
    entity: 'Unidade Norte / Montagem',
    category: 'Qualidade',
    author: 'Ana Souza',
    coAuthors: [],
    submittedAt: '2026-07-02',
    supporters: 1,
    steps: [
      {
        position: 1,
        name: 'Montagem do kit',
        assignee: 'Diego Alves',
        startDate: '2026-07-10',
        dueDate: '2026-07-20',
        completedAt: '2026-07-18',
      },
      {
        position: 2,
        name: 'Acompanhamento por 30 dias',
        assignee: 'Diego Alves',
        startDate: '2026-07-21',
        dueDate: '2026-08-20',
        completedAt: '2026-08-19',
      },
    ],
    timeline: [
      { at: '2026-07-02', actor: 'Ana Souza', text: 'Ideia enviada' },
      { at: '2026-07-08', actor: 'Carla Mendes', text: 'Ideia aprovada' },
      { at: '2026-08-20', actor: 'Carla Mendes', text: 'Ideia implementada' },
    ],
    comments: [],
    result: 'Fim de turno 10 minutos mais curto; área organizada nas auditorias de agosto e setembro.',
  },
  {
    code: 'ITS-2026-0039',
    title: 'Piso epóxi na expedição',
    description: 'O piso atual é difícil de limpar e acumula sujeira.',
    status: 'rejected',
    entity: 'Unidade Norte / Expedição',
    category: 'Custo',
    author: 'Ana Souza',
    coAuthors: [],
    submittedAt: '2026-08-15',
    supporters: 0,
    steps: [],
    timeline: [
      { at: '2026-08-15', actor: 'Ana Souza', text: 'Ideia enviada' },
      { at: '2026-08-25', actor: 'Carla Mendes', text: 'Não autorizada' },
    ],
    comments: [],
    rejectionReason: 'Custo acima do orçamento deste ano. A ideia pode ser reavaliada no planejamento de 2027.',
  },
  {
    code: 'ITS-2026-0055',
    title: 'Proteção na correia da esteira de embalagem',
    description: 'Há risco de prensamento das mãos na correia exposta.',
    status: 'submitted',
    entity: 'Unidade Norte / Expedição',
    category: 'Segurança',
    author: 'Bruno Lima',
    coAuthors: [],
    submittedAt: '2026-10-20',
    slaDueAt: '2026-10-30',
    supporters: 3,
    steps: [],
    timeline: [{ at: '2026-10-20', actor: 'Bruno Lima', text: 'Ideia enviada' }],
    comments: [],
  },
  {
    code: 'ITS-2026-0058',
    title: 'Sinalização dos corredores de empilhadeira',
    description: 'Cruzamentos sem sinalização entre pedestres e empilhadeiras.',
    status: 'submitted',
    entity: 'Unidade Sul / Manutenção',
    category: 'Segurança',
    author: 'Elisa Rocha',
    coAuthors: [],
    submittedAt: '2026-11-01',
    slaDueAt: '2026-11-11',
    supporters: 0,
    steps: [],
    timeline: [{ at: '2026-11-01', actor: 'Elisa Rocha', text: 'Ideia enviada' }],
    comments: [],
  },
  {
    code: 'ITS-2026-0060',
    title: 'Reaproveitamento de paletes danificados',
    description: 'Paletes com uma tábua quebrada são descartados inteiros.',
    status: 'in_review',
    entity: 'Unidade Norte / Expedição',
    category: 'Meio ambiente',
    author: 'Diego Alves',
    coAuthors: [],
    assignedTo: 'Carla Mendes',
    submittedAt: '2026-10-25',
    slaDueAt: '2026-11-04',
    impact: 2,
    effort: 2,
    supporters: 1,
    steps: [],
    timeline: [{ at: '2026-10-25', actor: 'Diego Alves', text: 'Ideia enviada' }],
    comments: [],
  },
];

export const findIdea = (code: string) => IDEAS.find((i) => i.code === code);

/** Prazo da ideia = data prevista da última etapa (RN-17). */
export const deadlineOf = (idea: Idea) => idea.steps.at(-1)?.dueDate;

/** Atraso só para ideias em andamento com etapa aberta vencida (RN-18). */
export const isLate = (idea: Idea) => {
  const last = idea.steps.at(-1);
  return idea.status === 'in_progress' && !!last && !last.completedAt && last.dueDate < TODAY;
};

/** Triagem fora do prazo de retorno (RN-54). */
export const isTriageLate = (idea: Idea) =>
  (idea.status === 'submitted' || idea.status === 'in_review') && !!idea.slaDueAt && idea.slaDueAt < TODAY;

/** Progresso por etapas concluídas (RN-19, modo "etapas"). */
export const progressOf = (idea: Idea) =>
  idea.steps.length === 0 ? 0 : Math.round((idea.steps.filter((s) => s.completedAt).length / idea.steps.length) * 100);

export const formatDate = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

/** Cores de categoria: configuráveis pela organização (aqui, um exemplo). Sempre acompanhadas do nome. */
export const CATEGORY_COLORS: Record<string, string> = {
  Segurança: 'oklch(0.72 0.17 60)',
  Qualidade: 'oklch(0.58 0.15 250)',
  Entrega: 'oklch(0.62 0.12 195)',
  Custo: 'oklch(0.6 0.14 140)',
  'Meio ambiente': 'oklch(0.55 0.12 155)',
  Pessoas: 'oklch(0.62 0.16 350)',
};

IDEAS.push(
  {
    code: 'ITS-2026-0044',
    title: 'Etiqueta de validade nos frascos de solvente',
    description: 'Frascos abertos ficam sem data e o solvente perde efeito.',
    status: 'in_progress',
    entity: 'Unidade Sul / Manutenção',
    category: 'Qualidade',
    author: 'Elisa Rocha',
    coAuthors: [],
    assignedTo: 'Carla Mendes',
    submittedAt: '2026-09-02',
    impact: 3,
    effort: 1,
    supporters: 4,
    steps: [
      {
        position: 1,
        name: 'Modelo de etiqueta',
        assignee: 'Elisa Rocha',
        startDate: '2026-09-15',
        dueDate: '2026-09-25',
        completedAt: '2026-09-24',
      },
      {
        position: 2,
        name: 'Treinamento dos turnos',
        assignee: 'Carla Mendes',
        startDate: '2026-09-26',
        dueDate: '2026-11-20',
      },
    ],
    timeline: [{ at: '2026-09-02', actor: 'Elisa Rocha', text: 'Ideia enviada' }],
    comments: [],
  },
  {
    code: 'ITS-2026-0049',
    title: 'Rodízio de pausas na linha de montagem',
    description: 'Todos param ao mesmo tempo e a linha fica parada 15 minutos.',
    status: 'in_review',
    entity: 'Unidade Norte / Montagem',
    category: 'Pessoas',
    author: 'Fábio Nunes',
    coAuthors: [],
    assignedTo: 'Gustavo Prado',
    submittedAt: '2026-10-22',
    slaDueAt: '2026-11-01',
    impact: 4,
    effort: 3,
    supporters: 6,
    steps: [],
    timeline: [{ at: '2026-10-22', actor: 'Fábio Nunes', text: 'Ideia enviada' }],
    comments: [],
  },
  {
    code: 'ITS-2026-0053',
    title: 'Reaproveitar água do teste de estanqueidade',
    description: 'A água do teste vai direto para o esgoto após um único uso.',
    status: 'submitted',
    entity: 'Unidade Sul / Manutenção',
    category: 'Meio ambiente',
    author: 'Helena Costa',
    coAuthors: [],
    submittedAt: '2026-10-31',
    slaDueAt: '2026-11-10',
    supporters: 2,
    steps: [],
    timeline: [{ at: '2026-10-31', actor: 'Helena Costa', text: 'Ideia enviada' }],
    comments: [],
  },
  {
    code: 'ITS-2026-0036',
    title: 'Gabarito para furação das tampas',
    description: 'A marcação manual gera retrabalho em 1 de cada 20 tampas.',
    status: 'implemented',
    entity: 'Unidade Norte / Montagem',
    category: 'Qualidade',
    author: 'Igor Martins',
    coAuthors: ['Fábio Nunes'],
    submittedAt: '2026-06-10',
    supporters: 9,
    steps: [
      {
        position: 1,
        name: 'Desenho do gabarito',
        assignee: 'Igor Martins',
        startDate: '2026-06-20',
        dueDate: '2026-07-05',
        completedAt: '2026-07-03',
      },
      {
        position: 2,
        name: 'Fabricação e teste',
        assignee: 'Diego Alves',
        startDate: '2026-07-06',
        dueDate: '2026-07-30',
        completedAt: '2026-07-28',
      },
    ],
    timeline: [{ at: '2026-06-10', actor: 'Igor Martins', text: 'Ideia enviada' }],
    comments: [],
    result: 'Retrabalho caiu de 5% para 0,4% das tampas.',
  },
);

/** Hall de destaques (RN-72 a RN-80). Ganhos fictícios, marcados como validados só para demonstração. */
export interface HallMeasure {
  value: number;
  unit: string;
  text: string;
}

export interface HallEntry {
  code: string;
  title: string;
  category: string;
  entity: string;
  authors: string[] | null; // null = o autor preferiu não aparecer (RN-70/74)
  implementedAt: string;
  likes: number;
  testimonial?: string;
  before: HallMeasure;
  after: HallMeasure;
  gain?: string;
}

export const HALL_FEATURED: HallEntry = {
  code: 'ITS-2026-0036',
  title: 'Gabarito para furação das tampas',
  category: 'Qualidade',
  entity: 'Unidade Norte / Montagem',
  authors: ['Igor Martins', 'Fábio Nunes'],
  implementedAt: '2026-07-28',
  likes: 41,
  testimonial: 'A gente marcava cada tampa no olho. Com o gabarito, o furo sai sempre no lugar.',
  before: { value: 5, unit: '%', text: 'das tampas com retrabalho' },
  after: { value: 0.4, unit: '%', text: 'das tampas com retrabalho' },
  gain: 'R$ 18.400 por ano, validado pela controladoria',
};

export const HALL_ENTRIES: HallEntry[] = [
  {
    code: 'ITS-2026-0031',
    title: 'Rampa móvel na doca 3',
    category: 'Segurança',
    entity: 'Unidade Norte / Expedição',
    authors: null,
    implementedAt: '2026-06-02',
    likes: 37,
    before: { value: 6, unit: 'ocorrências', text: 'quase-acidentes por trimestre' },
    after: { value: 0, unit: 'ocorrências', text: 'no último trimestre' },
  },
  {
    code: 'ITS-2026-0047',
    title: 'Kit de limpeza no posto de solda',
    category: 'Qualidade',
    entity: 'Unidade Norte / Montagem',
    authors: ['Ana Souza'],
    implementedAt: '2026-08-20',
    likes: 23,
    before: { value: 25, unit: 'min', text: 'para fechar o turno' },
    after: { value: 15, unit: 'min', text: 'para fechar o turno' },
  },
  {
    code: 'ITS-2026-0028',
    title: 'Coleta separada de luvas contaminadas',
    category: 'Meio ambiente',
    entity: 'Unidade Sul / Manutenção',
    authors: ['Helena Costa'],
    implementedAt: '2026-05-14',
    likes: 19,
    before: { value: 320, unit: 'kg', text: 'de resíduo comum por mês' },
    after: { value: 140, unit: 'kg', text: 'de resíduo comum por mês' },
  },
];

export const HALL_OF_FAME = [
  { year: 2025, title: 'Troca rápida de molde na injetora 2', entity: 'Unidade Norte / Montagem' },
  { year: 2025, title: 'Roteiro único de inspeção de empilhadeiras', entity: 'Unidade Sul / Manutenção' },
  { year: 2024, title: 'Carrinho kanban para parafusos', entity: 'Unidade Norte / Montagem' },
];

/** Painel de indicadores (RN-61 a RN-65): números fictícios para o protótipo. */
export const DASHBOARD = {
  period: 'jan. a out. de 2026',
  byStatus: { submitted: 18, in_review: 11, in_progress: 24, implemented: 63, rejected: 14 } as Record<
    IdeaStatus,
    number
  >,
  late: 5,
  triageOnTimePct: 86,
  avgDays: [
    { label: 'Envio até o primeiro retorno', days: 4.8, target: 10 },
    { label: 'Aprovação até a implementação', days: 38, target: 60 },
    { label: 'Envio até a implementação', days: 52, target: 90 },
  ],
  monthly: [
    { m: 'jan', sent: 9, done: 3 },
    { m: 'fev', sent: 11, done: 4 },
    { m: 'mar', sent: 14, done: 6 },
    { m: 'abr', sent: 12, done: 7 },
    { m: 'mai', sent: 16, done: 8 },
    { m: 'jun', sent: 13, done: 6 },
    { m: 'jul', sent: 15, done: 9 },
    { m: 'ago', sent: 12, done: 8 },
    { m: 'set', sent: 10, done: 6 },
    { m: 'out', sent: 18, done: 6 },
  ],
  byEntity: [
    { entity: 'Unidade Norte / Montagem', sent: 58, implemented: 31, onTimePct: 91 },
    { entity: 'Unidade Norte / Expedição', sent: 41, implemented: 17, onTimePct: 78 },
    { entity: 'Unidade Sul / Manutenção', sent: 31, implemented: 15, onTimePct: 88 },
  ],
};
