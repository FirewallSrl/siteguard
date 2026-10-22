/** Interfaccia comune SFTP / FTP usata da scan e inventario. */
export type RemoteListEntry = {
  name: string;
  type: "d" | "-" | "l";
  size?: number;
  /** Epoch ms — ultima modifica sul server (mtime) */
  modifyTime?: number;
};

export type RemoteStat = {
  size: number;
  isDirectory: boolean;
  modifyTime?: number;
};

export type RemoteFsClient = {
  list(path: string): Promise<RemoteListEntry[]>;
  get(path: string): Promise<Buffer>;
  put(path: string, data: Buffer | string): Promise<void>;
  stat(path: string): Promise<RemoteStat>;
  rename(from: string, to: string): Promise<void>;
  delete(path: string): Promise<void>;
  end(): Promise<void>;
};
