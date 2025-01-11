# Gibs Assets

based off of schema available here: https://raw.githubusercontent.com/Uniswap/token-lists/main/src/tokenlist.schema.json

this repo relies on git submodules so you will need to be careful not to break links and regularly update

constrained assets metadata linking.

- reduce rpc calls
- images for each token
- multiple data providers
- multiple networks
- backup lookups
- sequenced filters

## load backups

if you are dealing with bridged assets, chances are that you want to provide backup images when one side of a bridge does not have an image link. using this server, you can form a url that will tell the backend to check for image 1, then image 2, then 3, and so on.

## network images

the simplest image: just a chain id

```sh
https://gib.show/image/1
```

## token id

a chain id and it's hex hash

```sh
https://gib.show/image/1/0x2b591e99afe9f32eaa6214f7b7629768c40eeb39
```

## list

a full list

```sh
https://gib.show/list/pulsex/exchange
```

if a default value is set, then no param is required:

```sh
https://gib.show/list/9mm
```

## filters on lists

get only the pulsechain assets under the 9mm list

```sh
https://gib.show/list/9mm?chainId=369

https://gib.show/list/pulsechain-bridge/home?chainId=369
```

## backup images

the following shows WETH being loaded, and bridged WETH used as a backup - note the two `i` query params

```sh
https://gib.show/image/?i=1/0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2&i=369/0x02DcdD04e3F455D838cd1249292C58f3B79e3C3C
```

## perspectives

resolve through specific lists, first by seeding the db with your configuration, then utilizing the list order key. the following resolves through pulsex, then piteas, then internetmoney, then trustwallet in that order.

```sh
https://gib.show/list/merged/5ff74ffa222c6c435c9432ad937c5d95e3327ebbe3eb9ff9f62a4d940d5790f9?chainId=369
```
