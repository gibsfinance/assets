---
title: Submissions
description: How anyone can send in a token list or a token image, and what the operator-only endpoints do.
sidebar:
  order: 10
---

Anyone can suggest a list or an image. No sign-in is needed for the endpoints in the first two sections.

## Submit a token list

```
POST /api/lists/submit
```

Send a JSON body:

| Field | Required | Meaning |
|-------|----------|---------|
| `url` | Yes | The address of a Uniswap-style token list in JSON. |
| `name` | Yes | A name for the list. |
| `submittedBy` | Yes | Who sends it. |
| `description` | No | A short description. |

The answer is 201 with `id`, `status`, `providerKey` and `listKey`. A new submission starts as `pending`. If you send an address that is already known, Gib.Show updates the name, description and `submittedBy`, and returns the existing status. It does not reset the status to `pending`.

The answer is 400 when a field is missing, when the address is not `http` or `https` or points at a private address, or when the content is not a token list.

Submitted lists get a provider key that starts with `user-`.

## List submissions

```
GET /api/lists/submissions?status={status}
```

Returns submissions, optionally filtered by status. A submission has one of these statuses: `pending`, `approved`, `rejected` or `stale`. Its image mode is `link`, `save` or `auto`.

## Submit a token image

```
POST /api/images/submit
```

Send a JSON body with `chainId` (prefixed or bare), `address`, `image` and `submittedBy`. The `image` is a data URI of the form `data:image/...;base64,...`.

- The decoded image can be at most 512 KB. Accepted formats are `png`, `jpg`, `webp`, `gif` and `svg`.
- The request body can be at most 1 MB, because base64 text is about a third larger than the bytes it carries. A larger body answers 413.
- The answer is 201 with `imageHash` and `imageUrl`.
- The answer is 400 for a missing field, an invalid data URI, or an image over the limit.

## Operator-only endpoints

These endpoints need an admin bearer token. Without a valid token they answer 401. They also answer 401 on a server where no admin token is set.

- `GET /api/lists/submissions/approved` returns approved submissions in the shape the collector reads. As a side effect, it saves automatic image mode changes (`auto` becomes `save` or `link`, based on subscriber count and how recently the images were used).
- `PATCH /api/lists/submissions/{id}` changes the status or image mode of a submission. It answers 400 when no known field is given or a value is outside the allowed set, and 404 when the submission does not exist.

## GitHub token exchange

```
POST /api/github/token
```

The studio uses this endpoint when you publish a list to GitHub. It exchanges an OAuth code for an access token. It answers 400 for a missing code or a rejected exchange, 502 when GitHub fails, and 503 when OAuth is not configured on that server. See [Publishing](/list-management/publishing/).
