# Terms and attribution

Gib.Show is an index. It collects artwork that other projects publish, usually
stores a copy so it loads quickly, and serves it back at a predictable address.
It is a convenience layer over other people's work.

Some sources we do not copy at all. Where a source asks that its artwork not be
stored or altered, we keep only the address and send you there instead: the
predictable address still works, and answers with a redirect to the source
rather than with our own copy. Those responses carry the same provenance
headers as any other.

## We claim nothing

We do not own the logos, marks, or icons served here. We assert no copyright
over them and grant no licence to them. Each mark belongs to the project it
identifies, and the file that carries it belongs to whoever published it.

The software that runs this service is a separate matter from the artwork it
serves. The artwork carries the terms of its source.

## Every response tells you where the image came from

You do not have to guess. Every image response carries its own provenance:

| Header | What it holds |
|---|---|
| `x-source-uri` | The exact file we copied |
| `x-provider` | The collector that supplied it |
| `x-license` | The licence we identified, or `unknown` |
| `x-license-url` | Where to read that licence |
| `x-attribution` | The notice to reproduce |

Read them with `curl -I`, or from browser JavaScript — they are exposed for
cross-origin reads.

## What you have to do

Most of our sources publish under the MIT licence. MIT is permissive, and it
has one condition: the copyright notice and the permission notice must travel
with copies of the work. If you ship one of these images, ship the notice. The
`x-attribution` header gives you the exact line.

When `x-license` reads `unknown`, we could not establish terms for that source.
Treat it as reserved. Do not assume a licence we could not find, and go to the
source before you ship it.

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
row, a network badge — is ordinarily nominative use, and that is what this
service is built for. Using it to suggest that a project endorses, sponsors, or
is affiliated with you is not. That line is yours to respect.

## If this is your artwork

Write to us and we will remove it. We would rather take a mark down than argue
about it. We will also correct a licence we recorded wrongly, and we would like
to hear about it — a wrong entry here propagates into everyone who trusted it.

## No warranty

This service is provided as is. We do not warrant that a licence we recorded is
correct, that an image is current, or that the service will be available. You
are responsible for what you ship.

We are not lawyers and this page is not legal advice. If your use is commercial
or high-volume, read the source licences yourself.
