import { describe, it, expect, beforeEach } from 'vitest';
import {
  PROVIDER_DEFAULT_MODELS,
  getApiBase,
  getServerAuthToken,
  getAuthHeaders,
  apiFetch,
} from './utils.js';

describe('Store Utils & Network Helpers', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('provides default models for all supported providers', () => {
    expect(PROVIDER_DEFAULT_MODELS.antigravity).toBe('gemini-3.7-flash');
    expect(PROVIDER_DEFAULT_MODELS.anthropic).toBe('claude-3-5-sonnet-20241022');
    expect(PROVIDER_DEFAULT_MODELS.openai).toBe('gpt-5.6-sol');
    expect(PROVIDER_DEFAULT_MODELS.cline).toBe('cline-pass/deepseek-v4-pro');
    expect(PROVIDER_DEFAULT_MODELS.ollama).toBe('llama3.3');
    expect(PROVIDER_DEFAULT_MODELS.openrouter).toBe('anthropic/claude-3.5-sonnet');
    expect(PROVIDER_DEFAULT_MODELS.opencode).toBe('claude-fable-5');
  });

  it('retrieves server auth token and sets auth headers', () => {
    localStorage.setItem('cline_web_server_auth_token', 'test-token-xyz');
    expect(getServerAuthToken()).toBe('test-token-xyz');

    const headers = getAuthHeaders({ 'Content-Type': 'application/json' });
    expect(headers['Authorization']).toBe('Bearer test-token-xyz');
    expect(headers['X-API-Key']).toBe('test-token-xyz');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('formats API base URL with current hostname', () => {
    const base = getApiBase();
    expect(base).toContain(':3001');
  });
});
