import {
  isConnected,
  getNetworkDetails,
  requestAccess,
  signTransaction,
  signAuthEntry,
  WatchWalletChanges
} from "@stellar/freighter-api";
import { WalletAdapter, WalletState, WalletStatus } from "./types.js";

export class FreighterAdapter implements WalletAdapter {
  id = "freighter";
  name = "Freighter";
  capabilities = {
    canSignTransaction: true,
    canSignAuthEntry: true
  };

  private watcher: WatchWalletChanges | null = null;
  private currentTargetPassphrase?: string;

  private isUserRejection(error: any): boolean {
    if (!error) return false;
    const msg = typeof error === "string" ? error : error.message || "";
    return (
      msg.toLowerCase().includes("reject") ||
      msg.toLowerCase().includes("decline") ||
      msg.toLowerCase().includes("cancel")
    );
  }

  async checkState(targetNetworkPassphrase?: string): Promise<WalletState> {
    try {
      const connectedRes = await isConnected();
      if (!connectedRes.isConnected) {
        return { status: "disconnected" };
      }

      const accessRes = await requestAccess();
      if (accessRes.error || !accessRes.address) {
        if (this.isUserRejection(accessRes.error)) {
          return { status: "rejected", error: "User rejected connection" };
        }
        return {
          status: "disconnected",
          error: accessRes.error ? String(accessRes.error) : "Access denied"
        };
      }

      const networkRes = await getNetworkDetails();
      if (networkRes.error || !networkRes.networkPassphrase) {
        return { status: "disconnected", error: "Failed to get network details" };
      }

      if (targetNetworkPassphrase && networkRes.networkPassphrase !== targetNetworkPassphrase) {
        return {
          status: "wrong-network",
          address: accessRes.address,
          network: networkRes.networkPassphrase,
          error: `Wrong network. Expected ${targetNetworkPassphrase}`
        };
      }

      return {
        status: "connected",
        address: accessRes.address,
        network: networkRes.networkPassphrase
      };
    } catch (e: any) {
      if (this.isUserRejection(e)) {
        return { status: "rejected", error: "User rejected connection" };
      }
      return { status: "disconnected", error: e.message };
    }
  }

  async connect(targetNetworkPassphrase?: string): Promise<WalletState> {
    this.currentTargetPassphrase = targetNetworkPassphrase;
    // initial request for access triggers connection prompt
    return this.checkState(targetNetworkPassphrase);
  }

  async disconnect(): Promise<void> {
    if (this.watcher) {
      this.watcher.stop();
      this.watcher = null;
    }
  }

  /**
   * Refuse to open a Freighter signature prompt unless the wallet network
   * matches the API payment network (opts or last connect target).
   */
  private async assertConnectedNetwork(opts?: { networkPassphrase?: string }) {
    const expected = opts?.networkPassphrase ?? this.currentTargetPassphrase;
    if (!expected) return;

    const networkRes = await getNetworkDetails();
    if (networkRes.error || !networkRes.networkPassphrase) {
      throw new Error("Failed to get network details");
    }
    if (networkRes.networkPassphrase !== expected) {
      throw new Error(`Wrong network. Expected ${expected}`);
    }
  }

  async signTransaction(xdr: string, opts?: { networkPassphrase?: string }) {
    await this.assertConnectedNetwork(opts);
    const res = await signTransaction(xdr, opts);
    if (res.error || !res.signedTxXdr) {
      if (this.isUserRejection(res.error)) {
        throw new Error("User rejected transaction");
      }
      throw new Error(res.error ? String(res.error) : "Failed to sign transaction");
    }
    return {
      signedTxXdr: res.signedTxXdr,
      signerAddress: res.signerAddress
    };
  }

  async signAuthEntry(xdr: string, opts?: { networkPassphrase?: string }) {
    await this.assertConnectedNetwork(opts);
    const res = await signAuthEntry(xdr, opts);
    if (res.error || !res.signedAuthEntry) {
      if (this.isUserRejection(res.error)) {
        throw new Error("User rejected signature");
      }
      throw new Error(res.error ? String(res.error) : "Failed to sign auth entry");
    }
    return {
      signedAuthEntry: res.signedAuthEntry,
      signerAddress: res.signerAddress
    };
  }

  watchChanges(
    callback: (state: WalletState) => void,
    targetNetworkPassphrase?: string
  ): () => void {
    if (this.watcher) {
      this.watcher.stop();
    }
    this.watcher = new WatchWalletChanges();

    // We cannot easily determine rejection here, but we'll re-evaluate full state
    const fetchFullState = async () => {
      const state = await this.checkState(targetNetworkPassphrase);
      callback(state);
    };

    this.watcher.watch((params) => {
      // Trigger full check on any change to correctly transition states
      fetchFullState().catch(() => {});
    });

    return () => {
      if (this.watcher) {
        this.watcher.stop();
        this.watcher = null;
      }
    };
  }
}
