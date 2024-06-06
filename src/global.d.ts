declare module "ipfs-fetch" {
  IPFSFetch = (input: { ipfs: ReturnType<typeof IPFS.create> }) => Promise<typeof fetch>;
  export = IPFSFetch;
};
