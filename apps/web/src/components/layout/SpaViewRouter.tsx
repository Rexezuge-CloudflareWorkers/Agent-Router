import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Compass } from 'lucide-react';
import type { CurrentUser } from '../../types';
import Unauthorized from './Unauthorized';
import { AppPage, PageHeader } from './AppPage';
import { LoadingSpinner, EmptyState } from './PageState';
import { LandingView } from '../../views/LandingView';
import { DashboardView } from '../../views/DashboardView';
import { ProvidersView } from '../../views/ProvidersView';
import { GatewayKeysView } from '../../views/GatewayKeysView';
import { SettingsView } from '../../views/SettingsView';

// Recharts is the heaviest dependency in the SPA; keep it out of the initial
// bundle by loading the usage dashboard on demand.
const UsageView = lazy(() => import('../../views/UsageView').then((module) => ({ default: module.UsageView })));

interface SpaViewRouterProps {
  user: CurrentUser | null;
  setUser: (user: CurrentUser) => void;
  authorized: boolean | null;
  showNotice: (type: 'success' | 'error', text: string) => void;
  defaultOwner: string;
  language: string;
  onLanguageChange: (lng: string) => void;
  languageDisabled?: boolean;
}

function gated(user: CurrentUser | null, element: React.ReactNode): React.JSX.Element {
  if (user) return <>{element}</>;
  return (
    <AppPage>
      <Unauthorized />
    </AppPage>
  );
}

function SpaViewRouter({ user, setUser, authorized, showNotice, language, onLanguageChange, languageDisabled }: SpaViewRouterProps) {
  const { t } = useTranslation();
  if (authorized === null) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--color-accent)] border-t-transparent" />
      </div>
    );
  }
  return (
    <Routes>
      <Route path="/" element={user ? <DashboardView showNotice={showNotice} /> : <LandingView />} />
      <Route path="/providers" element={gated(user, <ProvidersView showNotice={showNotice} />)} />
      <Route path="/keys" element={gated(user, <GatewayKeysView showNotice={showNotice} />)} />
      <Route
        path="/usage"
        element={gated(
          user,
          <Suspense fallback={<LoadingSpinner />}>
            <UsageView showNotice={showNotice} />
          </Suspense>,
        )}
      />
      <Route
        path="/settings"
        element={
          user ? (
            <SettingsView
              user={user}
              setUser={setUser}
              showNotice={showNotice}
              language={language}
              onLanguageChange={onLanguageChange}
              languageDisabled={languageDisabled}
            />
          ) : (
            <AppPage>
              <Unauthorized message={t('errors.signInToManage', 'Sign in to manage settings.')} />
            </AppPage>
          )
        }
      />
      <Route
        path="*"
        element={
          <AppPage>
            <PageHeader title={t('errors.pageNotFound', 'Page not found')} />
            <EmptyState
              icon={<Compass className="h-5 w-5" />}
              message={t('errors.pageNotFoundDescription', 'The page you requested does not exist.')}
            />
          </AppPage>
        }
      />
    </Routes>
  );
}

export { SpaViewRouter };
export type { SpaViewRouterProps };
