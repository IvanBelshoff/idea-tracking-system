import { cn } from 'cn';
import { cloneElement, type ReactElement, useId } from 'react';
import { Label } from '@/components/ui/label';

interface FieldProps {
  label: string;
  /** Mensagem de erro (já traduzida). Liga aria-invalid e aria-describedby no controle. */
  error?: string;
  hint?: string;
  optionalLabel?: string;
  className?: string;
  children: ReactElement<{ id?: string; 'aria-invalid'?: boolean; 'aria-describedby'?: string }>;
}

/** Rótulo + controle + dica + erro, com as ligações de acessibilidade feitas aqui, uma vez só. */
export function Field({ label, error, hint, optionalLabel, className, children }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={cn('grid content-start gap-1.5', className)}>
      <Label id={`${id}-label`} htmlFor={id}>
        {label}
        {optionalLabel && <span className="font-normal text-muted-foreground"> ({optionalLabel})</span>}
      </Label>
      {cloneElement(children, { id, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy })}
      {hint && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-xs font-medium text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/** Select nativo com o visual do Input: acessível, rápido em listas longas (fusos) e no celular. */
export function NativeSelect({ className, ...props }: React.ComponentProps<'select'>) {
  return (
    <select
      className={cn(
        'h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 [&_option]:bg-popover [&_option]:text-popover-foreground [&_optgroup]:bg-popover [&_optgroup]:text-muted-foreground',
        className,
      )}
      {...props}
    />
  );
}
