import { describe, expect, it } from 'vitest'
import { chainIdFilterMatch, resolveChainIdAgainstStored } from './chain-id'

describe('chainIdFilterMatch', () => {
  // ?chain_id=501 used to be prefixed to eip155-501 and matched with equality, so
  // lists on solana-501 were unreachable by number. A bare value names no namespace,
  // so it matches on the stored id's reference instead.
  it('matches a bare number on the reference, reaching any namespace', () => {
    expect(chainIdFilterMatch('501')).toEqual({ kind: 'reference', reference: '501' })
    expect(chainIdFilterMatch('369')).toEqual({ kind: 'reference', reference: '369' })
  })

  // The counterpart: an explicit id is an assertion, so it must NOT widen to Solana.
  it('matches an explicit identifier exactly', () => {
    expect(chainIdFilterMatch('eip155-501')).toEqual({ kind: 'exact', chainId: 'eip155-501' })
    expect(chainIdFilterMatch('solana-501')).toEqual({ kind: 'exact', chainId: 'solana-501' })
  })

  it('canonicalizes the bare asset chain rather than treating it as a reference', () => {
    expect(chainIdFilterMatch('asset-0')).toEqual({ kind: 'exact', chainId: 'asset-0' })
  })
})

/** A stored network that holds tokens. */
const populated = (chainId: string) => ({ chainId, hasTokens: true })
/** A stored network row with no tokens behind it — a phantom, e.g. a stale eip155 duplicate. */
const empty = (chainId: string) => ({ chainId, hasTokens: false })

describe('resolveChainIdAgainstStored', () => {
  describe('bare numeric input', () => {
    // The bug this exists for. /stats reports {chainId: "501", chainIdentifier:
    // "solana-501"}, and feeding that bare 501 back into /list/tokens resolved it
    // to eip155-501 — a network that does not exist — so the endpoint answered 200
    // with zero tokens while /stats claimed 6286. Callers cannot tell "this chain
    // is empty" from "you asked in the wrong namespace".
    it('resolves to the non-evm namespace that actually holds the chain', () => {
      expect(resolveChainIdAgainstStored('501', [populated('solana-501')])).toEqual({
        status: 'resolved',
        chainId: 'solana-501',
      })
    })

    it('resolves tron the same way', () => {
      expect(resolveChainIdAgainstStored('195', [populated('tvm-195')])).toEqual({
        status: 'resolved',
        chainId: 'tvm-195',
      })
    })

    // Backward compatibility is the reason eip155 wins rather than "first match":
    // every existing consumer calls /list/tokens/1 and /list/tokens/369 meaning
    // Ethereum and PulseChain. That must not change because a non-EVM chain
    // happens to share the number.
    it('prefers eip155 when both namespaces hold the same reference', () => {
      expect(resolveChainIdAgainstStored('1', [populated('solana-1'), populated('eip155-1')])).toEqual({
        status: 'resolved',
        chainId: 'eip155-1',
      })
    })

    it('resolves to eip155 for an ordinary evm chain', () => {
      expect(resolveChainIdAgainstStored('369', [populated('eip155-369')])).toEqual({
        status: 'resolved',
        chainId: 'eip155-369',
      })
    })

    // The case that made this token-aware rather than a plain namespace preference.
    // The dev database carries an eip155-501 row with no tokens behind it, alongside
    // the real solana-501. A rule that preferred eip155 on sight would resolve to the
    // phantom and reproduce the original bug exactly — 200 with an empty list. Rows
    // like this are not hypothetical: migration 0008 exists to delete four of them.
    it('skips a phantom eip155 row in favour of the namespace holding the tokens', () => {
      expect(resolveChainIdAgainstStored('501', [empty('eip155-501'), populated('solana-501')])).toEqual({
        status: 'resolved',
        chainId: 'solana-501',
      })
    })

    // Both empty: nothing to follow, so fall back to the compatible namespace. The
    // answer is an empty list either way; this just keeps it predictable.
    it('falls back to eip155 when every candidate is empty', () => {
      expect(resolveChainIdAgainstStored('501', [empty('eip155-501'), empty('solana-501')])).toEqual({
        status: 'resolved',
        chainId: 'eip155-501',
      })
    })

    // A single empty candidate is still the truthful answer — naming solana-501 tells
    // the caller the chain is known and empty, where eip155-501 would imply it does
    // not exist at all.
    it('names a lone empty candidate rather than inventing an eip155 id', () => {
      expect(resolveChainIdAgainstStored('501', [empty('solana-501')])).toEqual({
        status: 'resolved',
        chainId: 'solana-501',
      })
    })

    // Two non-EVM namespaces sharing a reference with no eip155 row to break the
    // tie. Guessing would silently serve the wrong chain's tokens, so the caller
    // is told to disambiguate.
    it('reports ambiguity rather than guessing between non-evm namespaces', () => {
      expect(resolveChainIdAgainstStored('42', [populated('solana-42'), populated('tvm-42')])).toEqual({
        status: 'ambiguous',
        candidates: ['solana-42', 'tvm-42'],
      })
    })

    // Preserves today's contract: an unknown chain still resolves into eip155 and
    // the caller answers 200 with an empty list. Turning this into a 404 would
    // break consumers polling a chain before its first token is collected.
    it('falls back to eip155 when nothing is stored', () => {
      expect(resolveChainIdAgainstStored('999999', [])).toEqual({
        status: 'resolved',
        chainId: 'eip155-999999',
      })
    })
  })

  describe('explicit namespace input', () => {
    it('passes an explicit non-evm identifier through untouched', () => {
      expect(resolveChainIdAgainstStored('solana-501', [populated('solana-501')])).toEqual({
        status: 'resolved',
        chainId: 'solana-501',
      })
    })

    // An explicit namespace is an assertion, not a guess — honour it even when it
    // matches nothing, so the caller gets the empty answer they asked for rather
    // than being silently redirected to a different chain.
    it('does not redirect an explicit identifier to a populated namespace', () => {
      expect(resolveChainIdAgainstStored('eip155-501', [populated('solana-501')])).toEqual({
        status: 'resolved',
        chainId: 'eip155-501',
      })
    })

    it('leaves asset-0 alone', () => {
      expect(resolveChainIdAgainstStored('asset-0', [populated('asset-0')])).toEqual({
        status: 'resolved',
        chainId: 'asset-0',
      })
    })

    it('maps the bare asset chain to asset-0, not eip155-0', () => {
      expect(resolveChainIdAgainstStored('0', [populated('asset-0')])).toEqual({
        status: 'resolved',
        chainId: 'asset-0',
      })
    })
  })
})
