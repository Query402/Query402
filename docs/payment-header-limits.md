# Payment header limits

Query402 accepts payment headers up to 8,192 characters. The limit applies to
`Payment`, `Payment-Signature`, and `X-Payment` on protected x402 routes and is
checked before the x402 parser or payment diagnostics process the value.

Headers above the limit receive HTTP `413` with the stable error code
`payment_header_too_large`. Clients should send a compact encoded payment
payload and must not retry the oversized value unchanged.
