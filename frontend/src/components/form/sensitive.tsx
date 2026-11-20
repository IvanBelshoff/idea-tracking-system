import { cn } from 'cn';
import { Eye, EyeOff } from 'lucide-react';
import { forwardRef, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { MASK, REVEAL_MS } from '@/lib/sensitive';

/**
 * Estado de revelar (RN-135): começa oculto (a menos que o valor inicial seja vazio, caso em que não há
 * o que esconder e a pessoa digita à vista), volta a ocultar sozinho em 60 segundos, quando `hideOn`
 * muda (ex.: depois de salvar) e quando o componente sai da tela (trocar de página).
 */
export function useReveal(startHidden: boolean, hideOn: unknown) {
  const [visible, setVisible] = useState(() => !startHidden);
  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => setVisible(false), REVEAL_MS);
    return () => clearTimeout(timer);
  }, [visible]);
  // O sinal externo (ex.: salvou) oculta; a primeira execução (a montagem) não conta.
  const mounted = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: roda só quando o sinal externo muda
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    setVisible(false);
  }, [hideOn]);
  return [visible, setVisible] as const;
}

export function EyeButton({
  visible,
  onToggle,
  field,
  className,
}: {
  visible: boolean;
  onToggle: () => void;
  field: string;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={visible}
      aria-label={visible ? t('common.hideField', { field }) : t('common.showField', { field })}
      className={cn(
        'grid place-items-center rounded-md text-muted-foreground hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
        className,
      )}
    >
      {visible ? <EyeOff aria-hidden="true" className="size-4" /> : <Eye aria-hidden="true" className="size-4" />}
    </button>
  );
}

type SensitiveInputProps = Omit<React.ComponentProps<'input'>, 'value' | 'type'> & {
  value: string;
  /** Nome do campo, para o botão do olho ("Mostrar ID do cliente"). */
  fieldLabel: string;
  /** Quando este valor muda, o campo volta a ocultar (ex.: `save.isSuccess`). */
  hideOn?: unknown;
};

/**
 * Campo editável de dado sensível (RN-135). Oculto, mostra só a máscara (somente leitura) e o valor
 * não existe na página; para editar, clique no olho. Não é preenchido nem guardado pelo navegador.
 */
export const SensitiveInput = forwardRef<HTMLInputElement, SensitiveInputProps>(function SensitiveInput(
  { value, fieldLabel, hideOn, className, ...props },
  ref,
) {
  const [visible, setVisible] = useReveal(value !== '', hideOn);
  return (
    <div className="relative">
      <Input
        ref={ref}
        {...props}
        type="text"
        value={visible ? value : MASK}
        readOnly={!visible || props.readOnly}
        onChange={visible ? props.onChange : undefined}
        autoComplete="off"
        spellCheck={false}
        data-1p-ignore="true"
        data-lpignore="true"
        data-form-type="other"
        className={cn('pr-10', !visible && 'select-none text-muted-foreground', className)}
      />
      <EyeButton
        visible={visible}
        onToggle={() => setVisible((v) => !v)}
        field={fieldLabel}
        className="absolute inset-y-0 right-0 w-10 rounded-l-none"
      />
    </div>
  );
});

/** Valor só de leitura de dado sensível (RN-135): máscara até clicar no olho; o valor não fica na página. */
export function SensitiveText({
  value,
  fieldLabel,
  className,
  hideOn,
}: {
  value: string;
  fieldLabel: string;
  className?: string;
  hideOn?: unknown;
}) {
  const [visible, setVisible] = useReveal(value !== '', hideOn);
  if (!value) return <span className={className}>—</span>;
  return (
    <span className="inline-flex max-w-full items-start gap-1">
      <span className={cn('min-w-0', className)}>{visible ? value : MASK}</span>
      <EyeButton
        visible={visible}
        onToggle={() => setVisible((v) => !v)}
        field={fieldLabel}
        className="size-6 shrink-0"
      />
    </span>
  );
}
