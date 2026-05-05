import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MODELS } from '@open-design/contracts';
import {
  DEFAULT_MODEL,
  getModelId,
  getModelPref,
  setModelId,
  setModelPref,
} from '../model-pref';

describe('model-pref (multi-provider)', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('returns DEFAULT_MODEL + default openrouter provider when nothing is stored', () => {
    expect(getModelPref()).toEqual({ provider: 'openrouter', modelId: DEFAULT_MODEL });
    expect(getModelId()).toBe(DEFAULT_MODEL);
  });

  it('round-trips a (provider, modelId) tuple', () => {
    setModelPref({ provider: 'anthropic', modelId: 'claude-sonnet-4-6' });
    expect(getModelPref()).toEqual({ provider: 'anthropic', modelId: 'claude-sonnet-4-6' });
  });

  it('back-compat setModelId resolves provider from MODELS list', () => {
    setModelId('gpt-4o-mini');
    expect(getModelPref()).toEqual({ provider: 'openai', modelId: 'gpt-4o-mini' });
    setModelId('anthropic/claude-haiku-4-5');
    expect(getModelPref()).toEqual({
      provider: 'openrouter',
      modelId: 'anthropic/claude-haiku-4-5',
    });
  });

  it('coerces a legacy bare claude-* id (pre-multi-provider) to the openrouter slug', () => {
    // Older versions of ModelDropdown wrote bare ids under 'open-design.model'
    // with no companion provider. We default the provider to openrouter and
    // recover the slug.
    localStorage.setItem('open-design.model', 'claude-haiku-4-5');
    expect(getModelPref()).toEqual({
      provider: 'openrouter',
      modelId: 'anthropic/claude-haiku-4-5',
    });
  });

  it('falls back to the provider default when the stored model id is unknown for that provider', () => {
    localStorage.setItem('open-design.provider', 'openai');
    localStorage.setItem('open-design.model', 'anthropic/claude-haiku-4-5'); // wrong namespace
    expect(getModelPref().provider).toBe('openai');
    // Should not be the cross-namespace id; should fall back to first openai model.
    const openaiModels = MODELS.filter((m) => m.provider === 'openai');
    expect(getModelPref().modelId).toBe(openaiModels[0]!.id);
  });

  it('falls back to default provider when stored provider value is bogus', () => {
    localStorage.setItem('open-design.provider', 'no-such-provider');
    expect(getModelPref().provider).toBe('openrouter');
  });
});
