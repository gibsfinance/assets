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

// 443 curated icons (>=64x64 or SVG) from Ethereum, PulseChain, TrustWallet + network icons
const ICON_PATHS: string[] = [
  '/image/1',
  '/image/1/0x0000000000085d4780b73119b644ae5ecd22b376',
  '/image/1/0x00000000001876eb1444c986fd502e618c587430',
  '/image/1/0x00000000008943c65caf789fffcf953be156f6f8',
  '/image/1/0x0000000000b3f879cb30fe243b4dfee438691c04',
  '/image/1/0x00000000441378008ea67f4284a57932b1c000a5',
  '/image/1/0x00000100f2a2bd000715001920eb70d229700085',
  '/image/1/0x00006100f7090010005f1bd7ae6122c3c2cf0090',
  '/image/1/0x0000852600ceb001e08e00bc008be620d60031f2',
  '/image/1/0x0000a1c00009a619684135b824ba02f7fbf3a572',
  '/image/1/0x0001a500a6b18995b03f44bb040a5ffc28e45cb0',
  '/image/1/0x000214f253a824d1230aff79848fac3ec2858ee9',
  '/image/1/0x0006634f2fdb9a12b179d05a2b5165b3210bade8',
  '/image/1/0x000c100050e98c91f9114fa5dd75ce6869bf4f53',
  '/image/1/0x001f0aa5da15585e5b2305dbab2bac425ea71007',
  '/image/1/0x001fc4a7f2f586596308091c7b296d4535a25a90',
  '/image/1/0x0022228a2cc5e7ef0274a7baa600d44da5ab5776',
  '/image/1/0x0027449bf0887ca3e431d263ffdefb244d95b555',
  '/image/1/0x002acd33d758fcbdc72242a86ed27efa0006d42f',
  '/image/1/0x00380143129167395e8b4f0a35edc1bc60e7ce65',
  '/image/1/0x0051d363a60bd98d8a10927d10708e5ef853b306',
  '/image/1/0x005b148048e06a250939f5b0fc32aae19c6c2c84',
  '/image/1/0x00865a6ca2529862be9344c4f88800741b737ee9',
  '/image/1/0x009631f3cb11a9af2e2f0186e698a2bc976d86eb',
  '/image/1/0x009a7c8b62ec98f734fde06904def69e95898726',
  '/image/1/0x00a79ff8fff20331b9df63fc6f92eb7d9991c223',
  '/image/1/0x00b7db6b4431e345eee5cc23d21e8dbc1d5cada3',
  '/image/1/0x00c4b398500645eb5da00a1a379a88b11683ba01',
  '/image/1/0x00d270d9a41886a8e6e433911ae2f7d257b60051',
  '/image/1/0x00ea6f91b00e080e816f1bb2fad71b0fe1528983',
  '/image/1/0x00fc270c9cc13e878ab5363d00354bebf6f05c15',
  '/image/1/0x01139476be434edf3a5041748d458c85e85b3313',
  '/image/1/0x0132a1871b9c985354ad16d5fc1cc6f1ec32c4d4',
  '/image/1/0x013a06558f07d9e6f9a00c95a33f3a0e0255176b',
  '/image/1/0x013ae307648f529aa72c5767a334ddd37aab43c3',
  '/image/1/0x0142c3b2fc51819b5af5dfc4aa52df9722790851',
  '/image/1/0x015228e32287bacd2d8aa9b703c3e110bbcfce0f',
  '/image/1/0x01522e6c543ff04e74842abd0f2afecc5ef5c281',
  '/image/1/0x016396044709eb3edc69c44f4d5fa6996917e4e8',
  '/image/1/0x016ee7373248a80bde1fd6baa001311d233b3cfa',
  '/image/1/0x0172bf2eded9d1ce712e52fd27e8f18a502b1172',
  '/image/1/0x0189d31f6629c359007f72b8d5ec8fa1c126f95c',
  '/image/1/0x018d7d179350f1bb9853d04982820e37cce13a92',
  '/image/1/0x0198f46f520f33cd4329bd4be380a25a90536cd5',
  '/image/1/0x01995786f1435743c42b7f2276c496a610b58612',
  '/image/1/0x01aa952c2aa0259198e403c10799557e9a6b1ec1',
  '/image/1/0x01af924198e893fc57a1b2d2be5a6cc420b8764a',
  '/image/1/0x01b3ec4aae1b8729529beb4965f27d008788b0eb',
  '/image/1/0x01bcd148c54ca43dad8c195100998ded48fad39c',
  '/image/1/0x01c0987e88f778df6640787226bc96354e1a9766',
  '/image/1/0x01cc4151fe5f00efb8df2f90ff833725d3a482a3',
  '/image/1/0x01cd3d9df5869ca7954745663bd6201c571e05cf',
  '/image/1/0x01e2087be8c34fb06229aa9e49bf801a89d30d9d',
  '/image/1/0x01fdb5103a0d9de8d12e32e7775d5799bd715a54',
  '/image/1/0x0200412995f1bafef0d3f97c4e28ac2515ec1ece',
  '/image/1/0x0202be363b8a4820f3f4de7faf5224ff05943ab1',
  '/image/1/0x0218c4e3aad7ecf71ccc5d5aaa43c02245f45ccd',
  '/image/1/0x0223fc70574214f65813fe336d870ac47e147fae',
  '/image/1/0x0235fe624e044a05eed7a43e16e3083bc8a4287a',
  '/image/1/0x023ebb622f461a15a344edc45e6a5eabb5a68e03',
  '/image/1/0x02585e4a14da274d02df09b222d4606b10a4e940',
  '/image/1/0x025daf950c6e814dee4c96e13c98d3196d22e60c',
  '/image/1/0x02639fc688df086f18ce5e7f0f014bc74de0229b',
  '/image/1/0x026b2693a7c724e8ed0122f39ab6fbc4d5a4fb22',
  '/image/1/0x026e62dded1a6ad07d93d39f96b9eabd59665e0d',
  '/image/1/0x026f8d523d49f36db657e012c96488465d8d88f9',
  '/image/1/0x028ce5ea3298a50c0d8a27b937b1f48cf0d68b56',
  '/image/1/0x0290b327a8583bd6fa63c130b732a808864e55fc',
  '/image/1/0x029606e5ec44cad1346d6a1273a53b971fa93ad6',
  '/image/1/0x02b1669bc9ee893edaff3cadfd326a294d643f99',
  '/image/1/0x02c12964e74a0ebb4ecfa13c3717797dedd9ef6f',
  '/image/1/0x02c4c78c462e32cca4a90bc499bf411fb7bc6afb',
  '/image/1/0x02e2c716230c6750208f7cb1af34049472c91527',
  '/image/1/0x02e3083a51e8632e571fbd6a62ac396c10c653ba',
  '/image/1/0x02eb3da777eb3ff40914fd3d5c249123cc2df04a',
  '/image/1/0x02ec0c9e6d3c08b8fb12fec51ccba048afbc36a6',
  '/image/1/0x02f02e0ca8a521ef73daa9c45353b9fbefc5ee10',
  '/image/1/0x02f28544c89b2d704eb0d1f9f4fc60d688ad8959',
  '/image/1/0x02f61fd266da6e8b102d4121f5ce7b992640cf98',
  '/image/1/0x030ba81f1c18d280636f32af80b9aad02cf0854e',
  '/image/1/0x030c32c1190cbf077e5ee67ed19572c558e43ae4',
  '/image/1/0x031228f403dbfde1dd47310bdc49bb788f53ecd9',
  '/image/1/0x0316eb71485b0ab14103307bf65a021042c6d380',
  '/image/1/0x0327112423f3a68efdf1fcf402f6c5cb9f7c33fd',
  '/image/1/0x03282f2d7834a97369cad58f888ada19eec46ab6',
  '/image/1/0x032ae2bd448904e0d468167dc25b4c35d3d72a36',
  '/image/1/0x033030feebd93e3178487c35a9c8ca80874353c9',
  '/image/1/0x03352d267951e96c6f7235037c5dfd2ab1466232',
  '/image/1/0x033e223870f766644f7f7a4b7dc2e91573707d06',
  '/image/1/0x034b0dd380b5f6f8123b8d0d0e42329b67772792',
  '/image/1/0x0353837b32aa01d335becedc57a329b8ce0619a7',
  '/image/1/0x035bfe6057e15ea692c0dfdcab3bb41a64dd2ad4',
  '/image/1/0x036407f23d5e1c1486f7488332cf54bf06e5f09f',
  '/image/1/0x036d80f9abe266b7c6ec0a9bd078fac3a90d4239',
  '/image/1/0x0371a82e4a9d0a4312f3ee2ac9c6958512891372',
  '/image/1/0x037a54aab062628c9bbae1fdb1583c195585fe41',
  '/image/1/0x038e1b56b615ff3dd20e0bd4c7e91c7ee07d3508',
  '/image/1/0x0391d2021f89dc339f60fff84546ea23e337750f',
  '/image/1/0x0396340f16bbec973280ab053efc3f208fa37795',
  '/image/1/0x039b5649a59967e3e936d7471f9c3700100ee1ab',
  '/image/1/0x039c642289e45eb7ee1b88123f4fc3aa94d34359',
  '/image/1/0x039f5050de4908f9b5ddf40a4f3aa3f329086387',
  '/image/1/0x03b155af3f4459193a276395dd76e357bb472da1',
  '/image/1/0x03c780cd554598592b97b7256ddaad759945b125',
  '/image/1/0x03dde9e5bb31ee40a471476e2fccf75c67921062',
  '/image/1/0x03fb52d4ee633ab0d06c833e32efdd8d388f3e6a',
  '/image/1/0x0408d7ed44de8d93a2510caef3db4ac7a4a1dfec',
  '/image/1/0x040f685a2ffe3598a5041af33643c5f731507917',
  '/image/1/0x04162aee1c40cf63747e6bc3a7e84acec1ba2a78',
  '/image/1/0x0417912b3a7af768051765040a55bb0925d4ddcf',
  '/image/1/0x04203b7668eb832a5cbfe248b57defeb709e48e3',
  '/image/10',
  '/image/100',
  '/image/1000',
  '/image/10000',
  '/image/10001',
  '/image/10143',
  '/image/1017',
  '/image/1030',
  '/image/105105',
  '/image/1088',
  '/image/1101',
  '/image/1111',
  '/image/11155111',
  '/image/1135',
  '/image/1151111081099710',
  '/image/11811',
  '/image/122',
  '/image/1234',
  '/image/128',
  '/image/1284',
  '/image/1285',
  '/image/1287',
  '/image/130',
  '/image/1313161554',
  '/image/1329',
  '/image/137',
  '/image/1380012617',
  '/image/14',
  '/image/143',
  '/image/1440000',
  '/image/1440002',
  '/image/146',
  '/image/151',
  '/image/1514',
  '/image/1666600000',
  '/image/167000',
  '/image/169',
  '/image/1750',
  '/image/17777',
  '/image/182',
  '/image/1868',
  '/image/20',
  '/image/2000',
  '/image/2020',
  '/image/204',
  '/image/210425',
  '/image/2203',
  '/image/2222',
  '/image/245022934',
  '/image/246',
  '/image/25',
  '/image/250',
  '/image/252',
  '/image/2741',
  '/image/288',
  '/image/295',
  '/image/30',
  '/image/314',
  '/image/321',
  '/image/324',
  '/image/32659',
  '/image/32769',
  '/image/33139',
  '/image/34443',
  '/image/361',
  '/image/369',
  '/image/369/0x0000000000095413afc295d19edeb1ad7b71c952',
  '/image/369/0x0000a1c00009a619684135b824ba02f7fbf3a572',
  '/image/369/0x0008cf1f921eacf0efcfa5e542d171e04d223a27',
  '/image/369/0x0016269802de1fc2dc4f5cfd2178f721ef2171ee',
  '/image/369/0x005d1123878fc55fbd56b54c73963b234a64af3c',
  '/image/369/0x007367e86f684afcda1964309f028e195c3b26a4',
  '/image/369/0x00a8b738e453ffd858a7edf03bccfe20412f0eb0',
  '/image/369/0x00d1793d7c3aae506257ba985b34c76aaf642557',
  '/image/369/0x018ed6f8ec6c7bc4f972b61e3db9d0dd00b8d41b',
  '/image/369/0x0195d5990a7d6d7ee7a3a4610e357bb660494ba0',
  '/image/369/0x01b4fc6daaae73c2614598b1f9f35f8933117e10',
  '/image/369/0x01ff50f8b7f74e4f00580d9596cd3d0d6d6e326f',
  '/image/369/0x0202be363b8a4820f3f4de7faf5224ff05943ab1',
  '/image/369/0x0258f474786ddfd37abce6df6bbb1dd5dfc4434a',
  '/image/369/0x02dcdd04e3f455d838cd1249292c58f3b79e3c3c',
  '/image/369/0x03042482d64577a7bdb282260e2ea4c8a89c064b',
  '/image/369/0x0316eb71485b0ab14103307bf65a021042c6d380',
  '/image/369/0x0327112423f3a68efdf1fcf402f6c5cb9f7c33fd',
  '/image/369/0x035bfe6057e15ea692c0dfdcab3bb41a64dd2ad4',
  '/image/369/0x037a54aab062628c9bbae1fdb1583c195585fe41',
  '/image/369/0x0391d2021f89dc339f60fff84546ea23e337750f',
  '/image/369/0x03ab458634910aad20ef5f1c8ee96f1d6ac54919',
  '/image/369/0x03bae7118dab6cf99a2e7828462321fb4d7f7ea4',
  '/image/369/0x03be5c903c727ee2c8c4e9bc0acc860cca4715e2',
  '/image/369/0x0480b383e9111ca05116aea6d35b891c708d57ec',
  '/image/369/0x0488401c3f535193fa8df029d9ffe615a06e74e6',
  '/image/369/0x048fe49be32adfc9ed68c37d32b5ec9df17b3603',
  '/image/369/0x04b5e13000c6e9a3255dc057091f3e3eeee7b0f0',
  '/image/369/0x04c17b9d3b29a78f7bd062a57cf44fc633e71f85',
  '/image/369/0x04c618cdbc1d59142dfeb4b9864835a06983ec2d',
  '/image/369/0x04fa0d235c4abf4bcf4787af4cf447de572ef828',
  '/image/369/0x05079687d35b93538cbd59fe5596380cae9054a9',
  '/image/369/0x054d64b73d3d8a21af3d764efd76bcaa774f3bb2',
  '/image/369/0x054f76beed60ab6dbeb23502178c52d6c5debe40',
  '/image/369/0x0563dce613d559a47877ffd1593549fb9d3510d6',
  '/image/369/0x0567ca0de35606e9c260cc2358404b11de21db44',
  '/image/369/0x056fd409e1d7a124bd7017459dfea2f387b6d5cd',
  '/image/369/0x05d3606d5c81eb9b7b18530995ec9b29da05faba',
  '/image/369/0x062bd527ec96d42be897a0e1c840b5ba912b890f',
  '/image/369/0x06450dee7fd2fb8e39061434babcfc05599a6fb8',
  '/image/369/0x06a01a4d579479dd5d884ebf61a31727a3d8d442',
  '/image/369/0x06af07097c9eeb7fd685c692751d5c66db49c215',
  '/image/369/0x07150e919b4de5fd6a63de1f9384828396f25fdc',
  '/image/369/0x0763fdccf1ae541a5961815c0872a8c5bc6de4d7',
  '/image/369/0x08ad83d779bdf2bbe1ad9cc0f78aa0d24ab97802',
  '/image/369/0x08d967bb0134f2d07f7cfb6e246680c53927dd30',
  '/image/369/0x08edb18cb120676ff4c3435726df424cc8e18638',
  '/image/369/0x090185f2135308bad17527004364ebcc2d37e5f6',
  '/image/369/0x0913ddae242839f8995c0375493f9a1a3bddc977',
  '/image/369/0x0954906da0bf32d5479e25f46056d22f08464cab',
  '/image/369/0x09617f6fd6cf8a71278ec86e23bbab29c04353a7',
  '/image/369/0x09a3ecafa817268f77be1283176b946c4ff2e608',
  '/image/369/0x09b1d3e1cb861848f049ed448b2461d39fd18674',
  '/image/369/0x09fe5f0236f0ea5d930197dce254d77b04128075',
  '/image/369/0x0a50c93c762fdd6e56d86215c24aaad43ab629aa',
  '/image/369/0x0a68a6199038325dbb3e4821659a84e4985227f4',
  '/image/369/0x0a7c5041b196da7200bf6e24513810957515c565',
  '/image/369/0x0a913bead80f321e7ac35285ee10d9d922659cb7',
  '/image/369/0x0aacfbec6a24756c20d41914f2caba817c0d8521',
  '/image/369/0x0ab87046fbb341d058f17cbc4c1133f25a20a52f',
  '/image/369/0x0abdace70d3790235af448c88547603b945604ea',
  '/image/369/0x0aee8703d34dd9ae107386d3eff22ae75dd616d1',
  '/image/369/0x0b38210ea11411557c13457d4da7dc6ea731b88a',
  '/image/369/0x0b8008a38fdbbdda214de411c5bb7bda59f4a960',
  '/image/369/0x0bb11b8fc71aeb87305f8118caf5076a9593be86',
  '/image/369/0x0bb217e40f8a5cb79adf04e1aab60e5abd0dfc1e',
  '/image/369/0x0bb7db697567178c590efa64a7dcb2ce6213768c',
  '/image/369/0x0bc529c00c6401aef6d220be8c6ea1667f6ad93e',
  '/image/369/0x0c10bf8fcb7bf5412187a595ab97a3609160b5c6',
  '/image/369/0x0c37bcf456bc661c14d596683325623076d7e283',
  '/image/369/0x0c7d5ae016f806603cb1782bea29ac69471cab9c',
  '/image/369/0x0cb6f5a34ad42ec934882a05265a7d5f59b51a2f',
  '/image/369/0x0cdf9acd87e940837ff21bb40c9fd55f68bba059',
  '/image/369/0x0cec1a9154ff802e7934fc916ed7ca50bde6844e',
  '/image/369/0x0d438f3b5175bebc262bf23753c1e53d03432bde',
  '/image/369/0x0d86eb9f43c57f6ff3bc9e23d8f9d82503f0e84b',
  '/image/369/0x0d8775f648430679a709e98d2b0cb6250d2887ef',
  '/image/369/0x0d88ed6e74bbfd96b831231638b66c05571e824f',
  '/image/369/0x0d9227f9c4ab3972f994fccc6eeba3213c0305c4',
  '/image/369/0x0dd1989e4b0e82f154b729ff47f8c9a4f4b2cc1c',
  '/image/369/0x0deed1486bc52aa0d3e6f8849cec5add6598a162',
  '/image/369/0x0e0989b1f9b8a38983c2ba8053269ca62ec9b195',
  '/image/369/0x0e29e5abbb5fd88e28b2d355774e73bd47de3bcd',
  '/image/369/0x0e8d6b471e332f140e7d9dbb99e5e3822f728da6',
  '/image/369/0x0e9b56d2233ea2b5883861754435f9c51dbca141',
  '/image/369/0x0ef3b2024ae079e6dbc2b37435ce30d2731f0101',
  '/image/369/0x0f15c57b025ebe4c757250d2def81f5a763bdb94',
  '/image/369/0x0f2d719407fdbeff09d87557abb7232601fd9f29',
  '/image/369/0x0f3c6134f4022d85127476bc4d3787860e5c5569',
  '/image/369/0x0f5d2fb29fb7d3cfee444a200298f468908cc942',
  '/image/369/0x0f71b8de197a1c84d31de0f1fa7926c365f052b3',
  '/image/369/0x0f7b3f5a8fed821c5eb60049538a548db2d479ce',
  '/image/369/0x0f7f961648ae6db43c75663ac7e5414eb79b5704',
  '/image/369/0x0f8c45b896784a1e408526b9300519ef8660209c',
  '/image/369/0x0fd10b9899882a6f2fcb5c371e17e70fdee00c38',
  '/image/369/0x0fd5bd28d1796e3554b25aed003767561ed211bc',
  '/image/369/0x0ff5a8451a839f5f0bb3562689d9a44089738d11',
  '/image/369/0x0ff6ffcfda92c53f615a4a75d982f399c989366b',
  '/image/369/0x100a7c964e6aa85eadaec06d3652053c4faece8e',
  '/image/369/0x106552c11272420aad5d7e94f8acab9095a6c952',
  '/image/369/0x107c4504cd79c5d2696ea0030a8dd4e92601b82e',
  '/image/369/0x10bae51262490b4f4af41e12ed52a0e744c1137a',
  '/image/369/0x10be9a8dae441d276a5027936c3aaded2d82bc15',
  '/image/369/0x10f82e0bc964df9aab1bbcc4dc605e2e84ab5f2e',
  '/image/369/0x11003e410ca3fcd220765b3d2f343433a0b2bffd',
  '/image/369/0x111111111117dc0aa78b770fa6a738034120c302',
  '/image/369/0x111111517e4929d3dcbdfa7cce55d30d4b6bc4d6',
  '/image/369/0x115ec79f1de567ec68b7ae7eda501b406626478e',
  '/image/369/0x11eef04c884e24d9b7b4760e7476d06ddf797f36',
  '/image/369/0x12970e6868f88f6557b76120662c1b3e50a646bf',
  '/image/369/0x12b19d3e2ccc14da04fae33e63652ce469b3f2fd',
  '/image/369/0x12b6893ce26ea6341919fe289212ef77e51688c8',
  '/image/369/0x12d102f06da35cc0111eb58017fd2cd28537d0e1',
  '/image/369/0x12f649a9e821f90bb143089a6e56846945892ffb',
  '/image/369/0x131bf51e864024df1982f2cd7b1c786e1a005152',
  '/image/369/0x13339fd07934cd674269726edf3b5ccee9dd93de',
  '/image/369/0x13342624b9d3049fb8ef0a15b803f704864bb844',
  '/image/369/0x1337def16f9b486faed0293eb623dc8395dfe46a',
  '/image/369/0x1337def18c680af1f9f45cbcab6309562975b1dd',
  '/image/369/0x1341a2257fa7b770420ef70616f888056f90926c',
  '/image/369/0x1416946162b1c2c871a73b07e932d2fb6c932069',
  '/image/369/0x14409b0fc5c7f87b5dad20754fe22d29a3de8217',
  '/image/369/0x147faf8de9d8d8daae129b187f0d02d819126750',
  '/image/369/0x1494ca1f11d487c2bbe4543e90080aeba4ba3c2b',
  '/image/369/0x155040625d7ae3e9cada9a73e3e44f76d3ed1409',
  '/image/369/0x15874d65e649880c2614e7a480cb7c9a55787ff6',
  '/image/369/0x15ab57b385bf5c4412cf2341ea6b5c5623946e83',
  '/image/369/0x15b543e986b8c34074dfc9901136d9355a537e7e',
  '/image/369/0x15c935e3988509d3201bb45cd2f3dc0138b0baf0',
  '/image/369/0x15d38573d2feeb82e7ad5187ab8c1d52810b1f07',
  '/image/369/0x15d4c048f83bd7e37d49ea4c83a07267ec4203da',
  '/image/369/0x1614f18fc94f47967a3fbe5ffcd46d4e7da3d787',
  '/image/369/0x16484d73ac08d2355f466d448d2b79d2039f6ebb',
  '/image/369/0x165440036ce972c5f8ebef667086707e48b2623e',
  '/image/369/0x1658b6e5d74cdc02a7e410cf877bed81029f5d01',
  '/image/369/0x16d371153a76aec5f5bfe6af621dde030e643e5d',
  '/image/369/0x16eccfdbb4ee1a85a33f3a9b21175cd7ae753db4',
  '/image/369/0x1712aad2c773ee04bdc9114b32163c058321cd85',
  '/image/369/0x1735db6ab5baa19ea55d0adceed7bcdc008b3136',
  '/image/369/0x176000ea49160eae9ef71f2cfa73dcbf4fe7ae45',
  '/image/369/0x1776e1f26f98b1a5df9cd347953a26dd3cb46671',
  '/image/369/0x1c3c50bd18e3f0c7c23666b8e8a843238a359386',
  '/image/369/0x203e366a1821570b2f84ff5ae8b3bdeb48dc4fa1',
  '/image/369/0x207e6b4529840a4fd518f73c68bc9c19b2a15944',
  '/image/369/0x2260fac5e5542a773aa44fbcfedf7c193bc2c599',
  '/image/369/0x2556f7f8d82ebcdd7b821b0981c38d9da9439cdd',
  '/image/369/0x26179a4d4b58b4456f28d19507546596c9058ee5',
  '/image/369/0x2a06a971fe6ffa002fd242d437e3db2b5cc5b433',
  '/image/369/0x2b591e99afe9f32eaa6214f7b7629768c40eeb39',
  '/image/369/0x2fa878ab3f87cc1c9737fc071108f904c0b0c95d',
  '/image/369/0x3f105121a10247de9a92e818554dd5fcd2063ae7',
  '/image/369/0x4243568fa2bbad327ee36e06c16824cad8b37819',
  '/image/369/0x463413c579d29c26d59a65312657dfce30d545a1',
  '/image/369/0x514910771af9ca656af840dff83e8264ecf986ca',
  '/image/369/0x52ada28f70bc8ebe5dd4381120d3cd76863919a8',
  '/image/369/0x545998abcbf0633c83ba20cb94f384925be75dd5',
  '/image/369/0x57fde0a71132198bbec939b98976993d8d89d225',
  '/image/369/0x5f63bc3d5bd234946f18d24e98c324f629d9d60e',
  '/image/369/0x600136da8cc6d1ea07449514604dc4ab7098db82',
  '/image/369/0x6a44be19d96f087494bafa66ee5df1bf7aaf220f',
  '/image/369/0x6b32022693210cd2cfc466b9ac0085de8fc34ea6',
  '/image/369/0x6de1bb62c13394b7db57a25477dbedd76b3e9a90',
  '/image/369/0x75db6c0115bae972979baccce94e3b8a21a48c4e',
  '/image/369/0x78a2809e8e2ef8e07429559f15703ee20e885588',
  '/image/369/0x7901a3569679aec3501dbec59399f327854a70fe',
  '/image/369/0x7b39712ef45f7dced2bbdf11f3d5046ba61da719',
  '/image/369/0x7c7ba94b60270bc2c7d98d3498b5ce85b870a749',
  '/image/369/0x85f1724a1a21a2e4f27c2ffb54a976d5857b2fa0',
  '/image/369/0x8854bc985fb5725f872c8856bea11b917caeb2fe',
  '/image/369/0x8a7fdca264e87b6da72d000f22186b4403081a2a',
  '/image/369/0x8dcf280e9d3f8b988bba0000428a02c860e50bff',
  '/image/369/0x9009c1de3220caf855f83140e5ac18a43272ec01',
  '/image/369/0x9159f1d2a9f51998fc9ab03fbd8f265ab14a1b3b',
  '/image/369/0x924dd489c99614b47385245df0b5250538c71406',
  '/image/369/0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce',
  '/image/369/0x95b303987a60c71504d99aa1b13b4da07b0790ab',
  '/image/369/0x9663c2d75ffd5f4017310405fce61720af45b829',
  '/image/369/0x9cc7437978255e2c38b0d3d4671fb9ac411a68ac',
  '/image/369/0x9d93692e826a4bd9e903e2a27d7fbd1e116efdad',
  '/image/369/0x9f8182ad65c53fd78bd07648a1b3ddcb675c6772',
  '/image/369/0xa1077a294dde1b09bb078844df40758a5d0f9a27',
  '/image/369/0xa5b0d537cebe97f087dc5fe5732d70719caaec1d',
  '/image/369/0xaec4c07537b03e3e62fc066ec62401aed5fdd361',
  '/image/369/0xb17d901469b9208b17d916112988a3fed19b5ca1',
  '/image/369/0xb55ee890426341fe45ee6dc788d2d93d25b59063',
  '/image/369/0xbb101431d43b0e1fc31f000bf96826794806e0b4',
  '/image/369/0xbbcf895bfcb57d0f457d050bb806d1499436c0ce',
  '/image/369/0xc52f739f544d20725ba7ad47bb42299034f06f4f',
  '/image/369/0xc59be55d22cb7967ee95e5be0770e263ee014f78',
  '/image/369/0xc91562626b9a697af683555da9946986278ac9a5',
  '/image/369/0xca35638a3fddd02fec597d8c1681198c06b23f58',
  '/image/369/0xcfcffe432a48db53f59c301422d2edd77b2a88d7',
  '/image/369/0xd22e78c22d7e77229d60cc9fc57b0e294f54488e',
  '/image/369/0xde0220b69ce3e855a0124433a8e8d093f53a6be4',
  '/image/369/0xdedbcc8d9458b2556375680fba297c6aca6c7dcf',
  '/image/369/0xe11a9e0298fbb1248611956db3c8ff556dc1ddbd',
  '/image/369/0xe362401d1451e8eb38fd66d0c9e23fb080409ab9',
  '/image/369/0xe676a1e969feaef164198496bd787e0269f7b237',
  '/image/369/0xee2d275dbb79c7871f8c6eb2a4d0687dd85409d1',
  '/image/369/0xefd766ccb38eaf1dfd701853bfce31359239f305',
  '/image/369/0xf8ab3393b1f5cd6184fb6800a1fc802043c4063e',
  '/image/369/0xf96d60e9444f19fe5126888bd53bde80e58c2851',
  '/image/369/0xfcf7f3915a899b9133b0d10f6b84f6a849c212df',
  '/image/397',
  '/image/40',
  '/image/4002',
  '/image/420',
  '/image/4200',
  '/image/420420418',
  '/image/420420419',
  '/image/42161',
  '/image/421613',
  '/image/42170',
  '/image/42220',
  '/image/42262',
  '/image/42766',
  '/image/43111',
  '/image/43113',
  '/image/43114',
  '/image/4326',
  '/image/4337',
  '/image/4689',
  '/image/480',
  '/image/48900',
  '/image/5',
  '/image/50',
  '/image/5000',
  '/image/50104',
  '/image/534352',
  '/image/56',
  '/image/57',
  '/image/57073',
  '/image/58',
  '/image/59144',
  '/image/592',
  '/image/597',
  '/image/60',
  '/image/60808',
  '/image/61',
  '/image/64',
  '/image/65357',
  '/image/66',
  '/image/661898459',
  '/image/70',
  '/image/728126428',
  '/image/747',
  '/image/747474',
  '/image/77',
  '/image/7777777',
  '/image/787',
  '/image/80094',
  '/image/8108',
  '/image/81457',
  '/image/82',
  '/image/820',
  '/image/8217',
  '/image/8453',
  '/image/84531',
  '/image/88',
  '/image/888',
  '/image/900',
  '/image/943',
  '/image/964',
  '/image/97',
  '/image/9745',
  '/image/98866',
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
      <div className="absolute inset-0 rounded-full bg-gray-100 dark:bg-surface-2" />
      <img
        src={src}
        alt=""
        draggable={false}
        loading="lazy"
        decoding="async"
        onLoad={handleLoad}
        onError={handleError}
        className="rounded-full relative"
        style={{ width: size, height: size, opacity: 0 }}
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
