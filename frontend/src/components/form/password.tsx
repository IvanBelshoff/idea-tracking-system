import { Check, Eye, EyeOff, X } from 'lucide-react';
import { forwardRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { type PasswordPolicy, passwordChecks } from '@/lib/password-policy';

/** Campo de senha com botão mostrar/ocultar (acessível: rótulo muda e aria-pressed). */
export const PasswordInput = forwardRef<HTMLInputElement, React.ComponentProps<'input'>>(
  function PasswordInput(props, ref) {
    const { t } = useTranslation();
    const [visible, setVisible] = useState(false);
    return (
      <div className="relative">
        <Input ref={ref} type={visible ? 'text' : 'password'} className="pr-10" {...props} />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-pressed={visible}
          aria-label={visible ? t('common.hidePassword') : t('common.showPassword')}
          className="absolute inset-y-0 right-0 grid w-10 place-items-center rounded-r-md text-muted-foreground hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          {visible ? <EyeOff aria-hidden="true" className="size-4" /> : <Eye aria-hidden="true" className="size-4" />}
        </button>
      </div>
    );
  },
);

/** Lista da política de senha que vai marcando o que já foi atendido enquanto a pessoa digita. */
export function PasswordPolicyHints({
  password,
  policy,
  id,
}: {
  password: string;
  policy: PasswordPolicy;
  id?: string;
}) {
  const { t } = useTranslation();
  const checks = passwordChecks(password, policy);
  const items = [
    { ok: checks.length, text: t('password.minLength', { count: policy.minLength }) },
    { ok: checks.classes, text: t('password.minClasses', { count: policy.minClasses }) },
  ];
  return (
    <div id={id} className="text-xs text-muted-foreground">
      <p>{t('password.policyTitle')}</p>
      <ul className="mt-1 space-y-0.5">
        {items.map((i) => (
          <li key={i.text} className={`flex items-start gap-1.5 ${i.ok ? 'text-(--st-done)' : ''}`}>
            {i.ok ? (
              <Check aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            ) : (
              <X aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            )}
            <span>
              {i.text}
              <span className="sr-only">{i.ok ? ' ✓' : ''}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
