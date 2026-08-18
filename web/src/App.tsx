import { useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { Market, TradeRow, Settings } from './store';
import {
  useStore,
  connectPat,
  logout,
  startAutomation,
  stopAutomation,
  arm,
  selectMarket,
  manualTrade,
} from './store';

type Page = 'home' | 'history' | 'stats' | 'account';

const CURRENCY_SYMBOL: Record<string, string> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  AUD: 'A$',
  CAD: 'C$',
  SGD: 'S$',
  MYR: 'RM',
  IDR: 'Rp',
  JPY: '¥',
};

function fmtMoney(n: number, currency = ''): string {
  const symbol = CURRENCY_SYMBOL[currency] ?? (currency ? `${currency} ` : '');
  return `${symbol}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtSigned(n: number, currency = ''): string {
  const symbol = CURRENCY_SYMBOL[currency] ?? (currency ? `${currency} ` : '');
  return `${n >= 0 ? '+' : '-'}${symbol}${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function shortMarketName(display: string): string {
  return display.split('(')[0].trim().replace(/\s*Index$/, '');
}

function sideLabel(direction: string, barrier: number): string {
  return direction === 'under' ? `Under ${9 - barrier}` : `Over ${barrier}`;
}

const STRATEGY_META: Record<Settings['strategy_mode'], { label: string; hint: string }> = {
  conservative: { label: 'Conservative', hint: 'Flat bet every round' },
  martingale: { label: 'Martingale', hint: 'Redo bet, double stake on loss' },
  boosted_martingale: { label: 'Boosted Martingale', hint: 'Redo bet, raise stake to recover' },
};

export function App(): JSX.Element {
  const s = useStore();
  const [page, setPage] = useState<Page>('home');

  if (!s.session) return <ConnectView />;

  return (
    <>
      <main class="app" data-page={page}>
        <div class="view view-home">
          <HomePage page={page} onNavigate={setPage} />
        </div>
        <div class="desk-side">
          <div class="view view-history">
            <HistoryPage />
          </div>
          <div class="view view-stats">
            <StatsPage />
          </div>
          <div class="view view-account">
            <AccountPage />
          </div>
        </div>
      </main>
      <BottomNav page={page} setPage={setPage} />
    </>
  );
}

function ConnectView(): JSX.Element {
  const s = useStore();
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  return (
    <main class="app app--page">
      <div class="header">
        <div class="header-top">
          <div class="brand">
            <div class="logo">
              <span class="logo-zero"></span>
              <span class="logo-nine"></span>
            </div>
            <div class="brand-title">
              <span class="zero">Zero</span><span class="nine">Nine</span>
            </div>
          </div>
        </div>
        <div class="subtitle">Connect your Deriv account to start the bot</div>
      </div>

      <div class="connect-card">
        <div class="connect-title">API Token</div>
        <input
          class="connect-input"
          type="password"
          placeholder="Paste your Deriv API token"
          value={token}
          onInput={(e: any) => setToken(e.currentTarget.value)}
        />
        <button
          class="connect-btn"
          disabled={busy || !token.trim()}
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              await connectPat(token.trim());
            } catch (e) {
              setError(String(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? 'Connecting…' : 'Connect'}
        </button>
        {error && <div class="connect-err">{error}</div>}
        <div class="connect-hint">Demo account • API token only • No OAuth required</div>
        {s.ws === 'closed' && <div class="connect-err">Feed disconnected – reconnecting…</div>}
      </div>
    </main>
  );
}

function HomePage({ page, onNavigate }: { page: Page; onNavigate: (p: Page) => void }): JSX.Element {
  const s = useStore();
  const [now, setNow] = useState(() => Date.now() / 1000);
  const [startError, setStartError] = useState('');
  const [manualBusy, setManualBusy] = useState(false);
  const [manualMsg, setManualMsg] = useState('');
  const [configAnchor, setConfigAnchor] = useState<{ x: number; y: number } | null>(null);
  const [strategy, setStrategy] = useState<Settings['strategy_mode']>('conservative');
  const [stakeText, setStakeText] = useState('1');
  const [maxTradesText, setMaxTradesText] = useState('0');

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => window.clearInterval(id);
  }, []);

  const market = s.markets.find((m) => m.symbol === s.selected) ?? s.markets[0];
  const marketIndex = s.markets.findIndex((m) => m.symbol === market?.symbol);
  const automation = s.automation?.running ?? false;
  const decision = s.decision?.decision;

  const winCount = s.trades.filter((t) => t.status === 'won').length;
  const lossCount = s.trades.filter((t) => t.status === 'lost').length;
  const profit = s.trades.reduce((acc, t) => acc + (t.profit ?? 0), 0);

  const activeSide = decision ? sideLabel(decision.direction, decision.barrier) : 'Over 0';

  const lastTrade = s.trades[0];
  const betLabel = lastTrade
    ? lastTrade.contract_type === 'DIGITOVER'
      ? `Over ${lastTrade.barrier}`
      : `Under ${9 - lastTrade.barrier}`
    : '';
  const pnlValue = lastTrade?.profit ?? 0;
  const won = lastTrade?.status === 'won';
  const lost = lastTrade?.status === 'lost';
  const pending = lastTrade?.status === 'pending';
  const resultClass = won ? 'win' : lost ? 'loss' : 'exp';
  const resultLabel = pending
    ? 'Settling…'
    : won
      ? 'WIN'
      : lost
        ? 'LOSS'
        : lastTrade
          ? 'UNRESOLVED'
          : '';

  const period = market?.ticksPerMin ? Math.max(1, Math.round(60 / market.ticksPerMin)) : 1;
  const elapsed = market?.lastEpoch ? Math.max(0, now - market.lastEpoch) : 0;
  const secondsLeft = market?.lastEpoch ? Math.max(1, period - (Math.floor(elapsed) % period)) : period;
  const circumference = 176;
  const progress = circumference - (secondsLeft / period) * circumference;

  const openConfig = (e: { currentTarget: HTMLElement }) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setStrategy(s.settings?.strategy_mode ?? 'conservative');
    setStakeText(String(s.settings?.base_stake ?? 1));
    setMaxTradesText('0');
    setStartError('');
    setConfigAnchor({ x: rect.left + rect.width / 2, y: rect.bottom });
  };

  const toggleBot = async (e?: { currentTarget: HTMLElement }) => {
    setStartError('');
    if (automation) {
      try {
        await stopAutomation();
      } catch (err) {
        setStartError(err instanceof Error ? err.message : String(err));
      }
      return;
    }
    if (e) {
      openConfig(e);
      return;
    }
    await startFromConfig();
  };

  const startFromConfig = async (): Promise<void> => {
    setConfigAnchor(null);
    setStartError('');
    try {
      const stake = Math.max(0.1, Number(stakeText) || 0);
      const maxTrades = Math.max(0, Math.floor(Number(maxTradesText) || 0));
      if (s.session?.mode === 'real') await arm();
      await startAutomation({
        strategyMode: strategy,
        baseStake: stake,
        maxTrades: maxTrades > 0 ? maxTrades : undefined,
      });
    } catch (err) {
      setStartError(err instanceof Error ? err.message : String(err));
    }
  };

  const placeManual = async (direction: 'over' | 'under') => {
    if (!market || manualBusy) return;
    setManualBusy(true);
    setManualMsg('');
    try {
      const stake = s.settings?.base_stake ?? 1;
      const barrier = decision?.barrier ?? (direction === 'under' ? 9 : 1);
      await manualTrade({ market: market.symbol, direction, barrier, stake });
      setManualMsg(`${direction === 'over' ? 'Over' : 'Under'} ${direction === 'under' ? 9 - barrier : barrier} @ ${stake}`);
    } catch (e) {
      setManualMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setManualBusy(false);
    }
  };

  return (
    <>
      <header class="header">
        <div class="header-top">
          <div class="brand">
            <div class="logo">
              <span class="logo-zero"></span>
              <span class="logo-nine"></span>
            </div>
            <div class="brand-title">
              <span class="zero">Zero</span><span class="nine">Nine</span>
            </div>
          </div>
          <nav class="desktop-nav">
            <button class={`nav-link${page === 'home' ? ' active' : ''}`} onClick={() => onNavigate('home')}>Home</button>
            <button class={`nav-link${page === 'history' ? ' active' : ''}`} onClick={() => onNavigate('history')}>History</button>
            <button class={`nav-link${page === 'stats' ? ' active' : ''}`} onClick={() => onNavigate('stats')}>Stats</button>
            <button class={`nav-link${page === 'account' ? ' active' : ''}`} onClick={() => onNavigate('account')}>Account</button>
          </nav>
          <button class="header-bot" onClick={(e) => void toggleBot(e)}>
            <div class="control-icon" style={{ borderRadius: automation ? '3px' : '50%' }}></div>
            <span>{automation ? 'Stop Bot' : 'Start Bot'}</span>
          </button>
          <div class="balance">
            <div class="balance-amount">{fmtMoney(s.session?.balance ?? 0, s.session?.currency)}</div>
            <button class="balance-add">+</button>
          </div>
        </div>
        <div class="subtitle">
          Auto-cycling • Betting <span>{activeSide}</span>
        </div>
      </header>

      <div class="dashboard">
        <div class="dash-main">
          <section class="trade-card">
            <div class="market-head">
              <div class="live">
                <div class="live-dot"></div>
                {s.feed?.connected ? 'LIVE' : 'OFFLINE'}
              </div>
              <div class="market-position">
                {marketIndex >= 0 ? `Market ${marketIndex + 1} / ${s.markets.length}` : '—'}
              </div>
            </div>

            <div class="market-title-row">
              <div>
                <div class="market-name">{market ? market.display : 'Loading…'}</div>
                <div class="market-meta">↗ <span>Synthetic Index</span></div>
              </div>
              <div class="countdown">
                <svg viewBox="0 0 64 64">
                  <circle class="count-bg" cx="32" cy="32" r="28" />
                  <circle
                    class="count-progress"
                    cx="32"
                    cy="32"
                    r="28"
                    style={{ strokeDashoffset: String(progress) }}
                  />
                </svg>
                <div class="count-content">
                  <div class="count-number">{String(secondsLeft).padStart(2, '0')}</div>
                  <div class="count-label">SEC</div>
                </div>
              </div>
            </div>

            <div class="chart-box">
              <ChartCanvas market={market} />
              <div class="tick-badge">{market?.lastQuote != null ? market.lastQuote.toFixed(2) : '--'}</div>
            </div>

            <div class="contracts">
              {lastTrade ? (
                <>
                  <div class="contract bet">
                    <div class="contract-label">Bet</div>
                    <div class="contract-name">{betLabel}</div>
                    <div class="contract-sub">{fmtMoney(lastTrade.stake, s.session?.currency)} → {fmtMoney(lastTrade.est_win, s.session?.currency)}</div>
                  </div>
                  <div class={`contract pnl ${resultClass}`}>
                    <div class="contract-label">PnL</div>
                    <div class="contract-name">{fmtSigned(pnlValue, s.session?.currency)}</div>
                    <div class="contract-sub">{resultLabel}</div>
                  </div>
                </>
              ) : (
                <div class="contract bet empty">
                  <div class="contract-label">Bet</div>
                  <div class="contract-name">No positions</div>
                  <div class="contract-sub">Start the bot to begin trading</div>
                </div>
              )}
            </div>

            <div class="bot-status">
              Betting: <strong>{activeSide}</strong>
              <span class="strategy-pill">{STRATEGY_META[s.settings?.strategy_mode ?? strategy].label}</span>
              {s.automation?.runTarget ? (
                <span class="race-pill">{s.automation?.runTrades ?? 0}/{s.automation?.runTarget}</span>
              ) : null}
              <span class="check">✓</span>
            </div>

            {s.hold?.reason && automation && (
              <div class="bot-hold">{s.hold.reason}</div>
            )}

            {startError && <div class="bot-error">{startError}</div>}

            <div class="manual-bets">
              <button class="manual-btn over" disabled={!market || manualBusy} onClick={() => placeManual('over')}>
                {manualBusy ? '…' : 'Bet Over'}
              </button>
              <button class="manual-btn under" disabled={!market || manualBusy} onClick={() => placeManual('under')}>
                {manualBusy ? '…' : 'Bet Under'}
              </button>
            </div>
            {manualMsg && <div class="manual-msg">{manualMsg}</div>}

            <button class="bot-control" onClick={(e) => void toggleBot(e)}>
              <div class="control-icon" style={{ borderRadius: automation ? '3px' : '50%' }}></div>
              <span>{automation ? 'Stop Bot' : 'Start Bot'}</span>
            </button>
          </section>

          <section class="stats">
            <div class="stat win">
              <div class="stat-value">{winCount}</div>
              <div class="stat-label">Wins</div>
            </div>
            <div class="stat loss">
              <div class="stat-value">{lossCount}</div>
              <div class="stat-label">Losses</div>
            </div>
            <div class={`stat profit${profit >= 0 ? '' : ' negative'}`}>
              <div class="stat-value">{fmtSigned(profit, s.session?.currency)}</div>
              <div class="stat-label">Profit</div>
            </div>
          </section>
        </div>

        <div class="dash-side">
          <section class="section">
            <div class="section-head">
              <div class="section-title">Market Cycle</div>
              <button class="section-action" onClick={() => onNavigate('stats')}>View All →</button>
            </div>
            <div class="market-scroll">
              {s.markets.map((m) => (
                <MarketCard key={m.symbol} market={m} active={m.symbol === market?.symbol} />
              ))}
            </div>
          </section>

          <section class="section">
            <div class="section-head">
              <div class="section-title">Recent Activity</div>
              <button class="section-action" onClick={() => onNavigate('history')}>View All →</button>
            </div>
            <div class="activity">
              {s.trades.length === 0 && <div class="empty-hint">No trades yet – start the bot</div>}
              {s.trades.slice(0, 6).map((t) => (
                <ActivityRow key={t.id} trade={t} />
              ))}
            </div>
          </section>
        </div>
      </div>

      {configAnchor && (
        <div class="bot-config-overlay" onClick={() => setConfigAnchor(null)}>
          <div
            class="bot-config"
            role="dialog"
            aria-label="Bot configuration"
            style={{ left: `${configAnchor.x}px`, top: `${configAnchor.y + 10}px` }}
            onClick={(e) => e.stopPropagation()}
          >
            <div class="bcfg-caret"></div>
            <div class="bcfg-title">Bot Setup</div>

            <div class="bcfg-group">
              <div class="bcfg-label">Strategy</div>
              {(Object.keys(STRATEGY_META) as Settings['strategy_mode'][]).map((key) => (
                <button
                  key={key}
                  class={`bcfg-option${strategy === key ? ' active' : ''}`}
                  onClick={() => setStrategy(key)}
                >
                  <span class="bcfg-option-name">{STRATEGY_META[key].label}</span>
                  <span class="bcfg-option-hint">{STRATEGY_META[key].hint}</span>
                  <span class="bcfg-radio">{strategy === key ? '●' : '○'}</span>
                </button>
              ))}
            </div>

            <div class="bcfg-row">
              <label class="bcfg-field">
                <span>Amount ({s.session?.currency || 'USD'})</span>
                <input
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={stakeText}
                  onInput={(e) => setStakeText((e.target as HTMLInputElement).value)}
                />
              </label>
              <label class="bcfg-field">
                <span>Max trades</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={maxTradesText}
                  placeholder="0 = unlimited"
                  onInput={(e) => setMaxTradesText((e.target as HTMLInputElement).value)}
                />
              </label>
            </div>

            <div class="bcfg-actions">
              <button class="bcfg-cancel" onClick={() => setConfigAnchor(null)}>Cancel</button>
              <button class="bcfg-start" onClick={() => void startFromConfig()}>Start Bot</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function MarketCard({ market, active }: { market: Market; active: boolean }): JSX.Element {
  const hasDigit = market.lastDigit >= 0;
  const digit = hasDigit ? market.lastDigit : '–';
  const points = (market.recentDigits.length >= 2 ? market.recentDigits.slice(-12) : [4, 5, 4, 6, 5, 7, 6, 8, 7, 6, 8, 7])
    .map((d, i, arr) => {
      const x = (i / (arr.length - 1)) * 120;
      const y = 33 - Math.min(9, d) * 2.6;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <div
      class={`market-card${active ? ' active' : ''}`}
      onClick={() => selectMarket(market.symbol)}
    >
      <div class="market-card-top">
        <div class="market-symbol">{digit}</div>
        <div>
          <div class="market-card-name">{shortMarketName(market.display)}</div>
          <div class="market-card-type">Synthetic</div>
        </div>
      </div>
      <div class="spark">
        <svg viewBox="0 0 120 35" preserveAspectRatio="none">
          <polyline points={points} fill="none" stroke="#8f4cff" stroke-width="1.5" />
        </svg>
      </div>
      <div class="market-bottom">
        <span class="market-digit">{hasDigit ? `Digit ${digit}` : 'waiting'}</span>
        <span class="market-change">LIVE</span>
      </div>
    </div>
  );
}

function ActivityRow({ trade }: { trade: TradeRow }): JSX.Element {
  const win = trade.status === 'won';
  const loss = trade.status === 'lost';
  const exp = trade.status === 'expired' || trade.status === 'timeout';
  const err = trade.status === 'error';
  const pend = trade.status === 'pending';
  const icon = win ? '↑' : loss ? '↓' : pend ? '…' : exp ? '∅' : '!';
  const side = trade.contract_type === 'DIGITOVER' ? 'over' : 'under';
  const label = trade.contract_type === 'DIGITOVER' ? `Over ${trade.barrier}` : `Under ${9 - trade.barrier}`;
  const pnl = trade.profit ?? 0;

  const badge = win
    ? { text: 'Win', cls: 'win' }
    : loss
      ? { text: 'Loss', cls: 'loss' }
      : exp
        ? { text: 'Expired', cls: 'push' }
        : err
          ? { text: 'Error', cls: 'push' }
          : { text: 'Open', cls: 'push' };

  return (
    <div class="activity-row">
      <div class={`activity-icon${exp || err || pend ? ' push' : loss ? ' down' : ''}`}>{icon}</div>
      <div>
        <div class="activity-name">
          {label}
          {trade.exit_digit != null && trade.exit_digit >= 0 && (
            <span class="activity-exit"> → digit {trade.exit_digit}</span>
          )}
        </div>
        <div class="activity-market">
          {trade.market} • {new Date(trade.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
        <div class="activity-market">
          stake ${trade.stake} • payout {trade.payout != null ? trade.payout.toFixed(2) : '—'}
        </div>
      </div>
      <div>
        <div class={`activity-side ${side}`}>{label}</div>
        <div class={win ? 'pnl-win' : loss ? 'pnl-loss' : 'pnl-zero'}>
          {pend || exp || err ? '—' : fmtSigned(pnl, '$')}
        </div>
      </div>
      <div class={`result ${badge.cls}`}>{badge.text}</div>
    </div>
  );
}

function ChartCanvas({ market }: { market?: Market }): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const valuesRef = useRef<number[]>([]);
  const lastQuote = market?.lastQuote;

  useEffect(() => {
    if (lastQuote == null) return;
    const arr = valuesRef.current;
    if (arr[arr.length - 1] !== lastQuote) {
      valuesRef.current = [...arr.slice(-44), lastQuote];
    }
  }, [lastQuote]);

  useEffect(() => {
    drawChart(canvasRef.current, valuesRef.current);
  }, [lastQuote]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawChart(canvas, valuesRef.current);

    const onResize = () => drawChart(canvasRef.current, valuesRef.current);
    window.addEventListener('resize', onResize);

    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined' && canvas.parentElement) {
      observer = new ResizeObserver(() => drawChart(canvasRef.current, valuesRef.current));
      observer.observe(canvas.parentElement);
    }

    return () => {
      window.removeEventListener('resize', onResize);
      observer?.disconnect();
    };
  }, []);

  return <canvas ref={canvasRef}></canvas>;
}

function drawChart(canvas: HTMLCanvasElement | null, chartValues: number[]): void {
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const width = rect.width;
  const height = rect.height;
  ctx.clearRect(0, 0, width, height);

  const values = chartValues.length >= 2 ? chartValues : [0, 0];
  const padding = 9;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  ctx.strokeStyle = 'rgba(255,255,255,.055)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    const y = height * (i / 4);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  const points = values.map((value, index) => {
    const x = padding + (index / (values.length - 1)) * (width - padding * 2);
    const y = padding + (1 - (value - min) / range) * (height - padding * 2);
    return { x, y };
  });

  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, 'rgba(143,76,255,.24)');
  gradient.addColorStop(1, 'rgba(143,76,255,0)');
  ctx.beginPath();
  ctx.moveTo(points[0].x, height);
  points.forEach((p) => ctx.lineTo(p.x, p.y));
  ctx.lineTo(points[points.length - 1].x, height);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();

  const lineGradient = ctx.createLinearGradient(0, 0, width, 0);
  lineGradient.addColorStop(0, '#8f4cff');
  lineGradient.addColorStop(0.7, '#a45cff');
  lineGradient.addColorStop(1, '#ff4d91');
  ctx.beginPath();
  points.forEach((p, index) => {
    if (index === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  ctx.strokeStyle = lineGradient;
  ctx.lineWidth = 2.3;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();

  const last = points[points.length - 1];
  ctx.beginPath();
  ctx.arc(last.x, last.y, 4, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(last.x, last.y, 7, 0, Math.PI * 2);
  ctx.strokeStyle = '#a45cff';
  ctx.lineWidth = 2;
  ctx.stroke();
}

function HistoryPage(): JSX.Element {
  const s = useStore();
  return (
    <>
      <header class="header">
        <div class="page-title">Trade History</div>
      </header>
      <div class="activity">
        {s.trades.length === 0 && <div class="empty-hint">No trades yet</div>}
        {s.trades.map((t) => (
          <ActivityRow key={t.id} trade={t} />
        ))}
      </div>
    </>
  );
}

function StatsPage(): JSX.Element {
  const s = useStore();
  const trades = s.trades;
  const wins = trades.filter((t) => t.status === 'won').length;
  const losses = trades.filter((t) => t.status === 'lost').length;
  const profit = trades.reduce((acc, t) => acc + (t.profit ?? 0), 0);
  const total = trades.length;
  const winRate = wins + losses > 0 ? ((wins / (wins + losses)) * 100).toFixed(1) : '0.0';
  const avg = total > 0 ? profit / total : 0;
  const currency = s.session?.currency ?? '';

  return (
    <>
      <header class="header">
        <div class="page-title">Statistics</div>
      </header>
      <section class="stats">
        <div class="stat win"><div class="stat-value">{wins}</div><div class="stat-label">Wins</div></div>
        <div class="stat loss"><div class="stat-value">{losses}</div><div class="stat-label">Losses</div></div>
        <div class={`stat profit${profit >= 0 ? '' : ' negative'}`}><div class="stat-value">{fmtSigned(profit, currency)}</div><div class="stat-label">Profit</div></div>
      </section>
      <div class="section">
        <Detail label="Total Trades" value={String(total)} />
        <Detail label="Win Rate" value={`${winRate}%`} color={parseFloat(winRate) > 50 ? 'green' : 'red'} />
        <Detail label="Average Profit" value={fmtSigned(avg, currency)} color={avg >= 0 ? 'green' : 'red'} />
        <Detail label="Recovery Mode" value={s.recovery?.mode === 'recovering' ? 'Active' : 'Idle'} />
        <Detail label="Recovery Streak" value={String(s.recovery?.streak ?? 0)} />
      </div>
    </>
  );
}

function AccountPage(): JSX.Element {
  const s = useStore();
  const session = s.session;
  return (
    <>
      <header class="header">
        <div class="page-title">Account</div>
      </header>
      <div class="section">
        <Detail label="Login ID" value={session?.loginid ?? '—'} />
        <Detail label="Balance" value={fmtMoney(session?.balance ?? 0, session?.currency)} />
        <Detail label="Currency" value={session?.currency ?? '—'} />
        <Detail label="Mode" value={session?.mode === 'demo' ? 'Demo' : 'Real'} />
        <Detail label="Bot Status" value={s.automation?.running ? 'Running' : 'Stopped'} color={s.automation?.running ? 'green' : 'red'} />
      </div>
      <button class="logout-btn" onClick={() => void logout()}>Log Out</button>
    </>
  );
}

function Detail({ label, value, color }: { label: string; value: string; color?: 'green' | 'red' }): JSX.Element {
  return (
    <div class="detail-row">
      <span class="detail-label">{label}</span>
      <span class={`detail-value${color ? ` ${color}` : ''}`}>{value}</span>
    </div>
  );
}

function BottomNav({ page, setPage }: { page: Page; setPage: (p: Page) => void }): JSX.Element {
  const s = useStore();
  const automation = s.automation?.running ?? false;

  const toggleBot = async () => {
    try {
      if (automation) {
        await stopAutomation();
      } else {
        if (s.session?.mode === 'real') await arm();
        await startAutomation();
      }
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div class="bottom-nav-wrap">
      <nav class="bottom-nav">
        <button class={`nav-item${page === 'home' ? ' active' : ''}`} onClick={() => setPage('home')}>
          <div class="nav-icon">⌂</div>
          Home
        </button>
        <button class={`nav-item${page === 'history' ? ' active' : ''}`} onClick={() => setPage('history')}>
          <div class="nav-icon">↶</div>
          History
        </button>
        <button class="nav-item bot" onClick={toggleBot}>
          <div class="nav-icon">
            <div class="bot-square" style={{ borderRadius: automation ? '3px' : '50%' }}></div>
          </div>
          Bot
        </button>
        <button class={`nav-item${page === 'stats' ? ' active' : ''}`} onClick={() => setPage('stats')}>
          <div class="nav-icon">▥</div>
          Stats
        </button>
        <button class={`nav-item${page === 'account' ? ' active' : ''}`} onClick={() => setPage('account')}>
          <div class="nav-icon">○</div>
          Account
        </button>
      </nav>
    </div>
  );
}
