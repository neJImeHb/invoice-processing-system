import { spawn } from "node:child_process";

const children = [
  spawn("npm", ["run", "dev", "-w", "server"], { stdio: "inherit", shell: true }),
  spawn("npm", ["run", "dev", "-w", "client"], { stdio: "inherit", shell: true }),
];

function stopAll() {
  for (const child of children) {
    if (child.killed || child.exitCode !== null) {
      continue;
    }
    child.kill();
  }
}

for (const child of children) {
  child.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      stopAll();
      process.exit(code);
    }
  });
}

process.on("SIGINT", () => {
  stopAll();
  process.exit(0);
});
process.on("SIGTERM", () => {
  stopAll();
  process.exit(0);
});
