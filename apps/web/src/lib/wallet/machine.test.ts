import { describe, expect, it } from "vitest";
import { WalletSessionMachine } from "./machine.js";
import { WalletAdapter, WalletState } from "./types.js";

class FakeAdapter implements WalletAdapter {
  id = "fake";
  name = "Fake Wallet";
  capabilities = {
    canSignTransaction: true,
    canSignAuthEntry: true
  };

  mockState: WalletState = { status: "disconnected" };
  mockRejectSign = false;

  private watcherCb?: (state: WalletState) => void;

  async connect(targetNetworkPassphrase?: string): Promise<WalletState> {
    if (this.mockState.status === "wrong-network") {
      return this.mockState;
    }
    this.mockState = {
      status: "connected",
      address: "GABC123",
      network: targetNetworkPassphrase || "TESTNET"
    };
    if (this.watcherCb) this.watcherCb(this.mockState);
    return this.mockState;
  }

  async disconnect(): Promise<void> {
    this.mockState = { status: "disconnected" };
    if (this.watcherCb) this.watcherCb(this.mockState);
  }

  async checkState(targetNetworkPassphrase?: string): Promise<WalletState> {
    return this.mockState;
  }

  async signTransaction(xdr: string, opts?: { networkPassphrase?: string }) {
    if (this.mockRejectSign) throw new Error("User rejected");
    return { signedTxXdr: "signed_" + xdr, signerAddress: "GABC123" };
  }

  async signAuthEntry(xdr: string, opts?: { networkPassphrase?: string }) {
    if (this.mockRejectSign) throw new Error("User rejected");
    return { signedAuthEntry: "signed_" + xdr, signerAddress: "GABC123" };
  }

  watchChanges(
    callback: (state: WalletState) => void,
    targetNetworkPassphrase?: string
  ): () => void {
    this.watcherCb = callback;
    return () => {
      this.watcherCb = undefined;
    };
  }

  // Helper for test to simulate external changes
  simulateNetworkChange(network: string, targetPassphrase?: string) {
    if (network !== targetPassphrase) {
      this.mockState = {
        status: "wrong-network",
        address: "GABC123",
        network,
        error: "Wrong network"
      };
    } else {
      this.mockState = { status: "connected", address: "GABC123", network };
    }
    if (this.watcherCb) this.watcherCb(this.mockState);
  }
}

describe("WalletSessionMachine", () => {
  it("connects and sets state correctly", async () => {
    const machine = new WalletSessionMachine("TESTNET");
    const adapter = new FakeAdapter();
    machine.setAdapter(adapter);

    expect(machine.getState().status).toBe("disconnected");

    await machine.connect();

    expect(machine.getState().status).toBe("connected");
    expect(machine.getState().address).toBe("GABC123");
  });

  it("handles unsupported wallet", async () => {
    const machine = new WalletSessionMachine("TESTNET");
    const adapter = new FakeAdapter();
    adapter.capabilities.canSignAuthEntry = false; // unsupported
    machine.setAdapter(adapter);

    await machine.connect();
    expect(machine.getState().status).toBe("unsupported");
  });

  it("handles wrong network", async () => {
    const machine = new WalletSessionMachine("PUBLIC");
    const adapter = new FakeAdapter();
    adapter.mockState = {
      status: "wrong-network",
      error: "Wrong network",
      address: "GABC123",
      network: "TESTNET"
    };
    machine.setAdapter(adapter);

    await machine.connect();
    expect(machine.getState().status).toBe("wrong-network");
  });

  it("transitions to signing and back", async () => {
    const machine = new WalletSessionMachine("TESTNET");
    const adapter = new FakeAdapter();
    machine.setAdapter(adapter);
    await machine.connect();

    const promise = machine.signTransaction("tx_xdr");
    expect(machine.getState().status).toBe("signing");
    await promise;
    expect(machine.getState().status).toBe("connected");
  });

  it("handles user rejection during signing", async () => {
    const machine = new WalletSessionMachine("TESTNET");
    const adapter = new FakeAdapter();
    machine.setAdapter(adapter);
    await machine.connect();

    adapter.mockRejectSign = true;

    await expect(machine.signTransaction("tx_xdr")).rejects.toThrow();
    expect(machine.getState().status).toBe("rejected");
  });

  it("detects account/network changes via watcher", async () => {
    const machine = new WalletSessionMachine("TESTNET");
    const adapter = new FakeAdapter();
    machine.setAdapter(adapter);
    await machine.connect();

    expect(machine.getState().status).toBe("connected");

    adapter.simulateNetworkChange("PUBLIC", "TESTNET");
    expect(machine.getState().status).toBe("wrong-network");

    adapter.simulateNetworkChange("TESTNET", "TESTNET");
    expect(machine.getState().status).toBe("connected");
  });
});
