import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

const isoDate = z.iso.date();

export const HighlightSchema = z
  .object({
    ideaRef: z.string().trim().min(1).max(64),
    scope: z.enum(['entity', 'organization']),
    justification: z.string().trim().min(1, 'Conte por que esta ideia é destaque.').max(2000),
    startsOn: isoDate,
    endsOn: isoDate,
  })
  .refine((h) => h.endsOn >= h.startsOn, { path: ['endsOn'], message: 'O fim não pode ser antes do início.' });

export const RevokeSchema = z.object({ reason: z.string().trim().min(1, 'Informe o motivo.').max(2000) });
export const ConsentSchema = z.object({ accept: z.boolean() });
export const PraiseSchema = z.object({ body: z.string().trim().min(1, 'Escreva o elogio.').max(1000) });
export const HidePraiseSchema = z.object({ reason: z.string().trim().min(1, 'Informe o motivo.').max(500) });

export class HighlightRequest {
  @ApiProperty({ description: 'Código ou id da ideia' }) ideaRef!: string;
  @ApiProperty({ enum: ['entity', 'organization'] }) scope!: string;
  @ApiProperty() justification!: string;
  @ApiProperty({ format: 'date' }) startsOn!: string;
  @ApiProperty({ format: 'date' }) endsOn!: string;
}
export class RevokeRequest {
  @ApiProperty() reason!: string;
}
export class ConsentRequest {
  @ApiProperty({ description: 'Aparecer com nome e foto (true) ou sem nome (false)' }) accept!: boolean;
}
export class PraiseRequest {
  @ApiProperty() body!: string;
}

export class HallPerson {
  @ApiProperty({ type: String, nullable: true, description: 'Nulo = sem consentimento ou com opt-out (RN-74)' })
  name!: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Para a foto (só quando o nome aparece)' })
  userId!: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Versão da foto (RN-142); nula = iniciais ou ícone genérico',
  })
  photoVersion!: string | null;
  @ApiProperty({ enum: ['author', 'co_author'] }) role!: string;
}
export class HallCategory {
  @ApiProperty() name!: string;
  @ApiProperty({ type: String, nullable: true }) color!: string | null;
}
export class HallIdea {
  @ApiProperty() code!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ type: HallCategory, nullable: true }) category!: HallCategory | null;
  @ApiProperty() entity!: string;
  @ApiProperty({ description: 'Antes: a situação descrita no envio' }) before!: string;
  @ApiProperty({ type: String, nullable: true, description: 'Depois: o resultado obtido' }) after!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) implementedAt!: string | null;
}
export class HallGain {
  @ApiProperty() validatedAnnual!: number;
  @ApiProperty() currency!: string;
}
export class HallCard {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: ['entity', 'organization'] }) scope!: string;
  @ApiProperty({ enum: ['scheduled', 'active', 'expired', 'revoked'] }) state!: string;
  @ApiProperty() justification!: string;
  @ApiProperty({ format: 'date' }) startsOn!: string;
  @ApiProperty({ format: 'date' }) endsOn!: string;
  @ApiProperty({ type: HallIdea }) idea!: HallIdea;
  @ApiProperty({ type: [HallPerson], description: 'Autor e co-autores (RN-89)' }) people!: HallPerson[];
  @ApiProperty({ type: HallGain, nullable: true, description: 'Só com "mostrar ganho no Hall" e ganho validado' })
  gain!: HallGain | null;
  @ApiProperty({ type: Number, nullable: true, description: 'Nulo com as curtidas desligadas' }) likes!: number | null;
  @ApiProperty() likedByMe!: boolean;
  @ApiProperty({ description: 'Pode curtir (não é dela nem de co-autoria)' }) canLike!: boolean;
  @ApiProperty() praises!: number;
  @ApiProperty({ description: 'Pode revogar' }) canManage!: boolean;
  @ApiProperty({ description: 'Pode abrir a ideia em si (RN-01)' }) canOpenIdea!: boolean;
}
export class HallFameYear {
  @ApiProperty() year!: number;
  @ApiProperty({ type: [HallCard] }) cards!: HallCard[];
}
export class MyConsent {
  @ApiProperty() highlightId!: string;
  @ApiProperty() ideaTitle!: string;
  @ApiProperty({ enum: ['pending', 'accepted', 'declined'] }) status!: string;
}
export class HallView {
  @ApiProperty({ type: [HallCard], description: 'Destaques em vigor' }) current!: HallCard[];
  @ApiProperty({ type: [HallFameYear], description: 'Hall da fama: destaques vencidos, por ano' })
  fame!: HallFameYear[];
  @ApiProperty({ type: [MyConsent], description: 'Destaques da própria pessoa' }) mine!: MyConsent[];
  @ApiProperty({ description: 'Pode destacar (entidade ou organização)' }) canCurate!: boolean;
  @ApiProperty() likesEnabled!: boolean;
}
export class PraiseView {
  @ApiProperty() id!: string;
  @ApiProperty({ type: String, nullable: true, description: 'Nulo = autor com opt-out de nome' }) author!:
    | string
    | null;
  @ApiProperty() body!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ description: 'Oculto pela moderação (só moderadores veem)' }) hidden!: boolean;
  @ApiProperty({ type: String, nullable: true }) hiddenReason!: string | null;
}
export class HighlightDetail {
  @ApiProperty({ type: HallCard }) card!: HallCard;
  @ApiProperty({ type: [PraiseView] }) praiseList!: PraiseView[];
  @ApiProperty({ description: 'Pode ocultar elogios (hall.moderate)' }) canModerate!: boolean;
  @ApiProperty({
    type: String,
    nullable: true,
    enum: ['pending', 'accepted', 'declined'],
    description: 'Consentimento de quem chama',
  })
  myConsent!: string | null;
  @ApiProperty({ type: String, nullable: true }) revokedReason!: string | null;
}
export class LikeResult {
  @ApiProperty() likes!: number;
  @ApiProperty() likedByMe!: boolean;
}
export class CandidateView {
  @ApiProperty() code!: string;
  @ApiProperty() title!: string;
  @ApiProperty() entity!: string;
  @ApiProperty({ enum: ['gain', 'likes'] }) reason!: string;
  @ApiProperty({ type: Number, nullable: true }) validatedAnnual!: number | null;
  @ApiProperty({ type: String, nullable: true }) currency!: string | null;
  @ApiProperty() likes!: number;
}
