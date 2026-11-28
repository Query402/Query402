# Facilitator Response Policy

The API accepts facilitator response bodies up to **256 KiB (262,144 bytes)** for `/verify`, `/settle`, and `/supported`. The limit is enforced while reading the response stream, including when `Content-Length` is missing or inaccurate; a body exactly at the limit is accepted.

An oversized body is cancelled and rejected with `FacilitatorResponseTooLargeError`. The error message contains only the configured limit, not any facilitator response content.

The facilitator transport retains the x402 SDK's 90-second request timeout and follows redirects.
