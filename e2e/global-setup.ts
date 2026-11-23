import { execFileSync } from "node:child_process";
import { RESTORE_SEED_COMMAND } from "./lib/values";

const restoreTheSeededDatabaseOncePerRun = () => {
  const [command, ...args] = RESTORE_SEED_COMMAND;
  execFileSync(command, args, { stdio: ["ignore", process.stderr, process.stderr] });
};

export default restoreTheSeededDatabaseOncePerRun;
