import { AppShell, AuthShell } from './components/layout/AppShell';
import { NoticeBar } from './components/layout/NoticeBar';
import { SpaViewRouter } from './components/layout/SpaViewRouter';
import { useNotice } from './hooks/useNotice';
import { useCurrentUser } from './hooks/useCurrentUser';
import { useSpaLanguage } from './hooks/useSpaLanguage';

export default function SpaApp() {
  const { notice, showNotice, dismissNotice } = useNotice();
  const { user, setUser, authorized } = useCurrentUser();
  const { language, languageStatus, languagePending, handleLanguageChange } = useSpaLanguage({
    user,
    showNotice,
    setUser,
  });

  const ownerFromEmail = user ? user.email.split('@', 1)[0] : '';
  const defaultOwner = user?.username?.trim() ? user.username : ownerFromEmail;

  const router = (
    <SpaViewRouter
      user={user}
      setUser={setUser}
      authorized={authorized}
      showNotice={showNotice}
      defaultOwner={defaultOwner}
      language={languageStatus === 'error' ? 'unknown' : language}
      onLanguageChange={handleLanguageChange}
      languageDisabled={languagePending || languageStatus !== 'ready'}
    />
  );

  return (
    <div className="min-h-screen bg-[var(--color-surface-base)] text-[var(--color-text-primary)]">
      {user ? <AppShell user={user}>{router}</AppShell> : <AuthShell showSignIn={authorized === false}>{router}</AuthShell>}
      {notice && <NoticeBar notice={notice} onDismiss={dismissNotice} />}
    </div>
  );
}
