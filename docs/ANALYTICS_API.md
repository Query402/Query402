# Analytics API Documentation

## Overview

Query402 implements a privacy-safe, paginated analytics system that clearly separates demo queries from on-chain settled payments. This document describes the public and private analytics endpoints and the data they return.

## Design Principles

1. **Privacy-First**: No raw query text, URLs, or full payer addresses are exposed in public endpoints.
2. **Redaction**: Sensitive fields (query text, URLs, payment payloads) are never included in public responses.
3. **Hashing**: Payer public keys are hashed using SHA-256 (truncated to 16 chars) when within retention period.
4. **Retention**: Sensitive fields are automatically redacted after 90 days by default.
5. **Cursor Pagination**: Results are paginated using cursor-based navigation for efficient pagination.
6. **Settlement Clarity**: All queries are labeled as demo-paid, verified, settled, or failed.

## Public Analytics Endpoint

### GET `/api/v1/analytics`

Returns privacy-safe, aggregated analytics with no sensitive data exposed.

**Query Parameters:**
- `cursor` (optional): Base64-encoded cursor for pagination
- `limit` (optional): Number of records to return (1-100, default: 20)

**Response:**
```typescript
interface PrivacySafeAnalyticsResponse {
  aggregation: {
    demoPaid: {
      totalCount: number;
      totalVolumeUsd: number;
      byCategory: {
        search: { count: number; volumeUsd: number };
        news: { count: number; volumeUsd: number };
        scrape: { count: number; volumeUsd: number };
      };
    };
    verified: {
      totalCount: number;
      totalVolumeUsd: number;
      byCategory: { /* same as demoPaid */ };
    };
    settled: {
      totalCount: number;
      totalVolumeUsd: number;
      byCategory: { /* same as demoPaid */ };
    };
    failed: {
      totalCount: number;
      totalVolumeUsd: number;
      byCategory: { /* same as demoPaid */ };
    };
  };
  recentRecords: Array<{
    id: string;
    mode: "search" | "news" | "scrape";
    endpoint: string;
    providerId: string;
    priceUsd: number;
    paymentStatus: "demo-paid" | "paid" | "failed";
    createdAt: string;
    latencyMs: number;
    traceId: string;
    payerHash?: string; // SHA256 truncated to 16 chars, only within 90 days
  }>;
  pagination: {
    cursor: string;
    limit: number;
    hasMore: boolean;
    nextCursor?: string;
  };
}
```

**Example Request:**
```bash
curl "http://localhost:3001/api/v1/analytics?limit=10"
```

**Example Response:**
```json
{
  "aggregation": {
    "demoPaid": {
      "totalCount": 5,
      "totalVolumeUsd": 0.05,
      "byCategory": {
        "search": { "count": 3, "volumeUsd": 0.03 },
        "news": { "count": 2, "volumeUsd": 0.02 },
        "scrape": { "count": 0, "volumeUsd": 0 }
      }
    },
    "verified": {
      "totalCount": 0,
      "totalVolumeUsd": 0,
      "byCategory": { ... }
    },
    "settled": {
      "totalCount": 2,
      "totalVolumeUsd": 0.03,
      "byCategory": {
        "search": { "count": 1, "volumeUsd": 0.01 },
        "news": { "count": 1, "volumeUsd": 0.02 },
        "scrape": { "count": 0, "volumeUsd": 0 }
      }
    },
    "failed": {
      "totalCount": 1,
      "totalVolumeUsd": 0.01,
      "byCategory": { ... }
    }
  },
  "recentRecords": [
    {
      "id": "use_abc123",
      "mode": "search",
      "endpoint": "/x402/search",
      "providerId": "search.basic",
      "priceUsd": 0.01,
      "paymentStatus": "demo-paid",
      "createdAt": "2024-01-15T10:00:00Z",
      "latencyMs": 150,
      "traceId": "trace-123",
      "payerHash": "a1b2c3d4e5f6g7h8"
    }
  ],
  "pagination": {
    "cursor": "start",
    "limit": 10,
    "hasMore": false
  }
}
```

## Detailed Analytics Endpoint (Protected)

### GET `/x402/analytics/detailed`

Returns analytics with more detail for authorized access. Still redacts sensitive data but includes transaction hashes and payer key hashes.

**Authorization:**
Requires x402 payment protocol (similar to other /x402/* endpoints).

**Query Parameters:**
- `cursor` (optional): Base64-encoded cursor for pagination
- `limit` (optional): Number of records to return (1-100, default: 20)

**Response:**
```typescript
interface DetailedAnalyticsResponse {
  aggregation: PrivacySafeAnalyticsAggregation; // Same as public
  records: Array<{
    id: string;
    mode: "search" | "news" | "scrape";
    endpoint: string;
    providerId: string;
    priceUsd: number;
    paymentStatus: "demo-paid" | "paid" | "failed";
    paymentTxHash?: string; // Only within retention period
    payerKeyHash?: string; // SHA256 truncated, only within retention
    createdAt: string;
    latencyMs: number;
    traceId: string;
  }>;
  pagination: CursorPaginationMeta;
}
```

**Note:** Full payer addresses and raw payment payloads are never exposed, even in this endpoint.

## Settlement Status Definitions

1. **demo-paid**: Query executed using demo mode (no actual payment on-chain)
2. **verified**: Payment attempt verified by facilitator, but not yet on-chain
3. **settled**: Payment confirmed on-chain (authoritative source of on-chain paid volume)
4. **failed**: Payment attempt failed

## Pagination

The analytics API uses cursor-based pagination for efficient navigation:

```bash
# Get first page
curl "http://localhost:3001/api/v1/analytics?limit=20"

# If response has hasMore=true, get next page using nextCursor
curl "http://localhost:3001/api/v1/analytics?cursor=<nextCursor>&limit=20"
```

**Cursor Format:**
- Cursors are base64-encoded JSON containing `{ timestamp, id }`
- Cursors are opaque to clients - do not attempt to decode or manipulate them
- Invalid cursors are treated as "start from beginning"

## Retention Policy

By default, sensitive fields are retained for 90 days:

- Within 90 days: Query timestamps, payer key hashes, transaction hashes available
- After 90 days: Sensitive fields are redacted (payerHash, paymentTxHash become undefined)
- Query text and URLs are never exposed in any response

**Configuration:**
```javascript
const config = {
  retentionDays: 90,       // Adjust as needed
  maxPageLimit: 100,       // Maximum records per page
  defaultPageLimit: 20     // Default if limit not specified
};
```

## Privacy Guarantees

The following data is **never exposed** in any analytics endpoint:

- ✗ Raw query text (e.g., "SELECT * FROM...")
- ✗ Scrape URLs (e.g., "https://example.com/private")
- ✗ Full payer public keys (e.g., "GBLL3LQ...")
- ✗ Raw payment payloads or secrets
- ✗ Facilitator URLs or internal infrastructure details

The following data is **redacted after retention period**:

- 🕐 Payer key hashes (after 90 days → undefined)
- 🕐 Transaction hashes (after 90 days → undefined)

The following data is **always safe to expose**:

- ✓ Aggregated counts and volumes
- ✓ Settlement status (demo/verified/settled/failed)
- ✓ Query mode and provider ID
- ✓ Price and latency metrics
- ✓ Timestamps and trace IDs
- ✓ Hashed payer identifiers (within retention)

## Analytics Flow

### 1. Query Execution
```
Client → Query Request (e.g., /x402/search) → API
```

### 2. Settlement Recording
```
API saves UsageEvent + PaymentAttempt to persistence layer
- UsageEvent includes: queryOrUrl, payerPublicKey, paymentStatus
- PaymentAttempt includes: payerPublicKey, transactionHash, status
```

### 3. Public Analytics
```
GET /api/v1/analytics → Aggregates + Redacts
- Strips all query text and URLs
- Hashes payer keys
- Returns settlement-separated counts
```

### 4. Authorized Analytics (Protected)
```
GET /x402/analytics/detailed → More Detail + Redacted
- Includes transaction hashes (within retention)
- Includes payer key hashes (within retention)
- Still strips query text and payment secrets
```

## Example Integration

### Dashboard Display

```javascript
// Fetch public analytics
const response = await fetch('/api/v1/analytics?limit=5');
const data = await response.json();

// Display settlement breakdown
console.log('On-Chain Settled Volume:', data.aggregation.settled.totalVolumeUsd);
console.log('Demo Queries:', data.aggregation.demoPaid.totalCount);
console.log('Failed Attempts:', data.aggregation.failed.totalCount);

// Display recent records (privacy-safe)
data.recentRecords.forEach(record => {
  console.log(`${record.mode} query: $${record.priceUsd} (${record.paymentStatus})`);
});

// Handle pagination
if (data.pagination.hasMore) {
  const nextPage = await fetch(`/api/v1/analytics?cursor=${data.pagination.nextCursor}&limit=5`);
  // ... process next page
}
```

## Testing

### Verification of Privacy Guarantees

The test suite validates:

1. **No raw query text in response**: Confirms queryOrUrl never appears
2. **No full payer addresses**: Verifies Stellar addresses don't leak
3. **No raw payment payloads**: Confirms sensitive payment data redacted
4. **Correct hashing**: Verifies payer keys hashed consistently, non-reversibly
5. **Cursor pagination boundaries**: Confirms correct record ordering and hasMore flag
6. **Retention enforcement**: Validates fields redacted after 90 days
7. **Settlement aggregation**: Confirms demo/verified/settled/failed counted correctly

Run tests:
```bash
npm test -- analytics-service.test.ts
npm test -- analytics-privacy.test.ts
```

## Backward Compatibility

The legacy `/api/analytics` endpoint remains available but is not recommended:

```bash
GET /api/analytics
```

This endpoint returns the original (non-privacy-safe) format. It is **deprecated** in favor of `/api/v1/analytics`.

## Configuration

Configure analytics behavior in your environment:

```javascript
// Default configuration
const analyticsConfig = {
  retentionDays: 90,
  maxPageLimit: 100,
  defaultPageLimit: 20
};
```

You can override these when calling analytics functions directly:

```javascript
getPublicAnalytics(usageEvents, payments, {}, {
  retentionDays: 30,
  maxPageLimit: 50,
  defaultPageLimit: 10
});
```

## Security Headers

All analytics endpoints are served with standard CORS headers and support encrypted connections in production.

## Changelog

- **v1.0.0** (2024-01-15): Initial privacy-safe analytics API with cursor pagination, demo/settled separation, and hashing
