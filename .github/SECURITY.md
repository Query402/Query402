# Security Policy

Query402 handles payments (x402 + Stellar), server-side URL fetching, sponsored
transactions, and client wallets. We take reports about payment handling, SSRF,
sponsorship abuse, and wallet/key exposure seriously and appreciate responsible
disclosure.

## Supported versions

Only the latest release on the `main` branch is supported with security fixes.

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |
| < 0.1   | :x:                |

If you are running an older commit or fork, please reproduce against the latest
`main` before reporting.

## Reporting a vulnerability (private)

**Do not open a public issue for security problems.**

Use GitHub private vulnerability reporting:

1. Go to the **Security** tab of this repository.
2. Open **Report a vulnerability** (advisories → _Report a vulnerability_).
3. Direct link: <https://github.com/Emoji-dot/Query402/security/advisories/new>
4. Include: affected area (payment, SSRF/scrape, sponsorship, wallet), the
   version or commit, reproduction steps, and the impact you observed.

If private vulnerability reporting is unavailable to you, contact a maintainer
directly instead of filing a public issue. Do not publish the finding until a
fix is available.

## Response expectations

- **Acknowledgement**: within 3 business days.
- **Initial assessment / triage**: within 7 business days.
- **Fix or mitigation plan**: communicated after triage, prioritized by severity.
- **Disclosure**: coordinated with you; we credit reporters who want credit.

This is a small project, so timelines are best-effort and we will keep you
updated in the private advisory thread.

## Please keep these out of public issues, PRs, and screenshots

Never include any of the following in a public issue, pull request, commit, log
paste, or screenshot:

- **Payment headers and evidence** — `payment-required`, `payment-response`,
  `X-Sponsorship-Grant`, and any other x402/settlement payloads.
- **Wallet secrets** — `S...` secret keys, seed phrases, `DEMO_CLIENT_SECRET_KEY`,
  `SPONSORSHIP_SIGNING_SECRET`, or any private key material.
- **API keys** — facilitator keys, `GROQ_API_KEY`, provider keys, and tokens.
- **Exploit details** — working payloads, PoCs, or step-by-step abuse that would
  let someone exploit the issue before a fix exists.

Use the private advisory to share repros and evidence. Redact secrets as
`<redacted>` in any log excerpt you attach. This also applies to test data: do
not create advisories or examples containing real secrets.

## Scope

In scope: the API (`apps/api`), the web dashboard (`apps/web`), the agent client
(`apps/agent-client`), and shared packages, with focus on payment handling, the
SSRF/scrape path, sponsorship controls, and wallet/key handling.

Related documents: [SSRF scrape policy](../docs/SSRF_SCRAPE_POLICY.md) and
[sponsorship threat model](../docs/sponsorship-threat-model.md).
