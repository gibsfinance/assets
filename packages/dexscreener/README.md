# Dexscreener Api Optimized

An optimized wrapper around the dexscreener api that maximizes that number of requests without running into rate limits.

```ts
const chainKey = 'ethereum'
const chainType = 'evm'
const chainId = 1
const collector = new dexscreener.Collector(
  chainKey,
  chainType,
  chainId,
)
let nextKeys = new Set<string>()
while ((nextKeys = collector.getPendingTokens(16)).size) {
  await collector.collect(nextKeys, signal)
}
```
