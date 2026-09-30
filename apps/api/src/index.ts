import { app } from "./app.js";
import { config } from "./lib/config.js";
import { logger } from "./lib/logger.js";
import { bootApi } from "./lib/storage/sqlite/startup.js";

const result = bootApi({
  listen: () => {
    app.listen(config.PORT_API, () => {
      logger.info(
        {
          port: config.PORT_API,
          network: config.STELLAR_NETWORK,
          facilitator: config.X402_FACILITATOR_URL
        },
        "Query402 API listening"
      );
    });
  }
});

if (!result.listening) {
  process.exit(1);
}
