import { useTranslation } from 'react-i18next';
import { ArrowRight, Gauge, KeyRound, Layers, Route, ShieldCheck, Sparkles } from 'lucide-react';
import { AppPage } from '../components/layout/AppPage';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { CopyButton } from '../components/shared/CopyButton';
import { ZERO_TRUST_AUTHENTICATION_PATH } from '../lib/constants';

const UPSTREAMS = ['OpenAI', 'Anthropic', 'Gemini', 'ChatGPT Codex', 'Command Code'];

function signIn() {
  location.assign(ZERO_TRUST_AUTHENTICATION_PATH);
}

const SAMPLE = `curl $HOST/v1/chat/completions \\
  -H "Authorization: Bearer $AGENT_ROUTER_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"gpt-4.1-mini","messages":[{"role":"user","content":"Hello"}]}'`;

export function LandingView() {
  const { t } = useTranslation();
  const origin = globalThis.location?.origin ?? '$HOST';
  const snippet = SAMPLE.split('$HOST').join(origin);

  return (
    <AppPage variant="hero" className="max-w-6xl">
      <div className="relative">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-0 -z-10 h-[360px] w-[640px] max-w-full -translate-x-1/2 rounded-full bg-[var(--color-accent)]/15 blur-[120px]"
        />
        <div className="mx-auto max-w-3xl text-center animate-fade-in-up">
          <span className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border-muted)] bg-[var(--color-surface-2)] px-3 py-1 text-xs font-medium text-[var(--color-text-secondary)]">
            <Sparkles className="h-3.5 w-3.5 text-[var(--color-accent-text)]" />
            {t('landing.badge', 'Self-hosted AI gateway on Cloudflare Workers')}
          </span>
          <h1 className="mt-6 text-4xl font-semibold tracking-tight text-[var(--color-text-primary)] sm:text-5xl lg:text-6xl">
            {t('landing.titleLead', 'One gateway for')}{' '}
            <span className="bg-gradient-to-r from-[var(--color-accent-text)] to-[#c4b5fd] bg-clip-text text-transparent">
              {t('landing.titleAccent', 'every model')}
            </span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base text-[var(--color-text-secondary)] sm:text-lg">
            {t(
              'landing.subtitle',
              'Manage gateway keys, pool multiple upstream keys per provider, and fail over automatically on rate limits.',
            )}
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button variant="primary" size="lg" onClick={signIn}>
              {t('landing.signIn', 'Sign In With Cloudflare Access')}
              <ArrowRight className="h-4 w-4" />
            </Button>
            <a
              href="#quickstart"
              className="text-sm font-medium text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)]"
            >
              {t('landing.quickstart', 'See the quickstart')}
            </a>
          </div>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-[var(--color-text-muted)]">
            {UPSTREAMS.map((name) => (
              <span key={name} className="flex items-center gap-1.5">
                <span className="h-1 w-1 rounded-full bg-[var(--color-accent)]" />
                {name}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div id="quickstart" className="mx-auto mt-16 grid max-w-5xl gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
            </div>
            <span className="text-[11px] uppercase tracking-wide text-[var(--color-text-muted)]">
              {t('landing.terminal', 'Quickstart')}
            </span>
          </div>
          <pre className="mt-4 overflow-x-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-base)] p-4 font-mono text-[12px] leading-relaxed text-[var(--color-text-secondary)]">
            <code>{snippet}</code>
          </pre>
          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="text-xs text-[var(--color-text-muted)]">
              {t('landing.snippetHint', 'Same request shape as the upstream APIs you already use.')}
            </p>
            <CopyButton value={snippet} />
          </div>
        </Card>

        <div className="grid gap-4 lg:col-span-2">
          {[
            {
              icon: Layers,
              title: t('landing.keyPools', 'Key pools'),
              description: t('landing.keyPoolsDescription', 'Add multiple upstream keys per provider with usage caps.'),
            },
            {
              icon: Route,
              title: t('landing.failover', 'Automatic failover'),
              description: t('landing.failoverDescription', '429s and 5xx retried on the next healthy key transparently.'),
            },
            {
              icon: KeyRound,
              title: t('landing.gatewayKeys', 'Gateway keys'),
              description: t('landing.gatewayKeysDescription', 'Clients use one bearer key across OpenAI, Anthropic and Gemini.'),
            },
          ].map((feature) => (
            <Card key={feature.title} variant="interactive" className="flex items-start gap-3 p-4">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--color-accent)]/12 text-[var(--color-accent-text)]">
                <feature.icon className="h-4 w-4" />
              </span>
              <div>
                <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">{feature.title}</h2>
                <p className="mt-0.5 text-sm text-[var(--color-text-secondary)]">{feature.description}</p>
              </div>
            </Card>
          ))}
        </div>
      </div>

      <div className="mx-auto mt-12 grid max-w-5xl gap-4 sm:grid-cols-3">
        {[
          {
            icon: ShieldCheck,
            title: t('landing.encrypted', 'Encrypted at rest'),
            description: t('landing.encryptedDescription', 'Upstream secrets are AES-GCM encrypted in the Secrets Store.'),
          },
          {
            icon: Gauge,
            title: t('landing.caps', 'Usage caps'),
            description: t('landing.capsDescription', 'Per-key request and token budgets with automatic cooldown.'),
          },
          {
            icon: Route,
            title: t('landing.protocols', 'Drop-in protocols'),
            description: t('landing.protocolsDescription', 'OpenAI, Anthropic and Gemini request shapes out of the box.'),
          },
        ].map((item) => (
          <div key={item.title} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-1)]/60 p-4">
            <item.icon className="h-4 w-4 text-[var(--color-text-muted)]" />
            <h3 className="mt-3 text-sm font-medium text-[var(--color-text-primary)]">{item.title}</h3>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">{item.description}</p>
          </div>
        ))}
      </div>
    </AppPage>
  );
}
