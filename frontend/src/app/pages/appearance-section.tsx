import { useEffect, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { BRAND_FONTS, type BrandFont, FONT_FAMILY, loadFont } from '../fonts';
import { useMe, usePublicSettings, useUpdatePreferences } from '../session';

/**
 * Aparência da própria tela (RN-145): uma cor da paleta curada e uma das fontes da identidade visual.
 * Só aparece quando a organização libera; a escolha vale em qualquer aparelho (fica no servidor).
 * Grupos de opções nativos (radio): o escolhido é anunciado e as setas andam entre as opções.
 */
export function AppearanceSection() {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const { data: settings } = usePublicSettings();
  const update = useUpdatePreferences();
  const ids = useId();
  // As amostras usam a própria fonte: baixa as que ainda não vieram.
  useEffect(() => {
    for (const f of BRAND_FONTS) void loadFont(f);
  }, []);
  const appearance = me?.appearance;
  if (!appearance?.allowed) return null;

  const swatch = 'inline-block size-6 shrink-0 rounded-full border border-black/10 dark:border-white/20';
  const option =
    'flex cursor-pointer items-center gap-2.5 rounded-lg border p-2.5 text-sm has-checked:border-primary has-checked:bg-primary/5 has-focus-visible:ring-3 has-focus-visible:ring-ring/50';

  return (
    <div className="space-y-6">
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t('account.appearance.color')}</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          <label className={option}>
            <input
              type="radio"
              name={`${ids}-color`}
              className="accent-primary"
              checked={appearance.color === null}
              onChange={() => update({ uiColor: null })}
            />
            <span
              aria-hidden="true"
              className={`${swatch} bg-(--sw-l) dark:bg-(--sw-d)`}
              style={
                {
                  '--sw-l': settings?.branding.light.brand,
                  '--sw-d': settings?.branding.dark.brand,
                } as React.CSSProperties
              }
            />
            {t('account.appearance.organization')}
          </label>
          {appearance.palette.map((c) => (
            <label key={c.key} className={option}>
              <input
                type="radio"
                name={`${ids}-color`}
                className="accent-primary"
                checked={appearance.color === c.key}
                onChange={() => update({ uiColor: c.key })}
              />
              <span
                aria-hidden="true"
                className={`${swatch} bg-(--sw-l) dark:bg-(--sw-d)`}
                style={{ '--sw-l': c.light.brand, '--sw-d': c.dark.brand } as React.CSSProperties}
              />
              {t(`account.appearance.colors.${c.key}` as never)}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t('account.appearance.font')}</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className={option}>
            <input
              type="radio"
              name={`${ids}-font`}
              className="accent-primary"
              checked={appearance.font === null}
              onChange={() => update({ uiFont: null })}
            />
            {t('account.appearance.organization')}
          </label>
          {BRAND_FONTS.map((f: BrandFont) => (
            <label key={f} className={option} style={{ fontFamily: FONT_FAMILY[f] }}>
              <input
                type="radio"
                name={`${ids}-font`}
                className="accent-primary"
                checked={appearance.font === f}
                onChange={() => update({ uiFont: f })}
              />
              <span className="min-w-0">
                <span className="block font-medium">{t(`admin.branding.font.options.${f}.name` as never)}</span>
                <span className="block text-xs text-muted-foreground">{t('account.appearance.sample')}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
