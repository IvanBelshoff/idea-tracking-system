import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { axisMargin, axisTicks, axisTop } from './ops-format';

export interface ChartPoint {
  key: string | number;
  /** O que o eixo mostra: "14h", "27/10". */
  label: string;
  /** Texto mais longo só para a dica, quando o do eixo é curto demais. */
  tip?: string;
  /** Nulo é ausência de medida: a coluna some e a linha falha ali. */
  value: number | null;
  /** Linhas extras da dica, já formatadas. */
  extras?: string[];
}

interface Props {
  title: string;
  /** Uma frase para quem não vê o gráfico (entra no nome acessível). */
  summary: string;
  points: ChartPoint[];
  shape: 'columns' | 'line';
  /** `primary` é a série comum; `danger` é para erros. */
  tone: 'primary' | 'danger';
  format: (value: number) => string;
  /** Formato curto do eixo; padrão, o mesmo da dica. */
  axisFormat?: (value: number) => string;
  height?: number;
  /** Gráficos lado a lado passam a mesma margem para o tempo cair na mesma vertical. */
  marginLeft?: number;
}

const MARGIN = { top: 20, right: 8, bottom: 24 };
/** Colunas finas: a sobra da faixa é ar. */
const MAX_COLUMN = 24;
const GAP = 2;

/** Cor e ícone juntos nunca falam sozinhos: a legenda e a tabela repetem os números. Só tokens do tema. */
const TONE = {
  primary: { fill: 'fill-chart-1', stroke: 'stroke-chart-1', dash: 'bg-chart-1' },
  danger: { fill: 'fill-(--st-rejected-fill)', stroke: 'stroke-(--st-rejected-fill)', dash: 'bg-(--st-rejected-fill)' },
} as const;

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry?.contentRect.width ?? 0)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Coluna com o topo arredondado em 4px e a base reta, presa à linha do zero. */
function columnPath(x: number, base: number, width: number, height: number) {
  const r = Math.min(4, width / 2, height);
  const top = base - height;
  return `M${x},${base}V${top + r}Q${x},${top} ${x + r},${top}H${x + width - r}Q${x + width},${top} ${x + width},${top + r}V${base}Z`;
}

/**
 * Um gráfico de uma série só, em SVG próprio e sem biblioteca: colunas ou linha, eixo do zero a um
 * número redondo, dica ao passar o mouse ou com as setas do teclado, e valor lido em voz alta.
 * Com os tokens e o i18n do ITS.
 */
export function Chart({
  title,
  summary,
  points,
  shape,
  tone,
  format,
  axisFormat = format,
  height = 168,
  marginLeft,
}: Props) {
  const { t } = useTranslation();
  const [ref, width] = useWidth();
  const [active, setActive] = useState<number | null>(null);

  const color = TONE[tone];
  const values = points.map((point) => point.value ?? 0);
  const max = Math.max(0, ...values);
  const top = axisTop(max);
  const yTicks = axisTicks(max);
  const left = marginLeft ?? axisMargin(max, axisFormat);
  const areaX = Math.max(0, width - left - MARGIN.right);
  const areaY = height - MARGIN.top - MARGIN.bottom;
  const base = MARGIN.top + areaY;
  const band = points.length > 0 ? areaX / points.length : 0;
  const columnWidth = Math.max(1, Math.min(MAX_COLUMN, band - GAP));
  const center = (i: number) => left + band * i + band / 2;
  const y = (value: number) => base - (value / top) * areaY;

  // Rótulo direto só no pico (colunas) ou no último valor (linha).
  const peak = values.reduce((best, value, i) => (value > (values[best] ?? 0) ? i : best), 0);
  const last = points.findLastIndex((point) => point.value != null);
  const labelled = shape === 'columns' ? ((values[peak] ?? 0) > 0 ? peak : -1) : last;

  // Rótulos do eixo X: um a cada ~90px, sempre o primeiro e o último.
  const wanted = Math.max(2, Math.floor(areaX / 90));
  const step = Math.max(1, Math.ceil((points.length - 1) / (wanted - 1)));
  const xTicks = points
    .map((_, i) => i)
    .filter((i) => i === points.length - 1 || (i % step === 0 && points.length - 1 - i >= step / 2));

  const linePath = points
    .map((point, i) => (point.value == null ? null : { x: center(i), y: y(point.value) }))
    .reduce<string>((path, p, i, list) => {
      if (!p) return path;
      return `${path}${list[i - 1] ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`;
    }, '');

  const move = (event: KeyboardEvent<SVGSVGElement>) => {
    if (points.length === 0) return;
    if (event.key === 'Escape') setActive(null);
    const current = active ?? points.length - 1;
    const next =
      event.key === 'ArrowLeft'
        ? Math.max(0, current - 1)
        : event.key === 'ArrowRight'
          ? Math.min(points.length - 1, current + 1)
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? points.length - 1
              : null;
    if (next === null) return;
    event.preventDefault();
    setActive(next);
  };

  const activePoint = active === null ? null : points[active];
  const xTip = active === null ? 0 : center(active);
  const noData = t('admin.ops.chart.noData');

  return (
    <figure className="min-w-0">
      <figcaption className="text-sm font-medium">{title}</figcaption>
      <div ref={ref} className="relative mt-2" style={{ height }}>
        {width > 0 && (
          // biome-ignore lint/a11y/useSemanticElements: um <fieldset> não envolve um SVG; o grupo nomeado é o papel certo
          <svg
            width={width}
            height={height}
            role="group"
            aria-roledescription={t('admin.ops.chart.roleDescription')}
            aria-label={`${title}. ${summary} ${t('admin.ops.chart.hint')}`}
            // biome-ignore lint/a11y/noNoninteractiveTabindex: o gráfico é navegável por teclado (setas, Home, End, Esc)
            tabIndex={0}
            onKeyDown={move}
            onFocus={() => setActive((current) => current ?? Math.max(0, last))}
            onBlur={() => setActive(null)}
            onPointerLeave={() => setActive(null)}
            className="block rounded-md outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {yTicks.map((tick) => (
              <g key={tick}>
                <line
                  x1={left}
                  x2={width - MARGIN.right}
                  y1={y(tick)}
                  y2={y(tick)}
                  className="stroke-border"
                  strokeWidth={1}
                  shapeRendering="crispEdges"
                />
                <text
                  x={left - 8}
                  y={y(tick)}
                  dy="0.32em"
                  textAnchor="end"
                  className="fill-muted-foreground text-xs tabular-nums"
                >
                  {axisFormat(tick)}
                </text>
              </g>
            ))}

            {xTicks.map((i) => {
              const point = points[i];
              if (!point) return null;
              const first = i === 0 && xTicks.length > 1;
              const end = i === points.length - 1;
              return (
                <text
                  key={point.key}
                  x={center(i)}
                  y={height - 6}
                  textAnchor={first ? 'start' : end ? 'end' : 'middle'}
                  dx={first ? -band / 2 : end ? band / 2 : 0}
                  className="fill-muted-foreground text-xs tabular-nums"
                >
                  {point.label}
                </text>
              );
            })}

            {/* A faixa ativa aparece, mesmo quando o valor é zero. */}
            {active !== null && (
              <rect x={left + band * active} y={MARGIN.top} width={band} height={areaY} className="fill-foreground/5" />
            )}

            {shape === 'columns' &&
              points.map((point, i) =>
                point.value ? (
                  <path
                    key={point.key}
                    d={columnPath(
                      center(i) - columnWidth / 2,
                      base,
                      columnWidth,
                      Math.max(1, (point.value / top) * areaY),
                    )}
                    className={`${color.fill} transition-opacity ${active !== null && active !== i ? 'opacity-60' : ''}`}
                  />
                ) : null,
              )}

            {shape === 'line' && (
              <>
                {active !== null && (
                  <line
                    x1={xTip}
                    x2={xTip}
                    y1={MARGIN.top}
                    y2={base}
                    className="stroke-muted-foreground"
                    strokeWidth={1}
                    shapeRendering="crispEdges"
                  />
                )}
                <path
                  d={linePath}
                  fill="none"
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  className={color.stroke}
                />
                {points.map((point, i) => {
                  if (point.value == null) return null;
                  // Ponto solto (sem vizinho), o ativo e o último ganham a bolinha.
                  const alone = points[i - 1]?.value == null && points[i + 1]?.value == null;
                  if (!alone && i !== active && i !== last) return null;
                  return (
                    <circle
                      key={point.key}
                      cx={center(i)}
                      cy={y(point.value)}
                      r={4}
                      strokeWidth={2}
                      className={`${color.fill} stroke-card`}
                    />
                  );
                })}
              </>
            )}

            {labelled >= 0 && points[labelled]?.value != null && active === null && (
              <text
                x={center(labelled)}
                y={y(points[labelled]?.value ?? 0) - 10}
                textAnchor={
                  labelled > points.length * 0.85 ? 'end' : labelled < points.length * 0.15 ? 'start' : 'middle'
                }
                dx={shape === 'line' && labelled > points.length * 0.85 ? -6 : 0}
                // Contorno da cor do cartão: a série que passa por trás não corta o número.
                paintOrder="stroke"
                strokeWidth={4}
                strokeLinejoin="round"
                className="fill-foreground stroke-card text-xs font-medium tabular-nums"
              >
                {format(points[labelled]?.value ?? 0)}
              </text>
            )}

            {/* A faixa inteira é o alvo do mouse, não só o traço pintado. */}
            {points.map((point, i) => (
              <rect
                key={point.key}
                x={left + band * i}
                y={MARGIN.top}
                width={band}
                height={areaY}
                fill="transparent"
                onPointerEnter={() => setActive(i)}
              />
            ))}
          </svg>
        )}

        {/* Sempre montada, para o leitor de tela anunciar a troca de valor. */}
        <p aria-live="polite" className="sr-only">
          {activePoint
            ? `${activePoint.tip ?? activePoint.label}: ${activePoint.value == null ? noData : format(activePoint.value)}. ${(activePoint.extras ?? []).join('. ')}`
            : ''}
        </p>

        {activePoint && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute z-10 w-max max-w-56 rounded-md border bg-popover px-3 py-2 text-popover-foreground shadow-sm"
            // Ao lado da faixa, nunca por cima dela: à direita na metade esquerda, à esquerda na outra.
            style={
              xTip < width / 2
                ? { top: MARGIN.top, left: xTip + band / 2 + 6 }
                : { top: MARGIN.top, right: width - xTip + band / 2 + 6 }
            }
          >
            <p className="flex items-center gap-2 text-sm font-semibold tabular-nums">
              <span aria-hidden="true" className={`h-0.5 w-3 rounded-full ${color.dash}`} />
              {activePoint.value == null ? t('admin.ops.chart.noDataCap') : format(activePoint.value)}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">{activePoint.tip ?? activePoint.label}</p>
            {activePoint.extras?.map((extra) => (
              <p key={extra} className="text-xs text-muted-foreground">
                {extra}
              </p>
            ))}
          </div>
        )}
      </div>
    </figure>
  );
}
