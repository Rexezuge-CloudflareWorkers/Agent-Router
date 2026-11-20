import { useTranslation } from 'react-i18next';
import { LanguageSelector } from '../shared/LanguageSelector';
import { Card, CardDescription, CardHeader, CardTitle } from '../ui/Card';
import { Field } from '../ui/Input';

export function LanguageSettingsCard({
  language,
  onLanguageChange,
  disabled,
}: {
  language: string;
  onLanguageChange: (lng: string) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{t('settings.preferences', 'Preferences')}</CardTitle>
          <CardDescription>{t('settings.languageDescription', 'Choose your preferred display language.')}</CardDescription>
        </div>
      </CardHeader>
      <Field label={t('settings.language', 'Language')} htmlFor="user-language">
        <LanguageSelector value={language} onChange={onLanguageChange} disabled={disabled} className="w-fit" />
      </Field>
    </Card>
  );
}
