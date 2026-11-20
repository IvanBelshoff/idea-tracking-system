import { Check, Copy, Download } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Field, NativeSelect } from '@/components/form/field';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { LoadFailure } from '../ops/load-failure';
import { Section } from '../shared';
import { buildDocs, type DocField, type DocLang, type DocModule, type DocRoute, TOKEN_PLACEHOLDER } from './docs-model';
import { type IntegrationsView, useContract } from './queries';
import { WebhookDocs } from './webhooks/webhook-docs';

function CopyButton({ value, label }: { value: string; label: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      {copied ? t('admin.common.copied') : label}
    </Button>
  );
}

/** Os campos como linhas, com os objetos aninhados recuados. */
function flatten(
  fields: readonly DocField[],
  depth = 0,
  prefix = '',
): { field: DocField; depth: number; key: string }[] {
  return fields.flatMap((f) => {
    const key = `${prefix}/${f.name}`;
    return [{ field: f, depth, key }, ...flatten(f.children, depth + 1, key)];
  });
}

/** Trecho de código rolável: entra na ordem do teclado (setas rolam), como o axe exige. */
function Code({ label, children }: { label: string; children: string }) {
  return (
    <pre
      {...{ role: 'region', 'aria-label': label, tabIndex: 0 }}
      className="mt-1 max-h-72 overflow-auto rounded-md bg-muted p-3 text-xs focus-visible:outline-2 focus-visible:outline-ring"
    >
      {children}
    </pre>
  );
}

function RouteDoc({ route }: { route: DocRoute }) {
  const { t } = useTranslation();
  const rows = flatten(route.fields);
  // Cada região rolável leva a rota no nome: nomes repetidos entre rotas confundem quem usa leitor de tela.
  const where = `${route.method} ${route.path}`;
  const example = route.example === null ? '' : JSON.stringify(route.example, null, 2);
  return (
    <article className="rounded-lg border p-4">
      <h4 className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant="secondary">{route.method}</Badge>
        <code className="font-mono text-sm break-all">{route.path}</code>
      </h4>
      {route.summary && <p className="mt-2 font-medium">{route.summary}</p>}
      {route.description && <p className="mt-1 max-w-[75ch] text-sm text-muted-foreground">{route.description}</p>}

      {route.params.length > 0 && (
        <div className="mt-4">
          <h5 className="text-sm font-semibold">{t('admin.integrations.docs.params')}</h5>
          <Table className="mt-1" scrollLabel={`${t('admin.integrations.docs.params')} · ${where}`}>
            <TableHeader>
              <TableRow>
                <TableHead>{t('admin.integrations.docs.name')}</TableHead>
                <TableHead>{t('admin.integrations.docs.type')}</TableHead>
                <TableHead>{t('admin.integrations.docs.description')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {route.params.map((p) => (
                <TableRow key={`${p.place}:${p.name}`}>
                  <TableCell className="align-top font-mono text-xs">
                    {p.name}
                    <span className="ml-2 font-sans text-muted-foreground">
                      {p.required ? t('admin.integrations.docs.required') : t('admin.integrations.docs.optional')}
                    </span>
                  </TableCell>
                  <TableCell className="align-top text-xs whitespace-normal">{p.type}</TableCell>
                  <TableCell className="align-top text-sm whitespace-normal">{p.description}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {route.body && (
        <div className="mt-4">
          <h5 className="text-sm font-semibold">{t('admin.integrations.docs.body')}</h5>
          <Table className="mt-1" scrollLabel={`${t('admin.integrations.docs.body')} · ${where}`}>
            <TableHeader>
              <TableRow>
                <TableHead>{t('admin.integrations.docs.name')}</TableHead>
                <TableHead>{t('admin.integrations.docs.type')}</TableHead>
                <TableHead>{t('admin.integrations.docs.description')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {flatten(route.body.fields).map(({ field, depth, key }) => (
                <TableRow key={key}>
                  <TableCell
                    className="align-top font-mono text-xs"
                    style={{ paddingLeft: `${0.5 + depth * 1.25}rem` }}
                  >
                    {field.name}
                  </TableCell>
                  <TableCell className="align-top text-xs whitespace-normal">
                    {field.type}
                    {field.nullable && (
                      <span className="text-muted-foreground"> · {t('admin.integrations.docs.nullable')}</span>
                    )}
                  </TableCell>
                  <TableCell className="align-top text-sm whitespace-normal">{field.description}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <h5 className="mt-3 text-sm font-semibold">{t('admin.integrations.docs.bodyExample')}</h5>
          <p className="text-xs text-muted-foreground">{t('admin.integrations.docs.exampleNote')}</p>
          <Code label={`${t('admin.integrations.docs.bodyExample')} · ${where}`}>
            {JSON.stringify(route.body.example, null, 2)}
          </Code>
        </div>
      )}

      {rows.length > 0 && (
        <div className="mt-4">
          <h5 className="text-sm font-semibold">{t('admin.integrations.docs.fields')}</h5>
          <Table className="mt-1" scrollLabel={`${t('admin.integrations.docs.fields')} · ${where}`}>
            <TableHeader>
              <TableRow>
                <TableHead>{t('admin.integrations.docs.name')}</TableHead>
                <TableHead>{t('admin.integrations.docs.type')}</TableHead>
                <TableHead>{t('admin.integrations.docs.description')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ field, depth, key }) => (
                <TableRow key={key}>
                  <TableCell
                    className="align-top font-mono text-xs"
                    style={{ paddingLeft: `${0.5 + depth * 1.25}rem` }}
                  >
                    {field.name}
                  </TableCell>
                  <TableCell className="align-top text-xs whitespace-normal">
                    {field.type}
                    {field.nullable && (
                      <span className="text-muted-foreground"> · {t('admin.integrations.docs.nullable')}</span>
                    )}
                  </TableCell>
                  <TableCell className="align-top text-sm whitespace-normal">{field.description}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {example && (
        <div className="mt-4">
          <h5 className="text-sm font-semibold">{t('admin.integrations.docs.example')}</h5>
          <p className="text-xs text-muted-foreground">{t('admin.integrations.docs.exampleNote')}</p>
          <Code label={`${t('admin.integrations.docs.example')} · ${where}`}>{example}</Code>
        </div>
      )}

      <div className="mt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h5 className="text-sm font-semibold">{t('admin.integrations.docs.curl')}</h5>
          <CopyButton value={route.curl} label={t('admin.integrations.docs.copyCurl')} />
        </div>
        <Code label={`${t('admin.integrations.docs.curl')} · ${where}`}>{route.curl}</Code>
      </div>
    </article>
  );
}

function ModuleDoc({ module }: { module: DocModule }) {
  const { t } = useTranslation();
  const title =
    module.id === 'contract'
      ? t('admin.integrations.docs.contract')
      : t(`admin.integrations.modules.names.${module.id}` as never);
  return (
    <section aria-label={title} className="space-y-3">
      <h3 className="flex items-center gap-2 text-lg font-semibold">
        {title}
        {module.id === 'users' && <Badge variant="destructive">{t('admin.integrations.modules.sensitive')}</Badge>}
        {(module.id === 'ideas_write' || module.id === 'gains_write') && (
          <Badge variant="secondary">{t('admin.integrations.modules.writes')}</Badge>
        )}
      </h3>
      {module.routes.map((r) => (
        <RouteDoc key={`${r.method} ${r.path}`} route={r} />
      ))}
    </section>
  );
}

/**
 * Documentação da API de integração (RN-115): só de leitura, gerada do próprio contrato. Mostra, por
 * módulo ligado, as rotas, os campos, um exemplo FICTÍCIO e o `curl` com `SEU_TOKEN`. Não faz
 * nenhuma chamada à API de integração (não há "Experimentar") e nunca mostra dado real nem token.
 */
export function DocsSection({ view }: { view: IntegrationsView }) {
  const { t, i18n } = useTranslation();
  const [integration, setIntegration] = useState('');
  const contract = useContract(integration);
  const lang: DocLang = i18n.language.startsWith('en') ? 'en' : 'pt-BR';
  const docs = useMemo(() => (contract.data ? buildDocs(contract.data, lang) : null), [contract.data, lang]);

  const download = () => {
    if (!contract.data) return;
    const blob = new Blob([`${JSON.stringify(contract.data, null, 2)}\n`], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'its-integration-openapi.json';
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Section title={t('admin.integrations.docs.title')} intro={t('admin.integrations.docs.intro')}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-end gap-4">
          <Field label={t('admin.integrations.docs.viewAs')} className="min-w-64">
            <NativeSelect value={integration} onChange={(e) => setIntegration(e.target.value)}>
              <option value="">{t('admin.integrations.docs.allEnabled')}</option>
              {view.integrations
                .filter((i) => i.status !== 'revoked')
                .map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
            </NativeSelect>
          </Field>
          <Button variant="outline" onClick={download} disabled={!contract.data}>
            <Download aria-hidden="true" />
            {t('admin.integrations.docs.download')}
          </Button>
        </div>

        <div className="space-y-2 rounded-lg border p-4 text-sm">
          <p>
            <span className="text-muted-foreground">{t('admin.integrations.docs.base')}</span>{' '}
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{docs?.baseUrl ?? view.baseUrl ?? '—'}</code>
          </p>
          <p>
            <span className="text-muted-foreground">{t('admin.integrations.docs.auth')}</span>{' '}
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">Authorization: Bearer {TOKEN_PLACEHOLDER}</code>
          </p>
          <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
            <li>{t('admin.integrations.docs.conv1')}</li>
            <li>{t('admin.integrations.docs.conv2')}</li>
            <li>{t('admin.integrations.docs.conv3')}</li>
            <li>{t('admin.integrations.docs.conv4')}</li>
            <li>{t('admin.integrations.docs.conv5')}</li>
          </ul>
        </div>

        {contract.isError && (
          <LoadFailure
            message={t('admin.integrations.docs.loadFailed')}
            error={contract.error}
            retrying={contract.isFetching}
            onRetry={() => void contract.refetch()}
          />
        )}
        {docs && docs.modules.filter((m) => m.id !== 'contract').length === 0 && (
          <p className="text-sm text-muted-foreground">{t('admin.integrations.docs.noModules')}</p>
        )}
        {docs?.modules.map((m) => (
          <ModuleDoc key={m.id} module={m} />
        ))}
        <WebhookDocs />
      </div>
    </Section>
  );
}
