import { useEffect, useState } from 'react';
import styled from 'styled-components';
import { byokKey } from '../../lib/byok-key';
import { useT } from '@/i18n';
import { getModelPref, setModelPref } from '../../lib/model-pref';
import { emitModelChange } from '../../lib/model-pref-events';
import {
  PROVIDERS,
  PROVIDER_LABELS,
  PROVIDER_KEY_URLS,
  defaultModelForProvider,
  type LLMProvider,
} from '@open-design/contracts';

const Form = styled.form`
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
`;

const TabBar = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 3px;
  background: ${({ theme }) => theme.colors.bg200};
  border-radius: 8px;
  border: 1px solid ${({ theme }) => theme.colors.line200};
`;

const TabButton = styled.button<{ $active: boolean; $hasKey: boolean }>`
  /* flex-basis 0 + min-width forces wrap into roughly 4-per-row at the
     460px modal width while staying tappable. */
  flex: 1 1 110px;
  min-width: 100px;
  padding: 6px 10px;
  border: none;
  border-radius: 5px;
  background: ${({ $active, theme }) => ($active ? theme.colors.bg100 : 'transparent')};
  color: ${({ $active, theme }) => ($active ? theme.colors.fg100 : theme.colors.fg300)};
  font-size: 13px;
  font-weight: ${({ $active }) => ($active ? 600 : 500)};
  font-family: inherit;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  box-shadow: ${({ $active }) => ($active ? '0 1px 2px rgba(0,0,0,0.06)' : 'none')};
  transition:
    background 120ms ease,
    color 120ms ease;

  &:hover {
    color: ${({ theme }) => theme.colors.fg100};
  }
`;

const KeyDot = styled.span<{ $set: boolean }>`
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: ${({ $set }) => ($set ? '#1a8a40' : '#c8c4bc')};
  flex-shrink: 0;
`;

const Label = styled.label`
  font-size: 14px;
  font-weight: 500;
`;

const Input = styled.input`
  padding: 8px 12px;
  border: 1px solid ${({ theme }) => theme.colors.line200};
  border-radius: 6px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 13px;
`;

const Note = styled.p`
  margin: 0;
  font-size: 12px;
  color: ${({ theme }) => theme.colors.fg300};
`;

const Row = styled.div`
  display: flex;
  gap: 8px;
`;

const Button = styled.button`
  padding: 8px 16px;
  border: 1px solid ${({ theme }) => theme.colors.line200};
  border-radius: 6px;
  background: ${({ theme }) => theme.colors.bg100};
  cursor: pointer;
  font-size: 14px;
  &:hover {
    background: ${({ theme }) => theme.colors.bg200};
  }
`;

const PrimaryButton = styled(Button)`
  background: ${({ theme }) => theme.colors.brandBase};
  color: white;
  border-color: ${({ theme }) => theme.colors.brandBase};
  &:hover {
    opacity: 0.9;
    background: ${({ theme }) => theme.colors.brandBase};
  }
`;

const Status = styled.span<{ $kind: 'ok' | 'err' | 'idle' }>`
  font-size: 12px;
  color: ${(p) => (p.$kind === 'ok' ? '#1a8a40' : p.$kind === 'err' ? '#c0392b' : 'inherit')};
`;

interface ProviderHelp {
  readonly placeholder: string;
  readonly note: string;
}

const PROVIDER_HELP: Readonly<Record<LLMProvider, ProviderHelp>> = {
  openrouter: {
    placeholder: 'sk-or-v1-...',
    note: 'Aggregator — one key for Claude, GPT, Gemini, etc.',
  },
  anthropic: {
    placeholder: 'sk-ant-...',
    note: 'Direct Anthropic API. Browser → api.anthropic.com.',
  },
  openai: {
    placeholder: 'sk-...',
    note: 'Direct OpenAI API. Browser → api.openai.com.',
  },
  google: {
    placeholder: 'AIza...',
    note: 'Google AI Studio key. Browser → generativelanguage.googleapis.com.',
  },
  xai: {
    placeholder: 'xai-...',
    note: 'xAI Grok. Browser → api.x.ai.',
  },
  mistral: {
    placeholder: 'Mistral key',
    note: 'Mistral AI. Browser → api.mistral.ai.',
  },
  deepseek: {
    placeholder: 'sk-...',
    note: 'DeepSeek (OpenAI-compatible API). Browser → api.deepseek.com.',
  },
  groq: {
    placeholder: 'gsk_...',
    note: 'Groq fast inference for open-weight models. Browser → api.groq.com.',
  },
  cohere: {
    placeholder: 'Cohere key',
    note: 'Cohere Command family (R / R+ / A). Browser → api.cohere.com.',
  },
  cerebras: {
    placeholder: 'csk-...',
    note: 'Cerebras fast inference for open-weight models. Browser → api.cerebras.ai.',
  },
  vercel: {
    placeholder: 'v1:...',
    note: 'Vercel v0 chat model (web-app code generation). Browser → api.v0.dev.',
  },
  moonshot: {
    placeholder: 'sk-...',
    note: 'Moonshot AI (Kimi). 中国友好端点：浏览器 → api.moonshot.cn.',
  },
  alibaba: {
    placeholder: 'sk-...',
    note: '阿里云通义千问 (Qwen) DashScope 兼容模式。浏览器 → dashscope.aliyuncs.com.',
  },
  huggingface: {
    placeholder: 'hf_...',
    note: 'Hugging Face Inference Router (OpenAI-compatible). Browser → router.huggingface.co.',
  },
  baseten: {
    placeholder: 'Baseten API key',
    note: 'Baseten Model APIs (OpenAI-compatible). Browser → inference.baseten.co.',
  },
};

/** Provider-specific health check. */
async function probeKey(provider: LLMProvider, key: string): Promise<{ ok: boolean; msg: string }> {
  const trimmed = key.trim();
  if (provider === 'openrouter') {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${trimmed}` },
      body: JSON.stringify({
        model: defaultModelForProvider('openrouter'),
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });
    if (res.ok) return { ok: true, msg: '✓ Key works' };
    const err = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    return { ok: false, msg: `${res.status}: ${err.error?.message ?? 'failed'}` };
  }
  if (provider === 'openai') {
    // /v1/models is the cheapest auth-only probe (no token spend).
    const res = await fetch('https://api.openai.com/v1/models', {
      headers: { authorization: `Bearer ${trimmed}` },
    });
    if (res.ok) return { ok: true, msg: '✓ Key works' };
    const err = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    return { ok: false, msg: `${res.status}: ${err.error?.message ?? 'failed'}` };
  }
  if (provider === 'anthropic') {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': trimmed,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: defaultModelForProvider('anthropic'),
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });
    if (res.ok) return { ok: true, msg: '✓ Key works' };
    const err = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    return { ok: false, msg: `${res.status}: ${err.error?.message ?? 'failed'}` };
  }
  if (provider === 'google') {
    // Google AI Studio uses ?key=, not Authorization header.
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(trimmed)}`,
    );
    if (res.ok) return { ok: true, msg: '✓ Key works' };
    const err = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    return { ok: false, msg: `${res.status}: ${err.error?.message ?? 'failed'}` };
  }
  if (provider === 'xai') {
    // xAI exposes /v1/api-key for an auth-only round-trip.
    const res = await fetch('https://api.x.ai/v1/api-key', {
      headers: { authorization: `Bearer ${trimmed}` },
    });
    if (res.ok) return { ok: true, msg: '✓ Key works' };
    return { ok: false, msg: `${res.status}: ${res.statusText || 'failed'}` };
  }
  if (provider === 'mistral') {
    const res = await fetch('https://api.mistral.ai/v1/models', {
      headers: { authorization: `Bearer ${trimmed}` },
    });
    if (res.ok) return { ok: true, msg: '✓ Key works' };
    const err = (await res.json().catch(() => ({}))) as { message?: string };
    return { ok: false, msg: `${res.status}: ${err.message ?? res.statusText ?? 'failed'}` };
  }
  if (provider === 'deepseek') {
    // DeepSeek API is OpenAI-compatible.
    const res = await fetch('https://api.deepseek.com/models', {
      headers: { authorization: `Bearer ${trimmed}` },
    });
    if (res.ok) return { ok: true, msg: '✓ Key works' };
    const err = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    return { ok: false, msg: `${res.status}: ${err.error?.message ?? 'failed'}` };
  }
  if (provider === 'groq') {
    const res = await fetch('https://api.groq.com/openai/v1/models', {
      headers: { authorization: `Bearer ${trimmed}` },
    });
    if (res.ok) return { ok: true, msg: '✓ Key works' };
    const err = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    return { ok: false, msg: `${res.status}: ${err.error?.message ?? 'failed'}` };
  }
  if (provider === 'cohere') {
    const res = await fetch('https://api.cohere.com/v1/models', {
      headers: { authorization: `Bearer ${trimmed}` },
    });
    if (res.ok) return { ok: true, msg: '✓ Key works' };
    const err = (await res.json().catch(() => ({}))) as { message?: string };
    return { ok: false, msg: `${res.status}: ${err.message ?? res.statusText ?? 'failed'}` };
  }
  if (provider === 'cerebras') {
    // Cerebras API is OpenAI-compatible.
    const res = await fetch('https://api.cerebras.ai/v1/models', {
      headers: { authorization: `Bearer ${trimmed}` },
    });
    if (res.ok) return { ok: true, msg: '✓ Key works' };
    const err = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    return { ok: false, msg: `${res.status}: ${err.error?.message ?? 'failed'}` };
  }
  if (provider === 'vercel') {
    const res = await fetch('https://api.v0.dev/v1/models', {
      headers: { authorization: `Bearer ${trimmed}` },
    });
    if (res.ok) return { ok: true, msg: '✓ Key works' };
    const err = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    return { ok: false, msg: `${res.status}: ${err.error?.message ?? 'failed'}` };
  }
  // OpenAI-compatible providers (Moonshot / Alibaba / HuggingFace / Baseten)
  // — uniform GET {baseURL}/models with Bearer auth.
  const compatibleBaseUrls: Partial<Record<LLMProvider, string>> = {
    moonshot: 'https://api.moonshot.cn/v1',
    alibaba: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    huggingface: 'https://router.huggingface.co/v1',
    baseten: 'https://inference.baseten.co/v1',
  };
  const baseURL = compatibleBaseUrls[provider];
  if (!baseURL) {
    return { ok: false, msg: `Unknown provider: ${provider as string}` };
  }
  const res = await fetch(`${baseURL}/models`, {
    headers: { authorization: `Bearer ${trimmed}` },
  });
  if (res.ok) return { ok: true, msg: '✓ Key works' };
  const err = (await res.json().catch(() => ({}))) as {
    error?: { message?: string };
    message?: string;
  };
  return {
    ok: false,
    msg: `${res.status}: ${err.error?.message ?? err.message ?? res.statusText ?? 'failed'}`,
  };
}

export interface ApiKeyFormProps {
  onSaved?: () => void;
}

export function ApiKeyForm({ onSaved }: ApiKeyFormProps) {
  const t = useT();
  // Active tab (and the provider being edited) — initialized to whichever
  // provider the user is currently chatting with. Switching tabs only
  // navigates this form; pressing Save persists the input AND promotes the
  // tabbed provider to "active provider for the chat agent".
  const [provider, setProvider] = useState<LLMProvider>(() => getModelPref().provider);
  const [value, setValue] = useState('');
  const [keyVersion, setKeyVersion] = useState(0); // bump to refresh dot indicators
  const [testStatus, setTestStatus] = useState<{ kind: 'ok' | 'err' | 'idle'; msg: string }>({
    kind: 'idle',
    msg: '',
  });

  // When tab changes, hydrate input from that provider's stored key + reset status.
  useEffect(() => {
    setValue(byokKey.get(provider) ?? '');
    setTestStatus({ kind: 'idle', msg: '' });
  }, [provider]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Blank input must not silently "save" — surface a clear error so the
    // modal stays open and the user knows why instead of getting an opaque
    // 401 from the provider later.
    const trimmed = value.trim();
    if (trimmed === '') {
      setTestStatus({ kind: 'err', msg: t('settings.enterKeyError') });
      return;
    }
    byokKey.set(provider, trimmed);
    // Saving a key for a provider also makes that the *active* provider:
    // it's what the user just demonstrated intent to use. Keep the model id
    // sane by pinning to the first model registered for the new provider.
    const cur = getModelPref();
    if (cur.provider !== provider) {
      setModelPref({ provider, modelId: defaultModelForProvider(provider) });
      emitModelChange();
    }
    setKeyVersion((n) => n + 1);
    onSaved?.();
  };

  const handleClear = () => {
    byokKey.clear(provider);
    setValue('');
    setTestStatus({ kind: 'idle', msg: '' });
    setKeyVersion((n) => n + 1);
    onSaved?.();
  };

  const handleTest = async () => {
    if (!value.trim()) {
      setTestStatus({ kind: 'err', msg: t('settings.enterKeyError') });
      return;
    }
    setTestStatus({ kind: 'idle', msg: t('settings.testing') });
    try {
      const result = await probeKey(provider, value);
      // Localize the canonical "✓ Key works" success — provider-specific
      // failure messages stay in English since they come straight from the
      // upstream API and are useful as-is for debugging.
      const localized = result.ok ? t('settings.keyOk') : result.msg;
      setTestStatus({ kind: result.ok ? 'ok' : 'err', msg: localized });
    } catch (e) {
      setTestStatus({ kind: 'err', msg: (e as Error).message });
    }
  };

  return (
    <Form onSubmit={handleSubmit}>
      <TabBar role="tablist" aria-label={t('settings.providerTabsAria')}>
        {PROVIDERS.map((p) => {
          // Read fresh on every render so dot reflects post-save state.
          // keyVersion gates re-evaluation cheaply.
          void keyVersion;
          const hasKey = byokKey.isSet(p);
          return (
            <TabButton
              key={p}
              type="button"
              role="tab"
              aria-selected={provider === p}
              aria-controls={`api-key-input-${p}`}
              $active={provider === p}
              $hasKey={hasKey}
              onClick={() => setProvider(p)}
              data-testid={`api-key-tab-${p}`}
            >
              <KeyDot $set={hasKey} aria-hidden="true" />
              {PROVIDER_LABELS[p]}
            </TabButton>
          );
        })}
      </TabBar>
      <Label htmlFor={`api-key-input-${provider}`}>
        {t('settings.apiKeyLabel', { provider: PROVIDER_LABELS[provider] })}
      </Label>
      <Input
        id={`api-key-input-${provider}`}
        type="password"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={PROVIDER_HELP[provider].placeholder}
        autoComplete="off"
        spellCheck={false}
        data-testid={`api-key-input-${provider}`}
      />
      <Note>
        {PROVIDER_HELP[provider].note} {t('settings.storageNote')}{' '}
        <a href={PROVIDER_KEY_URLS[provider]} target="_blank" rel="noreferrer">
          {t('settings.getKey')}
        </a>
      </Note>
      <Row>
        <PrimaryButton type="submit" data-testid="api-key-save">
          {t('settings.save')}
        </PrimaryButton>
        <Button type="button" onClick={handleClear} data-testid="api-key-clear">
          {t('settings.clear')}
        </Button>
        <Button type="button" onClick={handleTest} data-testid="api-key-test">
          {t('settings.test')}
        </Button>
      </Row>
      {testStatus.msg && (
        <Status $kind={testStatus.kind} role="status">
          {testStatus.msg}
        </Status>
      )}
    </Form>
  );
}
