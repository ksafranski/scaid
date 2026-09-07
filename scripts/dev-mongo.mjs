/**
 * Starts a local MongoDB in Docker before `npm run dev`, so getting the app running is a
 * single command.
 *
 * Deliberately never fails the dev server: if MONGODB_URI points somewhere remote (Atlas),
 * or Mongo is already up, or Docker isn't available, this prints what it found and gets out
 * of the way.
 */
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createConnection } from "node:net";

const CONTAINER = "scaid-mongo";
const VOLUME = "scaid-mongo-data";
// mongo:8 and mongo:latest refuse to boot on Linux kernels >= 6.19 (SERVER-121912),
// which includes Docker Desktop's VM. 8.2 is the first release that starts cleanly.
const IMAGE = process.env.SCAID_MONGO_IMAGE || "mongo:8.2";

const say = (message) => console.log(`  [mongo] ${message}`);

/** Minimal .env reader — we only need one variable, before Next has loaded anything. */
function readEnvFiles() {
  const values = {};
  for (const file of [".env", ".env.local"]) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const match = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/i.exec(line);
      if (!match) continue;
      values[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
    }
  }
  return values;
}

function isPortOpen(port, timeout = 1000) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    const finish = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeout);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

function docker(args) {
  return execFileSync("docker", args, { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
}

async function waitForPort(port, seconds) {
  for (let attempt = 0; attempt < seconds * 2; attempt++) {
    if (await isPortOpen(port)) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

async function main() {
  const uri = process.env.MONGODB_URI || readEnvFiles().MONGODB_URI;

  if (!uri) {
    say("No MONGODB_URI yet — copy .env.example to .env.local first.");
    return;
  }

  let url;
  try {
    url = new URL(uri);
  } catch {
    say(`Couldn't read MONGODB_URI ("${uri}") — leaving it alone.`);
    return;
  }

  const isLocal = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (!isLocal) {
    say(`Using the database at ${url.hostname} — nothing to start locally.`);
    return;
  }

  const port = Number(url.port) || 27017;
  if (await isPortOpen(port)) {
    say(`Already running on port ${port}.`);
    return;
  }

  try {
    docker(["info"]);
  } catch {
    say("Docker isn't running, and nothing is listening on port " + port + ".");
    say("Start Docker Desktop, or point MONGODB_URI at a hosted database.");
    return;
  }

  try {
    const exists = docker(["ps", "-aq", "--filter", `name=^${CONTAINER}$`]);
    if (exists) {
      say(`Starting the existing "${CONTAINER}" container…`);
      docker(["start", CONTAINER]);
    } else {
      say(`Creating "${CONTAINER}" from ${IMAGE} (first run pulls the image)…`);
      docker(["run", "-d", "--name", CONTAINER, "-p", `${port}:27017`, "-v", `${VOLUME}:/data/db`, IMAGE]);
    }
  } catch (error) {
    say(`Docker couldn't start it: ${error.stderr?.toString().trim() || error.message}`);
    return;
  }

  if (await waitForPort(port, 30)) {
    say(`Ready on port ${port}.`);
    return;
  }

  say("It didn't come up in time. Here's what the container said:");
  try {
    console.log(docker(["logs", "--tail", "5", CONTAINER]));
  } catch {
    // Nothing useful to add if even the logs are unavailable.
  }
}

// Never block `npm run dev` on a database problem — warn and let Next start.
main().catch((error) => say(`Skipping automatic startup: ${error.message}`));
