import { Route, Routes } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { CurrentUser } from '../../types';
import Unauthorized from './Unauthorized';
import { Card } from '../ui/Card';
import { AppPage } from './AppPage';
import { LandingView } from '../../views/LandingView';
import { DashboardView } from '../../views/DashboardView';
import { ProvidersView } from '../../views/ProvidersView';
import { GatewayKeysView } from '../../views/GatewayKeysView';
import { UsageView } from '../../views/UsageView';
import { SettingsView } from '../../views/SettingsView';

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
      <Unauthorized message="Sign In To Manage The Gateway." />
    </AppPage>
  );
}

function SpaViewRouter({ user, setUser, authorized, showNotice, language, onLanguageChange, languageDisabled }: SpaViewRouterProps) {
  const { t } = useTranslation();
  if (authorized === null) {
    return (
      <div className="min-h-screen bg-[var(--color-surface-base)] flex items-center justify-center">
        <div className="h-10 w-10 rounded-full border-2 border-[var(--color-accent)] border-t-transparent animate-spin" />
      </div>
    );
  }
  return (
    <Routes>
      <Route path="/" element={user ? <DashboardView showNotice={showNotice} /> : <LandingView />} />
      <Route path="/providers" element={gated(user, <ProvidersView showNotice={showNotice} />)} />
      <Route path="/keys" element={gated(user, <GatewayKeysView showNotice={showNotice} />)} />
      <Route path="/usage" element={gated(user, <UsageView showNotice={showNotice} />)} />
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
              <Unauthorized message={t('errors.signInToManage', 'Sign In To Manage Settings.')} />
            </AppPage>
          )
        }
      />
      <Route
        path="*"
        element={
          <AppPage>
            <Card>
              <h1 className="text-lg font-semibold text-[var(--color-text-primary)]">{t('errors.pageNotFound', 'Page Not Found')}</h1>
              <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
                {t('errors.pageNotFoundDescription', 'The Page You Requested Does Not Exist.')}
              </p>
            </Card>
          </AppPage>
        }
      />
    </Routes>
  );
}

export { SpaViewRouter };
export type { SpaViewRouterProps };
