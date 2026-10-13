import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function writeAtomic(path, text, mode) {
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, text, { mode });
  chmodSync(temp, mode);
  renameSync(temp, path);
}

/**
 * Durable service state. Public records (workspaces, agent metadata) live in `state.json`;
 * each agent secret lives alone in `secrets/<pubkey>.json` (0600) and is never serialized
 * into responses or logs.
 */
export class StateStore {
  constructor(stateDir) {
    this.stateDir = stateDir;
    this.secretsDir = join(stateDir, "secrets");
    mkdirSync(this.secretsDir, { recursive: true, mode: 0o700 });
    chmodSync(stateDir, 0o700);
    chmodSync(this.secretsDir, 0o700);
    this.path = join(stateDir, "state.json");
    try {
      const parsed = JSON.parse(readFileSync(this.path, "utf8"));
      this.workspaces = parsed.workspaces ?? {};
      this.agents = parsed.agents ?? {};
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      this.workspaces = {};
      this.agents = {};
    }
  }

  save() {
    writeAtomic(
      this.path,
      `${JSON.stringify({ workspaces: this.workspaces, agents: this.agents }, null, 2)}\n`,
      0o600,
    );
  }

  readSecret(pubkey) {
    return JSON.parse(readFileSync(join(this.secretsDir, `${pubkey}.json`), "utf8"));
  }

  writeSecret(pubkey, secret) {
    writeAtomic(join(this.secretsDir, `${pubkey}.json`), JSON.stringify(secret), 0o600);
  }

  deleteSecret(pubkey) {
    rmSync(join(this.secretsDir, `${pubkey}.json`), { force: true });
  }
}
