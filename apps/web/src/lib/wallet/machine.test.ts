import { test, describe } from "node:test";
import assert from "node:assert";
import { WalletSessionMachine } from "./machine.js";
import { WalletAdapter, WalletState } from "./types.js";

/**
 * Freighter-shaped adapter mock used by wallet machine tests.
 * Tracks whether sign APIs were invoked so mismatch paths can assert no prompt.
 */
class FakeFreighterAdapter implements WalletAdapter {
  id = "freighter";
  name = "Freighter";
  capabilities = {
    canSignTransaction: true,
    canSignAuthEntry: true
  };

  mockState: WalletState = { status: "disconnected" };
  mockRejectSign = false;
  signTransactionCalls = 0;
  signAuthEntryCalls = 0;
  /** When set, sign methods throw with this message (may include payload). */
  signErrorWithPayload: string | null = null;

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
    if (
      targetNetworkPassphrase &&
      this.mockState.network &&
      this.mockState.status === "connected" &&
      this.mockState.network !== targetNetworkPassphrase
    ) {
      return {
        status: "wrong-network",
        address: this.mockState.address,
        network: this.mockState.network,
        error: `Wrong network. Expected ${targetNetworkPassphrase}`
      };
    }
    return this.mockState;
  }

  async signTransaction(xdr: string, opts?: { networkPassphrase?: string }) {
    this.signTransactionCalls += 1;
    if (this.signErrorWithPayload) {
      throw new Error(this.signErrorWithPayload);
    }
    if (this.mockRejectSign) throw new Error("User rejected");
    return { signedTxXdr: "signed_" + xdr, signerAddress: "GABC123" };
  }

  async signAuthEntry(xdr: string, opts?: { networkPassphrase?: string }) {
    this.signAuthEntryCalls += 1;
    if (this.signErrorWithPayload) {
      throw new Error(this.signErrorWithPayload);
    }
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

  /** Silent network switch — updates checkState without notifying the watcher. */
  silentNetworkChange(network: string, targetPassphrase?: string) {
    if (targetPassphrase && network !== targetPassphrase) {
      this.mockState = {
        status: "wrong-network",
        address: "GABC123",
        network,
        error: `Wrong network. Expected ${targetPassphrase}`
      };
    } else {
      this.mockState = { status: "connected", address: "GABC123", network };
    }
  }

  // Helper for test to simulate external changes
  simulateNetworkChange(network: string, targetPassphrase?: string) {
    this.silentNetworkChange(network, targetPassphrase);
    if (this.watcherCb) this.watcherCb(this.mockState);
  }
}

describe("WalletSessionMachine", () => {
  test("connects and sets state correctly", async () => {
    const machine = new WalletSessionMachine("TESTNET");
    const adapter = new FakeFreighterAdapter();
    machine.setAdapter(adapter);

    assert.strictEqual(machine.getState().status, "disconnected");

    await machine.connect();

    assert.strictEqual(machine.getState().status, "connected");
    assert.strictEqual(machine.getState().address, "GABC123");
  });

  test("handles unsupported wallet", async () => {
    const machine = new WalletSessionMachine("TESTNET");
    const adapter = new FakeFreighterAdapter();
    adapter.capabilities.canSignAuthEntry = false; // unsupported
    machine.setAdapter(adapter);

    await machine.connect();
    assert.strictEqual(machine.getState().status, "unsupported");
  });

  test("handles wrong network", async () => {
    const machine = new WalletSessionMachine("PUBLIC");
    const adapter = new FakeFreighterAdapter();
    adapter.mockState = {
      status: "wrong-network",
      error: "Wrong network",
      address: "GABC123",
      network: "TESTNET"
    };
    machine.setAdapter(adapter);

    await machine.connect();
    assert.strictEqual(machine.getState().status, "wrong-network");
  });

  test("matching network can request a signature", async () => {
    const machine = new WalletSessionMachine("TESTNET");
    const adapter = new FakeFreighterAdapter();
    machine.setAdapter(adapter);
    await machine.connect();

    const result = await machine.signTransaction("tx_xdr");
    assert.strictEqual(machine.getState().status, "connected");
    assert.strictEqual(result.signedTxXdr, "signed_tx_xdr");
    assert.strictEqual(adapter.signTransactionCalls, 1);

    const auth = await machine.signAuthEntry("auth_xdr");
    assert.strictEqual(auth.signedAuthEntry, "signed_auth_xdr");
    assert.strictEqual(adapter.signAuthEntryCalls, 1);
  });

  test("transitions through signing while Freighter is open", async () => {
    const machine = new WalletSessionMachine("TESTNET");
    const adapter = new FakeFreighterAdapter();
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const baseSign = adapter.signTransaction.bind(adapter);
    adapter.signTransaction = async (xdr, opts) => {
      await gate;
      return baseSign(xdr, opts);
    };
    machine.setAdapter(adapter);
    await machine.connect();

    const promise = machine.signTransaction("tx_xdr");
    await Promise.resolve();
    await Promise.resolve();
    assert.strictEqual(machine.getState().status, "signing");
    release();
    await promise;
    assert.strictEqual(machine.getState().status, "connected");
  });

  test("mismatch does not call sign", async () => {
    const machine = new WalletSessionMachine("PUBLIC");
    const adapter = new FakeFreighterAdapter();
    adapter.mockState = {
      status: "wrong-network",
      error: "Wrong network. Expected PUBLIC",
      address: "GABC123",
      network: "TESTNET"
    };
    machine.setAdapter(adapter);
    await machine.connect();
    assert.strictEqual(machine.getState().status, "wrong-network");

    await assert.rejects(
      () => machine.signTransaction("SENSITIVE_PAYMENT_XDR"),
      /Wrong network|not connected/i
    );
    assert.strictEqual(adapter.signTransactionCalls, 0);
    assert.strictEqual(adapter.signAuthEntryCalls, 0);
  });

  test("network change between click and sign does not call sign", async () => {
    const machine = new WalletSessionMachine("TESTNET");
    const adapter = new FakeFreighterAdapter();
    machine.setAdapter(adapter);
    await machine.connect();
    assert.strictEqual(machine.getState().status, "connected");

    // User clicked pay; wallet network flips before Freighter opens.
    adapter.silentNetworkChange("PUBLIC", "TESTNET");

    await assert.rejects(
      () => machine.signAuthEntry("auth_entry_xdr"),
      /Wrong network/i
    );
    assert.strictEqual(adapter.signAuthEntryCalls, 0);
    assert.strictEqual(machine.getState().status, "wrong-network");
  });

  test("does not put the signed payload in the error", async () => {
    const machine = new WalletSessionMachine("TESTNET");
    const adapter = new FakeFreighterAdapter();
    machine.setAdapter(adapter);
    await machine.connect();

    const payload = "AAAAAGPAYLOAD_MUST_NOT_LEAK";
    adapter.signErrorWithPayload = `Freighter failed for ${payload}`;

    await assert.rejects(() => machine.signTransaction(payload), (err: Error) => {
      assert.ok(!err.message.includes(payload), "error must not contain payload");
      assert.ok(err.message.includes("[redacted]"));
      return true;
    });
    assert.ok(!String(machine.getState().error ?? "").includes(payload));
  });

  test("handles user rejection during signing", async () => {
    const machine = new WalletSessionMachine("TESTNET");
    const adapter = new FakeFreighterAdapter();
    machine.setAdapter(adapter);
    await machine.connect();

    adapter.mockRejectSign = true;
    try {
      await machine.signTransaction("tx_xdr");
      assert.fail("Should throw");
    } catch (e) {
      assert.strictEqual(machine.getState().status, "rejected");
    }
  });

  test("detects account/network changes via watcher", async () => {
    const machine = new WalletSessionMachine("TESTNET");
    const adapter = new FakeFreighterAdapter();
    machine.setAdapter(adapter);
    await machine.connect();

    assert.strictEqual(machine.getState().status, "connected");

    adapter.simulateNetworkChange("PUBLIC", "TESTNET");
    assert.strictEqual(machine.getState().status, "wrong-network");

    adapter.simulateNetworkChange("TESTNET", "TESTNET");
    assert.strictEqual(machine.getState().status, "connected");
  });

  test("refuses sign when opts network differs from API config", async () => {
    const machine = new WalletSessionMachine("TESTNET");
    const adapter = new FakeFreighterAdapter();
    machine.setAdapter(adapter);
    await machine.connect();

    await assert.rejects(
      () =>
        machine.signTransaction("tx_xdr", {
          networkPassphrase: "Public Global Stellar Network ; September 2015"
        }),
      /does not match API network config/
    );
    assert.strictEqual(adapter.signTransactionCalls, 0);
  });
});
