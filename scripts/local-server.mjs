import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { config as loadEnv } from "dotenv";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

loadEnv();
loadEnv({ path: ".env.local", override: true });

function runStep(args) {
  const result = spawnSync(npmCommand, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });

  if ((result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1);
  }
}

function resetBuildArtifacts() {
  rmSync(resolve(process.cwd(), ".next"), {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 120,
  });
}

runStep(["run", "db:push"]);
resetBuildArtifacts();
runStep(["run", "build"]);

const server = spawn(npmCommand, ["run", "start"], {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit",
});

const forwardSignal = (signal) => {
  if (!server.killed) {
    server.kill(signal);
  }
};

process.on("SIGINT", () => forwardSignal("SIGINT"));
process.on("SIGTERM", () => forwardSignal("SIGTERM"));

server.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
