import {main} from "../tools/production/mainnet-deploy.mjs";

try {
  await main();
} catch (error) {
  console.error("Mainnet stage refused:", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
