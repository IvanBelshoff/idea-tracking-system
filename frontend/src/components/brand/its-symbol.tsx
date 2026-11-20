import './its-symbol.css';
import { ITS_PA, ITS_PAS } from './its-symbol-path';

// Símbolo do ITS: três pás em ciclo, cada nariz encaixado na cauda da seguinte.
// Ideia → ação → resultado, e o resultado vira a próxima ideia (melhoria contínua).
// Uma cor só (currentColor; no sistema é a --brand, trocável por organização), em três intensidades:
// a ideia nasce clara e ganha corpo até virar resultado. Geometria em scripts/gen-symbol.mjs.

export interface ItsSymbolProps {
  size?: number;
  /** 'idle' parado; 'loop' gira um terço por vez (carregando); 'once' entra girando (ex.: ideia enviada). */
  motion?: 'idle' | 'loop' | 'once';
  /** Anima mesmo com movimento reduzido (só onde a pessoa pediu explicitamente para ver). */
  forceMotion?: boolean;
  /**
   * Solto sobre o fundo (fora do quadro de cor). No tema escuro as duas pás mais fracas sobem um
   * degrau, para não sumirem no preto (ver its-symbol.css).
   */
  free?: boolean;
  /** Sem título o símbolo é decorativo (aria-hidden), para quando já há o nome ao lado. */
  title?: string;
  className?: string;
}

const OPACITY = [1, 0.68, 0.36];

export function ItsSymbol({ size = 32, motion = 'idle', forceMotion, free, title, className }: ItsSymbolProps) {
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      role="img"
      aria-label={title ?? 'ITS'}
      aria-hidden={title ? undefined : true}
      className={`its-symbol ${className ?? ''}`}
      data-motion={motion}
      data-force-motion={forceMotion || undefined}
      data-free={free || undefined}
    >
      {title && <title>{title}</title>}
      <g className="its-symbol-pas" fill="currentColor">
        {OPACITY.map((o, i) => (
          <path key={o} d={ITS_PA} transform={`rotate(${(360 / ITS_PAS) * i} 16 16)`} opacity={o} />
        ))}
      </g>
    </svg>
  );
}
