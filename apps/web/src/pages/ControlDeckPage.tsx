import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { ProviderDefinition, QueryMode, SponsorshipPreview } from "@query402/shared";
import {
  Activity,
  CheckCircle2,
  CircleDollarSign,
  Clock4,
  Gauge,
  Home,
  Radar,
  ReceiptText,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  XCircle
} from "lucide-react";
import { Link } from "react-router-dom";
import type { AnalyticsResponse, PaidQueryResponse } from "../types.js";
import { API_BASE_URL, fetchJson, money } from "../lib/api.js";
import {
  fetchSponsorshipEnabled,
  fetchSponsorshipPreview,
  runSponsoredPaidQuery
} from "../lib/sponsorship.js";
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
  const [isAnalyticsLoading, setIsAnalyticsLoading] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sponsorshipEnabled, setSponsorshipEnabled] = useState(false);
  const [preview, setPreview] = useState<SponsorshipPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);

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
    setIsAnalyticsLoading(true);
    try {
      const data = await fetchJson<AnalyticsResponse>(`${API_BASE_URL}/api/analytics`);
      setAnalytics(data);
    } finally {
      setIsAnalyticsLoading(false);
    }
  }

  const showAnalyticsSkeleton = isAnalyticsLoading && analytics === null;
  const hasUsageHistory = (analytics?.totalQueries ?? 0) > 0;

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

  // Preview the sponsorship grant status whenever the sponsored path is active
  // and the relevant inputs change. Aborts in-flight requests so rapid toggling
  // of mode/provider does not surface stale state.
  useEffect(() => {
    if (paymentMode !== "sponsored" || !walletConnected || !sponsorshipEnabled) {
      setPreview(null);
      setPreviewError(null);
      setIsPreviewLoading(false);
      return;
    }

    const controller = new AbortController();
    setIsPreviewLoading(true);
    setPreviewError(null);

    fetchSponsorshipPreview({
      apiBaseUrl: API_BASE_URL,
      wallet: walletState.address!,
      mode,
      provider: selectedProvider,
      signal: controller.signal
    })
      .then((result) => {
        if (!controller.signal.aborted) {
          setPreview(result);
        }
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        setPreview(null);
        if (err instanceof Error && err.name === "AbortError") {
          return;
        }
        setPreviewError(
          err instanceof Error ? err.message : "Grant preview unavailable"
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsPreviewLoading(false);
        }
      });

    return () => controller.abort();
  }, [
    paymentMode,
    walletConnected,
    sponsorshipEnabled,
    walletState.address,
    mode,
    selectedProvider
  ]);

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
            isLoading={showAnalyticsSkeleton}
          />
          <StatTile
            label="Spend"
            value={money(analytics?.totalSpendUsd ?? 0)}
            icon={<CircleDollarSign size={16} />}
            isLoading={showAnalyticsSkeleton}
          />
          <StatTile
            label="Search"
            value={money(analytics?.spendByCategory.search ?? 0)}
            icon={<Radar size={16} />}
            isLoading={showAnalyticsSkeleton}
          />
          <StatTile
            label="News"
            value={money(analytics?.spendByCategory.news ?? 0)}
            icon={<ReceiptText size={16} />}
            isLoading={showAnalyticsSkeleton}
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

          {paymentMode === "sponsored" && walletConnected && sponsorshipEnabled ? (
            <SponsorshipPreviewPanel
              preview={preview}
              loading={isPreviewLoading}
              error={previewError}
              providerName={selectedProviderDetails?.name ?? selectedProvider}
              walletAddress={walletState.address}
            />
          ) : null}

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
                  <span>
                    Exec: {result.result.execution.source}
                    {result.result.execution.fallbackReason
                      ? ` · ${result.result.execution.fallbackReason}`
                      : ""}
                  </span>
                </div>

                <div className="trace-box">
                  <p>payment-response: {result.payment.paymentResponseHeader ?? "<none>"}</p>
                  <p>network: {result.payment.network}</p>
                  {result.payment.evidence?.proofLinks && (
                    <div className="proof-links">
                      <p>
                        tx:{" "}
                        {result.payment.evidence.proofLinks.transaction !== "not_available" ? (
                          <a href={result.payment.evidence.proofLinks.transaction} target="_blank" rel="noreferrer">
                            {result.payment.evidence.transactionHash?.slice(0, 12)}...
                          </a>
                        ) : (
                          "not_available"
                        )}
                      </p>
                      <p>
                        payer:{" "}
                        {result.payment.evidence.proofLinks.payer !== "not_available" ? (
                          <a href={result.payment.evidence.proofLinks.payer} target="_blank" rel="noreferrer">
                            {result.payment.evidence.payer?.slice(0, 8)}...
                          </a>
                        ) : (
                          "not_available"
                        )}
                      </p>
                    </div>
                  )}
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
              {showAnalyticsSkeleton ? (
                <>
                  <span className="analytics-skeleton analytics-skeleton--orbital" />
                  <span className="analytics-skeleton analytics-skeleton--caption" />
                </>
              ) : (
                <>
                  <p>{money(analytics?.totalSpendUsd ?? 0)}</p>
                  <span>Total spend</span>
                </>
              )}
            </div>
          </div>

          <div className="analytics-panel">
            <h3>Spend by category</h3>
            {showAnalyticsSkeleton ? (
              <AnalyticsSkeletonRows count={3} />
            ) : !hasUsageHistory ? (
              <p className="panel-empty-note">
                No spend recorded yet. Run a paid query to see category breakdown.
              </p>
            ) : (
              <ul>
                <li>
                  <span>Search</span>
                  <strong>{money(analytics!.spendByCategory.search)}</strong>
                </li>
                <li>
                  <span>News</span>
                  <strong>{money(analytics!.spendByCategory.news)}</strong>
                </li>
                <li>
                  <span>Scrape</span>
                  <strong>{money(analytics!.spendByCategory.scrape)}</strong>
                </li>
              </ul>
            )}
          </div>

          <div className="analytics-panel">
            <h3>Execution reliability</h3>
            {showAnalyticsSkeleton ? (
              <AnalyticsSkeletonRows count={3} />
            ) : !hasUsageHistory ? (
              <p className="panel-empty-note">
                No execution telemetry yet. Run a query to see live and fallback counts.
              </p>
            ) : (
              <ul>
                <li>
                  <span>Live</span>
                  <strong>{analytics!.executionSummary.liveExecutions}</strong>
                </li>
                <li>
                  <span>Fallback</span>
                  <strong>{analytics!.executionSummary.fallbackExecutions}</strong>
                </li>
                <li>
                  <span>Timeouts</span>
                  <strong>{analytics!.executionSummary.timeoutExecutions}</strong>
                </li>
              </ul>
            )}
          </div>

          <div className="feed-panel">
            <h3>Recent transactions</h3>
            {showAnalyticsSkeleton ? (
              <AnalyticsSkeletonRows count={3} />
            ) : (analytics?.recentTransactions ?? []).length === 0 ? (
              <p className="panel-empty-note">
                No payments yet. Your x402 settlement history will show up here.
              </p>
            ) : (
              analytics!.recentTransactions.slice(0, 5).map((tx) => (
                <div key={tx.id} className="feed-row">
                  <p>
                    <span>{tx.providerId}</span>
                    <strong>{money(tx.amountUsd)}</strong>
                  </p>
                  <small>{new Date(tx.createdAt).toLocaleString()}</small>
                  {tx.transactionHash && (
                    <small className="proof-link">
                      <a
                        href={`https://stellar.expert/explorer/testnet/tx/${tx.transactionHash}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        tx: {tx.transactionHash.slice(0, 8)}...
                      </a>
                    </small>
                  )}
                </div>
              ))
            )}
          </div>

          <div className="feed-panel">
            <h3>Execution feed</h3>
            {showAnalyticsSkeleton ? (
              <AnalyticsSkeletonRows count={3} />
            ) : (analytics?.recentUsage ?? []).length === 0 ? (
              <p className="panel-empty-note">
                No executions yet. Query runs and latency traces will appear here.
              </p>
            ) : (
              analytics!.recentUsage.slice(0, 5).map((usage) => (
                <div key={usage.id} className="feed-row">
                  <p>
                    <span>
                      {usage.mode.toUpperCase()} · {usage.providerId}
                    </span>
                    <strong>{usage.latencyMs}ms</strong>
                  </p>
                  <small>
                    {money(usage.priceUsd)} · {new Date(usage.createdAt).toLocaleString()}
                    {usage.execution
                      ? ` · ${usage.execution.source}${
                          usage.execution.fallbackReason
                            ? ` (${usage.execution.fallbackReason})`
                            : ""
                        }`
                      : ""}
                  </small>
                </div>
              ))
            )}
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

function StatTile(props: { label: string; value: string; icon: ReactNode; isLoading?: boolean }) {
  return (
    <div className="stat-tile">
      <p>
        {props.icon}
        {props.label}
      </p>
      {props.isLoading ? (
        <span className="analytics-skeleton analytics-skeleton--value" />
      ) : (
        <strong>{props.value}</strong>
      )}
    </div>
  );
}

function AnalyticsSkeletonRows(props: { count: number }) {
  return (
    <div className="analytics-skeleton-rows">
      {Array.from({ length: props.count }, (_, index) => (
        <span key={index} className="analytics-skeleton analytics-skeleton--row" />
      ))}
    </div>
  );
}

function shortAddressInline(address: string) {
  if (address.length < 12) {
    return address;
  }
  return `${address.slice(0, 6)}...${address.slice(-6)}`;
}

function SponsorshipPreviewPanel(props: {
  preview: SponsorshipPreview | null;
  loading: boolean;
  error: string | null;
  providerName: string;
  walletAddress: string | undefined;
}) {
  const { preview, loading, error, providerName, walletAddress } = props;

  if (loading && !preview) {
    return (
      <div className="grant-preview-card" data-loading="true">
        <header className="grant-preview-head">
          <ShieldCheck size={14} />
          <h3>Sponsored grant status</h3>
          <span className="grant-preview-chip pending">checking…</span>
        </header>
        <div className="grant-preview-rows">
          <span className="analytics-skeleton analytics-skeleton--row" />
          <span className="analytics-skeleton analytics-skeleton--row" />
          <span className="analytics-skeleton analytics-skeleton--row" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="grant-preview-card denied" data-loading="false">
        <header className="grant-preview-head">
          <ShieldCheck size={14} />
          <h3>Sponsored grant status</h3>
          <span className="grant-preview-chip denied">
            <XCircle size={12} /> unavailable
          </span>
        </header>
        <p className="grant-preview-summary denied">
          Could not fetch grant status: {error}. Try reconnecting wallet or refresh the page.
        </p>
      </div>
    );
  }

  if (!preview) {
    return null;
  }

  const allowed = preview.available;
  const allowLabel = allowed ? "Policy will allow" : "Policy will deny";
  const allowSubtitle = allowed
    ? "A fresh grant will be issued on execute and consumed within the budget cap."
    : previewReasonCopy(preview.decision, preview.reason);

  const walletDisplay = walletAddress ? shortAddressInline(walletAddress) : "No wallet";
  const expiryCopy = preview.grant.expiresInSeconds
    ? `expires in ${formatDuration(preview.grant.expiresInSeconds)}`
    : "expired";
  const restrictionMode = preview.grant.restrictions.mode;
  const restrictionProvider = preview.grant.restrictions.providerId;

  return (
    <div className={allowed ? "grant-preview-card allowed" : "grant-preview-card denied"}>
      <header className="grant-preview-head">
        <ShieldCheck size={14} />
        <h3>Sponsored grant status</h3>
        <span
          className={
            allowed ? "grant-preview-chip allowed" : "grant-preview-chip denied"
          }
        >
          {allowed ? (
            <>
              <CheckCircle2 size={12} /> {allowLabel}
            </>
          ) : (
            <>
              <XCircle size={12} /> {allowLabel}
            </>
          )}
        </span>
      </header>

      <p className="grant-preview-summary">{allowSubtitle}</p>

      <div className="grant-preview-grid">
        <GrantRow
          label="Wallet"
          value={walletDisplay}
          tone="neutral"
        />
        <GrantRow
          label="Grant API"
          value={
            preview.sponsorshipEnabled && preview.storageAvailable
              ? "Hypothetical grant · ready"
              : preview.sponsorshipEnabled
                ? "Storage unavailable"
                : "Sponsorship disabled"
          }
          tone="neutral"
        />
        <GrantRow
          label="Max per grant"
          value={money(preview.grant.maxAmountUsd)}
          tone="neutral"
        />
        <GrantRow
          label="Grant TTL"
          value={
            <span>
              <Clock4 size={11} /> {expiryCopy}
            </span>
          }
          tone={
            preview.grant.expiresInSeconds === 0
              ? "deny"
              : preview.grant.expiresInSeconds < 30
                ? "warn"
                : "neutral"
          }
        />
        <GrantRow
          label="Provider"
          value={providerName}
          tone={allowed ? "neutral" : "warn"}
        />
        <GrantRow
          label="Restriction"
          value={
            restrictionMode && restrictionProvider
              ? `${restrictionMode}/${restrictionProvider}`
              : restrictionMode
                ? `mode=${restrictionMode}, any provider`
                : restrictionProvider
                  ? `provider=${restrictionProvider}, any mode`
                  : "no policy lock"
          }
          tone="neutral"
        />
        <GrantRow
          label="Request price"
          value={
            preview.quotedPriceUsd > 0 ? money(preview.quotedPriceUsd) : "—"
          }
          tone={preview.priceFitsGrant ? "ok" : "deny"}
        />
        <GrantRow
          label="Wallet budget"
          value={`${money(preview.perWalletBudget.spentUsd)} / ${money(preview.perWalletBudget.limitUsd)}`}
          tone={
            preview.perWalletBudget.remainingUsd <= 0 ? "deny" : "neutral"
          }
        />
      </div>

      {!allowed ? (
        <p className="grant-preview-actionable">
          {denyActionableCopy(preview.decision)}
        </p>
      ) : (
        <p className="grant-preview-actionable ok">
          Ready to execute. Funds will be reserved against the wallet budget before the paid run.
        </p>
      )}
    </div>
  );
}

function GrantRow(props: { label: string; value: ReactNode; tone: "ok" | "warn" | "deny" | "neutral" }) {
  return (
    <div className={`grant-preview-row tone-${props.tone}`}>
      <span className="grant-preview-label">{props.label}</span>
      <span className="grant-preview-value">{props.value}</span>
    </div>
  );
}

function formatDuration(totalSeconds: number) {
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) {
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return rem > 0 ? `${hours}h ${rem}m` : `${hours}h`;
}

function previewReasonCopy(decision: string, reason: string | undefined) {
  if (reason) {
    return `Policy will deny with ${decision} (${reason}). Adjust the request or grant, then retry.`;
  }
  return `Policy will deny with ${decision}. Adjust the request or grant, then retry.`;
}

function denyActionableCopy(decision: string) {
  switch (decision) {
    case "denied_sponsorship_disabled":
      return "Sponsorship is currently disabled on the API. Contact the operator or switch to wallet payment.";
    case "denied_storage_unavailable":
      return "Sponsorship storage is not reachable right now. Retry shortly or fall back to wallet payment.";
    case "denied_wrong_provider":
      return "This provider is not available for sponsored runs. Pick another provider for this mode or switch to wallet payment.";
    case "denied_price_exceeded":
      return "The selected provider costs more than the grant cap. Pick a cheaper provider or wait for a fresh grant with a higher cap.";
    case "denied_expired":
      return "A grant signal was already issued but is expired. Re-run to mint a new one.";
    case "denied_budget_exceeded":
      return "The daily sponsored budget is exhausted. Try again tomorrow, switch wallets, or fall back to wallet payment.";
    default:
      return "Policy will deny this request. See the reason above and adjust inputs.";
  }
}
