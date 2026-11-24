# Security policy

## Supported versions

Security fixes are applied to the `main` branch. The current package line is `0.1.x`.
Older commits and forks are not supported.

| Version | Supported |
| ------- | --------- |
| `main` (`0.1.x`) | Yes |
| older snapshots | No |

## Reporting a vulnerability

Use GitHub private vulnerability reporting. Open a draft advisory from
[Report a vulnerability](https://github.com/Query402/Query402/security/advisories/new).
Do not open a public GitHub issue, pull request, or discussion for a suspected vulnerability.

Private reporting is a repository setting. If that page says reporting is disabled, wait for a
maintainer to enable **Private vulnerability reporting** under repository settings. Still do not
post the report in public.

Include the affected path, the version or commit, and the impact you can demonstrate. Do not
include a working exploit, a live payment payload, or a secret.

## What must stay private

Do not put any of the following in issues, pull requests, commits, logs, screenshots, or chat:

- payment headers, including `PAYMENT-SIGNATURE`, `X-PAYMENT`, and facilitator responses
- wallet secrets, seeds, or private keys
- API keys, including `X402_FACILITATOR_API_KEY` and provider credentials
- exploit details, proof-of-concept requests, or steps that would let someone repeat an attack

Describe the impact without those materials. A maintainer can ask for more detail on the private
advisory.

## Response

We aim to acknowledge a private report within 3 business days and to confirm or reject the impact
within 7 business days after that. Fixes ship on `main`. We will credit the reporter in the
advisory when they want to be named.
