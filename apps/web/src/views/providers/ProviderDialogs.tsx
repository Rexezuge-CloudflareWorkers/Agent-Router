import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/Button';
import { Field, Input, Select, Textarea } from '../../components/ui/Input';
import { ModalHeader, ModalShell } from '../../components/modals/ModalShell';
import type { Provider } from '../../types';

const KINDS = [
  { value: 'OPENAI', label: 'OpenAI' },
  { value: 'ANTHROPIC', label: 'Anthropic' },
  { value: 'GEMINI', label: 'Gemini' },
  { value: 'OPENAI_COMPAT', label: 'OpenAI Compatible' },
  { value: 'OPENAI_CODEX', label: 'OpenAI Codex (OAuth)' },
  { value: 'COMMAND_CODE', label: 'Command Code' },
] as const;

export function AddProviderDialog({ onSubmit, onClose }: { onSubmit: (kind: string, name: string) => Promise<void>; onClose: () => void }) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<string>('OPENAI');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await onSubmit(kind, name.trim());
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell onClose={onClose} widthClass="w-[calc(100vw-2rem)] max-w-md" ariaLabel={t('providers.newProvider', 'New Provider')}>
      <ModalHeader title={t('providers.newProvider', 'New Provider')} onClose={onClose} />
      <div className="space-y-4 p-5">
        <Field label={t('providers.kind', 'Provider kind')} htmlFor="provider-kind">
          <Select id="provider-kind" value={kind} onChange={(e) => setKind(e.target.value)}>
            {KINDS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.value === 'OPENAI_CODEX' ? t('providers.codexKindOption', 'OpenAI Codex (OAuth)') : item.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label={t('providers.name', 'Provider name')}
          htmlFor="provider-name"
          hint={t('providers.nameHint', 'A unique label, e.g. “Primary OpenAI”.')}
        >
          <Input
            id="provider-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Primary OpenAI"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit();
            }}
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button variant="primary" size="sm" loading={busy} disabled={!name.trim()} onClick={() => void submit()}>
            {t('common.create', 'Create')}
          </Button>
        </div>
      </div>
    </ModalShell>
  );
}

export function AddKeyDialog({
  provider,
  onSubmit,
  onClose,
}: {
  provider: Provider;
  onSubmit: (input: { name: string; secret: string }) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const isCodex = provider.kind === 'OPENAI_CODEX';
  const [name, setName] = useState('');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);

  const valid = name.trim().length > 0 && (isCodex || secret.trim().length > 0);

  const submit = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      await onSubmit({ name: name.trim(), secret: secret.trim() });
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell onClose={onClose} widthClass="w-[calc(100vw-2rem)] max-w-md" ariaLabel={t('providers.addKey', 'Add Key')}>
      <ModalHeader title={`${t('providers.addKey', 'Add Key')} · ${provider.name}`} onClose={onClose} />
      <div className="space-y-4 p-5">
        <Field label={t('providers.keyName', 'Key name')} htmlFor="provider-key-name">
          <Input
            id="provider-key-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={isCodex ? t('providers.codexOAuth', 'Codex OAuth') : 'Primary'}
            autoFocus
          />
        </Field>
        {!isCodex && (
          <Field
            label={t('providers.secret', 'Upstream secret')}
            htmlFor="provider-key-secret"
            hint={t('providers.secretHint', 'Stored encrypted at rest. Only a hint is ever shown again.')}
          >
            <Input
              id="provider-key-secret"
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder="sk-…"
              autoComplete="off"
            />
          </Field>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button variant="primary" size="sm" loading={busy} disabled={!valid} onClick={() => void submit()}>
            {isCodex ? t('providers.addCodexKey', 'Add Codex Key') : t('providers.addKey', 'Add Key')}
          </Button>
        </div>
      </div>
    </ModalShell>
  );
}

export function RotateKeyDialog({
  keyName,
  onSubmit,
  onClose,
}: {
  keyName: string;
  onSubmit: (secret: string) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!secret.trim()) return;
    setBusy(true);
    try {
      await onSubmit(secret.trim());
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell onClose={onClose} widthClass="w-[calc(100vw-2rem)] max-w-md" ariaLabel={t('providers.rotate', 'Rotate Key')}>
      <ModalHeader title={`${t('providers.rotate', 'Rotate Key')} · ${keyName}`} onClose={onClose} />
      <div className="space-y-4 p-5">
        <Field label={t('providers.replacementSecret', 'Replacement secret')} htmlFor="rotate-secret">
          <Input
            id="rotate-secret"
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder="sk-…"
            autoComplete="off"
            autoFocus
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button variant="primary" size="sm" loading={busy} disabled={!secret.trim()} onClick={() => void submit()}>
            {t('providers.rotate', 'Rotate Key')}
          </Button>
        </div>
      </div>
    </ModalShell>
  );
}

export function ImportTokenDialog({
  keyName,
  onSubmit,
  onClose,
}: {
  keyName: string;
  onSubmit: (pasted: string) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!value.trim()) return;
    setBusy(true);
    try {
      await onSubmit(value);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell onClose={onClose} widthClass="w-[calc(100vw-2rem)] max-w-lg" ariaLabel={t('providers.importToken', 'Import Token')}>
      <ModalHeader title={`${t('providers.importToken', 'Import Token')} · ${keyName}`} onClose={onClose} />
      <div className="space-y-4 p-5">
        <Field
          label={t('providers.importTokenPrompt', 'Refresh token or auth JSON')}
          htmlFor="import-token"
          hint={t('providers.importTokenHint', 'Paste the refresh token or auth JSON from the Codex app or OpenCode.')}
        >
          <Textarea
            id="import-token"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            rows={7}
            className="font-mono"
            placeholder='{"refresh_token":"…"}'
            autoFocus
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button variant="primary" size="sm" loading={busy} disabled={!value.trim()} onClick={() => void submit()}>
            {t('providers.importToken', 'Import Token')}
          </Button>
        </div>
      </div>
    </ModalShell>
  );
}

export function CodexDeviceDialog({
  session,
  onCancel,
}: {
  session: { flow: { userCode: string; verificationUrl: string; expiresAt: number } };
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <ModalShell
      onClose={onCancel}
      widthClass="w-[calc(100vw-2rem)] max-w-md"
      ariaLabel={t('providers.connectWithChatGPT', 'Connect With ChatGPT')}
    >
      <ModalHeader title={t('providers.connectWithChatGPT', 'Connect With ChatGPT')} onClose={onCancel} />
      <div className="space-y-4 p-5">
        <p className="text-sm text-[var(--color-text-secondary)]">
          {t('providers.deviceApproveHint', 'Enter this code at OpenAI to approve:')}
        </p>
        <div className="flex items-center justify-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-base)] py-5">
          <p className="font-mono text-3xl font-semibold tracking-[0.25em] text-[var(--color-text-primary)]">{session.flow.userCode}</p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <a
            href={session.flow.verificationUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-[var(--color-accent-text)] hover:underline"
          >
            {t('providers.openVerificationPage', 'Open verification page →')}
          </a>
          <Button variant="secondary" size="sm" onClick={onCancel}>
            {t('providers.cancelAuth', 'Cancel')}
          </Button>
        </div>
        <p className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--color-warning-text)]" />
          {t('providers.deviceWaiting', 'Waiting for approval… this page updates automatically.')}
        </p>
      </div>
    </ModalShell>
  );
}
