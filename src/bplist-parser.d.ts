declare module "bplist-parser" {
  /** Parse a binary plist from a Buffer. Returns an array of root objects. */
  export function parseBuffer(buffer: Buffer): unknown[];
  export function parseFile(file: string): Promise<unknown[]>;
}
