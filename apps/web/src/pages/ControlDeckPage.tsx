import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { ProviderDefinition, QueryMode } from "@query402/shared";
import {
  Activity,
  CircleDollarSign,
  Gauge,
  Home,
  Radar,
  ReceiptText,
  Sparkles,
  TerminalSquare
} from "lucide-react";
import { Link } from "react-router-dom";
import type { AnalyticsResponse, PaidQueryResponse } from "../types.js";
import { API_BASE_URL, fetchJson, money } from "../lib/api.js";
import { fetchSponsorshipEnabled, runSponsoredPaidQuery } from "../lib/sponsorship.js";
import { runWalletPaidQuery } from "../lib/x402.js";
import { WalletSessionMachine, FreighterAdapter, type WalletState } from "../lib/wallet/index.js";

const modeLabels: Record<QueryMode, string> = {
  search: "Search",
  news: "News",
  scrape: "Scrape"
};

const modeDefaultProvider: Record<QueryMode, string> = {
  search: "search.basic",
  news: "news.fast",
  scrape: "scrape.page"
};

const TOKEN_SYMBOL = "USDC";
const TOKEN_DECIMALS = 7;

function toTokenBaseUnits(amountUsd: number) {
  const normalizedAmount = amountUsd.toFixed(TOKEN_DECIMALS);
  return normalizedAmount.replace(".", "").replace(/^0+/, "") || "0";
}

export default function ControlDeckPage() {
  const [mode, setMode] = useState<QueryMode>("search");
  const [paymentMode, setPaymentMode] = useState<"wallet" | "sponsored">("wallet");
  const [walletState, setWalletState] = useState<WalletState>({ status: "disconnected" });

  const walletMachine = useMemo(() => {
    const machine = new WalletSessionMachine("Test SDF Network ; September 2015");
    machine.setAdapter(new FreighterAdapter());
    return machine;
  }, []);

  useEffect(() => {
    return walletMachine.subscribe(setWalletState);
  }, [walletMachine]);
  const [queryInput, setQueryInput] = useState("latest stellar x402 updates");
  const [urlInput, setUrlInput] = useState("https://developers.stellar.org");
  const [providers, setProviders] = useState<ProviderDefinition[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<string>(modeDefaultProvider.search);
  const [result, setResult] = useState<PaidQueryResponse | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sponsorshipEnabled, setSponsorshipEnabled] = useState(false);

  const modeProviders = useMemo(
    () => providers.filter((provider) => provider.category === mode && provider.enabled),
    [providers, mode]
  );

  const selectedProviderDetails = useMemo(
    () => modeProviders.find((provider) => provider.id === selectedProvider),
    [modeProviders, selectedProvider]
  );

  const activeInput = mode === "scrape" ? urlInput : queryInput;
  const walletConnected = walletState.status === "connected";
  const estimatedTokenAmount =
    selectedProviderDetails?.priceUsd.toFixed(TOKEN_DECIMALS) ?? "0.0000000";
  const estimatedTokenBaseUnits = selectedProviderDetails
    ? toTokenBaseUnits(selectedProviderDetails.priceUsd)
    : "0";

  function shortAddress(address: string) {
    if (address.length < 12) {
      return address;
    }
    return `${address.slice(0, 6)}...${address.slice(-6)}`;
  }

  async function connectWallet() {
    setError(null);
    try {
      await walletMachine.connect();
    } catch (e: any) {
      setError(e.message);
    }
  }

  function disconnectWallet() {
    setError(null);
    walletMachine.disconnect();
  }

  async function refreshMetrics() {
    const data = await fetchJson<AnalyticsResponse>(`${API_BASE_URL}/api/analytics`);
    setAnalytics(data);
  }

  useEffect(() => {
    async function bootstrap() {
      const [providersResponse, sponsorshipActive] = await Promise.all([
        fetchJson<{ providers: ProviderDefinition[] }>(`${API_BASE_URL}/api/providers`),
        fetchSponsorshipEnabled(API_BASE_URL)
      ]);
      setProviders(providersResponse.providers);
      setSelectedProvider(modeDefaultProvider.search);
      setSponsorshipEnabled(sponsorshipActive);
      await refreshMetrics();
    }

    bootstrap().catch((bootstrapError) => {
      setError(
        bootstrapError instanceof Error ? bootstrapError.message : "Failed to load API data"
      );
    });
  }, []);

  useEffect(() => {
    const first = modeProviders[0];
    if (first && !modeProviders.some((provider) => provider.id === selectedProvider)) {
      setSelectedProvider(first.id);
    }
  }, [modeProviders, selectedProvider]);

  useEffect(() => {
    if (!walletConnected && paymentMode === "sponsored") {
      setPaymentMode("wallet");
    }
  }, [walletConnected, paymentMode]);

  useEffect(() => {
    if (!sponsorshipEnabled && paymentMode === "sponsored") {
      setPaymentMode("wallet");
    }
  }, [sponsorshipEnabled, paymentMode]);

  async function runPaidQuery() {
    setIsLoading(true);
    setError(null);

    try {
      if (paymentMode === "sponsored" && !walletState.address) {
        throw new Error("Connect wallet before running a sponsored query");
      }

      const data =
        paymentMode === "wallet"
          ? await runWalletPaidQuery({
              apiBaseUrl: API_BASE_URL,
              mode,
              provider: selectedProvider,
              query: mode === "scrape" ? undefined : queryInput,
              url: mode === "scrape" ? urlInput : undefined,
              wallet: walletMachine
            })
          : await runSponsoredPaidQuery({
              apiBaseUrl: API_BASE_URL,
              mode,
              provider: selectedProvider,
              query: mode === "scrape" ? undefined : queryInput,
              url: mode === "scrape" ? urlInput : undefined,
              walletAddress: walletState.address!
            });

      setResult(data);
      await refreshMetrics();
    } catch (runError) {
      if (runError instanceof Error) {
        setError(runError.message);
        if (runError.message.toLowerCase().includes("reject")) {
          // Normalize rejection
          setError("Transaction rejected by user");
        } else {
          setError("Query failed");
        }
      }
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="q402-shell">
      <div className="q402-gridline" />
      <div className="q402-noise" />

      <header className="bridge control-topbar" id="control-deck">
        <div className="bridge-left lift-in">
          <p className="stamp">
            <Sparkles size={13} /> Query402 Control Deck
          </p>
          <h1>Agentic internet access, paid per request.</h1>
          <p className="subtitle">
            On Stellar testnet, pick a provider through the x402 flow, pay per query, and audit the
            trace instantly.
          </p>
          <Link className="ghost-btn topbar-link" to="/">
            <Home size={14} /> Back to landing
          </Link>
        </div>

        <div className="bridge-right lift-in delay-1">
          <div className="control-wallet-bar">
            <div className="wallet-row">
              <button
                type="button"
                className="wallet-btn"
                onClick={connectWallet}
                disabled={walletConnected || walletState.status === "connecting"}
              >
                {walletState.status === "connecting" ? "Connecting..." : "Connect Wallet"}
              </button>
              <button
                type="button"
                className="wallet-btn ghost"
                onClick={disconnectWallet}
                disabled={!walletConnected}
              >
                Disconnect
              </button>
              <span className={walletConnected ? "wallet-status connected" : "wallet-status"}>
                {walletConnected
                  ? `Connected: ${shortAddress(walletState.address!)}`
                  : walletState.status}
              </span>
            </div>
          </div>

          <StatTile
            label="Queries"
            value={String(analytics?.totalQueries ?? 0)}
            icon={<Activity size={16} />}
          />
          <StatTile
            label="Spend"
            value={money(analytics?.totalSpendUsd ?? 0)}
            icon={<CircleDollarSign size={16} />}
          />
          <StatTile
            label="Search"
            value={money(analytics?.spendByCategory.search ?? 0)}
            icon={<Radar size={16} />}
          />
          <StatTile
            label="News"
            value={money(analytics?.spendByCategory.news ?? 0)}
            icon={<ReceiptText size={16} />}
          />
        </div>
      </header>

      <main className="dock">
        <section className="bay bay--left lift-in delay-2">
          <div className="bay-head">
            <h2>Query Bay</h2>
            <span>{modeLabels[mode]} mode</span>
          </div>

          <div className="mode-switch">
            {(Object.keys(modeLabels) as QueryMode[]).map((item) => (
              <button
                key={item}
                className={mode === item ? "mode-btn active" : "mode-btn"}
                onClick={() => setMode(item)}
                type="button"
              >
                {modeLabels[item]}
              </button>
            ))}
          </div>

          <div className="input-shell">
            <label>{mode === "scrape" ? "TARGET URL" : "RESEARCH QUERY"}</label>
            {mode === "scrape" ? (
              <input
                value={urlInput}
                onChange={(event) => setUrlInput(event.target.value)}
                placeholder="https://example.com"
              />
            ) : (
              <input
                value={queryInput}
                onChange={(event) => setQueryInput(event.target.value)}
                placeholder="latest stellar x402 updates"
              />
            )}

            <label>PAYMENT MODE (Hackathon)</label>
            <div className="payment-mode-switch">
              <button
                type="button"
                className={
                  paymentMode === "sponsored" ? "payment-mode-btn active" : "payment-mode-btn"
                }
                onClick={() => setPaymentMode("sponsored")}
                disabled={!walletConnected || !sponsorshipEnabled}
              >
                Sponsored tx
              </button>
              <button
                type="button"
                className={
                  paymentMode === "wallet" ? "payment-mode-btn active" : "payment-mode-btn"
                }
                onClick={() => setPaymentMode("wallet")}
                disabled={!walletConnected}
              >
                Wallet tx
              </button>
            </div>
            <p className="wallet-hint">
              Sponsored mode requires wallet connection for ownership proof and an enabled
              sponsorship policy on the API.
              {!sponsorshipEnabled ? " Sponsorship is currently disabled on the API." : null}
            </p>
          </div>

          <div className="provider-strip">
            {modeProviders.length === 0 ? (
              <p className="empty-note" style={{ margin: "1rem" }}>
                No providers enabled for {modeLabels[mode]} mode.
              </p>
            ) : (
              modeProviders.map((provider, index) => (
                <button
                  key={provider.id}
                  onClick={() => setSelectedProvider(provider.id)}
                  className={
                    provider.id === selectedProvider ? "provider-card selected" : "provider-card"
                  }
                  style={{ animationDelay: `${index * 70}ms` }}
                  type="button"
                >
                  <p className="provider-name">{provider.name}</p>
                  <p className="provider-desc">{provider.description}</p>
                  <div className="provider-metrics">
                    <span>{money(provider.priceUsd)}</span>
                    <span>{provider.latencyEstimateMs}ms</span>
                    <span>Q{provider.qualityScore}</span>
                    <span className={`source-badge ${provider.sourceType}`}>
                      {provider.sourceType}
                    </span>
                  </div>
                </button>
              ))
            )}
          </div>

          <div className="action-row preflight">
            <div>
              <p className="action-label">Provider lock</p>
              <p className="action-value">{selectedProviderDetails?.name ?? "Choose provider"}</p>
              <p className="action-label">
                Mode: {paymentMode === "sponsored" ? "Sponsored" : "Wallet"}
              </p>
            </div>
            <div className="preflight-details">
              <p className="action-label">
                Network:{" "}
                <strong>{walletState.network ?? "Test SDF Network ; September 2015"}</strong>
              </p>
              <p className="action-label">
                Asset: <strong>{TOKEN_SYMBOL}</strong>
              </p>
              <p className="action-label">
                Amount: <strong>{estimatedTokenAmount}</strong> ({estimatedTokenBaseUnits} base
                units)
              </p>
              <p className="action-label">
                Pay-to: <strong>dynamic via x402</strong>
              </p>
            </div>
            <button
              className="run-btn"
              onClick={runPaidQuery}
              disabled={
                isLoading ||
                walletState.status === "signing" ||
                !selectedProviderDetails ||
                !walletConnected
              }
              type="button"
            >
              {isLoading || walletState.status === "signing" ? "Executing..." : "Run paid query"}
              <TerminalSquare size={16} />
            </button>
          </div>

          {walletState.error && <p className="error-box">Wallet Error: {walletState.error}</p>}
          {error ? <p className="error-box">{error}</p> : null}

          <div className="result-zone sweep">
            <div className="bay-head bay-head--compact">
              <h2>Signal Output</h2>
              <span>
                {result ? new Date(result.result.timestamp).toLocaleTimeString() : "waiting"}
              </span>
            </div>

            {!result ? (
              <p className="empty-note">Waiting for results. Start a query from the left panel.</p>
            ) : (
              <>
                <div className="result-meta">
                  <span>{result.result.providerName}</span>
                  <span>{money(result.result.priceUsd)}</span>
                  <span>{result.result.latencyMs}ms</span>
                  <span>{result.result.traceId.slice(0, 12)}</span>
                  <span className={`source-badge ${result.result.source}`}>
                    Source: {result.result.source}
                  </span>
                </div>

                <div className="trace-box">
                  <p>payment-response: {result.payment.paymentResponseHeader ?? "<none>"}</p>
                  <p>network: {result.payment.network}</p>
                </div>

                <div className="item-stack">
                  {result.result.items.map((item) => (
                    <article key={`${item.url}-${item.title}`}>
                      <h3>{item.title}</h3>
                      <a href={item.url} target="_blank" rel="noreferrer">
                        {item.url}
                      </a>
                      <p>{item.snippet}</p>
                    </article>
                  ))}
                </div>
              </>
            )}
          </div>
        </section>

        <aside className="bay bay--right lift-in delay-3">
          <div className="orbital">
            <div className="orbital-center">
              <Gauge size={20} />
              <p>{money(analytics?.totalSpendUsd ?? 0)}</p>
              <span>Total spend</span>
            </div>
          </div>

          <div className="analytics-panel">
            <h3>Spend by category</h3>
            <ul>
              <li>
                <span>Search</span>
                <strong>{money(analytics?.spendByCategory.search ?? 0)}</strong>
              </li>
              <li>
                <span>News</span>
                <strong>{money(analytics?.spendByCategory.news ?? 0)}</strong>
              </li>
              <li>
                <span>Scrape</span>
                <strong>{money(analytics?.spendByCategory.scrape ?? 0)}</strong>
              </li>
            </ul>
          </div>

          <div className="feed-panel">
            <h3>Recent transactions</h3>
            {(analytics?.recentTransactions ?? []).slice(0, 5).map((tx) => (
              <div key={tx.id} className="feed-row">
                <p>
                  <span>{tx.providerId}</span>
                  <strong>{money(tx.amountUsd)}</strong>
                </p>
                <small>{new Date(tx.createdAt).toLocaleString()}</small>
              </div>
            ))}
          </div>

          <div className="feed-panel">
            <h3>Execution feed</h3>
            {(analytics?.recentUsage ?? []).slice(0, 5).map((usage) => (
              <div key={usage.id} className="feed-row">
                <p>
                  <span>
                    {usage.mode.toUpperCase()} · {usage.providerId}
                  </span>
                  <strong>{usage.latencyMs}ms</strong>
                </p>
                <small>
                  {money(usage.priceUsd)} · {new Date(usage.createdAt).toLocaleString()}
                </small>
              </div>
            ))}
          </div>

          <div className="script-panel">
            <h3>Live payload preview</h3>
            <pre>
              {JSON.stringify(
                {
                  mode,
                  route: paymentMode,
                  provider: selectedProvider,
                  input: activeInput,
                  sponsorshipEnabled
                },
                null,
                2
              )}
            </pre>
          </div>
        </aside>
      </main>
    </div>
  );
}

function StatTile(props: { label: string; value: string; icon: ReactNode }) {
  return (
    <div className="stat-tile">
      <p>
        {props.icon}
        {props.label}
      </p>
      <strong>{props.value}</strong>
    </div>
  );
}
