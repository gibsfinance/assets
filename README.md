<div align="center">

# 🎨 Gibs Assets Frontend

A powerful token list management and visualization platform built with Svelte 5.

[![Built with Svelte](https://img.shields.io/badge/Built%20with-Svelte-FF3E00?style=flat-square&logo=svelte)](https://svelte.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-MIT-green.svg?style=flat-square)](LICENSE)

<img src="https://raw.githubusercontent.com/gibsfinance/assets/main/docs/preview.png" alt="Gibs Assets Preview" width="600">

</div>

---

## 🚀 Quick Start

### 1. Clone & Setup

```bash
# Clone with submodules
git clone --recursive git@github.com:gibsfinance/assets.git
cd assets

# Configure environment
cp .env.example .env

# Install dependencies
pnpm install
```

### 2. Development

```bash
# Start development server
pnpm run dev

# Open in browser
pnpm run dev -- --open
```

### 3. Production

```bash
# Create production build
pnpm run build

# Preview production build
pnpm run preview
```

> 📝 **Note:** You may need to install an [adapter](https://svelte.dev/docs/kit/adapters) for your deployment environment.

---

## 🔌 API Reference

### Token Endpoints

| Endpoint                             | Description                          |
| ------------------------------------ | ------------------------------------ |
| `/token/{chainId}/{tokenAddress}`    | Get specific token information       |
| `/list/`                             | Get a list of all                    |
| `/list/{listName}`                   | Get full token list (e.g., 9mm list) |
| `/list/{listName}?chainId={chainId}` | Get chain-filtered token list        |

### Image Endpoints

| Endpoint                                           | Description           |
| -------------------------------------------------- | --------------------- |
| `/image/{chainId}`                                 | Network/chain images  |
| `/image/{chainId}/{tokenAddress}`                  | Token images          |
| `/image/fallback/default/{chainId}/{tokenAddress}` | Fallback token images |

---

## 🛠 Advanced Features

### Backup Image System

Load multiple image sources with fallbacks:

```http
https://gib.show/image/?i=1/0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2&i=369/0x02DcdD04e3F455D838cd1249292C58f3B79e3C3C
```

### Chain-Specific Lists

Filter assets by chain:

```http
https://gib.show/list/9mm?chainId=369
```

### Multi-Source Resolution

Resolve through prioritized lists:

```http
https://gib.show/list/merged/5ff74ffa222c6c435c9432ad937c5d95e3327ebbe3eb9ff9f62a4d940d5790f9?chainId=369
```

---

## 📦 Project Structure

### Core Modules

- 📁 `/src/db` - Database operations
- 📁 `/src/collect` - Token collection
- 📁 `/src/utils` - Utility functions
- 📁 `/src/components` - UI components
- 📁 `/src/hooks` - Custom hooks

### Operation Indicators

| Icon | Meaning            |
| ---- | ------------------ |
| 🔍   | Searching/Reading  |
| ⚡   | Processing         |
| 🔗   | RPC Operations     |
| 🏗️   | Setup Operations   |
| 🖼️   | Logo Operations    |
| 📥   | Asset Processing   |
| 💾   | Storage Operations |
| ✨   | Completion         |

---

## 🧪 Development

### TypeScript Validation

```bash
npx tsc -p tsconfig.json
```

## ✨ Features

- ⚡ Token list management
- 🖼️ Token image serving & caching
- 📊 Token statistics tracking
- 🌐 Multi-network support
- 🔄 Token data aggregation
- 🚀 Comprehensive API endpoints
- 💾 Backup lookups
- 🔍 Sequenced filters

## 🎯 Key Metrics

<div align="center">

| Metric              | Count   |
| ------------------- | ------- |
| 🔗 Supported Chains | 50+     |
| 🪙 Tracked Tokens   | 10,000+ |
| 📋 Token Lists      | 140+    |
| 🖼️ Cached Images    | 5,000+  |

</div>

## 🌟 Supported Networks

<div align="center">

| Network    | Chain ID | Status    |
| ---------- | -------- | --------- |
| Ethereum   | 1        | ✅ Active |
| Pulse      | 369      | ✅ Active |
| BSC        | 56       | ✅ Active |
| Arbitrum   | 42161    | ✅ Active |
| Optimism   | 10       | ✅ Active |
| Base       | 8453     | ✅ Active |
| zkSync Era | 324      | ✅ Active |

</div>

<div align="center">

### Built with ❤️ by [Gibs Finance](https://github.com/gibsfinance/assets)

</div>
