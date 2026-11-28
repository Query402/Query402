# Request ID policy

Query402 accepts an optional inbound correlation ID on every API request and
returns the effective ID on every response.

## Header

| Direction | Header         |
| --------- | -------------- |
| Request   | `x-request-id` |
| Response  | `x-request-id` |

## Accepted values

- **Maximum length:** 128 characters.
- **Allowed characters:** printable, log-safe ASCII only — letters (`A-Z`,
  `a-z`), digits (`0-9`), dot (`.`), underscore (`_`), colon (`:`) and hyphen
  (`-`).
- Values containing control characters (for example `\n`, `\r`, NUL or DEL),
  whitespace, or any other punctuation are rejected.

## Behavior

1. A valid client-supplied `x-request-id` is echoed back unchanged in the
   response header and used in structured logs.
2. A value that is too long or contains invalid/control characters is discarded;
   the API generates a server-owned ID (`req_<21 chars>`) instead and logs a
   `discarded invalid inbound request id` warning with the rejection reason
   (`too_long` or `invalid_characters`).
3. A request without the header is assigned a generated server ID. This is
   normal and is not logged as a warning.

The effective ID is always available to application code as `res.locals.requestId`
(`res.locals.requestIdSource` is `client` or `generated`) and is included in the
`incoming request` log line as `requestId` / `requestIdSource`.
