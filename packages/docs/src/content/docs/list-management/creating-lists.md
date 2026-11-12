---
title: Creating lists
description: Four ways to start a list in the studio, from scratch, from a fork, from a URL or from pasted JSON.
sidebar:
  order: 2
---

## From scratch

1. Open the studio and click the **+** button in the sidebar.
2. Click "New List".
3. Add tokens by pasting their addresses.
4. Use "Load RPC" to fetch the name, symbol and decimals from the chain. See [Loading metadata from a chain](/list-management/rpc-metadata/).

## Fork an existing list

1. Browse tokens in the studio.
2. Click a list name, such as `piteas/exchange`, in any token row.
3. Click "Fork [list name]".
4. Edit the local copy. You can add and remove tokens, reorder them and change images.

## Import from a URL

1. Open the editor and choose "Import from URL".
2. Paste the address of any list in the Uniswap token list format.
3. The studio fetches the list, reads it and stores it in your browser.

## Paste JSON

1. Open the editor and choose "Paste JSON".
2. Paste raw JSON in the Uniswap token list format.

The studio accepts both `{ tokens: [...] }` and a bare array of tokens.
