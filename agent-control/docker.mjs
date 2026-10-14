import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import Docker from "dockerode";
import { HttpError } from "./lib.mjs";

export const CONTAINER_USER = "1000:1000";
export const MANAGED_LABEL = "buzz.agent-control";
const BUZZ_BINARIES = ["buzz", "buzz-acp", "buzz-agent", "buzz-dev-mcp"];
const RUNTIME_FILES = ["Dockerfile", "buzz-ws-fs"];

/** Thin wrapper around the configured (task/rootless) Docker daemon. */
export class ContainerRuntime {
  constructor({ socketPath, runtimeDir, binDir, imagePrefix = "buzz-remote-runtime", limits }) {
    if (!socketPath) throw new Error("DOCKER_HOST must point at a unix socket");
    this.docker = new Docker({ socketPath });
    this.runtimeDir = runtimeDir;
    this.binDir = binDir;
    this.limits = limits;
    const digest = createHash("sha256");
    for (const file of RUNTIME_FILES) digest.update(readFileSync(join(runtimeDir, file)));
    this.image = `${imagePrefix}:${digest.digest("hex").slice(0, 12)}`;
  }

  /** Build the runtime image into the daemon unless this content hash already exists. */
  async ensureImage(log = console) {
    try {
      await this.docker.getImage(this.image).inspect();
      return;
    } catch (error) {
      if (error.statusCode !== 404) throw error;
    }
    log.info?.(`building ${this.image}`);
    const stream = await this.docker.buildImage(
      { context: this.runtimeDir, src: RUNTIME_FILES },
      { t: this.image, rm: true, forcerm: true },
    );
    await new Promise((resolve, reject) => {
      this.docker.modem.followProgress(
        stream,
        (error, output) => {
          const failed = output?.find((entry) => entry.error);
          if (error || failed) reject(error ?? new Error(failed.error));
          else resolve();
        },
        () => {},
      );
    });
  }

  binaryBinds() {
    return BUZZ_BINARIES.map((name) => `${join(this.binDir, name)}:/opt/buzz/bin/${name}:ro`);
  }

  /** HostConfig shared by every contained workload: no privileges, bounded resources. */
  hostConfig({ binds, restartPolicy = { Name: "no" } }) {
    return {
      Binds: [...binds, ...this.binaryBinds()],
      Init: true,
      ReadonlyRootfs: true,
      Tmpfs: {
        "/tmp": "rw,nosuid,nodev,size=128m",
        "/home/buzz": "rw,nosuid,nodev,size=128m,uid=1000,gid=1000,mode=0700",
      },
      CapDrop: ["ALL"],
      SecurityOpt: ["no-new-privileges:true"],
      Memory: this.limits.memoryBytes,
      MemorySwap: this.limits.memoryBytes,
      PidsLimit: this.limits.pids,
      NanoCpus: this.limits.nanoCpus,
      NetworkMode: "bridge",
      RestartPolicy: restartPolicy,
      LogConfig: { Type: "json-file", Config: { "max-size": "2m", "max-file": "2" } },
    };
  }

  /**
   * Give a freshly created bind-mount source directory to the container user. Runs a one-shot
   * container with only CAP_CHOWN and only that directory mounted.
   */
  async chownForContainerUser(hostDir) {
    const container = await this.docker.createContainer({
      Image: this.image,
      User: "0:0",
      Cmd: ["chown", "1000:1000", "/target"],
      Labels: { [MANAGED_LABEL]: "chown" },
      NetworkDisabled: true,
      HostConfig: {
        Binds: [`${hostDir}:/target`],
        CapDrop: ["ALL"],
        CapAdd: ["CHOWN"],
        SecurityOpt: ["no-new-privileges:true"],
        NetworkMode: "none",
        ReadonlyRootfs: true,
      },
    });
    try {
      await container.start();
      const result = await container.wait();
      if (result.StatusCode !== 0) throw new Error(`chown helper exited ${result.StatusCode}`);
    } finally {
      await container.remove({ force: true }).catch(() => {});
    }
  }

  /** Delete everything under a container-user-owned host directory via a one-shot container. */
  async wipeDir(hostDir) {
    const container = await this.docker.createContainer({
      Image: this.image,
      User: CONTAINER_USER,
      Cmd: ["/usr/local/bin/buzz-ws-fs", "wipe"],
      Labels: { [MANAGED_LABEL]: "wipe" },
      NetworkDisabled: true,
      HostConfig: {
        Binds: [`${hostDir}:/workspace`],
        CapDrop: ["ALL"],
        SecurityOpt: ["no-new-privileges:true"],
        NetworkMode: "none",
        ReadonlyRootfs: true,
      },
    });
    try {
      await container.start();
      const result = await container.wait();
      if (result.StatusCode !== 0) throw new Error(`wipe helper exited ${result.StatusCode}`);
    } finally {
      await container.remove({ force: true }).catch(() => {});
    }
  }

  container(name) {
    return this.docker.getContainer(name);
  }

  /** Inspect a container, returning null when it does not exist. */
  async inspect(name) {
    try {
      return await this.docker.getContainer(name).inspect();
    } catch (error) {
      if (error.statusCode === 404) return null;
      throw error;
    }
  }

  async listManaged(kind) {
    return this.docker.listContainers({
      all: true,
      filters: { label: [`${MANAGED_LABEL}=${kind}`] },
    });
  }

  async removeContainer(name) {
    try {
      await this.docker.getContainer(name).remove({ force: true });
    } catch (error) {
      if (error.statusCode !== 404) throw error;
    }
  }

  /**
   * Run a short command in a running container and collect stdout (Buffer), stderr (string)
   * and exit code. `stdin` (Buffer) is streamed then closed.
   */
  async execCollect(name, cmd, { stdin, user = CONTAINER_USER, timeoutMs = 30_000, maxBytes } = {}) {
    const exec = await this.docker.getContainer(name).exec({
      Cmd: cmd,
      User: user,
      WorkingDir: "/workspace",
      AttachStdin: stdin !== undefined,
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
    });
    const stream = await exec.start({ hijack: true, stdin: stdin !== undefined });
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const out = [];
    const err = [];
    let outLength = 0;
    let tooLarge = false;
    stdout.on("data", (chunk) => {
      outLength += chunk.length;
      if (maxBytes && outLength > maxBytes) {
        tooLarge = true;
        stream.destroy();
        return;
      }
      out.push(chunk);
    });
    stderr.on("data", (chunk) => err.push(chunk));
    this.docker.modem.demuxStream(stream, stdout, stderr);
    const finished = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        stream.destroy();
        reject(new HttpError(504, "runtime_timeout", "Container command timed out"));
      }, timeoutMs);
      stream.on("end", () => {
        clearTimeout(timer);
        resolve();
      });
      stream.on("close", () => {
        clearTimeout(timer);
        resolve();
      });
      stream.on("error", (error) => {
        clearTimeout(timer);
        if (tooLarge) resolve();
        else reject(error);
      });
    });
    if (stdin !== undefined) {
      stream.write(stdin);
      stream.end();
    }
    await finished;
    if (tooLarge) throw new HttpError(413, "payload_too_large", "File is too large to transfer");
    const info = await exec.inspect();
    return {
      code: info.ExitCode,
      stdout: Buffer.concat(out),
      stderr: Buffer.concat(err).toString("utf8"),
    };
  }

  /**
   * Start an interactive exec and return `{exec, stream}`. With `tty` the stream is raw PTY
   * bytes; without, it is Docker's multiplexed stdout/stderr framing.
   */
  async execInteractive(name, cmd, { tty, env = [], user = CONTAINER_USER, cols, rows } = {}) {
    const exec = await this.docker.getContainer(name).exec({
      Cmd: cmd,
      User: user,
      WorkingDir: "/workspace",
      Env: env,
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      Tty: Boolean(tty),
      ...(tty && cols && rows ? { ConsoleSize: [rows, cols] } : {}),
    });
    const stream = await exec.start({ hijack: true, stdin: true, Tty: Boolean(tty) });
    return { exec, stream };
  }

  demux(stream, stdout, stderr) {
    this.docker.modem.demuxStream(stream, stdout, stderr);
  }

  /** Kill a process session inside a container and confirm nothing in it survived. */
  async killSession(name, sessionId) {
    if (!Number.isInteger(sessionId) || sessionId <= 1) return;
    try {
      await this.execCollect(name, ["/usr/local/bin/buzz-ws-fs", "killsession", String(sessionId)], {
        timeoutMs: 10_000,
      });
    } catch (error) {
      if (error.statusCode !== 404 && error.statusCode !== 409) throw error;
    }
  }
}
