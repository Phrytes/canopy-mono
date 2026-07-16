// @vitest-environment happy-dom
//
// renderUserLlmSettings — the member's PERSONAL assistant endpoint config (web). Refactored in 6e253460
// from 3 mode radios + onChange → 4 route-PRESET radios + endpoint fields + a Save button (onSave/validate).
// `mountUserLlmSettings` was removed (persistence is now the caller's job via onSave); these tests cover the
// pure renderer against the current API.
import { describe, it, expect, vi } from 'vitest';
import { renderUserLlmSettings } from '../../web/v2/userLlmSettings.js';

const t = (k) => k;
function mount() { const el = document.createElement('div'); document.body.appendChild(el); return el; }
const presetValues = (el) => [...el.querySelectorAll('input[type=radio][name=user-llm-preset]')].map((r) => r.value);

describe('renderUserLlmSettings — preset + endpoint config', () => {
  it('renders the 4 route presets with the current one checked', () => {
    const el = mount();
    renderUserLlmSettings(el, { current: { preset: 'local-ollama' }, t });
    expect(presetValues(el)).toEqual(['off', 'local-ollama', 'confidential-proxy', 'openai-compatible']);
    expect(el.querySelector('input[value=local-ollama]').checked).toBe(true);
    expect(el.querySelector('input[value=off]').checked).toBe(false);
  });

  it('defaults to off for a missing/invalid preset', () => {
    const el = mount();
    renderUserLlmSettings(el, { current: { preset: 'gpt-5' }, t });
    expect(el.querySelector('input[value=off]').checked).toBe(true);
  });

  it('shows endpoint fields when preset ≠ off, and none when off', () => {
    const off = mount();
    renderUserLlmSettings(off, { current: { preset: 'off' }, t });
    expect(off.querySelectorAll('.cc-user-llm__field').length).toBe(0);

    const local = mount();
    renderUserLlmSettings(local, { current: { preset: 'local-ollama' }, t });
    expect(local.querySelectorAll('.cc-user-llm__field').length).toBeGreaterThan(0);
  });

  it('switching the preset radio reactively reveals the fields (off → local)', () => {
    const el = mount();
    renderUserLlmSettings(el, { current: { preset: 'off' }, t });
    expect(el.querySelectorAll('.cc-user-llm__field').length).toBe(0);
    const local = el.querySelector('input[value=local-ollama]');
    local.checked = true;
    local.dispatchEvent(new Event('change'));
    expect(el.querySelectorAll('.cc-user-llm__field').length).toBeGreaterThan(0);
  });

  it('Save calls onSave with the full config (preset + endpoints)', async () => {
    const el = mount();
    const onSave = vi.fn(async () => null);
    renderUserLlmSettings(el, { current: { preset: 'local-ollama', llmBaseUrl: 'http://127.0.0.1:11434' }, onSave, t });
    el.querySelector('.cc-user-llm__save').click();
    await Promise.resolve();
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      preset: 'local-ollama', llmBaseUrl: 'http://127.0.0.1:11434',
    }));
  });

  it('validate blocks the save (shows the error, never calls onSave) — the confidential-route guard', async () => {
    const el = mount();
    const onSave = vi.fn(async () => null);
    const validate = vi.fn(() => 'unsafe endpoint');
    renderUserLlmSettings(el, { current: { preset: 'confidential-proxy' }, onSave, validate, t });
    el.querySelector('.cc-user-llm__save').click();
    await Promise.resolve();
    expect(validate).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
    expect(el.querySelector('.cc-user-llm__msg').textContent).toBe('unsafe endpoint');
  });
});
