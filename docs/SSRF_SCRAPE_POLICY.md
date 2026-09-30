# Scrape URL SSFR policy

Query402 validates scrape URLs before any scrape provider receives them. Providers that need to make real HTTP requests should use `safeScrapeFetch` from `apps/api/src/lib/scrape-url-safety.ts` so redirects, DNS answers, timeouts, response size, and content type checks all share the same policy.

## Policy

- Only `http` and `https` URLs are accepted.
- URLs with embedded credentials are rejected.
- `localhost`, `.localhost`, `.local`, and `.internal` hostnames are rejected.
- Literal IPv4 and IPv6 hosts are checked before network access.
- DNS is resolved before connecting, and every returned address must be public.
- Loopback, private, link-local, reserved, multicast, benchmarking, documentation, carrier-grade NAT, and common cloud metadata ranges are rejected.
- Redirects are followed manually, capped, and each redirect target is revalidated before the next request.
- Redirects that change scheme or host are rejected unless the new target passes a second safety check.
- Real fetches use an abort timeout, a maximum response body size, and an allowlist of text-oriented content types.
- Client-facing errors use a generic `unsafe_scrape_url` response and do not reveal internal DNS or network details.

## Provider enforcement

The scrape provider must run both `urlSafety` from `apps/api/src/lib/urlSafety.ts` and `scrape-url-safety` from `apps/api/src/lib/scrape-url-safety.ts` before any outbound request. The provider refuses to fetch unless both helpers agree the URL is safe. A URL blocked by either helper is rejected. Rejections return the stable `unsafe_scrape_url` error and do not include the response body.

## Residual risks

Application-level checks reduce SSFR risk but should not be the only control. DNS rebinding can still occur between userland DNS validation and the runtime's internal connection step because Node's built-in `fetch` does not expose a per-request IP pinning hook. Production deployments should also enforce network egress controls that block RFC1918, loopback, link-local, cloud metadata, Kubernetes, database, and control-plane networks from the API runtime.

Recommended deployment controls:

- Deny private and metadata network egress at the VPC, firewall, security group, or service mesh layer.
- Run scrape-capable workers without access to credentials, instance metadata, internal admin panels, or database networks.
- Prefer a hardened outbound proxy that resolves DNS and pins the approved public address for the connection.
- Keep provider-specific fetch code behind `safeScrapeFetch`; do not call global `fetch` directly for user-supplied scrape URLs.
