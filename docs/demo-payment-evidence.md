# Demo-mode payment evidence

Query402 supports a deterministic demo mode (`DEMO_MODE=true`) that bypasses live Stellar wallet funding and facilitator interactions. This mode is designed for hackathon reliability and local testing without requiring testnet credentials.

## Demo vs real payment evidence

Payment evidence records how a paid request was validated and settled. The evidence structure differs depending on whether the request used demo mode or real x402 settlement.

### Demo evidence

Demo evidence is recorded when:

- `DEMO_MODE=true` in environment configuration
- Request includes header `x-query402-demo-paid: true`

Demo evidence characteristics:

- **Does not involve on-chain settlement**: No Stellar transactions occur
- **No facilitator interaction**: Verification and settlement steps are skipped
- **Deterministic behavior**: Always succeeds for testing reliability
- **Status field**: `"demo-paid"`
- **Kind field**: `"demo"`
- **No transaction hash**: Settlement proof is not available
- **No facilitator result**: The `facilitatorResult` field is absent

Demo-only fields:

- `payer`: Extracted from `x-demo-payer` header (defaults to `"demo-agent"`)

### Real x402 evidence

Real evidence is recorded when:

- `DEMO_MODE=false` in environment configuration
- Valid payment credentials are configured
- Request goes through x402 middleware with facilitator verification/settlement

Real evidence characteristics:

- **On-chain settlement**: Stellar transactions are broadcast and confirmed
- **Facilitator interaction**: Payment verification and settlement via configured facilitator
- **Network-dependent**: Requires funded wallets and reachable RPC + facilitator endpoints
- **Status field**: `"verified"`, `"settled"`, or `"failed"`
- **Kind field**: `"verified"`, `"settled"`, or `"failed"`
- **Transaction hash**: Available when `status` is `"settled"` (stored in `transactionHash`)
- **Facilitator result**: Includes verification/settlement response from facilitator

Real-only fields:

- `transactionHash`: Stellar transaction hash (only when settled)
- `facilitatorResult`: JSON object with facilitator verification/settlement response

### Common fields (demo and real)

Both demo and real payment evidence include:

- `kind`: Type of evidence (`"demo"`, `"verified"`, `"settled"`, or `"failed"`)
- `status`: Payment status (`"demo-paid"`, `"verified"`, `"settled"`, or `"failed"`)
- `mode`: Query mode (`"search"`, `"news"`, or `"scrape"`)
- `endpoint`: API path (e.g., `"/x402/search"`)
- `providerId`: Provider identifier (e.g., `"search.basic"`)
- `amountUsd`: Price in USD for the request
- `network`: Stellar network identifier (e.g., `"stellar:testnet"`)
- `payTo`: Destination Stellar address
- `facilitatorUrl`: Configured facilitator endpoint
- `payer`: Public key or identifier of the payer

Optional common fields:

- `asset`: Asset identifier (present in real payments)
- `amount`: Payment amount in asset units (present in real payments)
- `error`: Error message (only when `status` is `"failed"`)

## Demo request flow

### 1. Initial 402 challenge

When `DEMO_MODE=true`, protected routes return a 402 response on first request:

```bash
curl http://localhost:3001/x402/search?provider=search.basic&q=stellar
```

Response (status 402):

```json
{
  "error": "Payment Required",
  "demoMode": true,
  "accepts": {
    "scheme": "exact",
    "network": "stellar:testnet",
    "price": "$0.01",
    "payTo": "GBXXX...XXX",
    "facilitator": "https://channels.openzeppelin.com/testnet"
  },
  "instructions": "For deterministic demo mode, retry with header x-query402-demo-paid: true. Demo evidence is recorded separately from settled x402 payments."
}
```

### 2. Retry with demo payment header

Include `x-query402-demo-paid: true` to bypass payment verification:

```bash
curl http://localhost:3001/x402/search?provider=search.basic&q=stellar \
  -H "x-query402-demo-paid: true"
```

Response (status 200):

```json
{
  "result": {
    "mode": "search",
    "providerId": "search.basic",
    "providerName": "Basic Search",
    "priceUsd": 0.01,
    "latencyMs": 150,
    "timestamp": "2026-06-28T12:34:56.789Z",
    "traceId": "trace_abc123",
    "items": [
      {
        "title": "Stellar Development Foundation",
        "url": "https://stellar.org",
        "snippet": "Stellar is an open network for money.",
        "score": 0.95
      }
    ],
    "source": "deterministic-fallback"
  }
}
```

### 3. Recorded evidence

Demo payment evidence is persisted in analytics storage with these fields:

```typescript
{
  kind: "demo",
  status: "demo-paid",
  mode: "search",
  endpoint: "/x402/search",
  providerId: "search.basic",
  amountUsd: 0.01,
  network: "stellar:testnet",
  payTo: "GBXXX...XXX",
  facilitatorUrl: "https://channels.openzeppelin.com/testnet",
  payer: "demo-agent"
}
```

The corresponding usage event includes:

- `paymentStatus: "demo-paid"`
- `paymentKind: "demo"`
- `paymentSource: "demo"`
- No `paymentTxHash` (transaction hash not applicable)

## Example: demo payment with curl

Start the API server in demo mode:

```bash
# Ensure DEMO_MODE=true in .env
npm run dev:api
```

Execute a demo-paid search request:

```bash
curl http://localhost:3001/x402/search?provider=search.basic&q="stellar soroban" \
  -H "x-query402-demo-paid: true" \
  -H "x-demo-payer: my-test-wallet"
```

Expected result:

- Status: 200
- Response includes `result` object with query results
- Payment evidence is persisted with `kind: "demo"` and `status: "demo-paid"`
- No Stellar credentials or testnet funding required

## Comparison table

| Field                | Demo Evidence              | Real Evidence (Verified)  | Real Evidence (Settled)   |
| -------------------- | -------------------------- | ------------------------- | ------------------------- |
| `kind`               | `"demo"`                   | `"verified"`              | `"settled"`               |
| `status`             | `"demo-paid"`              | `"verified"`              | `"settled"`               |
| `payer`              | From `x-demo-payer` header | From facilitator response | From facilitator response |
| `transactionHash`    | ❌ Not present             | ❌ Not present            | ✅ Stellar tx hash        |
| `facilitatorResult`  | ❌ Not present             | ✅ Verification response  | ✅ Settlement response    |
| `asset`              | ❌ Not present             | ✅ Asset code             | ✅ Asset code             |
| `amount`             | ❌ Not present             | ✅ Payment amount         | ✅ Payment amount         |
| On-chain settlement  | ❌ No                      | ❌ No                     | ✅ Yes                    |
| Requires credentials | ❌ No                      | ✅ Yes                    | ✅ Yes                    |

## When to use demo mode

**Use demo mode when:**

- Testing locally without Stellar testnet setup
- Running CI pipelines without live credentials
- Demonstrating the application flow during hackathons
- Developing new provider integrations
- Debugging routing and analytics logic

**Use real mode when:**

- Validating end-to-end payment settlement
- Testing facilitator integration
- Demonstrating actual on-chain transactions to judges
- Verifying wallet funding and transaction broadcast
- Producing audit trails with settlement proof

## Querying payment evidence

Payment evidence is stored in the analytics database alongside usage events. Retrieve recent payment attempts:

```bash
curl http://localhost:3001/api/usage?limit=10
```

The response includes usage events with pagination metadata:

```json
{
  "usage": [/* UsageEvent[] */],
  "pagination": {
    "limit": 10,
    "offset": 0,
    "count": 10
  }
}
```

Analytics summary includes spend breakdown by payment kind:

```bash
curl http://localhost:3001/api/analytics
```

Response includes:

- `totalSpendUsd`: Total across all payment kinds
- `settledSpendUsd`: Only settled (on-chain) payments
- `demoSpendUsd`: Demo-mode payments
- `failedSpendUsd`: Failed payment attempts

## Related documentation

- **Architecture overview**: [`ARCHITECTURE.md`](../ARCHITECTURE.md)
- **Testing strategy**: [`docs/testing.md`](./testing.md)
- **Real payment validation**: See README section "Real payment validation playbook"
