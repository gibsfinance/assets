---
title: Publishing
description: Publish a list from the studio to your own GitHub repository.
sidebar:
  order: 6
---

You can publish a list to your own GitHub repository:

1. Click "Publish" in the editor header.
2. Sign in with GitHub (OAuth).
3. The studio pushes the list as `tokenlist.json` to a new or an existing repository.
4. The studio returns the repository address so you can share it.

The publish system is pluggable. Support for GitLab and other version control providers can be added.

A server that you host yourself needs a GitHub OAuth application for this step. See [Configuration](/self-hosting/configuration/) for `GITHUB_OAUTH_CLIENT_ID` and `GITHUB_OAUTH_CLIENT_SECRET`.

Publishing is also your backup. See [Local storage](/list-management/local-storage/).
