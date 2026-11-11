import { describe, expect, it } from 'vitest'
import { CHAIN_REFUSAL, PRO_REFUSAL } from './__testing__/etherscan-fixtures'
import { classifyEtherscanResponse, parseTokenInfo } from './etherscan-response'

describe('classifyEtherscanResponse', () => {
  it('reads status 1 as ok, with the message as detail', () => {
    expect(classifyEtherscanResponse({ status: '1', message: 'OK', result: [] })).toEqual({
      outcome: 'ok',
      detail: 'OK',
    })
  })

  it('accepts a numeric status 1 and falls back to "OK" without a message', () => {
    expect(classifyEtherscanResponse({ status: 1, result: '1000' })).toEqual({ outcome: 'ok', detail: 'OK' })
  })

  it('recognises the API Pro refusal when it arrives in result', () => {
    expect(classifyEtherscanResponse({ status: '0', message: 'NOTOK', result: PRO_REFUSAL })).toEqual({
      outcome: 'requires-pro',
      detail: PRO_REFUSAL,
    })
  })

  it('recognises the API Pro refusal when it arrives in message', () => {
    expect(classifyEtherscanResponse({ status: '0', message: PRO_REFUSAL, result: null })).toEqual({
      outcome: 'requires-pro',
      detail: PRO_REFUSAL,
    })
  })

  it('recognises the chain refusal in result', () => {
    expect(classifyEtherscanResponse({ status: '0', message: 'NOTOK', result: CHAIN_REFUSAL })).toEqual({
      outcome: 'chain-not-on-plan',
      detail: CHAIN_REFUSAL,
    })
  })

  it('recognises the chain refusal in message', () => {
    expect(classifyEtherscanResponse({ status: '0', message: CHAIN_REFUSAL }).outcome).toBe('chain-not-on-plan')
  })

  it.each([
    ['Invalid API Key'],
    ['Missing/Invalid API Key, rate limit of 1/5sec applied'],
    ['Too many invalid api key attempts, please try again later'],
  ])('recognises the key refusal %j', (text) => {
    expect(classifyEtherscanResponse({ status: '0', message: 'NOTOK', result: text }).outcome).toBe('invalid-key')
  })

  it.each([
    ['Max rate limit reached, please use API Key for higher rate limit'],
    ['Max calls per sec rate limit reached (3/sec)'],
    ['Community Free API limit reached.'],
  ])('recognises the rate message %j', (text) => {
    expect(classifyEtherscanResponse({ status: '0', message: 'NOTOK', result: text }).outcome).toBe('rate-limited')
  })

  it('lets a plan refusal outrank a rate phrase in the same text', () => {
    const text = `${PRO_REFUSAL} Max rate limit reached`
    expect(classifyEtherscanResponse({ status: '0', result: text }).outcome).toBe('requires-pro')
  })

  it('treats a refusal it does not know as other, never as ok', () => {
    expect(
      classifyEtherscanResponse({ status: '0', message: 'NOTOK', result: 'Error! Invalid address format' }),
    ).toEqual({
      outcome: 'other',
      detail: 'Error! Invalid address format',
    })
  })

  it('uses the message as detail when result is not text', () => {
    expect(classifyEtherscanResponse({ status: '0', message: 'No records found', result: [] })).toEqual({
      outcome: 'other',
      detail: 'No records found',
    })
  })

  it('describes an answer with no text at all', () => {
    expect(classifyEtherscanResponse({ status: '0' })).toEqual({
      outcome: 'other',
      detail: 'the response carried no message',
    })
  })

  it.each([[null], [undefined], ['<html>blocked</html>'], [[]], [42]])('treats %j as other', (body) => {
    expect(classifyEtherscanResponse(body)).toEqual({ outcome: 'other', detail: 'the response was not a JSON object' })
  })
})

const tokenRecord = (overrides: Record<string, unknown> = {}) => ({
  contractAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  tokenName: ' USD Coin ',
  symbol: 'USDC',
  divisor: '6',
  tokenType: 'ERC20',
  image: 'https://etherscan.io/token/images/centre-usdc_28.png',
  ...overrides,
})

describe('parseTokenInfo', () => {
  it('reads name, symbol, decimals (from divisor) and the image field as the logo', () => {
    expect(parseTokenInfo([tokenRecord()])).toEqual({
      address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      name: 'USD Coin',
      symbol: 'USDC',
      decimals: 6,
      logoURI: 'https://etherscan.io/token/images/centre-usdc_28.png',
    })
  })

  it('accepts a record with no token type', () => {
    expect(parseTokenInfo([tokenRecord({ tokenType: undefined })])?.decimals).toBe(6)
  })

  it('keeps no logo when the image is empty', () => {
    expect(parseTokenInfo([tokenRecord({ image: '' })])?.logoURI).toBeNull()
  })

  it('keeps no logo when the image is a relative path, whose host is unknown', () => {
    expect(parseTokenInfo([tokenRecord({ image: '/token/images/usdc.png' })])?.logoURI).toBeNull()
  })

  it('keeps no logo when the image is not text', () => {
    expect(parseTokenInfo([tokenRecord({ image: 5 })])?.logoURI).toBeNull()
  })

  it.each([
    ['a collection', { tokenType: 'ERC721' }],
    ['an address that is not hexadecimal', { contractAddress: 'nope' }],
    ['a missing name', { tokenName: '  ' }],
    ['a missing symbol', { symbol: '' }],
    ['decimals that are not a number', { divisor: 'six' }],
    ['decimals that are empty', { divisor: '' }],
    ['decimals that are fractional', { divisor: '1.5' }],
    ['decimals that are negative', { divisor: '-1' }],
    ['decimals above 255', { divisor: '256' }],
  ])('rejects %s', (_label, overrides) => {
    expect(parseTokenInfo([tokenRecord(overrides)])).toBeNull()
  })

  it.each([[null], [[]], ['text'], [[null]], [[7]], [{}]])('rejects a result of %j', (result) => {
    expect(parseTokenInfo(result)).toBeNull()
  })
})
