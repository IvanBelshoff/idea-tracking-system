import { useTranslation } from 'react-i18next';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { eventKey } from './helpers';
import { useWebhooks } from './queries';

/**
 * O exemplo de conferência da assinatura (RN-120, RN-125). O mesmo trecho está na Ajuda de TI e é
 * executado contra uma entrega real nos testes; os dados do exemplo são inventados.
 */
export const VERIFY_EXAMPLE = `import { createHmac, timingSafeEqual } from 'node:crypto';

export function verify(headers, rawBody, secret) {
  const timestamp = headers['x-its-timestamp'];
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const expected = createHmac('sha256', secret).update(\`\${timestamp}.\${rawBody}\`).digest();
  return String(headers['x-its-signature'])
    .split(',')
    .some((part) => {
      const [version, value] = part.trim().split('=');
      return (
        version === 'v1' &&
        /^[0-9a-f]{64}$/.test(value ?? '') &&
        timingSafeEqual(Buffer.from(value, 'hex'), expected)
      );
    });
}`;

const SAMPLE_BODY = `{
  "id": "0b6f1c1e-7c1e-4b0a-9a53-5f6c2f0e8d11",
  "type": "idea.status_changed",
  "created_at": "2026-11-12T14:03:22.000Z",
  "data": {
    "idea_code": "ITS-2026-0042",
    "entity_id": "7d9e6a0e-3a11-4f55-8f4a-2a0c4c7b9a10",
    "from": "submitted",
    "to": "approved"
  }
}`;

/** Trecho rolável: entra na ordem do teclado (setas rolam), como o axe exige. */
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

/** A documentação dos webhooks (RN-125): eventos, cabeçalhos e o passo a passo para conferir a assinatura. */
export function WebhookDocs() {
  const { t } = useTranslation();
  const webhooks = useWebhooks();
  const events = webhooks.data?.events ?? [];
  return (
    <section className="space-y-4 rounded-lg border p-4 text-sm">
      <div>
        <h3 className="font-semibold">{t('admin.integrations.webhooks.docs.title')}</h3>
        <p className="mt-1 text-muted-foreground">{t('admin.integrations.webhooks.docs.intro')}</p>
      </div>
      {events.length > 0 && (
        <Table scrollLabel={t('admin.integrations.webhooks.docs.eventsTitle')}>
          <TableHeader>
            <TableRow>
              <TableHead>{t('admin.integrations.webhooks.deliveries.event')}</TableHead>
              <TableHead>{t('admin.integrations.detail.module')}</TableHead>
              <TableHead>{t('admin.integrations.docs.description')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {events.map((e) => (
              <TableRow key={e.type}>
                <TableCell className="font-mono text-xs">{e.type}</TableCell>
                <TableCell>{t(`admin.integrations.modules.names.${e.module}` as never)}</TableCell>
                <TableCell>{t(`admin.integrations.webhooks.events.${eventKey(e.type)}` as never)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <div>
        <h4 className="font-medium">{t('admin.integrations.webhooks.docs.bodyTitle')}</h4>
        <p className="mt-1 text-muted-foreground">{t('admin.integrations.webhooks.docs.bodyText')}</p>
        <Code label={t('admin.integrations.webhooks.docs.bodyTitle')}>{SAMPLE_BODY}</Code>
      </div>
      <div>
        <h4 className="font-medium">{t('admin.integrations.webhooks.docs.headersTitle')}</h4>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">
          <li>
            <code className="text-xs">X-ITS-Event</code>: {t('admin.integrations.webhooks.docs.hEvent')}
          </li>
          <li>
            <code className="text-xs">X-ITS-Event-Id</code>: {t('admin.integrations.webhooks.docs.hEventId')}
          </li>
          <li>
            <code className="text-xs">X-ITS-Timestamp</code>: {t('admin.integrations.webhooks.docs.hTimestamp')}
          </li>
          <li>
            <code className="text-xs">X-ITS-Signature</code>: {t('admin.integrations.webhooks.docs.hSignature')}
          </li>
        </ul>
      </div>
      <div>
        <h4 className="font-medium">{t('admin.integrations.webhooks.docs.verifyTitle')}</h4>
        <ol className="mt-1 list-decimal space-y-1 pl-5 text-muted-foreground">
          <li>{t('admin.integrations.webhooks.docs.verify1')}</li>
          <li>{t('admin.integrations.webhooks.docs.verify2')}</li>
          <li>{t('admin.integrations.webhooks.docs.verify3')}</li>
          <li>{t('admin.integrations.webhooks.docs.verify4')}</li>
        </ol>
        <Code label={t('admin.integrations.webhooks.docs.verifyTitle')}>{VERIFY_EXAMPLE}</Code>
      </div>
      <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
        <li>{t('admin.integrations.webhooks.docs.note1')}</li>
        <li>{t('admin.integrations.webhooks.docs.note2')}</li>
        <li>{t('admin.integrations.webhooks.docs.note3')}</li>
      </ul>
    </section>
  );
}
