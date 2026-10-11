import { useState } from 'react';
import type { PortfolioData } from './model';
import type { ManagedPosition, WorkspaceConfig } from './portfolioWorkspace';
import { validIdentifier, validAmount } from './portfolioWorkspace';

type Draft = Omit<ManagedPosition, 'id' | 'description'>;
const blank = (portfolioId: string): Draft => ({ name: '', address: '', chainId: 1, amountUsd: '', portfolioId });
const money = (value: string) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(value));

export function ManagePositions({ config, data, onCommit }: { config: WorkspaceConfig; data: PortfolioData | null; onCommit: (next: WorkspaceConfig, verify?: { address: string; chainId: 1 | 8453 }) => Promise<void> }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(() => blank(config.portfolios[0]?.id || 'demo'));
  const [portfolioName, setPortfolioName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renamed, setRenamed] = useState('');
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  async function apply(next: WorkspaceConfig, verify?: { address: string; chainId: 1 | 8453 }) {
    setWorking(true); setError(''); setMessage('');
    try { await onCommit(next, verify); setMessage('Saved. Portfolio totals and dependency impact have been recalculated.'); setEditingId(null); setDraft(blank(next.portfolios[0]?.id || 'demo')); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save the change.'); }
    finally { setWorking(false); }
  }
  function beginEdit(position: ManagedPosition) { setEditingId(position.id); setDraft({ name: position.name, address: position.address, chainId: position.chainId, amountUsd: position.amountUsd, portfolioId: position.portfolioId }); setError(''); setMessage(''); }
  async function savePosition() {
    const address = draft.address.trim(); const name = draft.name.trim();
    if (!validIdentifier(address)) { setError('Enter a 42-character Morpho V1 vault address or a 66-character Morpho market ID.'); return; }
    if (!validAmount(draft.amountUsd)) { setError('Enter a positive USD amount with at most two decimal places.'); return; }
    if (!config.portfolios.some((item) => item.id === draft.portfolioId)) { setError('Select a portfolio.'); return; }
    const previous = config.positions.find((item) => item.id === editingId);
    const position: ManagedPosition = { id: previous?.id || crypto.randomUUID(), ...draft, name, address, description: previous?.description || 'Analyst-configured illustrative Morpho position.' };
    const next: WorkspaceConfig = { ...config, positions: previous ? config.positions.map((item) => item.id === previous.id ? position : item) : [...config.positions, position] };
    await apply(next, !previous || previous.address.toLowerCase() !== address.toLowerCase() || previous.chainId !== draft.chainId ? { address, chainId: draft.chainId } : undefined);
  }
  async function removePosition(position: ManagedPosition) {
    if (!window.confirm(`Remove ${position.name || position.address} from this demo portfolio? Its assumed capital and exposure will be removed.`)) return;
    await apply({ ...config, positions: config.positions.filter((item) => item.id !== position.id) });
  }
  async function createPortfolio() {
    const name = portfolioName.trim(); if (!name) { setError('Enter a portfolio name.'); return; }
    await apply({ ...config, portfolios: [...config.portfolios, { id: crypto.randomUUID(), name }] }); setPortfolioName('');
  }
  async function renamePortfolio(id: string) {
    const name = renamed.trim(); if (!name) { setError('Enter a portfolio name.'); return; }
    await apply({ ...config, portfolios: config.portfolios.map((item) => item.id === id ? { ...item, name } : item) }); setRenamingId(null);
  }
  async function removePortfolio(id: string) {
    const item = config.portfolios.find((portfolio) => portfolio.id === id); const destination = config.portfolios.find((portfolio) => portfolio.id !== id);
    if (!item || !destination) { setError('Create another portfolio before deleting the last one.'); return; }
    const count = config.positions.filter((position) => position.portfolioId === id).length;
    if (!window.confirm(`Delete ${item.name}? ${count} position${count === 1 ? '' : 's'} will move to ${destination.name}.`)) return;
    await apply({ ...config, portfolios: config.portfolios.filter((portfolio) => portfolio.id !== id), positions: config.positions.map((position) => position.portfolioId === id ? { ...position, portfolioId: destination.id } : position) });
  }
  return <div className="management-page"><div className="eyebrow">ILLUSTRATIVE HOLDINGS · BROWSER STORAGE</div><h1>Manage Positions</h1><p>Portfolio names and assumed amounts stay in this browser. Vault state and dependencies come from Morpho; no wallet is connected.</p>
    {error && <div className="form-error" role="alert">{error}</div>}{message && <div className="form-success" role="status">{message}</div>}
    <section className="card manage-section"><h2>Portfolios</h2><div className="portfolio-management-list">{config.portfolios.map((portfolio) => <div key={portfolio.id}><strong>{portfolio.name}</strong><span>{config.positions.filter((position) => position.portfolioId === portfolio.id).length} positions</span>{renamingId === portfolio.id ? <><input aria-label={`Rename ${portfolio.name}`} value={renamed} onChange={(event) => setRenamed(event.target.value)} /><button onClick={() => void renamePortfolio(portfolio.id)} disabled={working}>Save</button><button onClick={() => setRenamingId(null)}>Cancel</button></> : <><button onClick={() => { setRenamingId(portfolio.id); setRenamed(portfolio.name); }}>Rename</button><button onClick={() => void removePortfolio(portfolio.id)} disabled={working || config.portfolios.length === 1}>Delete</button></>}</div>)}</div><div className="inline-form"><input aria-label="New portfolio name" placeholder="New portfolio name" value={portfolioName} onChange={(event) => setPortfolioName(event.target.value)} /><button onClick={() => void createPortfolio()} disabled={working}>Create portfolio</button></div></section>
    <section className="card manage-section"><h2>{editingId ? 'Edit position' : 'Add a Morpho vault or market position'}</h2><div className="position-form"><label>Position name <small>Optional; defaults to the verified vault or market name</small><input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="e.g. Treasury USDC allocation" /></label><label>Vault address or market ID<input value={draft.address} onChange={(event) => setDraft({ ...draft, address: event.target.value })} placeholder="0x… (40 hex address or 64 hex market ID)" spellCheck={false} /></label><label>Chain<select value={draft.chainId} onChange={(event) => setDraft({ ...draft, chainId: Number(event.target.value) as 1 | 8453 })}><option value={1}>Ethereum</option><option value={8453}>Base</option></select></label><label>Illustrative investment amount (USD)<input type="number" min="0.01" step="0.01" value={draft.amountUsd} onChange={(event) => setDraft({ ...draft, amountUsd: event.target.value })} placeholder="100000" /></label><label>Portfolio<select value={draft.portfolioId} onChange={(event) => setDraft({ ...draft, portfolioId: event.target.value })}>{config.portfolios.map((portfolio) => <option value={portfolio.id} key={portfolio.id}>{portfolio.name}</option>)}</select></label></div><div className="form-actions"><button className="primary" onClick={() => void savePosition()} disabled={working}>{working ? 'Validating Morpho data…' : editingId ? 'Save position' : 'Add and analyze position'}</button>{editingId && <button onClick={() => { setEditingId(null); setDraft(blank(config.portfolios[0].id)); }}>Cancel edit</button>}</div><p className="smallnote">Use a real Morpho V1 vault address or a Morpho market ID on Ethereum or Base. Holdings and amounts are hypothetical; market and vault state is retrieved from Morpho.</p></section>
    <section className="card manage-section"><h2>Tracked positions</h2>{config.positions.length ? config.portfolios.map((portfolio) => <div key={portfolio.id} className="managed-group"><h3>{portfolio.name}</h3>{config.positions.filter((position) => position.portfolioId === portfolio.id).map((position) => { const loaded = data?.positions.find((item) => item.id === position.id); return <div key={position.id} className="managed-row"><div><strong>{position.name || loaded?.analysis.vault.name || position.address}</strong><small>{position.chainId === 1 ? 'Ethereum' : 'Base'} · {position.address.length === 66 ? 'Market' : 'Vault'} · {loaded?.analysis.vault.asset.symbol || 'Morpho'} · {money(position.amountUsd)} assumed</small><code>{position.address}</code></div><div><button onClick={() => beginEdit(position)}>Edit</button><button onClick={() => void removePosition(position)} disabled={working}>Remove</button></div></div>; })}</div>) : <p>No positions are tracked. Add a verified vault or market above to begin.</p>}</section>
  </div>;
}
