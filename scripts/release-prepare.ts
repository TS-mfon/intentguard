import {main} from "../tools/production/release-plan.mjs";

try { await main(); }
catch(error) { console.error("Release preparation refused: "+String((error as Error).message).slice(0,600));process.exitCode=1; }
