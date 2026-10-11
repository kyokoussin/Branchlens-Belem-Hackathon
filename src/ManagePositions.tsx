import { useEffect, useMemo, useRef, useState } from 'react';
import Decimal from 'decimal.js';
import { fetchMorphoMarketCatalog, type CatalogMarket } from '../api/_morphoClient.mjs';
import type { PortfolioData } from './model';
import type { ManagedPosition, WorkspaceConfig } from './portfolioWorkspace';
import { validIdentifier, validAmount, verifySubject } from './portfolioWorkspace';

type Draft = Omit<ManagedPosition, 'id' | 'description'>;
const blank = (portfolioId: string): Draft => ({ name: '', address: '', chainId: 1, amountUsd: '', portfolioId, positionType: 'supply', borrowDebtUsd: '' });
const money = (value: string | null | undefined) => value == null ? 'Unavailable' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(value));
const shortId = (value: string) => value.length > 20 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value;

export function ManagePositions({ config, data, onCommit }: { config: WorkspaceConfig; data: PortfolioData | null; onCommit: (next: WorkspaceConfig, verify?: { address: string; chainId: 1 | 8453 }) => Promise<string | undefined> }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(() => blank(config.portfolios[0]?.id || 'demo'));
  const [portfolioName, setPortfolioName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renamed, setRenamed] = useState('');
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [catalog, setCatalog] = useState<CatalogMarket[]>([]);
  const [nextSkip, setNextSkip] = useState<number | null>(null);
  const [catalogAt, setCatalogAt] = useState('');
  const [catalogBusy, setCatalogBusy] = useState(false);
  const [catalogError, setCatalogError] = useState('');
  const [search, setSearch] = useState('');
  const [collateralFilter, setCollateralFilter] = useState('');
  const [loanFilter, setLoanFilter] = useState('');
  const [selectedMarket, setSelectedMarket] = useState<CatalogMarket | null>(null);
  const [verifiedMarketId, setVerifiedMarketId] = useState('');
  const [verifiedAt, setVerifiedAt] = useState('');
  const [verifying, setVerifying] = useState(false);
  const catalogRequest = useRef(0);
  const selectionRequest = useRef(0);

  async function loadMarkets(reset: boolean, chainId: 1 | 8453) {
    const skip = reset ? 0 : nextSkip;
    if (skip == null) return;
    const request = ++catalogRequest.current;
    setCatalogBusy(true); setCatalogError('');
    try {
      const result = await fetchMorphoMarketCatalog({ chainId, skip, limit: 50 });
      if (request !== catalogRequest.current) return;
      setCatalog((current) => reset ? result.items : [...new Map([...current, ...result.items].map((item) => [item.marketId, item])).values()]);
      setNextSkip(result.nextSkip); setCatalogAt(result.retrievedAt);
    } catch (cause) {
      if (request === catalogRequest.current) setCatalogError(cause instanceof Error ? cause.message : 'Morpho market catalog unavailable.');
    } finally { if (request === catalogRequest.current) setCatalogBusy(false); }
  }
  useEffect(() => {
    setCatalog([]); setNextSkip(null); setSelectedMarket(null); setVerifiedMarketId(''); setVerifiedAt('');
    void loadMarkets(true, draft.chainId);
    return () => { catalogRequest.current++; selectionRequest.current++; };
  }, [draft.chainId]);

  const collateralOptions = useMemo(() => [...new Map(catalog.map((item) => [item.collateral.address, item.collateral])).values()].sort((a, b) => a.symbol.localeCompare(b.symbol)), [catalog]);
  const loanOptions = useMemo(() => [...new Map(catalog.map((item) => [item.loan.address, item.loan])).values()].sort((a, b) => a.symbol.localeCompare(b.symbol)), [catalog]);
  const matches = useMemo(() => catalog.filter((item) => {
    const query = search.trim().toLowerCase();
    return (!collateralFilter || item.collateral.address === collateralFilter)
      && (!loanFilter || item.loan.address === loanFilter)
      && (!query || [item.collateral.symbol, item.loan.symbol, item.collateral.address, item.loan.address, item.marketId, item.oracleAddress || ''].some((part) => part.toLowerCase().includes(query)));
  }), [catalog, search, collateralFilter, loanFilter]);

  async function chooseMarket(item: CatalogMarket) {
    const request = ++selectionRequest.current;
    setSelectedMarket(item); setVerifiedMarketId(''); setVerifiedAt(''); setVerifying(true); setError('');
    try {
      const entry = await verifySubject(item.marketId, item.chainId);
      const raw = entry.raw as { marketId?: string; chain?: { id?: number } };
      if (request !== selectionRequest.current) return;
      if (raw.marketId?.toLowerCase() !== item.marketId || raw.chain?.id !== item.chainId) throw new Error('Morpho returned a different market identity.');
      setVerifiedMarketId(item.marketId); setVerifiedAt(String(entry.provenance.retrievedAt || entry.capturedAt));
      setDraft((current) => ({ ...current, address: item.marketId, chainId: item.chainId, name: current.name }));
    } catch (cause) {
      if (request === selectionRequest.current) setError(cause instanceof Error ? cause.message : 'Could not verify the selected market.');
    } finally { if (request === selectionRequest.current) setVerifying(false); }
  }

  async function apply(next: WorkspaceConfig, verify?: { address: string; chainId: 1 | 8453 }) {
    setWorking(true); setError(''); setMessage('');
    try {
      const syncNotice = await onCommit(next, verify);
      setMessage(syncNotice || 'Saved. The simulated position and verified market dependencies now appear in the portfolio graph.');
      setEditingId(null); setDraft(blank(next.portfolios[0]?.id || 'demo')); setSelectedMarket(null); setVerifiedMarketId('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save the change.'); }
    finally { setWorking(false); }
  }
  function beginEdit(position: ManagedPosition) {
    setEditingId(position.id);
    setDraft({ name: position.name, address: position.address, chainId: position.chainId, amountUsd: position.amountUsd, portfolioId: position.portfolioId, positionType: position.positionType || 'supply', borrowDebtUsd: position.borrowDebtUsd || '' });
    setSelectedMarket(null); setVerifiedMarketId(''); setError(''); setMessage('');
  }
  async function savePosition() {
    const address = draft.address.trim(); const name = draft.name.trim();
    const previous = config.positions.find((item) => item.id === editingId);
    if (!editingId && (!selectedMarket || verifiedMarketId !== address)) { setError('Select a market from the live Morpho list and wait for verification.'); return; }
    if (!validIdentifier(address)) { setError('Select a verified Morpho market.'); return; }
    if (!validAmount(draft.amountUsd)) { setError('Enter a positive simulated USD amount with at most two decimal places.'); return; }
    if (!config.portfolios.some((item) => item.id === draft.portfolioId)) { setError('Select a portfolio.'); return; }
    const positionType = draft.positionType || 'supply';
    if (positionType === 'borrow') {
      if ((!previous || previous.address.toLowerCase() !== address.toLowerCase() || previous.chainId !== draft.chainId) && verifiedMarketId !== address) { setError('Choose and verify the new borrow market from the Morpho list.'); return; }
      if (address.length !== 66 || !validAmount(draft.borrowDebtUsd || '')) { setError('A simulated borrow needs a market and a positive USD debt amount.'); return; }
      const currentLltv = data?.positions.find((item) => item.id === editingId)?.analysis.vault.allocations[0]?.lltv;
      const rawLltv = selectedMarket?.marketId === address ? selectedMarket.lltv : currentLltv == null ? null : new Decimal(currentLltv).mul('1000000000000000000').toString();
      if (rawLltv == null) { setError('Borrowing needs a verified market liquidation threshold.'); return; }
      const limit = new Decimal(draft.amountUsd).mul(rawLltv).div('1000000000000000000');
      if (new Decimal(draft.borrowDebtUsd!).gt(limit)) { setError(`Simulated debt exceeds this market's verified LLTV. Maximum at the entered collateral value: ${money(limit.toString())}.`); return; }
    }
    const position: ManagedPosition = {
      id: previous?.id || crypto.randomUUID(), ...draft, name, address, positionType,
      borrowDebtUsd: positionType === 'borrow' ? draft.borrowDebtUsd : undefined,
      description: address.length === 66 ? `Simulated ${positionType} position in a verified Morpho market.` : previous?.description || 'Analyst-configured illustrative Morpho vault position.',
    };
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

  return <div className="management-page"><div className="eyebrow">REAL MARKETS · SIMULATED HOLDINGS</div><h1>Manage Positions</h1><p>Browse public Morpho markets and model an investment. No Morpho account, wallet or cryptocurrency is needed. Your assumed holdings stay in this browser; the market relationships come from Morpho.</p>
    {error && <div className="form-error" role="alert">{error}</div>}{message && <div className="form-success" role="status">{message}</div>}
    <section className="card manage-section"><h2>Portfolios</h2><div className="portfolio-management-list">{config.portfolios.map((portfolio) => <div key={portfolio.id}><strong>{portfolio.name}</strong><span>{config.positions.filter((position) => position.portfolioId === portfolio.id).length} positions</span>{renamingId === portfolio.id ? <><input aria-label={`Rename ${portfolio.name}`} value={renamed} onChange={(event) => setRenamed(event.target.value)} /><button onClick={() => void renamePortfolio(portfolio.id)} disabled={working}>Save</button><button onClick={() => setRenamingId(null)}>Cancel</button></> : <><button onClick={() => { setRenamingId(portfolio.id); setRenamed(portfolio.name); }}>Rename</button><button onClick={() => void removePortfolio(portfolio.id)} disabled={working || config.portfolios.length === 1}>Delete</button></>}</div>)}</div><div className="inline-form"><input aria-label="New portfolio name" placeholder="New portfolio name" value={portfolioName} onChange={(event) => setPortfolioName(event.target.value)} /><button onClick={() => void createPortfolio()} disabled={working}>Create portfolio</button></div></section>
    <section className="card manage-section" aria-label="Add Position"><div className="eyebrow">1 · SELECT A REAL MARKET</div><h2>{editingId ? 'Edit simulated position' : 'Add Position'}</h2><p className="smallnote">Listed Morpho Blue markets, ordered by reported supply. Search and filters apply to loaded markets; load more to browse further.</p>
      <div className="position-form"><label>Blockchain<select aria-label="Blockchain" value={draft.chainId} onChange={(event) => { setDraft({ ...draft, chainId: Number(event.target.value) as 1 | 8453, address: '' }); setSearch(''); setCollateralFilter(''); setLoanFilter(''); }}><option value={1}>Ethereum</option><option value={8453}>Base</option></select></label><label>Search markets<input type="search" aria-label="Search Morpho markets" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Token, market ID or address" /></label><label>Collateral asset<select aria-label="Collateral asset" value={collateralFilter} onChange={(event) => setCollateralFilter(event.target.value)}><option value="">All collateral assets</option>{collateralOptions.map((asset) => <option value={asset.address} key={asset.address}>{asset.symbol} · {shortId(asset.address)}</option>)}</select></label><label>Loan asset<select aria-label="Loan asset" value={loanFilter} onChange={(event) => setLoanFilter(event.target.value)}><option value="">All loan assets</option>{loanOptions.map((asset) => <option value={asset.address} key={asset.address}>{asset.symbol} · {shortId(asset.address)}</option>)}</select></label></div>
      <div className="form-actions"><button onClick={() => { setSearch(''); setCollateralFilter(''); setLoanFilter(''); }}>Reset filters</button><span className="smallnote">{matches.length} matching market{matches.length === 1 ? '' : 's'} · {catalog.length} loaded{catalogAt ? ` · Morpho retrieved ${new Date(catalogAt).toLocaleString()}` : ''}</span></div>
      {catalogError && <p className="form-error" role="alert">{catalogError} <button onClick={() => void loadMarkets(true, draft.chainId)}>Retry</button></p>}
      <div className="market-picker-list" aria-label="Real Morpho markets">{matches.map((item) => <button type="button" className={selectedMarket?.marketId === item.marketId ? 'market-picker-row selected' : 'market-picker-row'} key={item.marketId} onClick={() => void chooseMarket(item)}><strong>{item.collateral.symbol} / {item.loan.symbol}</strong><span>Supply {money(item.supplyUsd)} · Borrow {money(item.borrowUsd)} · LLTV {item.lltv == null ? 'unavailable' : `${new Decimal(item.lltv).div('10000000000000000').toFixed(0)}%`}</span><code>{shortId(item.marketId)}</code></button>)}</div>
      {!catalogBusy && !matches.length && <p className="smallnote">No matching markets in this page. Adjust filters or load more markets.</p>}
      <div className="form-actions">{nextSkip != null && <button onClick={() => void loadMarkets(false, draft.chainId)} disabled={catalogBusy}>{catalogBusy ? 'Loading…' : 'Load more real markets'}</button>}{catalogBusy && <span className="smallnote">Loading Morpho markets…</span>}</div>
      {selectedMarket && <div className="market-detail card"><div className="eyebrow">VERIFIED MARKET DETAILS · REAL MORPHO DATA</div><h3>{selectedMarket.collateral.symbol} / {selectedMarket.loan.symbol} · {selectedMarket.chainId === 1 ? 'Ethereum' : 'Base'}</h3><p><strong>Market ID</strong> <code>{selectedMarket.marketId}</code></p><p><strong>Collateral</strong> {selectedMarket.collateral.symbol} · <code>{selectedMarket.collateral.address}</code></p><p><strong>Loan asset</strong> {selectedMarket.loan.symbol} · <code>{selectedMarket.loan.address}</code></p><p><strong>Oracle</strong> {selectedMarket.oracleType || 'Type unavailable'} · <code>{selectedMarket.oracleAddress || 'Address unavailable'}</code></p><p><strong>LLTV</strong> {selectedMarket.lltv == null ? 'Unavailable' : `${new Decimal(selectedMarket.lltv).div('10000000000000000').toFixed(2)}%`} · <strong>Supply</strong> {money(selectedMarket.supplyUsd)} · <strong>Borrow</strong> {money(selectedMarket.borrowUsd)} · <strong>Liquidity</strong> {money(selectedMarket.liquidityUsd)}</p><p className="smallnote">{verifying ? 'Retrieving full dependency data from Morpho…' : verifiedMarketId === selectedMarket.marketId ? `Full market and dependency data verified ${new Date(verifiedAt).toLocaleString()}.` : 'Select a market with verified full dependency data before adding it.'}</p></div>}
    </section>
    <section className="card manage-section"><div className="eyebrow">2 · MODEL A SIMULATED POSITION</div><h2>No wallet required</h2><div className="position-form"><label>Position type<select aria-label="Simulated position type" value={draft.positionType || 'supply'} onChange={(event) => setDraft({ ...draft, positionType: event.target.value as 'supply' | 'borrow', borrowDebtUsd: '' })}><option value="supply">Supply loan asset</option><option value="borrow">Borrow against collateral</option></select></label><label>Position name <small>Optional; defaults to the real market name</small><input aria-label="Position name" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="e.g. My simulated USDC supply" /></label><label>{draft.positionType === 'borrow' ? 'Simulated collateral value (USD)' : 'Simulated supplied amount (USD)'}<input aria-label={draft.positionType === 'borrow' ? 'Simulated collateral value (USD)' : 'Simulated supplied amount (USD)'} type="number" min="0.01" step="0.01" value={draft.amountUsd} onChange={(event) => setDraft({ ...draft, amountUsd: event.target.value })} placeholder="10000" /></label>{draft.positionType === 'borrow' && <label>Simulated debt value (USD)<input aria-label="Simulated debt value (USD)" type="number" min="0.01" step="0.01" value={draft.borrowDebtUsd || ''} onChange={(event) => setDraft({ ...draft, borrowDebtUsd: event.target.value })} placeholder="6000" /></label>}<label>Portfolio<select aria-label="Position portfolio" value={draft.portfolioId} onChange={(event) => setDraft({ ...draft, portfolioId: event.target.value })}>{config.portfolios.map((portfolio) => <option value={portfolio.id} key={portfolio.id}>{portfolio.name}</option>)}</select></label>{editingId && <label>Linked market or legacy vault ID<input aria-label="Linked market or vault ID" value={draft.address} onChange={(event) => { setDraft({ ...draft, address: event.target.value }); setVerifiedMarketId(''); }} spellCheck={false} /></label>}</div><div className="form-actions"><button className="primary" onClick={() => void savePosition()} disabled={working || verifying}>{working ? 'Saving and analyzing…' : editingId ? 'Save position' : 'Add simulated position'}</button>{editingId && <button onClick={() => { setEditingId(null); setDraft(blank(config.portfolios[0].id)); }}>Cancel edit</button>}</div><p className="smallnote">Amounts are hypothetical USD values, not tokens in a wallet. Supply uses assumed supplied principal; borrow uses assumed collateral value and debt. The graph uses the selected market's real IDs, assets, oracle and dependencies.</p></section>
    <section className="card manage-section"><h2>Tracked positions</h2>{config.positions.length ? config.portfolios.map((portfolio) => <div key={portfolio.id} className="managed-group"><h3>{portfolio.name}</h3>{config.positions.filter((position) => position.portfolioId === portfolio.id).map((position) => { const loaded = data?.positions.find((item) => item.id === position.id); return <div key={position.id} className="managed-row"><div><strong>{position.name || loaded?.analysis.vault.name || position.address}</strong><small>{position.chainId === 1 ? 'Ethereum' : 'Base'} · {position.address.length === 66 ? 'Real Morpho market' : 'Real Morpho vault'} · SIMULATED {position.positionType === 'borrow' ? 'BORROW' : 'SUPPLY'} · {position.positionType === 'borrow' ? `collateral ${money(position.amountUsd)} · debt ${money(position.borrowDebtUsd)}` : `${money(position.amountUsd)} supplied`}</small><code>{position.address}</code></div><div><button onClick={() => beginEdit(position)}>Edit</button><button onClick={() => void removePosition(position)} disabled={working}>Remove</button></div></div>; })}</div>) : <p>No simulated positions are tracked. Choose a verified market above to begin.</p>}</section>
  </div>;
}
