import SftpClient from "ssh2-sftp-client";
import type { RemoteFsClient, RemoteListEntry } from "./remote-fs";

export async function connectSftp(opts: {
  host: string;
  port?: number;
  username: string;
  password?: string;
  privateKey?: string;
  timeoutMs?: number;
}): Promise<RemoteFsClient> {
  const client = new SftpClient();
  await client.connect({
    host: opts.host,
    port: opts.port ?? 22,
    username: opts.username,
    password: opts.password,
    privateKey: opts.privateKey,
    readyTimeout: opts.timeoutMs ?? 20_000,
    algorithms: {
      serverHostKey: [
        "ssh-ed25519",
        "ecdsa-sha2-nistp256",
        "rsa-sha2-512",
        "rsa-sha2-256",
        "ssh-rsa",
      ],
    },
  });
  return new SftpRemoteClient(client);
}

class SftpRemoteClient implements RemoteFsClient {
  constructor(private readonly client: SftpClient) {}

  async list(path: string): Promise<RemoteListEntry[]> {
    const list = await this.client.list(path);
    return list.map((e) => ({
      name: e.name,
      type: (e.type === "d" || e.type === "l" ? e.type : "-") as
        | "d"
        | "-"
        | "l",
      size: e.size,
    }));
  }

  async get(path: string): Promise<Buffer> {
    return (await this.client.get(path)) as Buffer;
  }

  async put(path: string, data: Buffer | string): Promise<void> {
    const buf = typeof data === "string" ? Buffer.from(data, "utf8") : data;
    await this.client.put(buf, path);
  }

  async stat(path: string): Promise<{ size: number; isDirectory: boolean }> {
    const s = await this.client.stat(path);
    return {
      size: s.size,
      isDirectory: s.isDirectory,
    };
  }

  async rename(from: string, to: string): Promise<void> {
    await this.client.rename(from, to);
  }

  async delete(path: string): Promise<void> {
    await this.client.delete(path);
  }

  async end(): Promise<void> {
    await this.client.end().catch(() => undefined);
  }
}
