# Terms and attribution

Gib.Show is an index. It collects artwork that other projects publish, usually
stores a copy so it loads quickly, and serves it back at a predictable address.
It is a convenience layer over other people's work.

Some sources we do not copy at all. Where a source asks that its artwork not be
stored or altered, we keep only the address and send you there instead: the
predictable address still works, and answers with a redirect to the source
rather than with our own copy. Those responses carry the same provenance
headers as any other.

## We do not own the artwork

We do not own the logos, marks, or icons served here. We assert no copyright
over them and grant no licence to them. Each mark belongs to the project it
identifies, and the file that carries it belongs to whoever published it.

The software that runs this service is a separate matter from the artwork it
serves. The artwork carries the terms of its source.

## Every response tells you where the image came from

You do not have to guess. Every single-image response carries its own provenance:

| Header | What it holds |
|---|---|
| `x-source-uri` | The address of the original file |
| `x-provider` | The collector that supplied it |
| `x-license` | The licence we identified, or `unknown` |
| `x-license-url` | Where to read that licence |
| `x-attribution` | The notice to reproduce |

Read them with `curl -I`, or from browser JavaScript — they are exposed for
cross-origin reads.

Sprite sheets are the exception. A sheet combines many images from many
sources, so it cannot carry one image's licence. It carries only a link to this
page. Look up each image on its own route before you rely on its licence. Sheets
never include artwork from a source that forbids copies.

## What you have to do

Some of our sources publish under open licences, most often MIT. Many have no
licence we could find.

Each licence sets its own conditions, so read the one named in `x-license-url`.
MIT, for example, requires the copyright notice and the permission notice to
travel with copies of the work. Other licences add duties: some require you to
state that you changed the work. A resized or converted image is a changed copy.
The `x-attribution` header gives you the notice line we recorded.

When `x-license` reads `unknown`, we could not establish terms for that source.
Assume the owner reserves all rights. Do not assume a licence we could not
find, and go to the source before you ship it.

## Asking for only licensed artwork

Every token and chain image route accepts a repeatable `license` query
parameter, matched without regard to case (`?license=MIT&license=Apache-2.0`).
When you send it, only images whose licence gib.show has verified fall inside
that set are candidates, and you get the best one among them — not a missing
response just because a higher-ranked image happened to be unlicensed. When
nothing qualifies, you get the same not-found response as any other request
with no match. An unverified licence is unknown, and unknown is never treated
as permitted, so it never satisfies this filter.

## Trademarks are a separate question

A licence on a file is not a licence to a trademark. The MIT licence on an icon
file says nothing about the mark drawn in it.

Using a project's logo to identify that project — a chain selector, a token
row, a network badge — is often treated as nominative use, and that is what this
service is built for. Using it to suggest that a project endorses, sponsors, or
is affiliated with you is not. That line is yours to respect.

## Token data is not verified

Token lists, names, symbols, and addresses come from third parties. We do not
verify that a token is legitimate, safe, or the one it claims to be. Nothing
here is financial advice or an endorsement of any token or project.

## If this is your artwork

Open an issue at <https://github.com/gibsfinance/assets/issues> with the image
address and your claim. We review each request and remove artwork where the
claim is credible. We would rather take a mark down than argue about it. We
will also correct a licence we recorded wrongly, and we would like to hear
about it — a wrong entry here propagates into everyone who trusted it.

## No warranty

This service is provided as is. We do not warrant that a licence we recorded is
correct, that an image is current, or that the service will be available. You
are responsible for what you ship.

To the extent the law allows, we are not liable for any loss that comes from
your use of the service or its data.

## Changes to these terms

The Gib.Show maintainers (gibsfinance on GitHub) run this service. We may
change these terms. The version at <https://gib.show/terms> is the one that
applies.

We are not lawyers and this page is not legal advice. If your use is commercial
or high-volume, read the source licences yourself.
