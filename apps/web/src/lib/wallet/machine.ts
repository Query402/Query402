import { WalletAdapter, WalletState, WalletStatus } from "./types.js";

type Subscriber = (state: WalletState) => void;

/** Strip any signing payload from error text so XDR never lands in state/UI. */
function safeSignErrorMessage(error: unknown, payload: string): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Signing failed";
  if (!payload) return raw || "Signing failed";
  return raw.split(payload).join("[redacted]") || "Signing failed";
}

export class WalletSessionMachine {
  private adapter: WalletAdapter | null = null;
  private state: WalletState = { status: "disconnected" };
  private subscribers: Set<Subscriber> = new Set();
  private targetNetworkPassphrase?: string;
  private unwatch: (() => void) | null = null;

  constructor(targetNetworkPassphrase?: string) {
    this.targetNetworkPassphrase = targetNetworkPassphrase;
  }

  getState(): WalletState {
    return this.state;
  }

  getAdapter(): WalletAdapter | null {
    return this.adapter;
  }

  /** API payment network passphrase the machine was configured with. */
  getTargetNetworkPassphrase(): string | undefined {
    return this.targetNetworkPassphrase;
  }

  subscribe(callback: Subscriber): () => void {
    this.subscribers.add(callback);
    callback(this.state);
    return () => this.subscribers.delete(callback);
  }

  private setState(newState: Partial<WalletState>) {
    this.state = { ...this.state, ...newState };
    for (const sub of this.subscribers) {
      sub(this.state);
    }
  }

  setAdapter(adapter: WalletAdapter) {
    this.disconnect(); // cleanup old adapter
    this.adapter = adapter;

    // Test capabilities early if needed, though they are static on the adapter
    if (!adapter.capabilities.canSignTransaction || !adapter.capabilities.canSignAuthEntry) {
      this.setState({
        status: "unsupported",
        error: "Wallet does not support required Stellar x402 signing capabilities"
      });
      return;
    }

    this.unwatch = adapter.watchChanges((newState) => {
      // Re-evaluate supported capabilities when state changes if needed
      if (
        newState.status === "connected" &&
        (!adapter.capabilities.canSignTransaction || !adapter.capabilities.canSignAuthEntry)
      ) {
        this.setState({
          status: "unsupported",
          error: "Wallet does not support required Stellar x402 signing capabilities"
        });
        return;
      }
      this.setState(newState);
    }, this.targetNetworkPassphrase);

    // Initial check
    adapter.checkState(this.targetNetworkPassphrase).then((newState) => {
      if (
        newState.status === "connected" &&
        (!adapter.capabilities.canSignTransaction || !adapter.capabilities.canSignAuthEntry)
      ) {
        this.setState({
          status: "unsupported",
          error: "Wallet does not support required Stellar x402 signing capabilities"
        });
        return;
      }
      this.setState(newState);
    });
  }

  async connect() {
    if (!this.adapter) throw new Error("No adapter set");
    if (this.state.status === "connecting" || this.state.status === "signing") return;

    this.setState({ status: "connecting", error: undefined });

    try {
      const result = await this.adapter.connect(this.targetNetworkPassphrase);

      if (
        result.status === "connected" &&
        (!this.adapter.capabilities.canSignTransaction ||
          !this.adapter.capabilities.canSignAuthEntry)
      ) {
        this.setState({
          status: "unsupported",
          error: "Wallet does not support required Stellar x402 signing capabilities"
        });
        return;
      }

      this.setState(result);
    } catch (e: any) {
      this.setState({ status: "disconnected", error: e.message });
    }
  }

  async disconnect() {
    if (this.unwatch) {
      this.unwatch();
      this.unwatch = null;
    }
    if (this.adapter) {
      await this.adapter.disconnect();
    }
    this.setState({
      status: "disconnected",
      address: undefined,
      network: undefined,
      error: undefined
    });
  }

  /**
   * Re-read wallet network and refuse signing unless it matches the API config.
   * Call immediately before opening a Freighter signature request.
   */
  private async assertNetworkMatchesApiConfig(opts?: {
    networkPassphrase?: string;
  }): Promise<void> {
    if (!this.adapter) throw new Error("No adapter set");

    const expected =
      this.targetNetworkPassphrase ?? opts?.networkPassphrase;

    if (
      opts?.networkPassphrase &&
      this.targetNetworkPassphrase &&
      opts.networkPassphrase !== this.targetNetworkPassphrase
    ) {
      const error = "Signing network does not match API network config";
      this.setState({
        status: "wrong-network",
        address: this.state.address,
        network: this.state.network,
        error
      });
      throw new Error(error);
    }

    // Fresh check — covers a network switch between click and sign.
    const fresh = await this.adapter.checkState(this.targetNetworkPassphrase);
    this.setState(fresh);

    if (fresh.status === "wrong-network") {
      throw new Error(fresh.error ?? "Wallet is on the wrong network");
    }

    if (fresh.status !== "connected") {
      throw new Error(fresh.error ?? "Wallet not connected");
    }

    if (expected && fresh.network && fresh.network !== expected) {
      const error = `Wrong network. Expected ${expected}`;
      this.setState({
        status: "wrong-network",
        address: fresh.address,
        network: fresh.network,
        error
      });
      throw new Error(error);
    }
  }

  async signTransaction(xdr: string, opts?: { networkPassphrase?: string }) {
    if (!this.adapter) throw new Error("No adapter set");

    await this.assertNetworkMatchesApiConfig(opts);

    const prevState: WalletStatus = "connected";
    this.setState({ status: "signing", error: undefined });

    try {
      const signOpts = {
        ...opts,
        networkPassphrase: opts?.networkPassphrase ?? this.targetNetworkPassphrase
      };
      const result = await this.adapter.signTransaction(xdr, signOpts);
      this.setState({ status: prevState });
      return result;
    } catch (e: unknown) {
      const message = safeSignErrorMessage(e, xdr);
      const isReject = message.toLowerCase().includes("reject");
      this.setState({ status: isReject ? "rejected" : prevState, error: message });
      throw new Error(message);
    }
  }

  async signAuthEntry(xdr: string, opts?: { networkPassphrase?: string }) {
    if (!this.adapter) throw new Error("No adapter set");

    await this.assertNetworkMatchesApiConfig(opts);

    const prevState: WalletStatus = "connected";
    this.setState({ status: "signing", error: undefined });

    try {
      const signOpts = {
        ...opts,
        networkPassphrase: opts?.networkPassphrase ?? this.targetNetworkPassphrase
      };
      const result = await this.adapter.signAuthEntry(xdr, signOpts);
      this.setState({ status: prevState });
      return result;
    } catch (e: unknown) {
      const message = safeSignErrorMessage(e, xdr);
      const isReject = message.toLowerCase().includes("reject");
      this.setState({ status: isReject ? "rejected" : prevState, error: message });
      throw new Error(message);
    }
  }
}
