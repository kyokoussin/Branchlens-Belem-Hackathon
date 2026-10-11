import { describe, expect, it, vi } from 'vitest';
import { syncWorkspace } from '../src/workspaceSync.ts';

const workspace = { version: 1, portfolios: [{ id: 'demo', name: 'Demo' }], positions: [] };

describe('optional server sync for browser-saved positions', () => {
  it('reports a GET-only response without throwing or losing the browser save', async () => {
    const send = vi.fn(async () => ({ ok: false, status: 405 }));
    await expect(syncWorkspace(workspace, send)).resolves.toContain('Saved in this browser');
    expect(send).toHaveBeenCalledWith('/api/workflow?action=workspace', expect.objectContaining({ method: 'POST', body: JSON.stringify(workspace) }));
  });

  it('reports a network failure without throwing', async () => {
    await expect(syncWorkspace(workspace, async () => { throw new Error('offline'); })).resolves.toContain('Saved in this browser');
  });

  it('has no warning when server sync succeeds', async () => {
    await expect(syncWorkspace(workspace, async () => ({ ok: true }))).resolves.toBeUndefined();
  });
});
