import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AppPage, PageHeaderCard, ReadOnlyField } from '@rexezuge/web';
import { Card, CardHeader, CardTitle } from '../components/ui/Card';

export function DashboardView(_props: { showNotice: (type: 'success' | 'error', text: string) => void }) {
  const { t } = useTranslation();
  const origin = globalThis.location?.origin ?? '';
  return (
    <AppPage>
      <PageHeaderCard
        title="Dashboard"
        description={t('dashboard.description', 'Route OpenAI, Anthropic, Gemini, And ChatGPT Codex Through One Gateway.')}
      />

      <Card>
        <CardHeader>
          <CardTitle>Endpoints</CardTitle>
        </CardHeader>
        <div className="space-y-3">
          <ReadOnlyField label="OpenAI Compatible" value={`${origin}/v1/chat/completions`} showCopy />
          <ReadOnlyField label="Anthropic" value={`${origin}/anthropic/v1/messages`} showCopy />
          <ReadOnlyField label="Gemini" value={`${origin}/gemini/v1beta/models/gemini-2.0-flash:generateContent`} showCopy />
          <p className="text-sm text-[var(--color-text-secondary)]">
            Authenticate With <code className="font-mono text-xs">Authorization: Bearer ar_…</code> Using A Key From{' '}
            <Link to="/keys" className="text-[var(--color-accent)] hover:underline">
              Gateway Keys
            </Link>
            . Set <code className="font-mono text-xs">x-provider-id</code> To Pin A Provider; Otherwise The Model Name Routes Automatically.
          </p>
        </div>
      </Card>

      <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Providers</CardTitle>
          </CardHeader>
          <p className="text-sm text-[var(--color-text-secondary)]">Add Upstream Providers And Pool Multiple Keys With Usage Caps.</p>
          <Link to="/providers" className="mt-3 inline-block text-sm text-[var(--color-accent)] hover:underline">
            Manage Providers →
          </Link>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t('dashboard.codexTitle', 'ChatGPT Codex')}</CardTitle>
          </CardHeader>
          <p className="text-sm text-[var(--color-text-secondary)]">
            {t('dashboard.codexDescription', 'Connect With Your ChatGPT Account Via OAuth. No API Key Needed.')}
          </p>
          <Link to="/providers" className="mt-3 inline-block text-sm text-[var(--color-accent)] hover:underline">
            {t('dashboard.codexLink', 'Connect Codex →')}
          </Link>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Gateway Keys</CardTitle>
          </CardHeader>
          <p className="text-sm text-[var(--color-text-secondary)]">Mint Bearer Keys For Your Clients. Revoke Anytime.</p>
          <Link to="/keys" className="mt-3 inline-block text-sm text-[var(--color-accent)] hover:underline">
            Manage Keys →
          </Link>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Usage</CardTitle>
          </CardHeader>
          <p className="text-sm text-[var(--color-text-secondary)]">Token Totals And Per-Request Ledger For Debugging Failover.</p>
          <Link to="/usage" className="mt-3 inline-block text-sm text-[var(--color-accent)] hover:underline">
            View Usage →
          </Link>
        </Card>
      </div>
    </AppPage>
  );
}
