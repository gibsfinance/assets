import { useEffect, useRef, useMemo, useCallback } from 'react'
import { getApiUrl } from '../utils'

const SIZES = [28, 32, 36]
const DURATIONS = [35, 45, 30]
const DIRECTIONS: Array<'normal' | 'reverse'> = ['normal', 'reverse', 'normal']
const ICONS_PER_ROW = 40

let keyframesInjected = false
function ensureKeyframes() {
  if (keyframesInjected) return
  keyframesInjected = true
  const style = document.createElement('style')
  style.textContent = '@keyframes conveyor{from{transform:translateX(0)}to{transform:translateX(-50%)}}'
  document.head.appendChild(style)
}

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

// 390 curated icon paths from Ethereum, PulseChain, Arbitrum, BNB, Polygon + network icons
const ICON_PATHS: string[] = [
  '/image/1',
  '/image/1/0x0000000000095413afc295d19edeb1ad7b71c952',
  '/image/1/0x086f405146ce90135750bbec9a063a8b20a8bffb',
  '/image/1/0x104e363ac6521e55a24ae724855362acec3febe6',
  '/image/1/0x14d60e7fdc0d71d8611742720e4c50e7a974020c',
  '/image/1/0x19848077f45356b21164c412eff3d3e4ff6ebc31',
  '/image/1/0x1a91b61e884ddd93a0aa83cd6908a4bc07e6f3eb',
  '/image/1/0x1beef31946fbbb40b877a72e4ae04a8d1a5cee06',
  '/image/1/0x20c3fa331a385b63ee39137e99d0cf2db142fce1',
  '/image/1/0x20c64dee8fda5269a78f2d5bdba861ca1d83df7a',
  '/image/1/0x220b71671b649c03714da9c621285943f3cbcdc6',
  '/image/1/0x2370f9d504c7a6e775bf6e14b3f12846b594cd53',
  '/image/1/0x24d73bca2bd9c3a61e99dfc7cb86d3c379ebded7',
  '/image/1/0x2602278ee1882889b946eb11dc0e810075650983',
  '/image/1/0x275f5ad03be0fa221b4c6649b8aee09a42d9412a',
  '/image/1/0x28d38df637db75533bd3f71426f3410a82041544',
  '/image/1/0x2de509bf0014ddf697b220be628213034d320ece',
  '/image/1/0x2edf094db69d6dcd487f1b3db9febe2eec0dd4c5',
  '/image/1/0x2f42b7d686ca3effc69778b6ed8493a7787b4d6e',
  '/image/1/0x3505f494c3f0fed0b594e01fa41dd3967645ca39',
  '/image/1/0x370adc71f67f581158dc56f539df5f399128ddf9',
  '/image/1/0x378cb52b00f9d0921cb46dfc099cff73b42419dc',
  '/image/1/0x3d658390460295fb963f54dc0899cfb1c30776df',
  '/image/1/0x411099c0b413f4feddb10edf6a8be63bd321311c',
  '/image/1/0x431d5dff03120afa4bdf332c61a6e1766ef37bdb',
  '/image/1/0x441761326490cacf7af299725b6292597ee822c2',
  '/image/1/0x471a202f69d6e975da55e363dab1bdb2e86e0c0f',
  '/image/1/0x4ddc2d193948926d02f9b1fe9e1daa0718270ed5',
  '/image/1/0x4fdadf176c4d9c9686d7b965bde95758fed63184',
  '/image/1/0x5394794be8b6ed5572fcd6b27103f46b5f390e8f',
  '/image/1/0x5c6ee304399dbdb9c8ef030ab642b10820db8f56',
  '/image/1/0x5d3a536e4d6dbd6114cc1ead35777bab948e3643',
  '/image/1/0x671a912c10bba0cfa74cfc2d6fba9ba1ed9530b2',
  '/image/1/0x6d765cbe5bc922694afe112c140b8878b9fb0390',
  '/image/1/0x6f222e04f6c53cc688ffb0abe7206aac66a8ff98',
  '/image/1/0x70e8de73ce538da2beed35d14187f6959a8eca96',
  '/image/1/0x71fc860f7d3a592a4a98740e39db31d25db65ae8',
  '/image/1/0x723cbfc05e2cfcc71d3d89e770d32801a5eef5ab',
  '/image/1/0x77607588222e01bf892a29abab45796a2047fc7b',
  '/image/1/0x77c6e4a580c0dce4e5c7a17d0bc077188a83a059',
  '/image/1/0x7866e48c74cbfb8183cd1a929cd9b95a7a5cb4f4',
  '/image/1/0x7cfd34ca2dceca6c835adc7e61409a089cfff14a',
  '/image/1/0x7f0c8b125040f707441cad9e5ed8a8408673b455',
  '/image/1/0x873fb544277fd7b977b196a826459a69e27ea4ea',
  '/image/1/0x89ab32156e46f46d02ade3fecbe5fc4243b9aaed',
  '/image/1/0x9c78ee466d6cb57a4d01fd887d2b5dfb2d46288f',
  '/image/1/0x9e6be44cc1236eef7e1f197418592d363bedcd5a',
  '/image/1/0xa258c4606ca8206d8aa700ce2143d7db854d168c',
  '/image/1/0xa58a4f5c4bb043d2cc1e170613b74e767c94189b',
  '/image/1/0xa5ca62d95d24a4a350983d5b8ac4eb8638887396',
  '/image/1/0xa5f2211b9b8170f694421f2046281775e8468044',
  '/image/1/0xa696a63cc78dffa1a63e9e50587c197387ff6c7e',
  '/image/1/0xace8e719899f6e91831b18ae746c9a965c2119f1',
  '/image/1/0xb26631c6dda06ad89b93c71400d25692de89c068',
  '/image/1/0xb478c6245e3d85d6ec3486b62ea872128d562541',
  '/image/1/0xb6ca7399b4f9ca56fc27cbff44f4d2e4eef1fc81',
  '/image/1/0xb772c8745c46c8868610dcecdcefc803cfdf28f5',
  '/image/1/0xb8c3b7a2a618c552c23b1e4701109a9e756bab67',
  '/image/1/0xbdab72602e9ad40fc6a6852caf43258113b8f7a5',
  '/image/1/0xbe428c3867f05dea2a89fc76a102b544eac7f772',
  '/image/1/0xd109b2a304587569c84308c55465cd9ff0317bfb',
  '/image/1/0xd31e53966bf212e860d48a3a8651a23d09a7fdc3',
  '/image/1/0xd3d3f901b2d9c587988333f00b154d57fce9dd07',
  '/image/1/0xd5e0eda0214f1d05af466e483d9376a77a67448b',
  '/image/1/0xd7c1eb0fe4a30d3b2a846c04aa6300888f087a5f',
  '/image/1/0xd8e154ede9401dabb860fe84fecd2761b895bc50',
  '/image/1/0xdab396ccf3d84cf2d07c4454e10c8a6f5b008d2b',
  '/image/1/0xdcb5645eda1ed34c5641d81b927d33ebae9cf2a4',
  '/image/1/0xdffa3a7f5b40789c7a437dbe7b31b47f9b08fe75',
  '/image/1/0xe07ecc676daf0b24b24a1c46c966d9c463984b38',
  '/image/1/0xe11ba472f74869176652c35d30db89854b5ae84d',
  '/image/1/0xea01906843ea8d910658a2c485ffce7c104ab2b6',
  '/image/1/0xec21890967a8ceb3e55a3f79dac4e90673ba3c2e',
  '/image/1/0xf0610eb7d8ee12d59412da32625d5e273e78ff0b',
  '/image/1/0xf29ae508698bdef169b89834f76704c3b205aedf',
  '/image/1/0xf406f7a9046793267bc276908778b29563323996',
  '/image/1/0xf8e57ac2730d3088d98b79209739b0d5ba085a03',
  '/image/1/0xf921ae2dac5fa128dc0f6168bf153ea0943d2d43',
  '/image/1/0xfc05987bd2be489accf0f509e44b0145d68240f7',
  '/image/1/0xfcc5c47be19d06bf83eb04298b026f81069ff65b',
  '/image/1/0xfd0877d9095789caf24c98f7cce092fa8e120775',
  '/image/10',
  '/image/100',
  '/image/1284',
  '/image/130',
  '/image/137',
  '/image/137/0x03b54a6e9a984069379fae1a4fc4dbae93b3bccd',
  '/image/137/0x03f61137bfb86be07394f0fd07a33984020f96d8',
  '/image/137/0x04f177fcacf6fb4d2f95d41d7d3fee8e565ca1d0',
  '/image/137/0x05089c9ebffa4f0aca269e32056b1b36b37ed71b',
  '/image/137/0x0735fa49eb7d9ddf3e4d9a9f01229627f67632a1',
  '/image/137/0x0e9b89007eee9c958c0eda24ef70723c2c93dd58',
  '/image/137/0x11b37c9388420d79d48e8d531227f43c9bf1bbf1',
  '/image/137/0x162539172b53e9a93b7d98fb6c41682de558a320',
  '/image/137/0x181feaecca4a69a793272ea06df40edf2dd0804c',
  '/image/137/0x1a7e49125a6595588c9556f07a4c006461b24545',
  '/image/137/0x1fd6cf265fd3428f655378a803658942095b4c4e',
  '/image/137/0x21a00838e6b2d4aa3ac4bbc11111be011e1ca111',
  '/image/137/0x25ed22a5b6804cd1fbf750f005d5c4c80763c0fb',
  '/image/137/0x27842334c55c01ddfe81bf687425f906816c5141',
  '/image/137/0x28767e286113ab01ee819b9398a22d6f27badb6e',
  '/image/137/0x2c72d25530191ebd244eb6325e1892480b0e6e28',
  '/image/137/0x2d34a748427801e5d3da862bf474e2b28e501624',
  '/image/137/0x3d2bd0e15829aa5c362a4144fdf4a1112fa29b5c',
  '/image/137/0x40445993b0122456ec9e5c679f4f0485e1a5b474',
  '/image/137/0x49e6a20f1bbdfeec2a8222e052000bbb14ee6007',
  '/image/137/0x4c16f69302ccb511c5fac682c7626b9ef0dc126a',
  '/image/137/0x4c392822d4be8494b798cea17b43d48b2308109c',
  '/image/137/0x4c5ca366e26409845624e29b62c388a06961a792',
  '/image/137/0x4e78011ce80ee02d2c3e649fb657e45898257815',
  '/image/137/0x5c15cdb9d43824dca67fceb1201e5abebe0b2cbc',
  '/image/137/0x5f0197ba06860dac7e31258bdf749f92b6a636d4',
  '/image/137/0x5f2f8818002dc64753daedf4a6cb2ccb757cd220',
  '/image/137/0x62395ec568c92973a38230de209abba9de18b9b7',
  '/image/137/0x62a872d9977db171d9e213a5dc2b782e72ca0033',
  '/image/137/0x66f364f908c662772f5b7ecd58488f372c584833',
  '/image/137/0x6bb45ceac714c52342ef73ec663479da35934bf7',
  '/image/137/0x7aefff599570dec2f3dbbc2ace3cb1f8206749eb',
  '/image/137/0x7b2d2732dccc1830aa63241dc13649b7861d9b54',
  '/image/137/0x7b3bd12675c6b9d6993eb81283cb68e6eb9260b5',
  '/image/137/0x80244c2441779361f35803b8c711c6c8fc6054a3',
  '/image/137/0x80ca0d8c38d2e2bcbab66aa1648bd1c7160500fe',
  '/image/137/0x8105f88e77a5d102099bf73db4469d3f1e3b0cd6',
  '/image/137/0x838c9634de6590b96aeadc4bc6db5c28fd17e3c2',
  '/image/137/0x839f1a22a59eaaf26c85958712ab32f80fea23d9',
  '/image/137/0x8437d7c167dfb82ed4cb79cd44b7a32a1dd95c77',
  '/image/137/0x883abe4168705d2e5da925d28538b7a6aa9d8419',
  '/image/137/0x88c949b4eb85a90071f2c0bef861bddee1a7479d',
  '/image/137/0x9719d867a500ef117cc201206b8ab51e794d3f82',
  '/image/137/0x9a4eb698e5de3d3df0a68f681789072de1e50222',
  '/image/137/0x9c17d36bccecafb7d284e8b3d985576d21cf2350',
  '/image/137/0xa2c638b78783e9afe26a16ec8b11de54eb169360',
  '/image/137/0xa9a8eed4c7b91de6d6d2a6b2d21300ec162b1375',
  '/image/137/0xaa4fbc6809a8e1924520fc85282ac4c76a7671d7',
  '/image/137/0xaa9654becca45b5bdfa5ac646c939c62b527d394',
  '/image/137/0xab9cb20a28f97e189ca0b666b8087803ad636b3c',
  '/image/137/0xadb6d62e142a2f911fb3c9ca1c1d0fe5d9437252',
  '/image/137/0xae840deab9916d80fadf42e218119a6051468169',
  '/image/137/0xafb755c5f2ea2aadbae693d3bf2dc2c35158dc04',
  '/image/137/0xb0b195aefa3650a6908f15cdac7d92f8a5791b0b',
  '/image/137/0xb9df5fda1c435cd4017a1f1f9111996520b64439',
  '/image/137/0xbc5b59ea1b6f8da8258615ee38d40e999ec5d74f',
  '/image/137/0xc45a479877e1e9dfe9fcd4056c699575a1045daa',
  '/image/137/0xc65b1b55a287b4e8bf5c04faad21d43a21a1ce46',
  '/image/137/0xcc0643b786d8b566a98e85dde48077239eaa8598',
  '/image/137/0xcc44674022a792794d219847362bb95c661937a9',
  '/image/137/0xcce87c5b269c94b31ec437b1d7d85bf1413b7804',
  '/image/137/0xce899f26928a2b21c6a2fddd393ef37c61dba918',
  '/image/137/0xd0258a3fd00f38aa8090dfee343f10a9d4d30d3f',
  '/image/137/0xd14d1e501b2b52d6134db1ad0857aa91f9bfe2dd',
  '/image/137/0xd711d7d893de57dc13ff465763218770bd42db1d',
  '/image/137/0xd838290e877e0188a4a44700463419ed96c16107',
  '/image/137/0xdab35042e63e93cc8556c9bae482e5415b5ac4b1',
  '/image/137/0xdc4f4ed9872571d5ec8986a502a0d88f3a175f1e',
  '/image/137/0xe5417af564e4bfda1c483642db72007871397896',
  '/image/137/0xe8d17b127ba8b9899a160d9a07b69bca8e08bfc6',
  '/image/137/0xe9c21de62c5c5d0ceacce2762bf655afdceb7ab3',
  '/image/137/0xee5bb31fdf28b5d64f5a5605085cc4e3649aa624',
  '/image/137/0xf2b028ed5977f136982fdfa429814cf19f09693f',
  '/image/137/0xf401e2c1ce8f252947b60bfb92578f84217a1545',
  '/image/137/0xf5ea626334037a2cf0155d49ea6462fddc6eff19',
  '/image/137/0xf796969fa47fb0748c80b8b153cbb895e88cbd54',
  '/image/137/0xf868939ee81f04f463010bc52eab91c0839ef08c',
  '/image/137/0xf86df9b91f002cfeb2aed0e6d05c4c4eaef7cf02',
  '/image/137/0xfca466f2fa8e667a517c9c6cfa99cf985be5d9b1',
  '/image/137/0xffa188493c15dfaf2c206c97d8633377847b6a52',
  '/image/146',
  '/image/250',
  '/image/288',
  '/image/324',
  '/image/369',
  '/image/369/0x0567ca0de35606e9c260cc2358404b11de21db44',
  '/image/369/0x08edb18cb120676ff4c3435726df424cc8e18638',
  '/image/369/0x0deed1486bc52aa0d3e6f8849cec5add6598a162',
  '/image/369/0x1dcbf345bc44696bbbed402367f7c62e524fe8b5',
  '/image/369/0x1f9840a85d5af5bf1d1762f925bdaddc4201f984',
  '/image/369/0x2260fac5e5542a773aa44fbcfedf7c193bc2c599',
  '/image/369/0x3819f64f282bf135d62168c1e513280daf905e06',
  '/image/369/0x3ab667c153b8dd2248bb96e7a2e1575197667784',
  '/image/369/0x3f105121a10247de9a92e818554dd5fcd2063ae7',
  '/image/369/0x4d224452801aced8b2f0aebe155379bb5d594381',
  '/image/369/0x4d3aea379b7689e0cb722826c909fab39e54123d',
  '/image/369/0x514910771af9ca656af840dff83e8264ecf986ca',
  '/image/369/0x518076cce3729ef1a3877ea3647a26e278e764fe',
  '/image/369/0x5a98fcbea516cf06857215779fd812ca3bef1b32',
  '/image/369/0x600136da8cc6d1ea07449514604dc4ab7098db82',
  '/image/369/0x6982508145454ce325ddbe47a25d4ec3d2311933',
  '/image/369/0x6b175474e89094c44da98b954eedeac495271d0f',
  '/image/369/0x73d8a4d01d658e565cf83068397fd39baf386c48',
  '/image/369/0x7663e79e09d78142e3f6e4dca19faf604159842d',
  '/image/369/0x7901a3569679aec3501dbec59399f327854a70fe',
  '/image/369/0x7ff1c0e8c968a8ddc1f25e3d891562ea549ee32e',
  '/image/369/0x8854bc985fb5725f872c8856bea11b917caeb2fe',
  '/image/369/0x9159f1d2a9f51998fc9ab03fbd8f265ab14a1b3b',
  '/image/369/0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce',
  '/image/369/0x9663c2d75ffd5f4017310405fce61720af45b829',
  '/image/369/0x96e035ae0905efac8f733f133462f971cfa45db1',
  '/image/369/0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  '/image/369/0xa1077a294dde1b09bb078844df40758a5d0f9a27',
  '/image/369/0xa12e2661ec6603cbbb891072b2ad5b3d5edb48bd',
  '/image/369/0xa685c45fd071df23278069db9137e124564897d0',
  '/image/369/0xa9d4230b4899e6aac0d84e540941b3832aba3ba0',
  '/image/369/0xabf663531fa10ab8116cbf7d5c6229b018a26ff9',
  '/image/369/0xae0303f244a3e9c74ee8d373af0bd637643dd371',
  '/image/369/0xaec4c07537b03e3e62fc066ec62401aed5fdd361',
  '/image/369/0xb513038bbfdf9d40b676f41606f4f61d4b02c4a2',
  '/image/369/0xb7dd55c4858f93b819435152d1ffa3cf9561fff5',
  '/image/369/0xbbcf895bfcb57d0f457d050bb806d1499436c0ce',
  '/image/369/0xca35638a3fddd02fec597d8c1681198c06b23f58',
  '/image/369/0xcd1c703f6c2a382b6aaa61a5191219c27d671c31',
  '/image/369/0xcfcffe432a48db53f59c301422d2edd77b2a88d7',
  '/image/369/0xd22e78c22d7e77229d60cc9fc57b0e294f54488e',
  '/image/369/0xd7407bd3e6ad1baae0ba9eafd1ec41bfe63907b2',
  '/image/369/0xdac17f958d2ee523a2206206994597c13d831ec7',
  '/image/369/0xdfdc2836fd2e63bba9f0ee07901ad465bff4de71',
  '/image/369/0xeb6b7932da20c6d7b3a899d5887d86dfb09a6408',
  '/image/369/0xec345429357e75e81d162372a48b6c4307e1922d',
  '/image/369/0xec7caf2f5b4ec2574f214824d7f1ecef6fe6032b',
  '/image/369/0xecd465a15fac825b0fe69416a4c7bfe03a50c12e',
  '/image/369/0xee2d275dbb79c7871f8c6eb2a4d0687dd85409d1',
  '/image/369/0xf876bdf9d6403aa7d5bf7f523e8f440a841cc596',
  '/image/42161',
  '/image/42161/0x00000000ea00f3f4000e7ed5ed91965b19f1009b',
  '/image/42161/0x02a6c1789c3b4fdb1a7a3dfa39f90e5d3c94f4f9',
  '/image/42161/0x02c1b10e5329c4502469396b2ce9f200e60b4a77',
  '/image/42161/0x09e18590e8f76b6cf471b3cd75fe1a1a9d2b2c2b',
  '/image/42161/0x0b5c6ac0e1082f2d81e829b8c2957886e6bb3994',
  '/image/42161/0x0c59f6b96d3cac58240429c7659ec107f8b1efa7',
  '/image/42161/0x0d6fce45796d5c00689c0916b976645a0ff1f0ce',
  '/image/42161/0x0e929101c4fa7c91eaa64d7216161ba3eee387fe',
  '/image/42161/0x118346c2bb9d24412ed58c53bf9bb6f61a20d7ec',
  '/image/42161/0x13a7dedb7169a17be92b0e3c7c2315b46f4772b3',
  '/image/42161/0x13f950ee286a5be0254065d4b66420fc0e57adfc',
  '/image/42161/0x16e443aebc83e2089aa90431a1c0d311854eec69',
  '/image/42161/0x1717d8be2bcb27f4e8f36c817088fa6a2c0b3b30',
  '/image/42161/0x214151022c2a5e380ab80cdac31f23ae554a7345',
  '/image/42161/0x266e5923f6118f8b340ca5a23ae7f71897361476',
  '/image/42161/0x2824efe5cedb3bc8730e412981997dac7c7640c2',
  '/image/42161/0x28bf1c9ee2eb746a2d61a0bec97a344028171d6c',
  '/image/42161/0x28c7747d7ea25ed3ddcd075c6ccc3634313a0f59',
  '/image/42161/0x316ffea434348c2cb72024e62ae845770315351e',
  '/image/42161/0x31c91d8fb96bff40955dd2dbc909b36e8b104dde',
  '/image/42161/0x32df62dc3aed2cd6224193052ce665dc18165841',
  '/image/42161/0x337842843512192b798a5592053ce8e2245651f8',
  '/image/42161/0x3644971a7e971f60e707f7e8716ccac5a0461290',
  '/image/42161/0x39bce681d72720f80424914800a78c63fdfaf645',
  '/image/42161/0x3d75f2bb8abcdbd1e27443cb5cbce8a668046c81',
  '/image/42161/0x4117ec0a779448872d3820f37ba2060ae0b7c34b',
  '/image/42161/0x42ba3ac0c2d9b611623e1e48f51757606a105d9e',
  '/image/42161/0x448bc811f60eac772775dd53421380e8d4dc4338',
  '/image/42161/0x44966bf47a494b36dfb407afb334a9226cdf90bc',
  '/image/42161/0x4728e48c2c201e32fe210aab68a71e419feac74a',
  '/image/42161/0x4810e5a7741ea5fdbb658eda632ddfac3b19e3c6',
  '/image/42161/0x4a7779abed707a9c7deadbbef5c15f3e52370a99',
  '/image/42161/0x4ff50c17df0d1b788d021acd85039810a1aa68a1',
  '/image/42161/0x51318b7d00db7acc4026c88c3952b66278b6a67f',
  '/image/42161/0x5837e4189819637853a357af36650902347f5e73',
  '/image/42161/0x5979d7b546e38e414f7e9822514be443a4800529',
  '/image/42161/0x5b041a4e76b08c5afc1e0b9a789cbfab5ebec993',
  '/image/42161/0x5b32624f352d2fc6cc70889967a143ba1814f82b',
  '/image/42161/0x625e7708f30ca75bfd92586e17077590c60eb4cd',
  '/image/42161/0x67bad479f77488f0f427584e267e66086a7da43a',
  '/image/42161/0x6a2a68ca7fc793d8cea36326a6ec1ef7ac3d9742',
  '/image/42161/0x6d80113e533a2c0fe82eabd35f1875dcea89ea97',
  '/image/42161/0x700e4edb5c7d8f53ccb0cf212b81a121728e1d5b',
  '/image/42161/0x7c5fed5e0f8d05748cc12ffe1ca400b07de0f983',
  '/image/42161/0x7f88888b7a81546a036554aa67a289ea428b20d4',
  '/image/42161/0x7fb7ede54259cb3d4e1eaf230c7e2b1ffc951e9a',
  '/image/42161/0x82af49447d8a07e3bd95bd0d56f35241523fbab1',
  '/image/42161/0x83a32f2818b6754f7d58af0e559fa9d3fa99ce13',
  '/image/42161/0x89ea0284308deef33a22abd7ea33888b4349108c',
  '/image/42161/0x8ad3c73f833d3f9a523ab01476625f269aeb7cf0',
  '/image/42161/0x8c1ea32448e09a59f36595abec6207c9ebd590a2',
  '/image/42161/0x939727d85d99d0ac339bf1b76dfe30ca27c19067',
  '/image/42161/0x97ec5dada8262bd922bffd54a93f5a11efe0b136',
  '/image/42161/0x9a2486fbe7bc17c9100be65c31abe7c9bf84c23c',
  '/image/42161/0x9eeab030a17528efb2ac0f81d76fab8754e461bd',
  '/image/42161/0xa90424d5d3e770e8644103ab503ed775dd1318fd',
  '/image/42161/0xaae0c3856e665ff9b3e2872b6d75939d810b7e40',
  '/image/42161/0xab5c23bdbe99d75a7ae4756e7ccefd0a97b37e78',
  '/image/42161/0xb1284f6b3e487e3f773e9ad40f337c3b3cda5c69',
  '/image/42161/0xbd1b73b2e89967e83507b500d798998200a53380',
  '/image/42161/0xbe8e3f4d5bd6ee0175359982cc91dafa3cf72502',
  '/image/42161/0xc3abc47863524ced8daf3ef98d74dd881e131c38',
  '/image/42161/0xc52915fe75dc8db9fb6306f43aaef1344e0837ab',
  '/image/42161/0xc8fb643d18f1e53698cfda5c8fdf0cdc03c1dbec',
  '/image/42161/0xcb55d61e6299597c39feec3d4036e727afbe11be',
  '/image/42161/0xcd3246f6173217dbecf63ffab83d477b266679da',
  '/image/42161/0xd089b4cb88dacf4e27be869a00e9f7e2e3c18193',
  '/image/42161/0xd17aff8fcf7698aabfb5f8be90aa2692774fa810',
  '/image/42161/0xd3188e0df68559c0b63361f6160c57ad88b239d8',
  '/image/42161/0xd3443ee1e91af28e5fb858fbd0d72a63ba8046e0',
  '/image/42161/0xd41f1f0cf89fd239ca4c1f8e8ada46345c86b0a4',
  '/image/42161/0xd4939d69b31fbe981ed6904a3af43ee1dc777aab',
  '/image/42161/0xd6cf874e24a9f5f43075142101a6b13735cdd424',
  '/image/42161/0xdd92f0723a7318e684a88532cac2421e3cc9968e',
  '/image/42161/0xe018c227bc84e44c96391d3067fab5a9a46b7e62',
  '/image/42161/0xe1385fdd5ffb10081cd52c56584f25efa9084015',
  '/image/42161/0xed3fb761414da74b74f33e5c5a1f78104b188dfc',
  '/image/42161/0xef261714f7e5ba6b86f4780eb6e3bf26b10729cf',
  '/image/42161/0xf4bd09b048248876e39fcf2e0cdf1aee1240a9d2',
  '/image/42161/0xfa296fca3c7dba4a92a42ec0b5e2138da3b29050',
  '/image/42220',
  '/image/43114',
  '/image/5000',
  '/image/534352',
  '/image/56',
  '/image/56/0x02e75d28a8aa2a0033b8cf866fcf0bb0e1ee4444',
  '/image/56/0x099ea74ed0a30f6dcc5c7d5630ece2ab5d147812',
  '/image/56/0x0ccd575bf9378c06f6dca82f8122f570769f00c2',
  '/image/56/0x0f13fc8a93ab8edc9fde0a1e19aac693161599a5',
  '/image/56/0x10051147418c42218986cedd0adc266441f8a14f',
  '/image/56/0x155e8a74dac3d8560ddabbc26aa064b764535193',
  '/image/56/0x1610bc33319e9398de5f57b33a5b184c806ad217',
  '/image/56/0x17893dd8bf3f868f691b314abeb3ba8fd615e680',
  '/image/56/0x1ce0c2827e2ef14d5c4f29a091d735a204794041',
  '/image/56/0x1d2f0da169ceb9fc7b3144628db156f3f6c60dbe',
  '/image/56/0x23396cf899ca06c4472205fc903bdb4de249d6fc',
  '/image/56/0x23b35c7f686cac8297ea6e81a467286481ca4444',
  '/image/56/0x23c5d1164662758b3799103effe19cc064d897d6',
  '/image/56/0x334b3ecb4dca3593bccc3c7ebd1a1c1d1780fbf1',
  '/image/56/0x3b4de3c7855c03bb9f50ea252cd2c9fa1125ab07',
  '/image/56/0x3e17ee3b1895dd1a7cf993a89769c5e029584444',
  '/image/56/0x477c2c0459004e3354ba427fa285d7c053203c0e',
  '/image/56/0x4be63a9b26ee89b9a3a13fd0aa1d0b2427c135f8',
  '/image/56/0x4c769928971548eb71a3392eaf66bedc8bef4b80',
  '/image/56/0x4c9027e10c5271efca82379d3123917ae3f2374e',
  '/image/56/0x4ce5f6bf8e996ae54709c75865709aca5127dd54',
  '/image/56/0x57185189118c7e786cafd5c71f35b16012fa95ad',
  '/image/56/0x5ce12f6d9f2fcaf0b11494a1c39e09eeb16ca7e8',
  '/image/56/0x5d7909f951436d4e6974d841316057df3a622962',
  '/image/56/0x5e2689412fae5c29bd575fbe1d5c1cd1e0622a8f',
  '/image/56/0x5f0388ebc2b94fa8e123f404b79ccf5f40b29176',
  '/image/56/0x62823659d09f9f9d2222058878f89437425eb261',
  '/image/56/0x650b940a1033b8a1b1873f78730fcfc73ec11f1f',
  '/image/56/0x66b6b2ed21a0bfb3f84b120401074abfc4f0c08d',
  '/image/56/0x6e61579c22f9a6da63a33e819f29b6697d2a126e',
  '/image/56/0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c',
  '/image/56/0x734d66f635523d7ddb7d2373c128333da313041b',
  '/image/56/0x7565ab68d3f9dadff127f864103c8c706cf28235',
  '/image/56/0x7977bf3e7e0c954d12cdca3e013adaf57e0b06e0',
  '/image/56/0x79ebc9a2ce02277a4b5b3a768b1c0a4ed75bd936',
  '/image/56/0x7a0bc0f5de87be3b2fe00546df583668b2994444',
  '/image/56/0x7c56d81ecb5e1d287a1e22b89b01348f07be3541',
  '/image/56/0x80d04e44955aa9c3f24041b2a824a20a88e735a8',
  '/image/56/0x8578eb576e126f67913a8bc0622e0a22eba0989a',
  '/image/56/0x88c55b3255ae1e6628c953c5cdff27ad3cc33c81',
  '/image/56/0x93bb13e90678ccd8bbab07d1daef15086746dc9b',
  '/image/56/0x948d2a81086a075b3130bac19e4c6dee1d2e3fe8',
  '/image/56/0x972207a639cc1b374b893cc33fa251b55ceb7c07',
  '/image/56/0x9988d876d7500646534e2d91b382b1ac4c5a4444',
  '/image/56/0x9d173e6c594f479b4d47001f8e6a95a7adda42bc',
  '/image/56/0x9d6db6382444b70a51307a4291188f60d4eef205',
  '/image/56/0xa4e8399482ed8f3f7216263d94ab647b8cfc22ec',
  '/image/56/0xa5346f91a767b89a0363a4309c8e6c5adc0c4a59',
  '/image/56/0xa7f552078dcc247c2684336020c03648500c6d9f',
  '/image/56/0xa992ffb0c9b753307b9704079c61db4e405deffd',
  '/image/56/0xae9269f27437f0fcbc232d39ec814844a51d6b8f',
  '/image/56/0xaef0d72a118ce24fee3cd1d43d383897d05b4e99',
  '/image/56/0xaf3287cae99c982586c07401c0d911bf7de6cd82',
  '/image/56/0xaf41054c1487b0e5e2b9250c0332ecbce6ce9d71',
  '/image/56/0xafcc12e4040615e7afe9fb4330eb3d9120acac05',
  '/image/56/0xaffeabc20b2cafa80d2d7ff220ad37e4ec7541d7',
  '/image/56/0xb248a295732e0225acd3337607cc01068e3b9c10',
  '/image/56/0xb5761f36fdfe2892f1b54bc8ee8babb2a1b698d3',
  '/image/56/0xb5b7f828caed10db9582bed424ff79809ce766cb',
  '/image/56/0xb6090a50f66046e3c6afb9311846a6432e45060a',
  '/image/56/0xb9906e78b7ac656caa58aa7cbfb62e1f0d612a88',
  '/image/56/0xc2bd425a63800731e3ae42b6596bdd783299fcb1',
  '/image/56/0xc2d09cf86b9ff43cb29ef8ddca57a4eb4410d5f3',
  '/image/56/0xc350caa89eb963d5d6b964324a0a7736d8d65533',
  '/image/56/0xc45c56bf1aaf119a3c266f97bb28bf19646d0b1d',
  '/image/56/0xc636782a837feee37ccc29d58bdbb4bcbdd0ae1f',
  '/image/56/0xc7091aa18598b87588e37501b6ce865263cd67ce',
  '/image/56/0xc77dd3ade7b717583e0924466e4e474a5673332c',
  '/image/56/0xc9849e6fdb743d08faee3e34dd2d1bc69ea11a51',
  '/image/56/0xcc442a4c0b9c35578aa285f0d39f2bcc0e152acd',
  '/image/56/0xd955c9ba56fb1ab30e34766e252a97ccce3d31a6',
  '/image/56/0xe0a441d23cedb44822dfc8562e4d8d39c6b7f946',
  '/image/56/0xe2b16f618eb6016bc2625e98335f1844ee90236a',
  '/image/56/0xe4e11e02aa14c7f24db749421986eaec1369e8c9',
  '/image/56/0xf19f61bc9a2348a2fbc21209dddbbce2b98779a4',
  '/image/56/0xf1dc2f7d9b9de5421ee89ef746f482a16e213383',
  '/image/56/0xf59918b07278ff20109f8c37d7255e0677b45c43',
  '/image/56/0xf5dfd94bf89e0948c7770adf5e747dfa47bc4444',
  '/image/56/0xf91d58b5ae142dacc749f58a49fcbac340cb0343',
  '/image/56/0xfe723495f73714426493384eb5e49aa5b827e1d5',
  '/image/59144',
  '/image/81457',
  '/image/8453',
]

function ConveyorIcon({ src, size }: { src: string; size: number }) {
  const handleLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget
    const skeleton = img.previousElementSibling as HTMLElement | null
    if (skeleton) skeleton.style.display = 'none'
    img.style.opacity = '1'
  }, [])

  const handleError = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    // Keep skeleton visible, hide broken image
    e.currentTarget.style.display = 'none'
  }, [])

  return (
    <a href={src} target="_blank" rel="noopener noreferrer" className="shrink-0 pointer-events-auto relative" style={{ width: size, height: size }}>
      <div
        className="absolute inset-0 rounded-full bg-gray-200 dark:bg-surface-2 animate-pulse"
      />
      <img
        src={src}
        alt=""
        draggable={false}
        onLoad={handleLoad}
        onError={handleError}
        className="rounded-full relative"
        style={{ width: size, height: size, opacity: 0, transition: 'opacity 0.2s' }}
      />
    </a>
  )
}

const TOTAL_HEIGHT = SIZES.reduce((a, b) => a + b, 0) + (SIZES.length - 1) * 4

export default function FloatingIcons({ className }: { className?: string }) {
  const row0 = useRef<HTMLDivElement>(null)
  const row1 = useRef<HTMLDivElement>(null)
  const row2 = useRef<HTMLDivElement>(null)
  const rowRefs = [row0, row1, row2]

  const allSources = useMemo(() => shuffle(ICON_PATHS.map((p) => getApiUrl(p))), [])

  const rowIcons = useMemo(() =>
    [0, 1, 2].map((rowIdx) => {
      const perRow = ICONS_PER_ROW * 2
      const icons: string[] = []
      for (let i = 0; i < perRow; i++) {
        icons.push(allSources[(rowIdx * perRow + i) % allSources.length])
      }
      return icons
    }),
  [allSources])

  useEffect(() => {
    ensureKeyframes()
    requestAnimationFrame(() => {
      for (let i = 0; i < rowRefs.length; i++) {
        const el = rowRefs[i].current
        if (!el) continue
        el.style.setProperty('animation', `conveyor ${DURATIONS[i]}s linear infinite ${DIRECTIONS[i]}`, 'important')
      }
    })
  }, [])

  return (
    <div className={`overflow-hidden space-y-1 ${className ?? ''}`} style={{ height: TOTAL_HEIGHT }} aria-hidden="true">
      {rowIcons.map((icons, rowIdx) => (
        <div key={rowIdx} className="overflow-hidden">
          <div
            ref={rowRefs[rowIdx]}
            className="flex gap-3 items-center"
            style={{ width: 'max-content' }}
          >
            {icons.map((src, i) => (
              <ConveyorIcon key={`${rowIdx}-${i}`} src={src} size={SIZES[rowIdx]} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
