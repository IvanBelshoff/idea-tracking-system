import { useTranslation } from 'react-i18next';
import { ProviderLogo } from '@/components/brand/provider-logos';
import { Button } from '@/components/ui/button';

/** Botões "Entrar com…": navegação inteira para a API, que leva ao provedor e volta já com sessão. */
export function SsoButtons({ providers, back }: { providers: readonly string[]; back: string }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      {providers.map((provider) => (
        <Button key={provider} asChild variant="outline" className="w-full">
          <a href={`/api/auth/sso/${provider}/start?voltar=${encodeURIComponent(back)}`}>
            <ProviderLogo provider={provider} className="size-4" />
            {t(provider === 'google' ? 'login.sso.google' : 'login.sso.microsoft')}
          </a>
        </Button>
      ))}
    </div>
  );
}
