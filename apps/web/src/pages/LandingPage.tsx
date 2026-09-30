import { useEffect, useState } from "react";
import { Activity, ArrowRight, ShieldCheck, Sparkles, WalletCards } from "lucide-react";
import { Link } from "react-router-dom";
import type { ProviderDefinition } from "@query402/shared";
import type { AnalyticsResponse } from "../types.js";
import { API_BASE_URL, fetchJson, money } from "../lib/api.js";

export default function LandingPage() {
  const [analytics, setAnalytics] = useState<AnalyticsResponse | null>(null);
  const [providerCount, setProviderCount] = useState(0);

  useEffect(() => {
    async function bootstrap() {
      const [analyticsRes, providersRes] = await Promise.all([
        fetchJson<AnalyticsResponse>(`${API_BASE_URL}/api/analytics`),
        fetchJson<{ providers: ProviderDefinition[] }>(`${API_BASE_URL}/api/providers`)
      ]);

      setAnalytics(analyticsRes);
      setProviderCount(providersRes.providers.filter((provider) => provider.enabled).length);
    }

    bootstrap().catch(() => {
      setAnalytics(null);
      setProviderCount(0);
    });
  }, []);

  return (
    <div className="q402-shell lpx-shell">
      <div className="q402-gridline" />
      <div className="q402-noise" />

      <div className="lpx-wrap lift-in">
        <header className="lpx-topbar">
          <div className="lpx-brand">
            <img src="/assets/query402-logo.png" alt="Query402 logo" />
            <div>
              <p>Query402</p>
              <span>Agentic payment rail on Stellar</span>
            </div>
          </div>

          <div className="lpx-topbar-actions">
            <Link className="lpx-cta" to="/control">
              Enter Control Deck
              <ArrowRight size={15} />
            </Link>
          </div>
        </header>

        <section className="lpx-hero">
          <p className="lpx-eyebrow">Stellar-native usage economy</p>
          <h1>
            QUERY402
            <br />
            This is the front stage of agent commerce.
          </h1>
          <p>
            Query402 turns internet actions into priced, payable intents. Search, news, and scraping
            become on-demand transactions with transparent settlement and audit trails.
          </p>
          <div className="lpx-hero-actions">
            <Link className="lpx-cta strong" to="/control">
              Run live payment flow
              <ArrowRight size={16} />
            </Link>
            <a
              className="lpx-cta muted"
              href="https://developers.stellar.org"
              target="_blank"
              rel="noreferrer"
            >
              Explore Stellar
            </a>
          </div>
          <div className="lpx-hero-glow">
            <img src="/assets/query402-logo.png" alt="Query402 emblem" />
          </div>
        </section>

        <section className="lpx-marquee" aria-label="Live platform stats">
          <div>
            <WalletCards size={15} />
            <span>{money(analytics?.totalSpendUsd ?? 0)} paid volume</span>
          </div>
          <div>
            <Activity size={15} />
            <span>{analytics?.totalQueries ?? 0} paid executions</span>
          </div>
          <div>
            <ShieldCheck size={15} />
            <span>{providerCount} active providers</span>
          </div>
          <div>
            <Sparkles size={15} />
            <span>Real payment validation passed</span>
          </div>
        </section>

        <section className="lpx-manifesto">
          <article>
            <h2>Intent-first internet access</h2>
            <h1>
              Agents should buy outcomes,
              <br />
              not subscriptions.
            </h1>
            <p>
              Query402 removes fixed-cost bloat and replaces it with granular, verifiable access.
              Every query is priced, paid, and persisted into analytics that can be shown to judges,
              teams, and users.
            </p>
          </article>
        </section>

        <section className="lpx-flow">
          <h2>The Query402 flow</h2>
          <ol>
            <li>
              <span>01</span>
              <div>
                <h3>Choose intent + provider</h3>
                <p>Search, News, or Scrape. Compare quality and cost before execution.</p>
              </div>
            </li>
            <li>
              <span>02</span>
              <div>
                <h3>Attach payment proof</h3>
                <p>x402 challenges the request, client settles, and route unlocks instantly.</p>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                <h3>Collect result + ledger</h3>
                <p>Response, pricing, and usage metadata feed analytics in real time.</p>
              </div>
            </li>
          </ol>
        </section>

        <section className="lpx-sections">
          <article className="lpx-section">
            <p>For product teams</p>
            <h3>Ship agent internet access without annual contracts.</h3>
            <p>
              Start with mock providers for guaranteed demos, then switch to real integrations when
              keys are available.
            </p>
          </article>

          <article className="lpx-section alt">
            <p>For judges</p>
            <h3>One narrative: compare, pay, prove.</h3>
            <p>
              Live request, payment proof, structured results, and spend analytics — all visible in
              under two minutes.
            </p>
          </article>

          <article className="lpx-section">
            <p>For builders</p>
            <h3>Monorepo architecture that scales after demo day.</h3>
            <p>
              Separate landing and control routes, shared schemas, protected API endpoints, and a
              CLI validation path.
            </p>
          </article>
        </section>

        <section className="lpx-signature">
          <div>
            <p>Built for serious demos.</p>
            <h2>From prompt to paid response in under 30 seconds.</h2>
          </div>
          <Link className="lpx-cta strong" to="/control">
            Enter Control Deck
            <ArrowRight size={15} />
          </Link>
        </section>

        <footer className="lpx-footer">
          <p>Luxury front stage, dedicated operator back stage — exactly as requested.</p>
        </footer>
      </div>
    </div>
  );
}
