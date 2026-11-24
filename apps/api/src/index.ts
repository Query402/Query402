import { app } from "./app.js";
import { config } from "./lib/config.js";
import { logger } from "./lib/logger.js";
import { bootApi } from "./lib/storage/sqlite/startup.js";
import { closeAnalyticsDb } from "./lib/storage/sqlite/store.js";
import { registerShutdown } from "./lib/shutdown.js";

const result = bootApi({
  listen: () => {
    const server = app.listen(config.PORT_API, () => {
      logger.info(
        {
          port: config.PORT_API,
          network: config.STELLAR_NETWORK,
          facilitator: config.X402_FACILITATOR_URL
        },
        "Query402 API listening"
      );
    });

    registerShutdown({
      closeServer: () =>
        new Promise((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
      closeDb: closeAnalyticsDb
    });
  }
});
if (!result.listening) {
  process.exit(1);
}
