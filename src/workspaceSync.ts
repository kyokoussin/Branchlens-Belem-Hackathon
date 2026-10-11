import type { WorkspaceConfig } from './portfolioWorkspace';

export async function syncWorkspace(config: WorkspaceConfig, send: typeof fetch = fetch): Promise<string | undefined> {
  try {
    const response = await send('/api/workflow?action=workspace', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(config),
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return `Saved in this browser. Server sync is unavailable (HTTP ${response.status}).`;
  } catch {
    return 'Saved in this browser. Server sync is unavailable.';
  }
  return undefined;
}
