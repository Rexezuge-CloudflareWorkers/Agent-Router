import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/Button';
import { Field, Input, Select } from '../../components/ui/Input';
import { ModalHeader, ModalShell } from '../../components/modals/ModalShell';
import type { SearchProviderKind } from '../../types';

const KINDS: Array<{ value: SearchProviderKind; label: string }> = [
  { value: 'BRAVE', label: 'Brave' },
  { value: 'TAVILY', label: 'Tavily' },
];

function optionalNumber(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return /^\d+$/.test(trimmed) ? Number(trimmed) : undefined;
}

export function AddSearchProviderDialog({
  onSubmit,
  onClose,
}: {
  onSubmit: (kind: string, name: string) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<SearchProviderKind>('BRAVE');
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
    <ModalShell
      onClose={onClose}
      widthClass="w-[calc(100vw-2rem)] max-w-md"
      ariaLabel={t('searchProviders.newProvider', 'New Search Provider')}
    >
      <ModalHeader title={t('searchProviders.newProvider', 'New Search Provider')} onClose={onClose} />
      <div className="space-y-4 p-5">
        <Field label={t('searchProviders.kind', 'Search provider kind')} htmlFor="search-provider-kind">
          <Select id="search-provider-kind" value={kind} onChange={(event) => setKind(event.target.value as SearchProviderKind)}>
            {KINDS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label={t('searchProviders.name', 'Provider name')}
          htmlFor="search-provider-name"
          hint={t('searchProviders.nameHint', 'A unique label, e.g. “Primary Brave”.')}
        >
          <Input
            id="search-provider-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Primary Brave"
            autoFocus
            onKeyDown={(event) => {
              if (event.key === 'Enter') void submit();
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

export interface SearchKeyInput {
  name: string;
  secret: string;
  requestLimit?: number;
  resetInDays?: number;
  priority?: number;
}

export function AddSearchKeyDialog({
  providerName,
  onSubmit,
  onClose,
}: {
  providerName: string;
  onSubmit: (input: SearchKeyInput) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [secret, setSecret] = useState('');
  const [requestLimit, setRequestLimit] = useState('');
  const [resetInDays, setResetInDays] = useState('');
  const [priority, setPriority] = useState('0');
  const [busy, setBusy] = useState(false);
  const valid = name.trim().length > 0 && secret.trim().length > 0;

  const submit = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      await onSubmit({
        name: name.trim(),
        secret: secret.trim(),
        requestLimit: optionalNumber(requestLimit),
        resetInDays: optionalNumber(resetInDays),
        priority: optionalNumber(priority) ?? 0,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell onClose={onClose} widthClass="w-[calc(100vw-2rem)] max-w-md" ariaLabel={t('searchProviders.addKey', 'Add Key')}>
      <ModalHeader title={`${t('searchProviders.addKey', 'Add Key')} · ${providerName}`} onClose={onClose} />
      <div className="space-y-4 p-5">
        <Field label={t('searchProviders.keyName', 'Key name')} htmlFor="search-key-name">
          <Input id="search-key-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Primary" autoFocus />
        </Field>
        <Field
          label={t('searchProviders.secret', 'API key')}
          htmlFor="search-key-secret"
          hint={t('searchProviders.secretHint', 'Stored encrypted at rest. Only a hint is ever shown again.')}
        >
          <Input
            id="search-key-secret"
            type="password"
            value={secret}
            onChange={(event) => setSecret(event.target.value)}
            placeholder="brave-…"
            autoComplete="off"
          />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label={t('searchProviders.requestLimit', 'Request limit')} htmlFor="search-key-limit">
            <Input
              id="search-key-limit"
              inputMode="numeric"
              value={requestLimit}
              onChange={(event) => setRequestLimit(event.target.value)}
              placeholder="—"
            />
          </Field>
          <Field label={t('searchProviders.resetDays', 'Reset in days')} htmlFor="search-key-reset">
            <Input
              id="search-key-reset"
              inputMode="numeric"
              value={resetInDays}
              onChange={(event) => setResetInDays(event.target.value)}
              placeholder="—"
            />
          </Field>
          <Field label={t('searchProviders.priority', 'Priority')} htmlFor="search-key-priority">
            <Input
              id="search-key-priority"
              inputMode="numeric"
              value={priority}
              onChange={(event) => setPriority(event.target.value)}
              placeholder="0"
            />
          </Field>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button variant="primary" size="sm" loading={busy} disabled={!valid} onClick={() => void submit()}>
            {t('searchProviders.addKey', 'Add Key')}
          </Button>
        </div>
      </div>
    </ModalShell>
  );
}

export function RotateSearchKeyDialog({
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
    <ModalShell onClose={onClose} widthClass="w-[calc(100vw-2rem)] max-w-md" ariaLabel={t('searchProviders.rotate', 'Rotate Key')}>
      <ModalHeader title={`${t('searchProviders.rotate', 'Rotate Key')} · ${keyName}`} onClose={onClose} />
      <div className="space-y-4 p-5">
        <Field label={t('searchProviders.replacementSecret', 'Replacement API key')} htmlFor="rotate-search-key">
          <Input
            id="rotate-search-key"
            type="password"
            value={secret}
            onChange={(event) => setSecret(event.target.value)}
            placeholder="brave-…"
            autoComplete="off"
            autoFocus
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button variant="primary" size="sm" loading={busy} disabled={!secret.trim()} onClick={() => void submit()}>
            {t('searchProviders.rotate', 'Rotate Key')}
          </Button>
        </div>
      </div>
    </ModalShell>
  );
}
