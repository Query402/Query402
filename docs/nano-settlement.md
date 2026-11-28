# Nano (XNO) settlement option

Query402 still settles USDC through x402 on Stellar. Nano is an additional rail, not a replacement.

| Rail           | Asset  | Fee                 | Amount                                    |
| -------------- | ------ | ------------------- | ----------------------------------------- |
| `x402-stellar` | `USDC` | Stellar network fee | Integer micro-USD, via `buildPaymentLink` |
| `nano`         | `XNO`  | None                | Caller-supplied integer raw value         |

`buildNanoSettlement` checks the raw amount and the `nano_` account and returns a feeless instruction. It does not contact a Nano node, broadcast a block, or convert a catalog USD price into XNO. `XNO` is rejected by `buildPaymentLink` so it cannot be opened as a Stellar payment.

The shared helpers live in `packages/shared/src/settlement-options.ts`.
