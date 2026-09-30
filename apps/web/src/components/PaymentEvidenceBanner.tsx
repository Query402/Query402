import { AlertCircle, AlertTriangle, ExternalLink, ShieldCheck, HelpCircle } from "lucide-react";
import type { Query402Receipt } from "@query402/shared";
import type { PaidQueryResponse } from "../types.js";
import { evaluatePaymentEvidenceGate } from "../lib/receipt.js";

export interface EvidenceInfo {
  status: "demo" | "verified" | "failed" | "missing";
  title: string;
  description: string;
  explorerUrl?: string;
  className: string;
}

const RAW_PAYMENT_HEADER = /payment-(signature|response)|x-payment|base64[,:]/i;

export function getPaymentEvidenceInfo(
  evidence?: PaidQueryResponse["payment"]["evidence"],
  network?: string
): EvidenceInfo {
  if (!evidence) {
    return {
      status: "missing",
      title: "Missing Payment Evidence",
      description:
        "No verified payment evidence was found for this query execution. Intents should always settle via x402.",
      className: "payment-banner--missing"
    };
  }

  const net = (evidence.network || network || "").toLowerCase();
  const isTestnet =
    net.includes("test") || net.includes("september 2015") || net.includes("testnet");
  const explorerBase = isTestnet
    ? "https://stellar.expert/explorer/testnet"
    : "https://stellar.expert/explorer/public";

  if (evidence.kind === "demo") {
    return {
      status: "demo",
      title: "Demo Mode Payment",
      description: `Simulated transaction proof without live credentials (Payer: ${evidence.payer || "demo-agent"}).`,
      className: "payment-banner--demo"
    };
  }

  if (evidence.kind === "failed") {
    return {
      status: "failed",
      title: "Payment Verification Failed",
      description: `The payment evidence is invalid: ${evidence.error || "unknown verification error"}.`,
      className: "payment-banner--failed"
    };
  }

  if (evidence.kind === "settled" || evidence.kind === "verified") {
    const explorerUrl = evidence.transactionHash
      ? `${explorerBase}/tx/${evidence.transactionHash}`
      : undefined;

    const sponsorText = evidence.payer ? ` (Payer: ${evidence.payer})` : "";
    const amountText =
      evidence.amount && evidence.asset ? ` of ${evidence.amount} ${evidence.asset}` : "";

    return {
      status: "verified",
      title: evidence.kind === "settled" ? "Payment Settled" : "Payment Verified",
      description:
        evidence.kind === "settled"
          ? `Successfully settled payment${amountText} on Stellar ${evidence.network}${sponsorText}.`
          : `Authorized payment challenge${amountText} on Stellar ${evidence.network}${sponsorText} (settlement pending).`,
      explorerUrl,
      className: "payment-banner--verified"
    };
  }

  return {
    status: "missing",
    title: "Unrecognized Payment Evidence",
    description: "Unrecognized payment evidence format or invalid signature.",
    className: "payment-banner--missing"
  };
}

export interface PaymentEvidenceBannerProps {
  payment: PaidQueryResponse["payment"];
  /** Validated receipt gate input. When omitted/invalid/stale the banner hides. */
  receipt?: Query402Receipt | null;
  /** Injected clock for deterministic freshness tests. */
  now?: Date | number;
}

/**
 * Render payment evidence only when the receipt validates and the shared
 * freshness check says the proof is still current. Never render raw payment
 * headers.
 */
export default function PaymentEvidenceBanner({
  payment,
  receipt = null,
  now = Date.now()
}: PaymentEvidenceBannerProps) {
  const gate = evaluatePaymentEvidenceGate(receipt, now);
  if (!gate.show) {
    return null;
  }

  const info = getPaymentEvidenceInfo(payment.evidence, payment.network);

  // Defense in depth: never surface raw payment header material in the UI.
  if (RAW_PAYMENT_HEADER.test(info.description) || RAW_PAYMENT_HEADER.test(info.title)) {
    return null;
  }

  const getIcon = () => {
    switch (info.status) {
      case "verified":
        return <ShieldCheck className="banner-icon icon-verified" size={20} />;
      case "demo":
        return <AlertTriangle className="banner-icon icon-demo" size={20} />;
      case "failed":
        return <AlertCircle className="banner-icon icon-failed" size={20} />;
      case "missing":
      default:
        return <HelpCircle className="banner-icon icon-missing" size={20} />;
    }
  };

  return (
    <div className={`payment-banner ${info.className}`} data-testid="payment-evidence-banner">
      <div className="payment-banner-main">
        {getIcon()}
        <div className="payment-banner-content">
          <h4 className="payment-banner-title">{info.title}</h4>
          <p className="payment-banner-desc">{info.description}</p>
        </div>
      </div>
      {info.explorerUrl && (
        <a href={info.explorerUrl} target="_blank" rel="noreferrer" className="payment-banner-link">
          <span>Explorer</span>
          <ExternalLink size={13} />
        </a>
      )}
    </div>
  );
}
