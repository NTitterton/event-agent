import { spawnSync } from "node:child_process";

function run(command: string, args: string[]): void {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run("git", ["status", "--short"]);
run("git", ["push", "-u", "origin", "main"]);

