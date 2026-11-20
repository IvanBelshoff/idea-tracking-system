import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

const isoDate = z.iso.date();

export const RankingQuerySchema = z.object({
  scope: z.enum(['individual', 'entity']).default('individual'),
  period: z.enum(['season', 'all']).default('season'),
});

export const LevelsSchema = z
  .object({
    levels: z
      .array(z.object({ name: z.string().trim().min(1).max(80), minPoints: z.number().int().min(0).max(1_000_000) }))
      .min(1)
      .max(20),
  })
  .refine((v) => new Set(v.levels.map((l) => l.minPoints)).size === v.levels.length, {
    path: ['levels'],
    message: 'Cada nível precisa de uma pontuação mínima diferente.',
  })
  .refine((v) => v.levels.some((l) => l.minPoints === 0), {
    path: ['levels'],
    message: 'Um dos níveis precisa começar em 0 pontos.',
  });

export const AchievementSchema = z.object({
  code: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9_]{2,60}$/, 'Use letras, números e _'),
  name: z.string().trim().min(1).max(120),
  description: z
    .string()
    .trim()
    .max(2000)
    .nullish()
    .transform((v) => v || null),
  ruleType: z.enum(['ideas_submitted', 'ideas_implemented', 'points']),
  threshold: z.number().int().min(1).max(1_000_000),
  active: z.boolean().default(true),
});

export const SeasonSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    startsOn: isoDate,
    endsOn: isoDate,
    campaignId: z
      .uuid()
      .nullish()
      .transform((v) => v ?? null),
  })
  .refine((s) => s.endsOn >= s.startsOn, { path: ['endsOn'], message: 'O fim não pode ser antes do início.' });

export const RewardSchema = z.object({
  userId: z.uuid(),
  ideaRef: z
    .string()
    .trim()
    .max(64)
    .nullish()
    .transform((v) => v || null),
  description: z.string().trim().min(1, 'Descreva a recompensa.').max(500),
  grantedOn: isoDate,
});

// --- OpenAPI ---------------------------------------------------------------------------------------

export class LevelView {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() minPoints!: number;
}
export class LevelInput {
  @ApiProperty() name!: string;
  @ApiProperty() minPoints!: number;
}
export class LevelsRequest {
  @ApiProperty({ type: [LevelInput] }) levels!: LevelInput[];
}

export class AchievementView {
  @ApiProperty() id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: String, nullable: true }) description!: string | null;
  @ApiProperty({ enum: ['ideas_submitted', 'ideas_implemented', 'points'] }) ruleType!: string;
  @ApiProperty() threshold!: number;
  @ApiProperty() active!: boolean;
  @ApiProperty({ description: 'Quantas pessoas já têm' }) holders!: number;
}
export class AchievementRequest {
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: String, nullable: true, required: false }) description?: string | null;
  @ApiProperty({ enum: ['ideas_submitted', 'ideas_implemented', 'points'] }) ruleType!: string;
  @ApiProperty() threshold!: number;
  @ApiProperty({ required: false }) active?: boolean;
}
export class GrantResult {
  @ApiProperty({ description: 'Pessoas que receberam a conquista agora' }) granted!: number;
}

export class SeasonView {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ format: 'date' }) startsOn!: string;
  @ApiProperty({ format: 'date' }) endsOn!: string;
  @ApiProperty({ type: String, nullable: true }) campaignId!: string | null;
  @ApiProperty({ description: 'É a temporada de hoje' }) current!: boolean;
}
export class SeasonRequest {
  @ApiProperty() name!: string;
  @ApiProperty({ format: 'date' }) startsOn!: string;
  @ApiProperty({ format: 'date' }) endsOn!: string;
  @ApiProperty({ type: String, nullable: true, required: false }) campaignId?: string | null;
}

export class RewardView {
  @ApiProperty() id!: string;
  @ApiProperty() userName!: string;
  @ApiProperty({ type: String, nullable: true }) ideaCode!: string | null;
  @ApiProperty() description!: string;
  @ApiProperty({ format: 'date' }) grantedOn!: string;
  @ApiProperty({ type: String, nullable: true }) registeredBy!: string | null;
}
export class RewardRequest {
  @ApiProperty({ format: 'uuid' }) userId!: string;
  @ApiProperty({ type: String, nullable: true, required: false, description: 'Código da ideia (opcional)' })
  ideaRef?: string | null;
  @ApiProperty({ description: 'O que foi concedido (texto livre, sem valor obrigatório)' }) description!: string;
  @ApiProperty({ format: 'date' }) grantedOn!: string;
}

export class MyAchievement {
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: String, nullable: true }) description!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true, description: 'Nulo = ainda não conquistada' })
  grantedAt!: string | null;
}
export class LedgerEntry {
  @ApiProperty({ enum: ['idea_submitted', 'idea_approved', 'idea_implemented', 'idea_highlighted'] })
  eventType!: string;
  @ApiProperty() points!: number;
  @ApiProperty({ type: String, nullable: true }) ideaCode!: string | null;
  @ApiProperty({ type: String, nullable: true }) ideaTitle!: string | null;
  @ApiProperty({ format: 'date-time' }) at!: string;
}
export class LevelRef {
  @ApiProperty() name!: string;
  @ApiProperty() minPoints!: number;
}
export class MyRecognition {
  @ApiProperty() totalPoints!: number;
  @ApiProperty({ type: Number, nullable: true, description: 'Pontos na temporada de hoje; nulo sem temporada' })
  seasonPoints!: number | null;
  @ApiProperty({ type: SeasonView, nullable: true }) season!: SeasonView | null;
  @ApiProperty({ type: LevelRef, nullable: true }) level!: LevelRef | null;
  @ApiProperty({ type: LevelRef, nullable: true }) nextLevel!: LevelRef | null;
  @ApiProperty({ type: [MyAchievement] }) achievements!: MyAchievement[];
  @ApiProperty({ type: [LedgerEntry], description: 'Últimos lançamentos' }) recent!: LedgerEntry[];
  @ApiProperty({ type: [RewardView] }) rewards!: RewardView[];
  @ApiProperty({ description: 'O nome aparece em murais e rankings (opt-out, RN-70)' }) nameVisible!: boolean;
}

export class RankingRow {
  @ApiProperty() position!: number;
  @ApiProperty({ type: String, nullable: true, description: 'Nulo = pessoa que oculta o nome (RN-70)' })
  name!: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'A pessoa (só quando o nome aparece; nulo no ranking por entidade)',
  })
  userId!: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Versão da foto (RN-142); nula = iniciais ou ícone genérico',
  })
  photoVersion!: string | null;
  @ApiProperty() points!: number;
  @ApiProperty() isMe!: boolean;
}
export class Ranking {
  @ApiProperty({ enum: ['individual', 'entity'] }) scope!: string;
  @ApiProperty({ enum: ['season', 'all'] }) period!: string;
  @ApiProperty({ type: SeasonView, nullable: true }) season!: SeasonView | null;
  @ApiProperty({ type: [RankingRow] }) rows!: RankingRow[];
}
