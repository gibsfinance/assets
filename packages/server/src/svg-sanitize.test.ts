import { DOMParser } from '@xmldom/xmldom'
import { describe, it, expect } from 'vitest'
import { sanitizeImage, isScriptUri, SvgRejectedError } from './sanitize'
import { cleanCss, sanitizeSvgDocument } from './svg-sanitize'

const NS = 'xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"'

/** Sanitize an SVG written as text and give back the text. */
const clean = async (svg: string): Promise<string> => (await sanitizeImage(Buffer.from(svg), '.svg')).toString()

/** Wrap markup in an svg element that declares the usual prefixes. */
const wrap = (inner: string): string => `<svg ${NS}>${inner}</svg>`

const rejects = (bytes: string | Buffer) => expect(sanitizeImage(Buffer.from(bytes), '.svg')).rejects

describe('attribute values that look like markup', () => {
  it('checks the real href after a fake src="" inside another attribute (desync)', async () => {
    const output = await clean(wrap(`<a xlink:title=' src="' href="javascript:alert(1)"><text>x</text></a>`))
    expect(output).not.toContain('javascript')
    expect(output).not.toContain('alert')
    expect(output).toContain('href="#"')
  })

  it('checks the real href after a fake src="" in a double-quoted value', async () => {
    const output = await clean(wrap(`<a xlink:title=" src=' " xlink:href="javascript:alert(1)"><text>x</text></a>`))
    expect(output).not.toContain('alert')
  })

  it('checks a link that holds the other kind of quote', async () => {
    expect(await clean(wrap(`<a href="javascript:alert('x')"><text>x</text></a>`))).not.toContain('alert')
    expect(await clean(wrap(`<a href='javascript:alert("x")'><text>x</text></a>`))).not.toContain('alert')
  })

  it('finds an animation target after an earlier value that holds ">"', async () => {
    const output = await clean(
      wrap(`<a href="#"><set data-x="a>b" attributeName="xlink:href" to="javascript:alert(1)"/><text>x</text></a>`),
    )
    expect(output).not.toContain('<set')
    expect(output).not.toContain('alert')
  })

  it('strips a handler that follows a value holding "on"', async () => {
    const output = await clean(wrap(`<circle r="1" data-x=" onclick=&quot;" onload="alert(1)"/>`))
    expect(output).not.toContain('onload')
    expect(output).not.toContain('alert')
  })
})

describe('links under any prefix', () => {
  it('neutralises xlink:href, a second prefix for the same namespace, and a bare href or src', async () => {
    const output = await clean(
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:q="http://www.w3.org/1999/xlink">` +
        `<a q:href="javascript:alert(1)"/><a href="vbscript:x"/><image src="javascript:alert(2)"/></svg>`,
    )
    expect(output).not.toMatch(/alert|vbscript/)
  })

  it('neutralises a link whose scheme is written with references, once the parser has read it', async () => {
    const output = await clean(wrap(`<a xlink:href="&#x6A;ava&#115;cript&#58;alert(1)"/>`))
    expect(output).not.toContain('alert')
  })

  it('neutralises a link that is still a reference after the parser read it', async () => {
    const output = await clean(wrap(`<a href="&amp;#x6A;avascript:alert(1)"/>`))
    expect(output).not.toContain('alert')
  })

  it('neutralises file: and non-image data: links, and keeps data:image and local links', async () => {
    const output = await clean(
      wrap(
        `<image href="file:///etc/passwd"/><image href="data:text/html;base64,AAAA"/>` +
          `<image id="keep" href="data:image/png;base64,AAAA"/><a href="#keep"/>`,
      ),
    )
    expect(output).not.toMatch(/file:|text\/html/)
    expect(output).toContain('data:image/png;base64,AAAA')
    expect(output).toContain('href="#keep"')
  })

  it('removes a use that points outside the document, whatever the attribute is called', async () => {
    const output = await clean(
      wrap(
        `<use xlink:href="https://evil.example/x.svg#a"/><use href="data:image/svg+xml,AAAA"/>` +
          `<use xlink:href="/local/path.svg#a"/><use xlink:href="#ok"/><use/>`,
      ),
    )
    expect(output).not.toMatch(/evil|data:|local\/path/)
    expect(output).toContain('xlink:href="#ok"')
    expect(output.match(/<use/g)).toHaveLength(2)
  })

  it('neutralises a link on an a element that wraps a use, and keeps the use', async () => {
    const output = await clean(wrap(`<a xlink:href="javascript:alert(1)"><use xlink:href="#shape"/></a>`))
    expect(output).not.toContain('alert')
    expect(output).toContain('<use xlink:href="#shape"/>')
  })
})

describe('elements', () => {
  it.each(['script', 'foreignObject', 'iframe', 'embed', 'object', 'applet', 'math', 'handler', 'listener'])(
    'removes %s with its children',
    async (name) => {
      const output = await clean(wrap(`<g><${name}><circle id="inner"/></${name}><rect id="after"/></g>`))
      expect(output).not.toContain(name)
      expect(output).not.toContain('inner')
      expect(output).toContain('id="after"')
    },
  )

  it('removes an element in another namespace, with its children', async () => {
    const output = await clean(
      wrap(`<html:script xmlns:html="http://www.w3.org/1999/xhtml">alert(1)</html:script><rect id="after"/>`),
    )
    expect(output).not.toMatch(/script|alert/)
    expect(output).toContain('id="after"')
  })

  it('removes an svg-named element that is not in the SVG namespace, and one that is not an SVG element', async () => {
    const output = await clean(wrap(`<circle xmlns="urn:other" r="1"/><bogus/><rect id="after"/>`))
    expect(output).not.toMatch(/circle|bogus/)
    expect(output).toContain('id="after"')
  })

  it('keeps ordinary presentation elements, gradients, filters and text', async () => {
    const markup =
      `<defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient>` +
      `<filter id="f"><feGaussianBlur stdDeviation="2"/></filter><clipPath id="c"><rect width="1" height="1"/></clipPath></defs>` +
      `<g fill="url(#g)" filter="url(#f)"><text x="1">a<tspan>b</tspan></text><path d="M0 0L1 1"/></g>`
    const output = await clean(wrap(markup))
    for (const name of ['linearGradient', 'stop', 'filter', 'feGaussianBlur', 'clipPath', 'tspan', 'path']) {
      expect(output).toContain(`<${name}`)
    }
    expect(output).toContain('fill="url(#g)"')
  })
})

describe('elements written with a prefix', () => {
  const PREFIXED = 'xmlns:svg="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"'
  const prefixed = (inner: string) => `<svg:svg ${PREFIXED}>${inner}</svg:svg>`

  it('removes a script, a foreign object holding a frame, and an animation of a link, by namespace and local name', async () => {
    const output = await clean(
      prefixed(
        `<svg:script>alert(1)</svg:script>` +
          `<svg:foreignObject><svg:iframe src="https://evil.example"/></svg:foreignObject>` +
          `<svg:a href="#"><svg:animate attributeName="href" to="javascript:alert(2)"/></svg:a>` +
          `<svg:use xlink:href="https://evil.example/x.svg#a"/>` +
          `<svg:rect id="kept"/>`,
      ),
    )
    expect(output).not.toMatch(/script|foreignObject|iframe|animate|evil|alert/)
    expect(output).toContain('id="kept"')
  })

  it('removes an element whose prefix is bound to another namespace even when it is named like an svg element', async () => {
    const output = await clean(
      wrap(`<x:script xmlns:x="urn:other">alert(1)</x:script><x:rect xmlns:x="urn:other"/><rect id="kept"/>`),
    )
    expect(output).not.toMatch(/script|alert|x:rect/)
    expect(output).toContain('id="kept"')
  })

  it('checks the links of an element written with a prefix', async () => {
    const output = await clean(prefixed(`<svg:a xlink:href="javascript:alert(1)"/>`))
    expect(output).not.toContain('alert')
  })
})

describe('one scheme check for every link', () => {
  const XNS = `${NS} xmlns:x="http://www.w3.org/1999/xlink"`
  const cleanX = (inner: string) => clean(`<svg ${XNS}>${inner}</svg>`)

  it('checks data: and file: links under another prefix', async () => {
    const output = await cleanX(`<a x:href="data:text/html,hi"/><image x:href="file:///etc/hostname"/>`)
    expect(output).not.toMatch(/text\/html|file:|hostname/)
  })

  it('checks a scheme written with a reference, for data: and file:', async () => {
    const output = await cleanX(`<a href="&#100;ata:text/html,hi"/><image href="&#x66;ile:///etc/hostname"/>`)
    expect(output).not.toMatch(/text\/html|file:|hostname/)
    expect(output).not.toContain('&#')
  })

  it('does not expand an entity from the document type into a link: the document is rejected', async () => {
    const entity = `<!DOCTYPE svg [<!ENTITY j "javascript:alert(1)">]><svg ${NS} xmlns:xlink="http://www.w3.org/1999/xlink"><a xlink:href="&j;"/></svg>`
    await rejects(entity).toBeInstanceOf(SvgRejectedError)
  })

  it('drops a document type with an internal subset, even when nothing uses it', async () => {
    const output = await clean(`<!DOCTYPE svg [<!ENTITY j "javascript:alert(1)">]>${wrap('<rect id="kept"/>')}`)
    expect(output).not.toMatch(/DOCTYPE|ENTITY|alert/)
    expect(output).toContain('id="kept"')
  })
})

describe('attributes', () => {
  it('removes every on* attribute, under any prefix and in any case', async () => {
    const output = await clean(
      wrap(`<circle r="1" onclick="a()" ONLOAD="b()" xlink:onfocus="c()" onbegin="d()" fill="red"/>`),
    )
    expect(output).not.toMatch(/on[a-z]+=/i)
    expect(output).toContain('fill="red"')
  })

  it('removes an animation that targets a link or a handler, written any way, and keeps other animations', async () => {
    const output = await clean(
      wrap(
        `<a href="#">` +
          `<animate attributeName="href" to="javascript:alert(1)"/>` +
          `<animate attributeName=" xlink:href " to="javascript:alert(2)"/>` +
          `<animateTransform attributeName="&#x78;link:&#104;ref" to="javascript:alert(3)"/>` +
          `<animateMotion attributeName="src" to="javascript:alert(4)"/>` +
          `<set attributeName="onclick" to="alert(5)"/>` +
          `<set attributeName="fill" to="red"/>` +
          `<text>x</text></a>`,
      ),
    )
    expect(output).not.toContain('alert')
    expect(output).toContain('<set attributeName="fill" to="red"/>')
  })

  it('removes external and script url() values from any attribute and from style attributes', async () => {
    const output = await clean(
      wrap(
        `<rect fill="url(https://evil.example/a.svg#x)" filter="url(javascript:alert(1))" ` +
          `style="fill:red;background:url('https://evil.example/b.png');clip-path:url(#local)" mask="url(#m)"/>`,
      ),
    )
    expect(output).not.toMatch(/evil|alert/)
    expect(output).toContain('fill:red')
    expect(output).toContain('url(#local)')
    expect(output).toContain('mask="url(#m)"')
  })
})

describe('style', () => {
  it('removes @import in a cdata section and keeps the rest, as well as the cdata section', async () => {
    const output = await clean(
      wrap(
        `<style><![CDATA[@import url("https://evil.example/x.css"); .a > .b { fill: red }]]></style><rect class="a"/>`,
      ),
    )
    expect(output).not.toMatch(/@import|evil/)
    expect(output).toContain('.a &gt; .b { fill: red }')
    expect(output).not.toContain('<![CDATA[')
  })

  it('removes @import with no semicolon, and in plain text', async () => {
    const output = await clean(wrap(`<style>@import "https://evil.example/x.css"</style>`))
    expect(output).not.toMatch(/@import|evil/)
  })

  it('keeps data:image and local references, and removes other url() values', async () => {
    const output = await clean(
      wrap(
        `<style>.a{fill:url(#g)} .b{background:url(data:image/png;base64,AAAA)} ` +
          `.c{background:url("data:text/html,x")} .d{background:url( javascript:alert(1) )} ` +
          `.e{background:url('//evil.example/x')}</style>`,
      ),
    )
    expect(output).toContain('url(#g)')
    expect(output).toContain('url(data:image/png;base64,AAAA)')
    expect(output).not.toMatch(/text\/html|alert|evil/)
  })

  it('removes script constructs older browsers read', async () => {
    const output = await clean(
      wrap(`<style>.a{width:expression(alert(1));-moz-binding:url(#x);behavior: url(#y)}</style>`),
    )
    expect(output).not.toMatch(/expression\(|-moz-binding|behavior\s*:/)
  })

  it('drops a style whose danger is only visible once css escapes are read', async () => {
    const output = await clean(wrap(`<style>@\\69mport url(https://evil.example/x.css); .a{fill:red}</style>`))
    expect(output).not.toMatch(/evil|69mport/)
    expect(cleanCss('.a{background:url(\\6a avascript:alert(1))}')).toBe('')
  })

  it('keeps escapes that hide nothing', () => {
    expect(cleanCss('.a\\:b{fill:red}')).toBe('.a\\:b{fill:red}')
    expect(cleanCss('.a{content:"\\0 \\110000 \\41 "}')).toBe('.a{content:"\\0 \\110000 \\41 "}')
  })

  it('removes elements inside a style element', async () => {
    const output = await clean(wrap(`<style>.a{fill:red}<circle id="inner"/></style>`))
    expect(output).not.toContain('inner')
    expect(output).toContain('.a{fill:red}')
  })
})

describe('markup that is inert as XML but not in a web page', () => {
  /** Whether no script can start and every style element's closing tag is its own: nothing ends an element early. */
  const isInlineSafe = (output: string) =>
    !/<script/i.test(output) &&
    (output.match(/<\/style/gi) ?? []).length === (output.match(/<style[\s>]/gi) ?? []).length

  const read = (output: string) => new DOMParser().parseFromString(output, 'image/svg+xml')

  it('writes a cdata section in a style element as escaped text, so a closing tag inside it stays text', async () => {
    const output = await clean(wrap(`<style><![CDATA[ </style><script>alert(1)</script> ]]></style><rect id="kept"/>`))
    expect(isInlineSafe(output)).toBe(true)
    expect(output).not.toMatch(/<script|<!\[CDATA\[/)
    expect(read(output).getElementsByTagName('script')).toHaveLength(0)
    expect(output).toContain('id="kept"')
  })

  it('drops style text that still holds a < once cleaned, and keeps the element out of the output', async () => {
    const output = await clean(
      wrap(`<style>a{content:"&lt;/style&gt;&lt;script&gt;alert(1)&lt;/script&gt;"}</style><rect/>`),
    )
    expect(output).not.toMatch(/alert|&lt;script|<script/)
    expect(read(output).getElementsByTagName('script')).toHaveLength(0)
  })

  it('removes a style element inside a title, desc, text, tspan or metadata', async () => {
    const output = await clean(
      wrap(
        `<title><style>a{}</style>t</title><desc><style>b{}</style></desc><text><style>c{}</style>x<tspan><style>d{}</style></tspan></text>` +
          `<metadata><style>e{}</style></metadata><defs><style>keep{}</style></defs>`,
      ),
    )
    expect(output.match(/<style/g)).toHaveLength(1)
    expect(output).toContain('keep{}')
  })

  it('writes a cdata section anywhere else as escaped text', async () => {
    const output = await clean(
      wrap(
        `<title><![CDATA[</title><script>alert(1)</script>]]></title><text><![CDATA[</text><img src=x onerror=alert(2)>]]></text>`,
      ),
    )
    expect(output).not.toMatch(/<!\[CDATA\[|<script|<img/)
    expect(output).toContain('&lt;/title&gt;')
    expect(read(output).getElementsByTagName('script')).toHaveLength(0)
  })
})

describe('document parts', () => {
  it('removes comments, processing instructions and the document type, and keeps the content', async () => {
    const output = await clean(
      `<?xml version="1.0"?><?xml-stylesheet href="https://evil.example/x.css"?><!-- c -->` +
        `<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">` +
        wrap(`<!-- inside --><?php echo 1 ?><rect id="kept"/>`),
    )
    expect(output).not.toMatch(/<!--|<\?|DOCTYPE|evil|php/)
    expect(output).toContain('id="kept"')
  })

  it('does not expand a billion-laughs document: it is rejected, fast', async () => {
    const levels = Array.from(
      { length: 9 },
      (_, index) => `<!ENTITY l${index + 1} "${`&l${index};`.repeat(10)}">`,
    ).join('')
    const bomb = `<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY l0 "lol">${levels}]><svg xmlns="http://www.w3.org/2000/svg"><text>&l9;</text></svg>`
    const started = Date.now()
    await rejects(bomb).toBeInstanceOf(SvgRejectedError)
    expect(Date.now() - started).toBeLessThan(1000)
  })

  it('does not read an external entity: the document is rejected and nothing of the file appears', async () => {
    const xxe = `<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg"><text>&x;</text></svg>`
    await rejects(xxe).toBeInstanceOf(SvgRejectedError)
  })

  it('does not expand an internal entity declared in the document type', async () => {
    const internal = `<!DOCTYPE svg [<!ENTITY a "javascript:alert(1)">]><svg xmlns="http://www.w3.org/2000/svg"><a href="&a;"/></svg>`
    await rejects(internal).toBeInstanceOf(SvgRejectedError)
  })
})

describe('documents that cannot be stored', () => {
  it.each([
    ['text that is not markup', 'not xml at all'],
    ['an empty document', ''],
    ['an element that is never closed', `<svg ${NS}><circle r="1"></svg>`],
    ['an undeclared prefix', `<svg xmlns="http://www.w3.org/2000/svg"><a xlink:href="#a"/></svg>`],
    ['a root that is not an svg element', `<html xmlns="http://www.w3.org/1999/xhtml"><body/></html>`],
    ['an svg element in another namespace', `<svg xmlns="urn:other"><circle r="1"/></svg>`],
    ['an unknown entity', wrap(`<text>&nbsp;</text>`)],
    ['a declared encoding Node does not know', `<?xml version="1.0" encoding="x-nonsense"?>${wrap('')}`],
    ['bytes that are not valid in the declared encoding', Buffer.from([0x3c, 0x73, 0xff, 0xfe, 0xfd])],
  ])('rejects %s', async (_label, bytes) => {
    await rejects(bytes).toBeInstanceOf(SvgRejectedError)
  })

  it('rejects a document nested too deeply to walk, instead of crashing', async () => {
    const deep = wrap('<g>'.repeat(30000) + '</g>'.repeat(30000))
    await rejects(deep).toBeInstanceOf(SvgRejectedError)
  })

  it('keeps the cause of an error that is not the parser refusing', () => {
    expect.assertions(2)
    try {
      sanitizeSvgDocument(Buffer.from([0x3c, 0xff]))
    } catch (error) {
      expect(error).toBeInstanceOf(SvgRejectedError)
      expect((error as Error).cause).toBeDefined()
    }
  })
})

describe('encodings', () => {
  it('reads a declared single-byte encoding and writes UTF-8', async () => {
    const latin1 = Buffer.concat([
      Buffer.from('<?xml version="1.0" encoding="ISO-8859-1"?><svg xmlns="http://www.w3.org/2000/svg"><text>caf'),
      Buffer.from([0xe9]),
      Buffer.from('</text></svg>'),
    ])
    expect(await clean(latin1.toString('latin1'))).toContain('caf')
    const output = (await sanitizeImage(latin1, '.svg')).toString('utf-8')
    expect(output).toContain('café')
  })

  it('reads UTF-16 with a byte order mark, and UTF-8 with one', async () => {
    const text = wrap('<text>é</text>')
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')])
    expect((await sanitizeImage(utf16, '.svg')).toString()).toContain('é')
    const utf8 = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text)])
    expect((await sanitizeImage(utf8, '.svg')).toString()).toContain('é')
  })
})

describe('readings a parser leaves to us', () => {
  it('leaves a reference outside the character range as written when reading a link', () => {
    expect(isScriptUri('&#1114112;javascript:1')).toBe(false)
  })

  it('keeps an animation with no target attribute', async () => {
    expect(await clean(wrap(`<circle r="1"><animate to="5"/></circle>`))).toContain('<animate to="5"/>')
  })

  it('accepts a document the parser only warns about, and writes it out repaired', async () => {
    expect(await clean(`<svg ${NS} width=10/>`)).toContain('width="10"')
  })
})

describe('output', () => {
  it('is well formed and stable: sanitizing the output again changes nothing', async () => {
    const once = await clean(
      wrap(`<a xlink:href="javascript:1"><text>a &amp; b &lt; c</text></a><style><![CDATA[a>b{}]]></style>`),
    )
    expect(await clean(once)).toBe(once)
    expect(once).toContain('a &amp; b &lt; c')
  })

  it('keeps namespace declarations and the xlink prefix', async () => {
    const output = await clean(wrap(`<use xlink:href="#a"/>`))
    expect(output).toContain('xmlns:xlink="http://www.w3.org/1999/xlink"')
    expect(output).toContain('xlink:href="#a"')
  })
})

describe('remote loads that hid from the first checks (third review, finding 6)', () => {
  it('removes a url spelled with a style sheet escape in a presentation attribute', async () => {
    const output = await clean(wrap('<rect fill="\\75rl(https://evil.example/x)" width="1" height="1"/>'))
    expect(output).not.toContain('evil.example')
    expect(output).not.toContain('75rl')
  })

  it('removes an escaped url in any attribute, not only the style attribute', async () => {
    const output = await clean(wrap('<rect filter="\\75 rl(http://evil.example/f)" mask="u\\72l(//evil.example/m)"/>'))
    expect(output).not.toContain('evil.example')
  })

  it('keeps a presentation attribute that has no escape and no remote load', async () => {
    const output = await clean(wrap('<rect fill="url(#grad)" stroke="red" width="1" height="1"/>'))
    expect(output).toContain('fill="url(#grad)"')
    expect(output).toContain('stroke="red"')
  })

  it('removes a url with no closing parenthesis, which reads to the end of the text', async () => {
    const output = await clean(wrap('<style>rect { fill: url(https://evil.example/x</style><rect/>'))
    expect(output).not.toContain('evil.example')
    expect(cleanCss('a{background:url("https://evil.example/q')).not.toContain('evil.example')
    expect(cleanCss('a{background:url(https://evil.example/q')).not.toContain('evil.example')
  })

  it('keeps an unterminated url that points inside the document', () => {
    expect(cleanCss('a{fill:url(#local')).toContain('url(#local')
  })

  it.each([
    'image-set(url(https://evil.example/a.png) 1x)',
    'image-set("https://evil.example/a.png" 1x)',
    '-webkit-image-set("//evil.example/a.png" 1x, "//evil.example/b.png" 2x)',
    'IMAGE-SET("https://evil.example/a.png" 1x',
  ])('removes %s, including its bare string candidates', (value) => {
    expect(cleanCss(`a{background:${value}}`)).not.toContain('evil.example')
  })

  it('removes a remote font source and a remote import from a style element', async () => {
    const output = await clean(
      wrap(
        '<style>@font-face{font-family:f;src:url(https://evil.example/f.woff2) format("woff2")}@import "https://evil.example/s.css";</style><text>x</text>',
      ),
    )
    expect(output).not.toContain('evil.example')
  })

  it('removes xml:base from the root and from inner elements, so #x cannot resolve elsewhere', async () => {
    const output = await clean(
      `<svg ${NS} xml:base="https://evil.example/doc.svg"><defs><g id="x"><rect/></g></defs><g xml:base="http://evil.example/"><use href="#x"/></g></svg>`,
    )
    expect(output).not.toContain('xml:base')
    expect(output).not.toContain('evil.example')
    expect(output).toContain('<use href="#x"')
  })
})
