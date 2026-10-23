import { Client, FileType } from "basic-ftp";
import { Readable, Writable } from "stream";
import type { RemoteFsClient, RemoteListEntry } from "./remote-fs";

export type FtpConnectOpts = {
  host: string;
  port?: number;
  username: string;
  password: string;
  /** false = FTP chiaro; true = FTPS esplicito; "implicit" = FTPS implicito (es. 990) */
  secure?: boolean | "implicit";
  timeoutMs?: number;
};

export async function connectFtp(opts: FtpConnectOpts): Promise<RemoteFsClient> {
  const client = new Client(opts.timeoutMs ?? 12_000);
  client.ftp.verbose = false;
  const secure = opts.secure ?? false;
  await client.access({
    host: opts.host,
    port: opts.port ?? 21,
    user: opts.username,
    password: opts.password,
    secure,
    // Hosting spesso con cert sul nome dominio, mentre FTP usa IP
    ...(secure
      ? { secureOptions: { rejectUnauthorized: false } }
      : {}),
  });
  return new FtpRemoteClient(client);
}

class FtpRemoteClient implements RemoteFsClient {
  constructor(private readonly client: Client) {}

  private norm(path: string): string {
    if (!path || path === ".") return "";
    return path.replace(/^\/+/, "").replace(/\/+$/, "");
  }

  async list(path: string): Promise<RemoteListEntry[]> {
    const list = await this.client.list(this.norm(path) || ".");
    return list.map((f) => {
      let type: RemoteListEntry["type"] = "-";
      if (f.type === FileType.Directory) type = "d";
      else if (f.type === FileType.SymbolicLink) type = "l";
      else if (
        // LIST classico senza MLSD: Unknown + no extension → spesso cartella
        f.type === FileType.Unknown &&
        !/\.[a-z0-9]{1,8}$/i.test(f.name) &&
        (f.size === 0 || f.size == null)
      ) {
        type = "d";
      }
      return {
        name: f.name,
        type,
        size: f.size,
        modifyTime: f.modifiedAt ? f.modifiedAt.getTime() : undefined,
      };
    });
  }

  async get(path: string): Promise<Buffer> {
    const chunks: Buffer[] = [];
    const writable = new Writable({
      write(chunk, _enc, cb) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        cb();
      },
    });
    await this.client.downloadTo(writable, this.norm(path));
    return Buffer.concat(chunks);
  }

  async put(path: string, data: Buffer | string): Promise<void> {
    const buf = typeof data === "string" ? Buffer.from(data, "utf8") : data;
    const readable = Readable.from(buf);
    await this.client.uploadFrom(readable, this.norm(path));
  }

  async stat(path: string): Promise<{
    size: number;
    isDirectory: boolean;
    modifyTime?: number;
  }> {
    const normalized = this.norm(path);
    const base = normalized.includes("/")
      ? normalized.slice(0, normalized.lastIndexOf("/"))
      : ".";
    const name = normalized.includes("/")
      ? normalized.slice(normalized.lastIndexOf("/") + 1)
      : normalized;
    const list = await this.list(base || ".");
    const hit = list.find((e) => e.name === name);
    if (!hit) throw new Error(`FTP: path non trovato (${path})`);
    return {
      size: hit.size ?? 0,
      isDirectory: hit.type === "d",
      modifyTime: hit.modifyTime,
    };
  }

  async rename(from: string, to: string): Promise<void> {
    await this.client.rename(this.norm(from), this.norm(to));
  }

  async delete(path: string): Promise<void> {
    await this.client.remove(this.norm(path));
  }

  async end(): Promise<void> {
    this.client.close();
  }
}
