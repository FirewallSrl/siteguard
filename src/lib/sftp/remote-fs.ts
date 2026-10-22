/** Interfaccia comune SFTP / FTP usata da scan e inventario. */
export type RemoteListEntry = {
  name: string;
  type: "d" | "-" | "l";
  size?: number;
};

export type RemoteFsClient = {
  list(path: string): Promise<RemoteListEntry[]>;
  get(path: string): Promise<Buffer>;
  put(path: string, data: Buffer | string): Promise<void>;
  stat(path: string): Promise<{ size: number; isDirectory: boolean }>;
  rename(from: string, to: string): Promise<void>;
  delete(path: string): Promise<void>;
  end(): Promise<void>;
};
