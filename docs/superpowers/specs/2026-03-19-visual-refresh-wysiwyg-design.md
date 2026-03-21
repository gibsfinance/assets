# Gib.Show Visual Refresh + Studio — Design Spec

This spec describes the visual refresh of the Gib.Show frontend and the new Studio page (formerly Wizard) that combines an enhanced token browser with a WYSIWYG image configurator and code generator.

## Routes

| Route | Page | Description |
|-------|------|-------------|
| `#/` | Home | Landing page — metrics, features, full-page physics animation, CTA |
| `#/studio` | Studio | Token browser (left panel) + configurator/preview/code (right panel) |
| `#/docs` | Docs | Polished API reference with sidebar navigation and framework-aware code examples |
| `#/wizard` | Redirect | Redirects to `#/studio` for backward compatibility |

## Design System

### Direction

Vibrant Web3/DeFi aesthetic. Rich gradients, glowing accents, glassmorphism cards, animated backgrounds. The product serves images — the design should feel alive and visual.

### Color Palette

**Primary accent:** `#00DC82` (green), used in gradients:
- Green → Cyan: `linear-gradient(135deg, #00DC82, #0ea5e9)` — headings, CTAs, brand moments
- Green → Deep green: `linear-gradient(135deg, #00DC82, #00b368)` — buttons, interactive glow

**Dark mode surfaces (primary experience):**
- Base: `#09090b`
- Elevated-1: `#111113`
- Elevated-2: `#1a1a1e`
- Elevated-3: `#27272a`
- Borders: `rgba(255, 255, 255, 0.08)`

**Light mode surfaces:**
- Base: `#ffffff`
- Elevated-1: `#fafafa`
- Elevated-2: `#f4f4f5`
- Elevated-3: `#e4e4e7`
- Borders: `#e4e4e7`

**Glow effects:**
- Green glow: `box-shadow: 0 0 20px rgba(0, 220, 130, 0.3)` — interactive elements, active states
- Cyan glow: `box-shadow: 0 0 20px rgba(14, 165, 233, 0.3)` — secondary highlights
- Glass: `background: rgba(255, 255, 255, 0.03); backdrop-filter: blur(12px); border: 1px solid rgba(255, 255, 255, 0.08)` — cards, panels

### Typography

| Role | Font | Weight | Usage |
|------|------|--------|-------|
| Headings | Space Grotesk | 600-700 | Page titles, section headings, brand |
| Body | Inter | 400-500 | Paragraphs, labels, descriptions |
| Code | JetBrains Mono | 400 | Code blocks, API paths, addresses |

Brand heading ("Gib.Show") uses the green→cyan gradient as text fill.

### Card Variants

**Glass card:** Semi-transparent with backdrop blur. Used for feature cards, info panels.
```
background: rgba(255, 255, 255, 0.03)
backdrop-filter: blur(12px)
border: 1px solid rgba(255, 255, 255, 0.08)
border-radius: 16px
```

**Elevated card:** Solid background with shadow depth. Used for interactive panels, configurator sections.
```
background: #111113
border: 1px solid rgba(255, 255, 255, 0.08)
border-radius: 16px
box-shadow: 0 4px 24px rgba(0, 0, 0, 0.4)
```

**Glow card:** Accent border with subtle glow. Used for highlighted/active states, CTAs.
```
background: #111113
border: 1px solid rgba(0, 220, 130, 0.2)
border-radius: 16px
box-shadow: 0 0 24px rgba(0, 220, 130, 0.08)
```

### Button Variants

- **Primary:** Green gradient background, black text, green glow shadow
- **Secondary:** `rgba(255, 255, 255, 0.05)` background, white text, subtle border
- **Ghost:** Transparent background, green text, green border
- **Badge:** Small pill — green tint for tags, cyan tint for info

### Transitions

All interactive elements: `transition: all 150ms ease`. Hover states use subtle scale (`1.02`) and glow increase. Focus rings use green glow instead of browser default.

## Full-Page Physics Animation

### Overview

60-80 floating token/network icons rendered on a fixed-position `<canvas>` element behind all page content. Icons drift, bounce off each other and viewport walls, respond to scroll and mouse movement. This is the signature visual identity of Gib.Show.

### Icon Pool

- Source: Network icons via `/image/{chainId}`, token icons via `/image/{chainId}/{address}` from the metrics data
- Size distribution:
  - Background layer: 20-30px, low opacity (0.15-0.25)
  - Middle layer: 40-60px, medium opacity (0.3-0.5)
  - Foreground layer: 60-80px, higher opacity (0.5-0.7)
  - Monster (4% chance): 168px, 0.4 opacity
- Icons are pre-loaded as `Image` objects, drawn to canvas each frame

### Physics

**Movement:**
- Each icon has position (x, y) and velocity (vx, vy)
- Idle drift: random initial velocity, background icons ~0.3px/frame, foreground ~0.8px/frame
- Damping: velocity *= 0.999 per frame (slow energy loss, keeps things moving)

**Collision detection:**
- Each icon has a circular bounding radius (half its rendered size + small padding)
- Spatial hash grid divides the viewport into cells. Each frame, icons are bucketed by cell. Collision checks only happen between icons in the same or adjacent cells → O(n) average case
- Collisions only within the same depth layer (background doesn't collide with foreground)

**Collision response:**
- Damped elastic collision: icons bounce off each other with mass proportional to their size
- Larger icons deflect less, smaller icons bounce more
- Collision damping factor: 0.85 (slightly inelastic, prevents perpetual bouncing)

**Wall bounces:**
- Icons bounce off viewport edges (top, bottom, left, right)
- Bounce damping: 0.9 (slight energy loss on wall hit)

**Scroll interaction:**
- Scrolling applies a force vector to all icons proportional to scroll velocity
- Direction: scroll down → icons get pushed downward (and slightly outward from center)
- Fast scrolling causes chain collisions as icons pile up and bounce off each other

**Mouse/touch interaction:**
- Icons within a radius (~120px) of the cursor are gently repelled
- Repulsion force inversely proportional to distance (closer = stronger push)
- Creates a "parting the waters" effect as the cursor moves

### Performance

- Fixed-position `<canvas>` element with `z-index: 0`, all content layers above it
- `requestAnimationFrame` loop, target 60fps
- Spatial hash grid rebuilt each frame (cheap — just array bucketing)
- If frame time exceeds 20ms, reduce collision checks (skip every other frame for collision)
- `prefers-reduced-motion`: disable physics, show static scattered icons at their initial positions

### Fade

Icons fade as they approach viewport edges (0-5% from any edge → opacity ramp to 0). This prevents hard clipping at viewport boundaries.

## Pages

### Home (`#/`)

**Sections (top to bottom):**

1. **Hero** — "Gib.Show" branding with green→cyan gradient. Updated tagline. Physics canvas visible behind.
2. **Value proposition grid** — 3 glass cards: "Always Available", "Lightning Fast", "Reliable & Secure". Glow icons, updated typography.
3. **Integration examples** — Live API URLs with rendered image previews. Glass card treatment. Each shows a token image, network logo, or token list example pulled live from the API.
4. **Platform metrics** — Gradient text numbers with glow. Animated count-up on scroll into view. Total tokens, supported networks.
5. **Network distribution** — Glass cards with network icon, chain name, token count. Hover glow effect. Clicking navigates to `#/studio` with chain pre-selected (via `localStorage.selectedChainId`).
6. **CTA** — "Open Studio" primary button with glow.
7. **Attribution footer** — Provider logos in refreshed glass card row.

**Testnet toggle** — same behavior, updated styling with the new design system.

**Data flow** — unchanged from current implementation. Same metrics hook, same localStorage caching with 3hr TTL and chunking.

### Studio (`#/studio`)

Split-panel layout. Token browser on the left, configurator on the right.

#### Layout

**Desktop (≥1024px):** Side-by-side grid. Left panel: 380px fixed width. Right panel: flexible remainder. Both panels scroll independently.

**Mobile (<1024px):** Stacked with a tab bar to switch between "Browse" and "Configure" views. Selecting a token in Browse auto-switches to Configure.

**Architecture note:** The browser and configurator are independent components communicating through shared state (selected token, selected chain). This makes future migration to a collapsible drawer layout (VS Code sidebar pattern) straightforward — only the layout container changes, not the components.

#### Left Panel: Token Browser

**Search bar:**
- Text input for searching tokens by name, symbol, or address
- Local filtering on each keystroke (no debounce)
- Enter key triggers global search across all lists (same behavior as current wizard)
- Global search concurrency: 4 simultaneous fetches, abortable

**Filter controls (below search):**
- Chain selector: dropdown/popover to filter by network
- List filter: popover with checkboxes for each provider list, toggle all, search within list names, per-list token count
- Metadata toggle: shows/hides format and dimension columns in token rows

**Token rows:**
- Each row shows: token icon (36px circle), name, symbol, truncated address
- When metadata toggle is on: format badge (SVG/PNG/WEBP), dimensions (e.g., "256×256" or "Scalable" for SVG)
- Info button (ℹ) on each row opens the Token Detail Modal
- Clicking the row itself selects the token and loads it into the configurator
- Selected row has green glow highlight (`rgba(0, 220, 130, 0.08)` background, green border)

**Image metadata:**
- Format and dimensions are read from the HTTP response headers when the token's image is loaded (`Content-Type` for format, image decode for dimensions)
- Metadata is cached per token to avoid re-fetching
- Displayed inline when readily available, not fetched eagerly for all tokens

**Pagination:**
- Same as current: Previous/Next buttons, page indicator, per-page dropdown (10/25/50)

#### Token Detail Modal

Opens when the ℹ button is clicked on a token row.

**Contents:**
- **Hero:** Large token icon (64px) + token name + symbol + chain name
- **Image metadata grid:** Format (SVG/PNG/WEBP), dimensions (px or "Scalable"), file size, content-type
- **SVG indicator:** If the image is SVG, display a badge noting it's resolution-independent. The configurator adjusts available options for SVG images (no resize artifacts, potential for inline SVG)
- **List presence:** Which provider lists include this token, shown as badge pills. Expandable to show all if more than 4.
- **API endpoints:** Direct links to all available endpoints for this token
  - `/image/{chainId}/{address}` (priority-ordered)
  - `/image/direct/{hash}` (if hash known)
  - `/image/fallback/{order}/{chainId}/{address}` (explicit order)
- **Actions:**
  - "Configure in Studio" — selects this token in the configurator and closes the modal
  - "Copy URL" — copies the primary image URL to clipboard

#### Right Panel: Configurator

**Empty state (before token selection):**
- Preview area shows a placeholder illustration (faded token icon silhouette) with text: "Select a token to start configuring"
- Appearance controls are visible but disabled (grayed out)
- Code output panel is hidden
- This is the first thing users see when they navigate to Studio without a pre-selected chain

**Preview area (top, after token selected):**
- Main preview: renders the token image with all current configuration applied (size, shape, shadow, background, badge)
- The preview updates live as any control changes
- Mini context previews below the main preview:
  - **Avatar:** standalone circular icon at configured size
  - **Card:** token name + icon in a small card layout
  - **List item:** row with icon, name, symbol, address placeholder

**Appearance controls:**

| Control | Type | Options |
|---------|------|---------|
| Size | Number inputs (W × H) | Default 64×64. Linked aspect ratio toggle. |
| Shape | Visual picker | Circle, rounded (configurable radius), square |
| Shadow | Radio/segmented | None, subtle, medium, strong |
| Background | Swatches + picker | Transparent (checkerboard), black, white, custom color, custom gradient |

**Network badge controls:**

| Control | Type | Description |
|---------|------|-------------|
| Toggle | Switch | Enable/disable network badge overlay |
| Position | Radial/360° control | Drag the badge around the token perimeter. Full 360-degree positioning. User can drag in the preview or type degrees. |
| Size | Slider | 15% to 60% of token image size |
| Overlap | Slider | How much the badge overlaps the token edge. Range: -50% (floating away from edge) to +50% (deeply inset into the token). 0% = badge center sits on the token edge. |
| Ring | Toggle + controls | On/off. When on: ring color picker (defaults to background color for cutout effect), ring thickness slider. |

**Badge position implementation:**
- The badge position is stored as an angle (0-360 degrees) and the overlap value determines radial distance
- 0° = top center, 90° = right center, 180° = bottom center, 270° = left center
- The preview shows the badge at the configured angle, clamped to the token's bounding box
- CSS output translates polar coordinates to absolute positioning (`top`, `left`, `transform: translate(...)`)

**SVG-specific options:**
- When the selected token's image is SVG format, additional controls appear:
  - **Render mode:** `<img src>` (default, treats SVG as image) vs `inline SVG` (embeds the SVG markup, allows CSS styling)
  - **Color override:** When inline SVG is selected, optional fill color override

**List resolution ordering:**
- Collapsible section: "Resolution Order"
- Shows the available list providers as draggable items
- Users can drag to reorder which provider's image takes priority
- Default order matches the server's built-in priority (from `collectables.ts`)
- When custom order is set, the generated URL uses `/image/fallback/{order}/{chainId}/{address}` instead of `/image/{chainId}/{address}`
- The `{order}` segment is a comma-separated list of provider keys in priority order, e.g., `/image/fallback/coingecko,uniswap,trustwallet/1/0xdac1...`. This matches the existing server route parameter format.
- Reset button restores default order

**Code output (bottom of right panel):**

**Format tabs:** React | HTML | `<img>`

**Output mode toggle:** "Quick Paste" (snippet) | "Component" (full file)

**Quick Paste mode:**
- React: JSX with inline styles/className for the configured appearance. Includes the network badge as a positioned child element.
- HTML: `<div>` wrapper with inline CSS for size/shape/shadow/background, `<img>` for token, positioned `<img>` for badge
- `<img>`: Single `<img>` tag with the API URL. If badge is enabled, a warning note appears above the code: "Badge requires a wrapper element — switch to React or HTML for badge support." The badge configuration is preserved (not reset) so the user can switch tabs without losing settings.

**Component mode:**
- React: Full `GibToken` component file with props for all configured options (`chainId`, `address`, `size`, `shape`, `shadow`, `badge`, `badgePosition`, `badgeSize`, etc.)
- HTML: Same as quick paste (HTML doesn't have a component concept)
- `<img>`: Same as quick paste

**Code display:**
- Syntax highlighted with Shiki
- "Copy Code" primary action button (green gradient, glow)
- "Copy URL" secondary button (copies just the image URL)
- Code updates live as configuration changes

### Docs (`#/docs`)

**Layout:** Sticky sidebar (left, 240px) + main content (right, flexible).

**Sidebar:**
- Anchor links to each section
- Highlights current section on scroll (intersection observer)
- Sections: Token Endpoints, Image Endpoints, Features, Code Examples

**Endpoint display:**
- Each endpoint rendered as a glass card
- Method badge (`GET` in green pill)
- Path with syntax highlighting (`:chainId`, `:tokenAddress` highlighted)
- Description
- Expandable "Example" section showing a live URL + response preview

**Code examples:**
- Framework switcher tabs: HTML, JavaScript, React, cURL
- Syntax highlighted with Shiki (dark-plus / light-plus themes)
- Copy button on each code block

**Search/filter:**
- Quick filter bar at top of main content area
- Filters endpoints by keyword match against path, description, and parameter names

**Endpoints documented (unchanged):**

Token:
- `GET /token/{chainId}/{tokenAddress}`
- `GET /list/`
- `GET /list/{providerKey}/{listKey}`
- `GET /list/{providerKey}/{listKey}?chainId={chainId}`

Image:
- `GET /image/{chainId}`
- `GET /image/{chainId}/{tokenAddress}`
- `GET /image/fallback/{order}/{chainId}/{tokenAddress}`
- `GET /image/direct/{hash}`

**Mobile:** Sidebar collapses to a dropdown menu at the top of the page.

## Layout

**Header:**
- "Gib.Show" logo (left) — green→cyan gradient text
- "Studio" navigation button (right) — hidden when on `#/studio`
- Theme toggle (right) — sun/moon icon, same behavior

**Footer:**
- Attribution bar with provider logos
- Same providers as current, glass card styling

## State Management

### Existing (unchanged)

- **ThemeContext:** `isDark` + `toggle()`, persisted to `localStorage('theme')`
- **SettingsContext:** `showTestnets`, persisted to `localStorage('showTestnets')`
- **MetricsContext:** wraps `useMetrics()` hook — total tokens, tokens per chain, supported networks. 3hr TTL localStorage cache with chunking.

### New

- **StudioContext:** Selected token, selected chain, configurator state (all appearance + badge settings). Ephemeral per session — not persisted to localStorage except for cross-page navigation.
  - `selectedToken: Token | null`
  - `selectedChainId: string | null`
  - **Cross-page initialization:** On mount, reads `localStorage.selectedChainId`. If set, applies it as the initial `selectedChainId` and clears the key. This enables Home → Studio chain pre-selection (same pattern as the current Wizard's `NetworkSelect`).
  - `appearance: { width, height, shape, borderRadius, shadow, backgroundColor }` — `backgroundColor` is a `string` that accepts any valid CSS background value: hex (`#ff0000`), `transparent`, or gradient (`linear-gradient(135deg, #00DC82, #0ea5e9)`)
  - `activeTab: 'browse' | 'configure'` — mobile only, tracks which panel is visible. Defaults to `'browse'`. Auto-switches to `'configure'` on token selection.
  - `badge: { enabled, angleDeg, sizeRatio, overlap, ringEnabled, ringColor, ringThickness }`
  - `codeFormat: 'react' | 'html' | 'img'`
  - `codeMode: 'snippet' | 'component'`
  - `resolutionOrder: string[] | null` (null = server default)

- **ImageMetadataCache:** Simple Map keyed by image URL, storing `{ format, width, height, fileSize, contentType }`. Populated lazily. Not persisted.
  - **`useImageMetadata(url)` hook:** Given an image URL, returns cached metadata or fetches it. Performs a `fetch(url, { method: 'HEAD' })` to read `Content-Type` header. `Content-Length` is read if the server exposes it via CORS (`Access-Control-Expose-Headers`); `fileSize` will be `null` if unavailable. For dimensions, loads the image into an `Image` object and reads `naturalWidth`/`naturalHeight`. Results are stored in the cache Map (module-level, shared across components). Returns `{ metadata, isLoading }`.
  - Metadata is fetched lazily — only when a token row is visible (metadata toggle on) or when the Token Detail Modal opens. Not fetched eagerly for all tokens in the list.

## Component Architecture

### New Components

| Component | Purpose |
|-----------|---------|
| `PhysicsCanvas` | Full-page fixed canvas with floating icon physics simulation |
| `StudioBrowser` | Left panel: search, filters, token list, pagination |
| `StudioConfigurator` | Right panel: preview, appearance controls, badge controls, code output |
| `TokenDetailModal` | Full metadata modal opened from ℹ button |
| `BadgeConfigurator` | 360° radial position, overlap, size, ring controls |
| `CodeOutput` | Format tabs, mode toggle, syntax-highlighted code, copy buttons |
| `ListResolutionOrder` | Drag-and-drop provider priority ordering |
| `RadialPositionPicker` | Interactive circular control for badge angle selection. Sub-component of `BadgeConfigurator` — rendered inside it as the drag-to-position UI. `BadgeConfigurator` owns the state; `RadialPositionPicker` receives `angleDeg` and `onChange` as props. |
| `DocsSidebar` | Sticky anchor navigation for docs page |
| `EndpointCard` | Glass card with method badge, path, description, expandable example |
| `FrameworkSwitcher` | Tab bar for code example language selection |
| `CountUpNumber` | Animated number that counts up when scrolled into view. Uses IntersectionObserver — triggers once when the element first enters the viewport (including if already visible on initial render). Does not re-trigger. |

### Evolved Components

| Component | Changes |
|-----------|---------|
| `Home.tsx` | Reskinned with new design system, PhysicsCanvas replaces current floating icons, "Open Studio" CTA |
| `Layout.tsx` | "Studio" nav button replaces "Wizard", updated styling |
| `Attribution.tsx` | Glass card styling |
| `ThemeToggle.tsx` | Updated styling |
| `NetworkSelect.tsx` | Used within StudioBrowser, updated styling |
| `CodeBlock.tsx` | Updated Shiki themes, used in Docs |
| `ErrorMessage.tsx` | Updated styling |
| `PaginationControls.tsx` | Updated styling |

### Removed/Replaced

| Component | Replacement |
|-----------|-------------|
| `Wizard.tsx` | `Studio.tsx` (new page) |
| `TokenPreview.tsx` | Absorbed into `StudioConfigurator` |
| `ApiTypeSelector.tsx` | No longer needed — Studio handles all API types |
| `TokenListSelector.tsx` | Absorbed into `StudioBrowser` filters |
| `TokenAddressInput.tsx` | Absorbed into `StudioBrowser` search |
| `TokenBrowser.tsx` | Replaced by `StudioBrowser` (which composes `TokenSearch`, `TokenListFilter`, `NetworkSelect`, and pagination directly) |
| `UrlDisplay.tsx` | Replaced by `CodeOutput` component's "Copy URL" button |

### Kept Unchanged

| Component | Reason |
|-----------|--------|
| `Image.tsx` | Generic image with fallback — still needed everywhere |

### Composed Into StudioBrowser

| Component | Relationship |
|-----------|-------------|
| `TokenSearch.tsx` | Rendered as a child component inside `StudioBrowser`. Provides the search input, global search trigger, and list filter toggle button. `StudioBrowser` passes callbacks and state down as props — same parent-child pattern as the current `Wizard.tsx` → `TokenSearch.tsx` relationship. |
| `TokenListFilter.tsx` | Rendered as a child component inside `StudioBrowser`. Provides the list checkbox popover. Same props interface as current usage. |
| `NetworkSelect.tsx` | Also rendered inside `StudioBrowser` as the chain selector. Already listed under Evolved Components for styling updates. |

## Build

No changes to build toolchain. Same Vite 6 + React 19 + Tailwind CSS 4 + Shiki stack. New fonts (Inter, JetBrains Mono) loaded via Google Fonts or self-hosted in `public/fonts/`.

## Accessibility

- All interactive elements keyboard-navigable
- Focus rings use green glow (visible on both light and dark backgrounds)
- Color is never the sole indicator — always paired with text or shape
- `prefers-reduced-motion` disables physics animation, falls back to static icons
- Badge radial picker supports keyboard input (type degrees) as alternative to drag
- Modal uses focus trap and Escape to close
- Drag-and-drop list ordering has keyboard alternative (arrow keys to reorder)

## Out of Scope

- Server-side image resizing (`sharp` integration) — Phase 3, separate spec
- Arbitrary badge images (non-network icons) — future enhancement
- Collapsible drawer layout for browser panel — future migration from split panel
- Knex → Drizzle migration — separate initiative
- OpenAPI/Swagger auto-generated docs — separate initiative
