/**
 * circleMyData — the S5 "My data" screen. @vitest-environment happy-dom
 */
import { describe, it, expect, vi } from 'vitest';
import { renderCircleMyData } from '../web/v2/circleMyData.js';

const t = (k, v) => (v ? `${k}:${JSON.stringify(v)}` : k);

describe('renderCircleMyData', () => {
  it('shows the pod-local status + relay when not signed in', () => {
    const el = renderCircleMyData(document.createElement('div'), {
      t, podStatus: { signedIn: false },
      dataLocation: { relayOperator: 'Onderling', relayUrl: 'wss://relay.example' },
    });
    const kvs = [...el.querySelectorAll('.cc-mydata__kv')].map((r) => r.querySelector('.cc-mydata__v').textContent);
    expect(kvs).toContain('circle.mydata.pod_local');
    expect(kvs.some((v) => v.includes('Onderling') && v.includes('wss://relay.example'))).toBe(true);
  });

  it('shows pod root + signed-in status when on a pod', () => {
    const el = renderCircleMyData(document.createElement('div'), {
      t, podStatus: { signedIn: true, webid: 'https://me.pod/profile' },
      dataLocation: { podRoot: 'https://me.pod/' },
    });
    const text = el.textContent;
    expect(text).toContain('circle.mydata.pod_signed_in');
    expect(text).toContain('https://me.pod/');
  });

  it('lists privacy sections + usage metrics', () => {
    const el = renderCircleMyData(document.createElement('div'), {
      t,
      privacy: [{ title: 'Encryption', body: 'Messages are sealed before they leave the device.' }],
      metrics: { posts: 4, claims: 1 },
    });
    expect(el.querySelector('.cc-mydata__privacy-title').textContent).toBe('Encryption');
    expect(el.querySelector('.cc-mydata__privacy-body').textContent).toContain('sealed');
    const usage = [...el.querySelectorAll('.cc-mydata__kv')].map((r) => r.textContent).join('|');
    expect(usage).toContain('posts');
    expect(usage).toContain('4');
  });

  it('fires onBack', () => {
    const onBack = vi.fn();
    const el = renderCircleMyData(document.createElement('div'), { t, onBack });
    el.querySelector('.cc-mydata__back').click();
    expect(onBack).toHaveBeenCalled();
  });
});
