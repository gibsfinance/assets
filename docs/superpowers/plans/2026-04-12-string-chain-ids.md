# CAIP-2 Chain IDs — Future Refactor

**Goal:** Adopt [CAIP-2](https://github.com/ChainAgnostic/CAIPs/blob/main/CAIPs/caip-2.md) chain identifiers as the canonical format. Numeric EVM chain IDs become `eip155:{chainId}` (e.g., `eip155:369` for PulseChain, `eip155:1` for Ethereum). Non-EVM networks use their native CAIP-2 namespace (e.g., `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`, `cosmos:cosmoshub-4`, `bip122:000000000019d6689c085ae165831e93`).

**Why:** The current `numeric(78, 0)` column and `^\d+$` validation locks the platform to EVM-style numeric chain IDs. Wallets (WalletConnect, MetaMask) already use the `eip155:` prefix to distinguish chains. Adopting CAIP-2 makes the system wallet-compatible and extensible to any blockchain ecosystem.

**Migration strategy:**
- Schema: `network.chain_id` from `numeric(78, 0)` to `text`
- Data migration: existing numeric values get prefixed with `eip155:` (e.g., `369` → `eip155:369`)
- API: accept both bare numbers (for backwards compat, auto-prefix `eip155:`) and full CAIP-2 strings
- Internally always store and compare the full CAIP-2 string

**Scope:**
- Schema: ALTER COLUMN + data migration + reindex
- Server: update all queries, accept both `369` and `eip155:369` in endpoints
- Server: `network.type` becomes derivable from the CAIP-2 namespace prefix
- UI: update `Number(chainId)` / `parseInt(chainId)` casts → parse CAIP-2 format
- Collectors: emit CAIP-2 chain IDs when inserting networks

**Blocked by:** Nothing — can be done independently. Should be a dedicated branch.
