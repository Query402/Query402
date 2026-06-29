import { ProviderAdapter, ProviderRegistry, AdapterExecutionResult } from "./core.js";
import { getProviderById } from "../lib/pricing.js";
import type { CircuitBreakerState, ExecutionFallbackReason, ProviderExecutionMetadata } from "@query402/shared";

interface CircuitBreakerConfig {
  maxFailures: number;
  cooldownMs: number;
  timeoutMs: number;
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  maxFailures: 3,
  cooldownMs: 30000,
  timeoutMs: 5000
};

class CircuitBreaker {
  private failures = 0;
  private lastFailureTime = 0;

  constructor(private config: CircuitBreakerConfig = DEFAULT_CONFIG) {}

  getState(): CircuitBreakerState {
    if (this.failures >= this.config.maxFailures) {
      const now = Date.now();
      return now - this.lastFailureTime > this.config.cooldownMs ? "half-open" : "open";
    }
    return "closed";
  }

  allowAttempt(): boolean {
    if (this.failures >= this.config.maxFailures) {
      const now = Date.now();
      if (now - this.lastFailureTime > this.config.cooldownMs) {
        // Half-open: let one request through to test recovery.
        this.failures = this.config.maxFailures - 1;
        return true;
      }
      return false;
    }

    return true;
  }

  recordSuccess() {
    this.failures = 0;
  }

  recordFailure() {
    this.failures++;
    this.lastFailureTime = Date.now();
  }

  async executeWithTimeout<T>(promise: Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("Timeout"));
      }, this.config.timeoutMs);

      promise
        .then((res) => {
          clearTimeout(timer);
          resolve(res);
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }
}

export class DefaultProviderRegistry implements ProviderRegistry {
  private adapters = new Map<string, ProviderAdapter>();
  private circuits = new Map<string, CircuitBreaker>();

  constructor(private readonly circuitConfig: CircuitBreakerConfig = DEFAULT_CONFIG) {}

  register(adapter: ProviderAdapter): void {
    this.adapters.set(adapter.id, adapter);
    this.circuits.set(adapter.id, new CircuitBreaker(this.circuitConfig));
  }

  async execute(
    mode: "search" | "news" | "scrape",
    providerId: string,
    queryOrUrl: string
  ): Promise<AdapterExecutionResult> {
    const startedAt = Date.now();
    const providerDef = getProviderById(providerId);
    if (!providerDef) {
      throw new Error(`Provider not found or disabled: ${providerId}`);
    }

    if (providerDef.category !== mode) {
      throw new Error(`Provider ${providerId} does not support mode ${mode}`);
    }

    const adapter = this.adapters.get(providerId);
    if (!adapter) {
      throw new Error(`No adapter registered for provider: ${providerId}`);
    }

    const circuit = this.circuits.get(providerId)!;

    const buildResult = (
      items: AdapterExecutionResult["items"],
      source: AdapterExecutionResult["source"],
      execution: Partial<ProviderExecutionMetadata>
    ): AdapterExecutionResult => ({
      items,
      source,
      execution: {
        providerId,
        source,
        usedFallback: source !== "live",
        latencyEstimateMs: providerDef.latencyEstimateMs,
        observedDurationMs: Date.now() - startedAt,
        ...execution
      }
    });

    // If it's a strictly deterministic (mock) adapter
    if (providerDef.sourceType === "deterministic-fallback") {
      if (adapter.getFallback) {
        return buildResult(adapter.getFallback(queryOrUrl), "deterministic-fallback", {
          fallbackReason: "deterministic-provider"
        });
      }
      // Fallback to executing it directly if no getFallback is provided
      try {
        const items = await adapter.execute(queryOrUrl);
        return buildResult(items, "deterministic-fallback", {
          fallbackReason: "deterministic-provider"
        });
      } catch (err) {
        return buildResult([], "unavailable", {
          fallbackReason: "adapter-error"
        });
      }
    }

    // Real adapter logic
    if (!circuit.allowAttempt()) {
      return this.handleFallback(adapter, queryOrUrl, providerDef, startedAt, "circuit-open", {
        circuitBreakerState: "open"
      });
    }

    if (!(await adapter.isHealthy().catch(() => false))) {
      circuit.recordFailure();
      return this.handleFallback(adapter, queryOrUrl, providerDef, startedAt, "unhealthy", {
        circuitBreakerState: circuit.getState()
      });
    }

    try {
      const items = await circuit.executeWithTimeout(adapter.execute(queryOrUrl));
      circuit.recordSuccess();
      return buildResult(items, "live", {
        circuitBreakerState: circuit.getState()
      });
    } catch (err) {
      circuit.recordFailure();
      const fallbackReason: ExecutionFallbackReason =
        err instanceof Error && err.message === "Timeout" ? "timeout" : "adapter-error";
      return this.handleFallback(adapter, queryOrUrl, providerDef, startedAt, fallbackReason, {
        circuitBreakerState: circuit.getState()
      });
    }
  }

  private handleFallback(
    adapter: ProviderAdapter,
    queryOrUrl: string,
    providerDef: NonNullable<ReturnType<typeof getProviderById>>,
    startedAt: number,
    fallbackReason: ExecutionFallbackReason,
    execution: Partial<ProviderExecutionMetadata> = {}
  ): AdapterExecutionResult {
    if (adapter.getFallback) {
      return {
        items: adapter.getFallback(queryOrUrl),
        source: "deterministic-fallback",
        execution: {
          providerId: providerDef.id,
          source: "deterministic-fallback",
          usedFallback: true,
          fallbackReason,
          latencyEstimateMs: providerDef.latencyEstimateMs,
          observedDurationMs: Date.now() - startedAt,
          ...execution
        }
      };
    }
    return {
      items: [],
      source: "unavailable",
      execution: {
        providerId: providerDef.id,
        source: "unavailable",
        usedFallback: true,
        fallbackReason: "missing-fallback",
        latencyEstimateMs: providerDef.latencyEstimateMs,
        observedDurationMs: Date.now() - startedAt,
        ...execution
      }
    };
  }
}

export const registry = new DefaultProviderRegistry();
