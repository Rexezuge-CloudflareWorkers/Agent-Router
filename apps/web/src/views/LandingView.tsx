import { KeyRound, Layers, Route } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { AppPage } from '@rexezuge/web';
import { ZERO_TRUST_AUTHENTICATION_PATH } from '../lib/constants';

function signIn() {
  location.assign(ZERO_TRUST_AUTHENTICATION_PATH);
}

export function LandingView() {
  return (
    <AppPage variant="hero">
      <div className="text-center max-w-2xl mx-auto animate-fade-in-up">
        <h1 className="text-4xl font-semibold tracking-tight text-[var(--color-text-primary)]">
          One Gateway For <span className="text-[var(--color-accent)]">Every Model</span>
        </h1>
        <p className="mt-4 text-[var(--color-text-secondary)]">
          Manage Gateway Keys, Pool Multiple Upstream Keys Per Provider, And Fail Over Automatically On Rate Limits.
        </p>
        <div className="mt-8">
          <Button variant="primary" size="lg" onClick={signIn}>
            Sign In With Cloudflare Access
          </Button>
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-4 mt-12 animate-stagger-1">
        <Card>
          <Layers className="h-5 w-5 text-[var(--color-accent)] mb-3" />
          <h2 className="font-semibold text-[var(--color-text-primary)] mb-1">Key Pools</h2>
          <p className="text-sm text-[var(--color-text-secondary)]">Add Multiple Upstream Keys Per Provider With Usage Caps.</p>
        </Card>
        <Card>
          <Route className="h-5 w-5 text-[var(--color-accent)] mb-3" />
          <h2 className="font-semibold text-[var(--color-text-primary)] mb-1">Automatic Failover</h2>
          <p className="text-sm text-[var(--color-text-secondary)]">429s And 5xx Retried On The Next Healthy Key Transparently.</p>
        </Card>
        <Card>
          <KeyRound className="h-5 w-5 text-[var(--color-accent)] mb-3" />
          <h2 className="font-semibold text-[var(--color-text-primary)] mb-1">Gateway Keys</h2>
          <p className="text-sm text-[var(--color-text-secondary)]">Clients Use One Bearer Key Across OpenAI, Anthropic, And Gemini.</p>
        </Card>
      </div>
    </AppPage>
  );
}
