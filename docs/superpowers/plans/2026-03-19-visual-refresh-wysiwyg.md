# Visual Refresh + WYSIWYG Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform Gib.Show from a minimal green-on-gray SPA into a vibrant Web3 design tool with full-page physics animation, a split-panel Studio (token browser + WYSIWYG configurator), and polished docs.

**Architecture:** Design system tokens defined in Tailwind CSS 4 `@theme` + `app.css`. Studio page uses split-panel layout with independent browser/configurator components sharing state via React context. Physics animation runs on a fixed-position `<canvas>` element with spatial-hash collision detection. Code output generates React/HTML/img snippets from configurator state.

**Tech Stack:** React 19, React Router 7 (HashRouter), Tailwind CSS 4, Headless UI 2, Shiki, Iconify React, Vite 6. New: Inter + JetBrains Mono fonts via Google Fonts.

**Spec:** `docs/superpowers/specs/2026-03-19-visual-refresh-wysiwyg-design.md`

**IMPORTANT:** After every task, run `npx eslint . && npx tsc --noEmit && npx vite build` from `packages/ui/` to verify lint, types, and build all pass. Do not move to the next task until green.

---

## File Structure

### New Files

```
packages/ui/src/
├── lib/
│   ├── components/
│   │   ├── PhysicsCanvas.tsx          # Full-page floating icon physics simulation
│   │   ├── StudioBrowser.tsx          # Left panel: search, filters, token list, pagination
│   │   ├── StudioConfigurator.tsx     # Right panel: preview, controls, code output
│   │   ├── TokenDetailModal.tsx       # Full metadata modal (ℹ button)
│   │   ├── BadgeConfigurator.tsx      # 360° position, overlap, size, ring controls
│   │   ├── RadialPositionPicker.tsx   # Circular drag control for badge angle
│   │   ├── CodeOutput.tsx             # Format tabs, mode toggle, syntax code, copy
│   │   ├── ListResolutionOrder.tsx    # Drag-and-drop provider priority
│   │   ├── CountUpNumber.tsx          # Animated count-up on scroll into view
│   │   ├── DocsSidebar.tsx            # Sticky anchor navigation
│   │   ├── EndpointCard.tsx           # Glass card with method badge + expandable example
│   │   └── FrameworkSwitcher.tsx      # Tab bar for code language selection
│   ├── hooks/
│   │   └── useImageMetadata.ts        # HEAD fetch + Image decode, module-level cache
│   ├── contexts/
│   │   └── StudioContext.tsx           # Selected token, appearance, badge, code settings
│   ├── pages/
│   │   └── Studio.tsx                 # Split-panel page assembling browser + configurator
│   └── physics/
│       ├── engine.ts                  # Physics loop, collision detection, spatial hash
│       ├── types.ts                   # PhysicsIcon, Vector2D, CollisionCell types
│       └── forces.ts                  # Scroll, mouse, wall bounce force calculations
```

### Modified Files

```
packages/ui/src/
├── app.css                            # Tailwind @theme tokens, font imports, design system classes
├── App.tsx                            # Add /studio route, /wizard redirect
├── Layout.tsx                         # "Studio" nav button, gradient logo, updated styling
├── lib/
│   ├── types.ts                       # Add Studio-related types (StudioAppearance, BadgeConfig, etc.)
│   ├── components/
│   │   ├── Attribution.tsx            # Glass card styling
│   │   ├── CodeBlock.tsx              # Updated themes, used in Docs
│   │   ├── ErrorMessage.tsx           # Updated styling
│   │   ├── NetworkSelect.tsx          # Updated styling
│   │   ├── PaginationControls.tsx     # Updated styling
│   │   ├── ThemeToggle.tsx            # Updated styling
│   │   ├── TokenSearch.tsx            # Updated styling (composed into StudioBrowser)
│   │   └── TokenListFilter.tsx        # Updated styling (composed into StudioBrowser)
│   └── pages/
│       ├── Home.tsx                   # Reskin with design system, integrate PhysicsCanvas
│       └── Docs.tsx                   # Sidebar nav, endpoint cards, framework switcher
```

### Removed Files (after Studio is working)

```
packages/ui/src/lib/
├── components/
│   ├── ApiTypeSelector.tsx            # Replaced by Studio's unified flow
│   ├── TokenAddressInput.tsx          # Absorbed into StudioBrowser search
│   ├── TokenBrowser.tsx               # Replaced by StudioBrowser
│   ├── TokenListSelector.tsx          # Absorbed into StudioBrowser filters
│   ├── TokenPreview.tsx               # Absorbed into StudioConfigurator
│   └── UrlDisplay.tsx                 # Replaced by CodeOutput
└── pages/
    └── Wizard.tsx                     # Replaced by Studio.tsx
```

---

## Task 1: Design System Foundation

**Files:**
- Modify: `packages/ui/src/app.css`
- Modify: `packages/ui/index.html` (font link tags)

This task establishes all design tokens, font imports, and utility classes that every subsequent task depends on.

- [ ] **Step 1: Add Google Fonts to index.html**

Add `<link>` tags for Inter, Space Grotesk, and JetBrains Mono in `packages/ui/index.html`:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400&family=Space+Grotesk:wght@600;700&display=swap" rel="stylesheet">
```

- [ ] **Step 2: Define Tailwind theme tokens in app.css**

Replace the contents of `packages/ui/src/app.css` with design system tokens using Tailwind CSS 4's `@theme` directive:

```css
@import 'tailwindcss';
@custom-variant dark (&:where(.dark, .dark *));

@theme {
  /* Fonts */
  --font-heading: 'Space Grotesk', system-ui, sans-serif;
  --font-body: 'Inter', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', monospace;

  /* Primary accent (Tailwind convention: lower = lighter, higher = darker) */
  --color-accent-400: #33e69b;
  --color-accent-500: #00DC82;
  --color-accent-600: #00b368;

  /* Cyan secondary */
  --color-cyan-500: #0ea5e9;

  /* Dark surfaces */
  --color-surface-base: #09090b;
  --color-surface-1: #111113;
  --color-surface-2: #1a1a1e;
  --color-surface-3: #27272a;

  /* Light surfaces */
  --color-surface-light-base: #ffffff;
  --color-surface-light-1: #fafafa;
  --color-surface-light-2: #f4f4f5;
  --color-surface-light-3: #e4e4e7;

  /* Border */
  --color-border-dark: rgba(255, 255, 255, 0.08);
  --color-border-light: #e4e4e7;

  /* Glow */
  --shadow-glow-green: 0 0 20px rgba(0, 220, 130, 0.3);
  --shadow-glow-cyan: 0 0 20px rgba(14, 165, 233, 0.3);
  --shadow-glow-green-subtle: 0 0 24px rgba(0, 220, 130, 0.08);
  --shadow-elevated: 0 4px 24px rgba(0, 0, 0, 0.4);
}

html, body {
  @apply h-full;
}

body {
  @apply font-body;
}

/* Gradient text utility */
.text-gradient-brand {
  @apply bg-gradient-to-r from-accent-600 to-cyan-500 bg-clip-text text-transparent;
}

.text-gradient-green {
  @apply bg-gradient-to-r from-accent-500 to-accent-600 bg-clip-text text-transparent;
}

/* Glass card */
.glass-card {
  @apply bg-white/[0.03] backdrop-blur-xl border border-border-dark rounded-2xl;
}
.glass-card:where(.dark *) {
  @apply bg-white/[0.03] border-border-dark;
}
.glass-card:where(:not(.dark) *) {
  @apply bg-white border-border-light;
}

/* Elevated card */
.elevated-card {
  @apply bg-surface-1 border border-border-dark rounded-2xl shadow-elevated;
}

/* Glow card */
.glow-card {
  @apply bg-surface-1 border border-accent-500/20 rounded-2xl shadow-glow-green-subtle;
}

/* Buttons */
.btn-primary {
  @apply bg-gradient-to-r from-accent-500 to-accent-600 text-black font-semibold
         px-5 py-2.5 rounded-xl shadow-glow-green transition-all duration-150
         hover:scale-[1.02] hover:shadow-glow-green;
}

.btn-secondary {
  @apply bg-white/5 text-white font-medium px-5 py-2.5 rounded-xl
         border border-white/10 transition-all duration-150 hover:bg-white/10;
}

.btn-ghost {
  @apply bg-transparent text-accent-500 font-medium px-5 py-2.5 rounded-xl
         border border-accent-500/30 transition-all duration-150 hover:bg-accent-500/5;
}
```

- [ ] **Step 3: Verify lint and build pass**

```bash
cd packages/ui && npx eslint . && npx tsc --noEmit && npx vite build
```

- [ ] **Step 4: Commit**

```bash
git add -f packages/ui/src/app.css packages/ui/index.html
git commit -m "feat(ui): add design system tokens, fonts, and utility classes"
```

---

## Task 2: Layout + Routes Update

**Files:**
- Modify: `packages/ui/src/Layout.tsx`
- Modify: `packages/ui/src/App.tsx`
- Modify: `packages/ui/src/lib/types.ts`

- [ ] **Step 1: Add Studio types to types.ts**

Add the following types at the end of `packages/ui/src/lib/types.ts`:

```typescript
export interface StudioAppearance {
  width: number
  height: number
  shape: 'circle' | 'rounded' | 'square'
  borderRadius: number
  shadow: 'none' | 'subtle' | 'medium' | 'strong'
  backgroundColor: string
}

export interface BadgeConfig {
  enabled: boolean
  angleDeg: number
  sizeRatio: number
  overlap: number
  ringEnabled: boolean
  ringColor: string
  ringThickness: number
}

export type CodeFormat = 'react' | 'html' | 'img'
export type CodeMode = 'snippet' | 'component'

export interface ImageMetadata {
  format: string
  width: number | null
  height: number | null
  fileSize: number | null
  contentType: string
}
```

- [ ] **Step 2: Update Layout.tsx**

Rewrite `packages/ui/src/Layout.tsx` to use the new design system. Replace "Wizard" button with "Studio", add gradient logo:

```tsx
import { Link, Outlet, useLocation } from 'react-router-dom'
import { ThemeToggle } from './lib/components/ThemeToggle'

export function Layout() {
  const location = useLocation()
  const isStudio = location.pathname === '/studio'

  return (
    <div className="min-h-screen bg-surface-light-base dark:bg-surface-base text-gray-900 dark:text-gray-100">
      <header className="sticky top-0 z-50 border-b border-border-light dark:border-border-dark bg-white/80 dark:bg-surface-base/80 backdrop-blur-lg">
        <div className="mx-auto flex items-center justify-between px-4 py-3 max-w-7xl">
          <Link to="/" className="font-heading text-2xl font-bold text-gradient-brand hover:opacity-80 transition-opacity">
            Gib.Show
          </Link>
          <div className="flex items-center gap-4">
            {!isStudio && (
              <Link to="/studio" className="btn-primary text-sm">
                Studio
              </Link>
            )}
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  )
}
```

- [ ] **Step 3: Update App.tsx**

Add `/studio` route and `/wizard` redirect. Create a minimal placeholder `Studio.tsx` page:

First, create `packages/ui/src/lib/pages/Studio.tsx`:

```tsx
export default function Studio() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <p className="text-gray-400 font-heading text-xl">Studio — coming soon</p>
    </div>
  )
}
```

Then update `packages/ui/src/App.tsx` (**Note:** use named export `export function App()` to match `main.tsx`'s existing `import { App }`):

```tsx
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { ThemeProvider } from './lib/contexts/ThemeContext'
import { SettingsProvider } from './lib/contexts/SettingsContext'
import { MetricsProvider } from './lib/contexts/MetricsContext'
import { Layout } from './Layout'
import Home from './lib/pages/Home'
import Studio from './lib/pages/Studio'
import Docs from './lib/pages/Docs'

export function App() {
  return (
    <ThemeProvider>
      <SettingsProvider>
        <MetricsProvider>
          <HashRouter>
            <Routes>
              <Route element={<Layout />}>
                <Route index element={<Home />} />
                <Route path="studio" element={<Studio />} />
                <Route path="wizard" element={<Navigate to="/studio" replace />} />
                <Route path="docs" element={<Docs />} />
              </Route>
            </Routes>
          </HashRouter>
        </MetricsProvider>
      </SettingsProvider>
    </ThemeProvider>
  )
}
```

- [ ] **Step 4: Verify lint + types + build**

```bash
cd packages/ui && npx eslint . && npx tsc --noEmit && npx vite build
```

- [ ] **Step 5: Commit**

```bash
git add -f packages/ui/src/Layout.tsx packages/ui/src/App.tsx packages/ui/src/lib/types.ts packages/ui/src/lib/pages/Studio.tsx
git commit -m "feat(ui): add Studio route, wizard redirect, layout reskin"
```

---

## Task 3: Physics Engine (Pure Logic)

**Files:**
- Create: `packages/ui/src/lib/physics/types.ts`
- Create: `packages/ui/src/lib/physics/engine.ts`
- Create: `packages/ui/src/lib/physics/forces.ts`

This task builds the physics simulation as pure functions with no React dependency. Testable in isolation.

- [ ] **Step 1: Create physics types**

Create `packages/ui/src/lib/physics/types.ts`:

```typescript
export interface Vector2D {
  x: number
  y: number
}

export interface PhysicsIcon {
  id: number
  position: Vector2D
  velocity: Vector2D
  radius: number
  mass: number
  layer: 'background' | 'middle' | 'foreground'
  opacity: number
  imgSrc: string
  imgElement: HTMLImageElement | null
}

export interface PhysicsConfig {
  width: number
  height: number
  damping: number
  wallDamping: number
  collisionDamping: number
  edgeFadePercent: number
  mouseRepelRadius: number
  mouseRepelStrength: number
  scrollForceMultiplier: number
}

export interface SpatialCell {
  icons: PhysicsIcon[]
}

export const DEFAULT_CONFIG: PhysicsConfig = {
  width: 0,
  height: 0,
  damping: 0.999,
  wallDamping: 0.9,
  collisionDamping: 0.85,
  edgeFadePercent: 0.05,
  mouseRepelRadius: 120,
  mouseRepelStrength: 0.5,
  scrollForceMultiplier: 0.02,
}
```

- [ ] **Step 2: Create forces module**

Create `packages/ui/src/lib/physics/forces.ts`:

```typescript
import type { PhysicsIcon, PhysicsConfig, Vector2D } from './types'

export function applyWallBounce(icon: PhysicsIcon, config: PhysicsConfig): void {
  const { radius, position, velocity } = icon
  const { width, height, wallDamping } = config

  if (position.x - radius < 0) {
    position.x = radius
    velocity.x = Math.abs(velocity.x) * wallDamping
  } else if (position.x + radius > width) {
    position.x = width - radius
    velocity.x = -Math.abs(velocity.x) * wallDamping
  }

  if (position.y - radius < 0) {
    position.y = radius
    velocity.y = Math.abs(velocity.y) * wallDamping
  } else if (position.y + radius > height) {
    position.y = height - radius
    velocity.y = -Math.abs(velocity.y) * wallDamping
  }
}

export function applyMouseRepel(
  icon: PhysicsIcon,
  mousePos: Vector2D | null,
  config: PhysicsConfig,
): void {
  if (!mousePos) return
  const dx = icon.position.x - mousePos.x
  const dy = icon.position.y - mousePos.y
  const distSq = dx * dx + dy * dy
  const { mouseRepelRadius, mouseRepelStrength } = config
  if (distSq > mouseRepelRadius * mouseRepelRadius || distSq < 1) return
  const dist = Math.sqrt(distSq)
  const force = (mouseRepelStrength * (mouseRepelRadius - dist)) / mouseRepelRadius
  icon.velocity.x += (dx / dist) * force
  icon.velocity.y += (dy / dist) * force
}

export function applyScrollForce(
  icon: PhysicsIcon,
  scrollDelta: number,
  config: PhysicsConfig,
): void {
  icon.velocity.y += scrollDelta * config.scrollForceMultiplier
  // Slight outward push from center
  const centerX = config.width / 2
  const dx = icon.position.x - centerX
  icon.velocity.x += Math.sign(dx) * Math.abs(scrollDelta) * config.scrollForceMultiplier * 0.3
}

export function resolveCollision(a: PhysicsIcon, b: PhysicsIcon, damping: number): void {
  const dx = b.position.x - a.position.x
  const dy = b.position.y - a.position.y
  const distSq = dx * dx + dy * dy
  const minDist = a.radius + b.radius
  if (distSq >= minDist * minDist || distSq < 1) return

  const dist = Math.sqrt(distSq)
  const nx = dx / dist
  const ny = dy / dist

  // Separate overlapping icons
  const overlap = minDist - dist
  const totalMass = a.mass + b.mass
  a.position.x -= (nx * overlap * b.mass) / totalMass
  a.position.y -= (ny * overlap * b.mass) / totalMass
  b.position.x += (nx * overlap * a.mass) / totalMass
  b.position.y += (ny * overlap * a.mass) / totalMass

  // Elastic collision with damping
  const dvx = a.velocity.x - b.velocity.x
  const dvy = a.velocity.y - b.velocity.y
  const dvDotN = dvx * nx + dvy * ny
  if (dvDotN > 0) return // Already separating

  const impulse = ((2 * dvDotN) / totalMass) * damping
  a.velocity.x -= impulse * b.mass * nx
  a.velocity.y -= impulse * b.mass * ny
  b.velocity.x += impulse * a.mass * nx
  b.velocity.y += impulse * a.mass * ny
}

export function computeEdgeOpacity(
  icon: PhysicsIcon,
  config: PhysicsConfig,
): number {
  const { position, radius } = icon
  const { width, height, edgeFadePercent } = config
  const fadeX = width * edgeFadePercent
  const fadeY = height * edgeFadePercent

  let opacity = icon.opacity
  // Left edge
  if (position.x - radius < fadeX) {
    opacity *= Math.max(0, (position.x - radius) / fadeX)
  }
  // Right edge
  if (position.x + radius > width - fadeX) {
    opacity *= Math.max(0, (width - fadeX - (position.x + radius)) / (-fadeX) + 1)
  }
  // Top edge
  if (position.y - radius < fadeY) {
    opacity *= Math.max(0, (position.y - radius) / fadeY)
  }
  // Bottom edge
  if (position.y + radius > height - fadeY) {
    opacity *= Math.max(0, (height - fadeY - (position.y + radius)) / (-fadeY) + 1)
  }
  return Math.max(0, Math.min(1, opacity))
}
```

- [ ] **Step 3: Create engine module**

Create `packages/ui/src/lib/physics/engine.ts`:

```typescript
import type { PhysicsIcon, PhysicsConfig, Vector2D, SpatialCell } from './types'
import { applyWallBounce, applyMouseRepel, applyScrollForce, resolveCollision } from './forces'

const CELL_SIZE = 100

function buildSpatialGrid(
  icons: PhysicsIcon[],
): Map<string, SpatialCell> {
  const grid = new Map<string, SpatialCell>()
  for (const icon of icons) {
    const cx = Math.floor(icon.position.x / CELL_SIZE)
    const cy = Math.floor(icon.position.y / CELL_SIZE)
    const key = `${cx},${cy}`
    let cell = grid.get(key)
    if (!cell) {
      cell = { icons: [] }
      grid.set(key, cell)
    }
    cell.icons.push(icon)
  }
  return grid
}

function checkCollisionsInGrid(
  grid: Map<string, SpatialCell>,
  config: PhysicsConfig,
): void {
  const checked = new Set<string>()
  for (const [key, cell] of grid) {
    const [cx, cy] = key.split(',').map(Number)
    // Check this cell and neighbors
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const neighborKey = `${cx + dx},${cy + dy}`
        if (checked.has(`${key}-${neighborKey}`)) continue
        checked.add(`${key}-${neighborKey}`)
        checked.add(`${neighborKey}-${key}`)
        const neighbor = grid.get(neighborKey)
        if (!neighbor) continue
        const iconsA = cell.icons
        const iconsB = key === neighborKey ? iconsA : neighbor.icons
        for (let i = 0; i < iconsA.length; i++) {
          const startJ = key === neighborKey ? i + 1 : 0
          for (let j = startJ; j < iconsB.length; j++) {
            if (iconsA[i].layer !== iconsB[j].layer) continue
            resolveCollision(iconsA[i], iconsB[j], config.collisionDamping)
          }
        }
      }
    }
  }
}

export function stepPhysics(
  icons: PhysicsIcon[],
  config: PhysicsConfig,
  mousePos: Vector2D | null,
  scrollDelta: number,
): void {
  // Apply forces
  for (const icon of icons) {
    applyMouseRepel(icon, mousePos, config)
    if (scrollDelta !== 0) {
      applyScrollForce(icon, scrollDelta, config)
    }
  }

  // Move
  for (const icon of icons) {
    icon.velocity.x *= config.damping
    icon.velocity.y *= config.damping
    icon.position.x += icon.velocity.x
    icon.position.y += icon.velocity.y
    applyWallBounce(icon, config)
  }

  // Collisions
  const grid = buildSpatialGrid(icons)
  checkCollisionsInGrid(grid, config)
}

export function createIcon(
  id: number,
  imgSrc: string,
  layer: PhysicsIcon['layer'],
  config: PhysicsConfig,
): PhysicsIcon {
  const layerConfig = {
    background: { sizeRange: [20, 30], speedRange: [0.2, 0.4], opacity: [0.15, 0.25] },
    middle: { sizeRange: [40, 60], speedRange: [0.4, 0.6], opacity: [0.3, 0.5] },
    foreground: { sizeRange: [60, 80], speedRange: [0.6, 0.8], opacity: [0.5, 0.7] },
  }[layer]

  const size = layerConfig.sizeRange[0] + Math.random() * (layerConfig.sizeRange[1] - layerConfig.sizeRange[0])
  const speed = layerConfig.speedRange[0] + Math.random() * (layerConfig.speedRange[1] - layerConfig.speedRange[0])
  const opacity = layerConfig.opacity[0] + Math.random() * (layerConfig.opacity[1] - layerConfig.opacity[0])
  const angle = Math.random() * Math.PI * 2

  return {
    id,
    position: {
      x: Math.random() * config.width,
      y: Math.random() * config.height,
    },
    velocity: {
      x: Math.cos(angle) * speed,
      y: Math.sin(angle) * speed,
    },
    radius: size / 2,
    mass: size,
    layer,
    opacity,
    imgSrc,
    imgElement: null,
  }
}
```

- [ ] **Step 4: Verify lint + types + build**

```bash
cd packages/ui && npx eslint . && npx tsc --noEmit && npx vite build
```

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/lib/physics/
git commit -m "feat(ui): add physics engine with collision detection and force system"
```

---

## Task 4: PhysicsCanvas Component

**Files:**
- Create: `packages/ui/src/lib/components/PhysicsCanvas.tsx`

This task wraps the physics engine in a React component that renders to a `<canvas>` element.

- [ ] **Step 1: Create PhysicsCanvas component**

Create `packages/ui/src/lib/components/PhysicsCanvas.tsx`. This component:
- Creates a fixed-position canvas behind all content
- Pre-loads icon images from the metrics data (network icons + token icons)
- Runs the physics loop via `requestAnimationFrame`
- Listens for scroll and mouse events to apply forces
- Respects `prefers-reduced-motion`

```tsx
import { useEffect, useRef, useCallback } from 'react'
import { useMetricsContext } from '../contexts/MetricsContext'
import { getApiUrl } from '../utils'
import { stepPhysics, createIcon } from '../physics/engine'
import { computeEdgeOpacity } from '../physics/forces'
import type { PhysicsIcon, PhysicsConfig, Vector2D } from '../physics/types'
import { DEFAULT_CONFIG } from '../physics/types'

const ICON_COUNT = 70
const MONSTER_CHANCE = 0.04
const MONSTER_SIZE = 168

export default function PhysicsCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const iconsRef = useRef<PhysicsIcon[]>([])
  const configRef = useRef<PhysicsConfig>({ ...DEFAULT_CONFIG })
  const mousePosRef = useRef<Vector2D | null>(null)
  const scrollDeltaRef = useRef(0)
  const lastScrollY = useRef(0)
  const animFrameRef = useRef<number>(0)
  const { metrics } = useMetricsContext()

  const prefersReducedMotion = useRef(
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )

  const initIcons = useCallback(() => {
    if (!metrics) return

    const config = configRef.current
    const sources: string[] = []

    // Add network icons
    for (const net of metrics.networks.supported.slice(0, 20)) {
      sources.push(getApiUrl(`/image/${net.chainId}`))
    }
    // Add token icons from top chains
    const topChains = Object.entries(metrics.tokenList.byChain)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
    for (const [chainId] of topChains) {
      sources.push(getApiUrl(`/image/${chainId}`))
    }

    const icons: PhysicsIcon[] = []
    for (let i = 0; i < ICON_COUNT; i++) {
      const src = sources[i % sources.length]
      const isMonster = Math.random() < MONSTER_CHANCE
      const layerRoll = Math.random()
      const layer = layerRoll < 0.3 ? 'background' : layerRoll < 0.65 ? 'middle' : 'foreground'

      const icon = createIcon(i, src, layer, config)

      if (isMonster) {
        icon.radius = MONSTER_SIZE / 2
        icon.mass = MONSTER_SIZE
        icon.opacity = 0.4
      }

      // Pre-load image
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.src = icon.imgSrc
      img.onload = () => { icon.imgElement = img }
      icons.push(icon)
    }

    iconsRef.current = icons
  }, [metrics])

  const render = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const config = configRef.current

    ctx.clearRect(0, 0, config.width, config.height)

    // Draw in layer order: background → middle → foreground
    const layers: PhysicsIcon['layer'][] = ['background', 'middle', 'foreground']
    for (const layer of layers) {
      for (const icon of iconsRef.current) {
        if (icon.layer !== layer || !icon.imgElement) continue
        const alpha = computeEdgeOpacity(icon, config)
        if (alpha <= 0) continue
        ctx.globalAlpha = alpha
        const size = icon.radius * 2
        ctx.save()
        ctx.beginPath()
        ctx.arc(icon.position.x, icon.position.y, icon.radius, 0, Math.PI * 2)
        ctx.closePath()
        ctx.clip()
        ctx.drawImage(
          icon.imgElement,
          icon.position.x - icon.radius,
          icon.position.y - icon.radius,
          size,
          size,
        )
        ctx.restore()
      }
    }
    ctx.globalAlpha = 1
  }, [])

  const loop = useCallback(() => {
    if (prefersReducedMotion.current) return

    const scrollDelta = scrollDeltaRef.current
    scrollDeltaRef.current = 0

    stepPhysics(
      iconsRef.current,
      configRef.current,
      mousePosRef.current,
      scrollDelta,
    )
    render()
    animFrameRef.current = requestAnimationFrame(loop)
  }, [render])

  useEffect(() => {
    const handleResize = () => {
      const canvas = canvasRef.current
      if (!canvas) return
      const dpr = window.devicePixelRatio || 1
      canvas.width = window.innerWidth * dpr
      canvas.height = window.innerHeight * dpr
      canvas.style.width = `${window.innerWidth}px`
      canvas.style.height = `${window.innerHeight}px`
      const ctx = canvas.getContext('2d')
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0) // Use setTransform to avoid cumulative scaling on resize
      configRef.current.width = window.innerWidth
      configRef.current.height = window.innerHeight
    }

    const handleScroll = () => {
      const delta = window.scrollY - lastScrollY.current
      scrollDeltaRef.current += delta
      lastScrollY.current = window.scrollY
    }

    const handleMouseMove = (e: MouseEvent) => {
      mousePosRef.current = { x: e.clientX, y: e.clientY }
    }

    const handleMouseLeave = () => {
      mousePosRef.current = null
    }

    handleResize()
    initIcons()

    window.addEventListener('resize', handleResize)
    window.addEventListener('scroll', handleScroll, { passive: true })
    window.addEventListener('mousemove', handleMouseMove, { passive: true })
    document.addEventListener('mouseleave', handleMouseLeave)

    if (!prefersReducedMotion.current) {
      animFrameRef.current = requestAnimationFrame(loop)
    } else {
      // Static render for reduced motion
      render()
    }

    return () => {
      cancelAnimationFrame(animFrameRef.current)
      window.removeEventListener('resize', handleResize)
      window.removeEventListener('scroll', handleScroll)
      window.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseleave', handleMouseLeave)
    }
  }, [initIcons, loop, render])

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 z-0 pointer-events-none"
      aria-hidden="true"
    />
  )
}
```

- [ ] **Step 2: Verify lint + types + build**

```bash
cd packages/ui && npx eslint . && npx tsc --noEmit && npx vite build
```

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/lib/components/PhysicsCanvas.tsx
git commit -m "feat(ui): add PhysicsCanvas component with collision physics"
```

---

## Task 5: Home Page Reskin

**Files:**
- Modify: `packages/ui/src/lib/pages/Home.tsx`
- Create: `packages/ui/src/lib/components/CountUpNumber.tsx`

- [ ] **Step 1: Create CountUpNumber component**

Create `packages/ui/src/lib/components/CountUpNumber.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'

interface CountUpNumberProps {
  end: number
  duration?: number
  className?: string
}

export default function CountUpNumber({ end, duration = 2000, className }: CountUpNumberProps) {
  const [count, setCount] = useState(0)
  const ref = useRef<HTMLSpanElement>(null)
  const hasTriggered = useRef(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !hasTriggered.current) {
          hasTriggered.current = true
          const start = performance.now()
          const animate = (now: number) => {
            const elapsed = now - start
            const progress = Math.min(elapsed / duration, 1)
            // Ease out cubic
            const eased = 1 - Math.pow(1 - progress, 3)
            setCount(Math.round(eased * end))
            if (progress < 1) requestAnimationFrame(animate)
          }
          requestAnimationFrame(animate)
          observer.disconnect()
        }
      },
      { threshold: 0 },
    )

    observer.observe(el)
    return () => observer.disconnect()
  }, [end, duration])

  return (
    <span ref={ref} className={className}>
      {count.toLocaleString()}
    </span>
  )
}
```

- [ ] **Step 2: Rewrite Home.tsx**

Rewrite `packages/ui/src/lib/pages/Home.tsx` with the new design system. Remove the old inline floating icon animation code (it's replaced by PhysicsCanvas). Apply glass cards, gradient text, glow effects. Keep all data flow and functionality identical.

The Home page should:
- Import and render `<PhysicsCanvas />` — it renders as a fixed canvas behind everything
- Use `glass-card` class for feature cards and network cards
- Use `text-gradient-brand` for the hero heading
- Use `CountUpNumber` for the metrics
- Use `btn-primary` for the CTA
- Navigate to `/studio` instead of `/wizard`
- Use `font-heading` for headings, `font-body` for text
- Keep the testnet toggle, network card click behavior, and all data fetching unchanged

Key structural changes from the current 623-line Home.tsx:
- DELETE all `FloatingToken`-related code (the `useEffect` with `requestAnimationFrame`, `floatingTokens` state, the `<div className="floating-icons">` rendering). PhysicsCanvas handles this now.
- KEEP: metrics display, feature cards, integration examples, network distribution grid, attribution, testnet toggle
- RESTYLE: every card, heading, button, and text element to use the design system tokens

- [ ] **Step 3: Verify lint + types + build**

```bash
cd packages/ui && npx eslint . && npx tsc --noEmit && npx vite build
```

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/lib/pages/Home.tsx packages/ui/src/lib/components/CountUpNumber.tsx
git commit -m "feat(ui): reskin Home page with design system, physics canvas, count-up"
```

---

## Task 6: StudioContext

**Files:**
- Create: `packages/ui/src/lib/contexts/StudioContext.tsx`
- Modify: `packages/ui/src/App.tsx` (add StudioProvider inside MetricsProvider)

- [ ] **Step 1: Create StudioContext**

Create `packages/ui/src/lib/contexts/StudioContext.tsx`:

```tsx
import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import type { Token, StudioAppearance, BadgeConfig, CodeFormat, CodeMode } from '../types'

interface StudioState {
  selectedToken: Token | null
  selectedChainId: string | null
  appearance: StudioAppearance
  badge: BadgeConfig
  codeFormat: CodeFormat
  codeMode: CodeMode
  resolutionOrder: string[] | null
  activeTab: 'browse' | 'configure'
}

interface StudioContextValue extends StudioState {
  selectToken: (token: Token) => void
  selectChain: (chainId: string) => void
  updateAppearance: (updates: Partial<StudioAppearance>) => void
  updateBadge: (updates: Partial<BadgeConfig>) => void
  setCodeFormat: (format: CodeFormat) => void
  setCodeMode: (mode: CodeMode) => void
  setResolutionOrder: (order: string[] | null) => void
  setActiveTab: (tab: 'browse' | 'configure') => void
  reset: () => void
}

const DEFAULT_APPEARANCE: StudioAppearance = {
  width: 64,
  height: 64,
  shape: 'circle',
  borderRadius: 8,
  shadow: 'none',
  backgroundColor: 'transparent',
}

const DEFAULT_BADGE: BadgeConfig = {
  enabled: false,
  angleDeg: 135,
  sizeRatio: 0.3,
  overlap: 0,
  ringEnabled: true,
  ringColor: '#09090b',
  ringThickness: 2,
}

const StudioCtx = createContext<StudioContextValue | null>(null)

export function StudioProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<StudioState>({
    selectedToken: null,
    selectedChainId: null,
    appearance: { ...DEFAULT_APPEARANCE },
    badge: { ...DEFAULT_BADGE },
    codeFormat: 'react',
    codeMode: 'snippet',
    resolutionOrder: null,
    activeTab: 'browse',
  })

  // Cross-page chain pre-selection
  useEffect(() => {
    const storedChainId = localStorage.getItem('selectedChainId')
    if (storedChainId) {
      setState((s) => ({ ...s, selectedChainId: storedChainId }))
      localStorage.removeItem('selectedChainId')
    }
  }, [])

  const selectToken = useCallback((token: Token) => {
    setState((s) => ({
      ...s,
      selectedToken: token,
      selectedChainId: String(token.chainId),
      activeTab: 'configure',
    }))
  }, [])

  const selectChain = useCallback((chainId: string) => {
    setState((s) => ({ ...s, selectedChainId: chainId }))
  }, [])

  const updateAppearance = useCallback((updates: Partial<StudioAppearance>) => {
    setState((s) => ({ ...s, appearance: { ...s.appearance, ...updates } }))
  }, [])

  const updateBadge = useCallback((updates: Partial<BadgeConfig>) => {
    setState((s) => ({ ...s, badge: { ...s.badge, ...updates } }))
  }, [])

  const setCodeFormat = useCallback((codeFormat: CodeFormat) => {
    setState((s) => ({ ...s, codeFormat }))
  }, [])

  const setCodeMode = useCallback((codeMode: CodeMode) => {
    setState((s) => ({ ...s, codeMode }))
  }, [])

  const setResolutionOrder = useCallback((resolutionOrder: string[] | null) => {
    setState((s) => ({ ...s, resolutionOrder }))
  }, [])

  const setActiveTab = useCallback((activeTab: 'browse' | 'configure') => {
    setState((s) => ({ ...s, activeTab }))
  }, [])

  const reset = useCallback(() => {
    setState((s) => ({
      ...s,
      appearance: { ...DEFAULT_APPEARANCE },
      badge: { ...DEFAULT_BADGE },
      codeFormat: 'react',
      codeMode: 'snippet',
      resolutionOrder: null,
    }))
  }, [])

  return (
    <StudioCtx.Provider value={{
      ...state,
      selectToken,
      selectChain,
      updateAppearance,
      updateBadge,
      setCodeFormat,
      setCodeMode,
      setResolutionOrder,
      setActiveTab,
      reset,
    }}>
      {children}
    </StudioCtx.Provider>
  )
}

export function useStudio(): StudioContextValue {
  const ctx = useContext(StudioCtx)
  if (!ctx) throw new Error('useStudio must be used within StudioProvider')
  return ctx
}
```

- [ ] **Step 2: Add StudioProvider to App.tsx**

Wrap the `<HashRouter>` in `<StudioProvider>` (inside MetricsProvider, since Studio needs metrics):

```tsx
import { StudioProvider } from './lib/contexts/StudioContext'

// In the JSX, wrap HashRouter:
<MetricsProvider>
  <StudioProvider>
    <HashRouter>
      ...
    </HashRouter>
  </StudioProvider>
</MetricsProvider>
```

- [ ] **Step 3: Verify lint + types + build**

```bash
cd packages/ui && npx eslint . && npx tsc --noEmit && npx vite build
```

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/lib/contexts/StudioContext.tsx packages/ui/src/App.tsx
git commit -m "feat(ui): add StudioContext with appearance, badge, and code state"
```

---

## Task 7: useImageMetadata Hook

**Files:**
- Create: `packages/ui/src/lib/hooks/useImageMetadata.ts`

- [ ] **Step 1: Create the hook**

Create `packages/ui/src/lib/hooks/useImageMetadata.ts`:

```typescript
import { useState, useEffect } from 'react'
import type { ImageMetadata } from '../types'

const cache = new Map<string, ImageMetadata>()
const pending = new Map<string, Promise<ImageMetadata>>()

async function fetchMetadata(url: string): Promise<ImageMetadata> {
  const cached = cache.get(url)
  if (cached) return cached

  const inflight = pending.get(url)
  if (inflight) return inflight

  const promise = (async () => {
    let format = 'unknown'
    let fileSize: number | null = null
    let contentType = 'unknown'

    try {
      const res = await fetch(url, { method: 'HEAD' })
      contentType = res.headers.get('content-type') ?? 'unknown'
      const cl = res.headers.get('content-length')
      fileSize = cl ? parseInt(cl, 10) : null

      if (contentType.includes('svg')) format = 'SVG'
      else if (contentType.includes('png')) format = 'PNG'
      else if (contentType.includes('webp')) format = 'WEBP'
      else if (contentType.includes('jpeg') || contentType.includes('jpg')) format = 'JPEG'
      else if (contentType.includes('gif')) format = 'GIF'
    } catch {
      // HEAD failed, fall back to image decode for dimensions
    }

    let width: number | null = null
    let height: number | null = null

    if (format !== 'SVG') {
      try {
        const img = new Image()
        img.crossOrigin = 'anonymous'
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve()
          img.onerror = () => reject(new Error('Image load failed'))
          img.src = url
        })
        width = img.naturalWidth
        height = img.naturalHeight
      } catch {
        // Image decode failed
      }
    }

    const metadata: ImageMetadata = { format, width, height, fileSize, contentType }
    cache.set(url, metadata)
    pending.delete(url)
    return metadata
  })()

  pending.set(url, promise)
  return promise
}

export function useImageMetadata(url: string | null): {
  metadata: ImageMetadata | null
  isLoading: boolean
} {
  const [metadata, setMetadata] = useState<ImageMetadata | null>(
    url ? cache.get(url) ?? null : null,
  )
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (!url) {
      setMetadata(null)
      return
    }

    const cached = cache.get(url)
    if (cached) {
      setMetadata(cached)
      return
    }

    setIsLoading(true)
    fetchMetadata(url).then((m) => {
      setMetadata(m)
      setIsLoading(false)
    }).catch(() => {
      setIsLoading(false)
    })
  }, [url])

  return { metadata, isLoading }
}
```

- [ ] **Step 2: Verify lint + types + build**

```bash
cd packages/ui && npx eslint . && npx tsc --noEmit && npx vite build
```

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/lib/hooks/useImageMetadata.ts
git commit -m "feat(ui): add useImageMetadata hook with HEAD fetch and caching"
```

---

## Task 8: StudioBrowser Component

**Files:**
- Create: `packages/ui/src/lib/components/StudioBrowser.tsx`
- Modify: `packages/ui/src/lib/components/TokenSearch.tsx` (restyle)
- Modify: `packages/ui/src/lib/components/TokenListFilter.tsx` (restyle)
- Modify: `packages/ui/src/lib/components/NetworkSelect.tsx` (restyle)
- Modify: `packages/ui/src/lib/components/PaginationControls.tsx` (restyle)

- [ ] **Step 1: Restyle child components**

Update `TokenSearch.tsx`, `TokenListFilter.tsx`, `NetworkSelect.tsx`, and `PaginationControls.tsx` to use the new design system classes. Replace hardcoded colors with design tokens (`bg-surface-1`, `border-border-dark`, `text-accent-500`, etc.). Replace old button classes with `btn-primary`, `btn-secondary`, `btn-ghost`.

This is a styling pass — no behavioral changes. Each component keeps its existing props interface and behavior.

- [ ] **Step 2: Create StudioBrowser component**

Create `packages/ui/src/lib/components/StudioBrowser.tsx`. This is the left panel of the Studio page. It composes:
- `NetworkSelect` (chain selector)
- `TokenSearch` (search bar + global search)
- `TokenListFilter` (list checkbox popover)
- Token list (rows with icon, name, symbol, address, metadata)
- `PaginationControls`

It uses `useStudio()` context for `selectToken`, `selectChain`, `selectedChainId`, `selectedToken`.
It uses `useTokenBrowser()` for list state.
It uses `useImageMetadata()` for inline metadata when metadata toggle is on.

Key features:
- Token rows are clickable → calls `selectToken(token)` from context
- Each row has an ℹ button that sets a local `inspectToken` state (which triggers `TokenDetailModal` — built in Task 9)
- Selected token row has `glow-card` styling
- Metadata toggle in the filter bar shows/hides format + dimensions
- Search, filter, pagination all reuse existing component behavior

```tsx
import { useState, useMemo } from 'react'
import { useStudio } from '../contexts/StudioContext'
import { useTokenBrowser } from '../hooks/useTokenBrowser'
import { useSettings } from '../contexts/SettingsContext'
import { useMetricsContext } from '../contexts/MetricsContext'
import { getApiUrl } from '../utils'
import NetworkSelect from './NetworkSelect'
import TokenSearch from './TokenSearch'
import PaginationControls from './PaginationControls'
import type { Token, SearchUpdate } from '../types'

interface StudioBrowserProps {
  onInspectToken: (token: Token) => void
}

export default function StudioBrowser({ onInspectToken }: StudioBrowserProps) {
  const { selectToken, selectChain, selectedChainId, selectedToken } = useStudio()
  const { showTestnets } = useSettings()
  const { metrics } = useMetricsContext()
  const { enabledLists, tokensByList, toggleList, toggleAll, setListTokens, clearTokens } = useTokenBrowser()

  const [showMetadata, setShowMetadata] = useState(false)
  const [searchState, setSearchState] = useState<SearchUpdate>({
    query: '', isSearching: false, isGlobalSearching: false, isError: false, tokens: [],
  })
  const [currentPage, setCurrentPage] = useState(1)
  const [tokensPerPage, setTokensPerPage] = useState(25)

  // Combine tokens from enabled lists
  const allTokens = useMemo(() => {
    if (searchState.isGlobalSearching || searchState.tokens.length > 0) {
      return searchState.tokens
    }
    const seen = new Set<string>()
    const tokens: Token[] = []
    for (const [listKey, listTokens] of tokensByList) {
      if (!enabledLists.has(listKey)) continue
      for (const t of listTokens) {
        const key = `${t.chainId}-${t.address?.toLowerCase()}`
        if (seen.has(key)) continue
        seen.add(key)
        tokens.push(t)
      }
    }
    return tokens
  }, [tokensByList, enabledLists, searchState])

  // Filter by search query (local)
  const filteredTokens = useMemo(() => {
    if (!searchState.query) return allTokens
    const q = searchState.query.toLowerCase()
    return allTokens.filter((t) =>
      t.name?.toLowerCase().includes(q) ||
      t.symbol?.toLowerCase().includes(q) ||
      t.address?.toLowerCase().includes(q),
    )
  }, [allTokens, searchState.query])

  // Paginate
  const paginatedTokens = useMemo(() => {
    const start = (currentPage - 1) * tokensPerPage
    return filteredTokens.slice(start, start + tokensPerPage)
  }, [filteredTokens, currentPage, tokensPerPage])

  const networkName = selectedChainId
    ? metrics?.networks.supported.find((n) => String(n.chainId) === selectedChainId)?.name ?? `Chain ${selectedChainId}`
    : ''

  return (
    <div className="flex flex-col h-full border-r border-border-light dark:border-border-dark">
      {/* Search + Filters */}
      <div className="p-3 border-b border-border-light dark:border-border-dark space-y-2">
        <TokenSearch
          onsearchupdate={setSearchState}
          count={filteredTokens.length}
          networkName={networkName}
          selectedChain={selectedChainId ?? ''}
          onupdateopen={() => {}}
          ontogglelist={toggleList}
          ontoggleall={toggleAll}
        />
        <div className="flex gap-2">
          <NetworkSelect
            isOpenToStart={false}
            network={selectedChainId ?? ''}
            showTestnets={showTestnets}
            onselect={(chainId: string) => {
              selectChain(chainId)
              setCurrentPage(1)
              clearTokens()
            }}
            onnetworkname={() => {}}
          />
          <button
            onClick={() => setShowMetadata((v) => !v)}
            className={`px-2 py-1 rounded-lg text-xs transition-colors ${
              showMetadata
                ? 'bg-accent-500/10 text-accent-500'
                : 'bg-white/5 text-gray-400 dark:text-gray-500'
            }`}
          >
            Metadata
          </button>
        </div>
      </div>

      {/* Token List */}
      <div className="flex-1 overflow-y-auto p-1">
        {paginatedTokens.map((token) => {
          const isSelected = selectedToken?.address === token.address &&
            String(selectedToken?.chainId) === String(token.chainId)
          return (
            <div
              key={`${token.chainId}-${token.address}`}
              onClick={() => selectToken(token)}
              className={`flex items-center gap-2.5 px-2.5 py-2 rounded-xl cursor-pointer mb-0.5 transition-all ${
                isSelected
                  ? 'bg-accent-500/[0.08] border border-accent-500/20'
                  : 'border border-transparent hover:bg-white/5'
              }`}
            >
              <img
                src={getApiUrl(`/image/${token.chainId}/${token.address}`)}
                alt={token.name}
                className="w-9 h-9 rounded-full flex-shrink-0 bg-surface-2"
                loading="lazy"
              />
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm truncate">{token.name}</div>
                <div className="text-xs text-gray-500 truncate">
                  {token.symbol} · {token.address?.slice(0, 6)}...{token.address?.slice(-4)}
                </div>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onInspectToken(token)
                }}
                className="w-5 h-5 rounded flex items-center justify-center text-[10px] text-gray-400 hover:text-accent-500 hover:bg-accent-500/10 transition-colors"
                title="Token details"
              >
                ℹ
              </button>
            </div>
          )
        })}
        <div className="text-center py-3 text-xs text-gray-500">
          {filteredTokens.length > 0
            ? `Showing ${paginatedTokens.length} of ${filteredTokens.length.toLocaleString()} tokens`
            : 'No tokens found'}
        </div>
      </div>

      {/* Pagination */}
      <div className="border-t border-border-light dark:border-border-dark">
        <PaginationControls
          currentPage={currentPage}
          totalItems={filteredTokens.length}
          tokensPerPage={tokensPerPage}
          onPageChange={setCurrentPage}
        />
      </div>
    </div>
  )
}
```

**Note:** The `TokenSearch` and `NetworkSelect` props interfaces will need adjustments to match their current signatures. Read the existing components before wiring up. The code above shows the pattern — exact props may need tweaking to match what those components actually expect.

- [ ] **Step 3: Verify lint + types + build**

```bash
cd packages/ui && npx eslint . && npx tsc --noEmit && npx vite build
```

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/lib/components/StudioBrowser.tsx packages/ui/src/lib/components/TokenSearch.tsx packages/ui/src/lib/components/TokenListFilter.tsx packages/ui/src/lib/components/NetworkSelect.tsx packages/ui/src/lib/components/PaginationControls.tsx
git commit -m "feat(ui): add StudioBrowser with restyled child components"
```

---

## Task 9: TokenDetailModal

**Files:**
- Create: `packages/ui/src/lib/components/TokenDetailModal.tsx`

- [ ] **Step 1: Create TokenDetailModal component**

Create `packages/ui/src/lib/components/TokenDetailModal.tsx` using Headless UI's `Dialog` component. Shows:
- Token hero (icon + name + symbol + chain)
- Image metadata grid (format, dimensions, file size) via `useImageMetadata`
- SVG badge if applicable
- List presence (which provider lists include this token)
- API endpoint URLs
- "Configure in Studio" and "Copy URL" actions

Use the existing `Dialog` and `DialogPanel` from `@headlessui/react` (already a dependency).

The component receives `token: Token | null` and `onClose: () => void` as props. When `token` is non-null, the modal is open. It calls `useStudio().selectToken(token)` when "Configure" is clicked.

- [ ] **Step 2: Verify lint + types + build**

```bash
cd packages/ui && npx eslint . && npx tsc --noEmit && npx vite build
```

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/lib/components/TokenDetailModal.tsx
git commit -m "feat(ui): add TokenDetailModal with metadata and list presence"
```

---

## Task 10: RadialPositionPicker + BadgeConfigurator

**Files:**
- Create: `packages/ui/src/lib/components/RadialPositionPicker.tsx`
- Create: `packages/ui/src/lib/components/BadgeConfigurator.tsx`

- [ ] **Step 1: Create RadialPositionPicker**

Create `packages/ui/src/lib/components/RadialPositionPicker.tsx`. This is a circular drag control:
- Renders a circle (e.g., 120px diameter) representing the token perimeter
- A small dot/handle on the circumference represents the badge position
- User drags the handle around the circle to set the angle (0-360°)
- Also accepts keyboard input (type degrees into a number input)
- Props: `angleDeg: number`, `onChange: (angleDeg: number) => void`

Implementation:
- Use `onMouseDown` → `onMouseMove` → `onMouseUp` pattern (or `onPointerDown` for touch)
- Calculate angle from center of circle to mouse position: `Math.atan2(dy, dx)` converted to degrees
- Map to 0-360 where 0° = top center (so offset by -90°)

- [ ] **Step 2: Create BadgeConfigurator**

Create `packages/ui/src/lib/components/BadgeConfigurator.tsx`. Contains:
- Toggle switch (enable/disable badge)
- `RadialPositionPicker` for angle
- Size slider (15% to 60%)
- Overlap slider (-50% to +50%)
- Ring toggle + ring color picker + ring thickness slider

Uses `useStudio().updateBadge()` to persist all changes.

All controls disabled when badge is toggled off (but values preserved).

- [ ] **Step 3: Verify lint + types + build**

```bash
cd packages/ui && npx eslint . && npx tsc --noEmit && npx vite build
```

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/lib/components/RadialPositionPicker.tsx packages/ui/src/lib/components/BadgeConfigurator.tsx
git commit -m "feat(ui): add BadgeConfigurator with 360° radial position picker"
```

---

## Task 11: CodeOutput Component

**Files:**
- Create: `packages/ui/src/lib/components/CodeOutput.tsx`

- [ ] **Step 1: Create CodeOutput component**

Create `packages/ui/src/lib/components/CodeOutput.tsx`. This component:
- Reads all state from `useStudio()` (appearance, badge, codeFormat, codeMode, selectedToken, resolutionOrder)
- Generates code string based on current configuration:
  - **React snippet**: JSX with inline styles
  - **React component**: Full `GibToken.tsx` file content
  - **HTML**: `<div>` wrapper with CSS + `<img>` tags
  - **img**: Single `<img>` tag (with badge warning if badge enabled)
- Renders format tabs (React | HTML | img) and mode toggle (snippet | component)
- Displays code with Shiki syntax highlighting via the existing `CodeBlock` component
- "Copy Code" button (primary) and "Copy URL" button (secondary)

Code generation logic:
- Badge position: Convert polar (angleDeg, overlap) to CSS absolute positioning. The badge sits on a circle around the token image. `angleDeg` determines the angle (0°=top, 90°=right), `overlap` determines radial offset from the edge.
  ```
  const rad = (angleDeg - 90) * (Math.PI / 180)
  const containerSize = width  // token image size
  const badgeSize = containerSize * sizeRatio
  const radius = (containerSize / 2) + (badgeSize / 2) * (1 - overlap * 2)
  const cx = containerSize / 2 + Math.cos(rad) * radius - badgeSize / 2
  const cy = containerSize / 2 + Math.sin(rad) * radius - badgeSize / 2
  ```
- Shape: `borderRadius` based on `shape` ('circle' → '50%', 'rounded' → `${borderRadius}px`, 'square' → '0')
- Shadow: Map 'none'/'subtle'/'medium'/'strong' to CSS box-shadow values
- URL: Use `/image/{chainId}/{address}` by default, or `/image/fallback/{order}/{chainId}/{address}` if custom resolution order is set

- [ ] **Step 2: Verify lint + types + build**

```bash
cd packages/ui && npx eslint . && npx tsc --noEmit && npx vite build
```

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/lib/components/CodeOutput.tsx
git commit -m "feat(ui): add CodeOutput with React/HTML/img generation and Shiki"
```

---

## Task 12: ListResolutionOrder Component

**Files:**
- Create: `packages/ui/src/lib/components/ListResolutionOrder.tsx`

- [ ] **Step 1: Create ListResolutionOrder component**

Create `packages/ui/src/lib/components/ListResolutionOrder.tsx`. This is a collapsible section with:
- Disclosure toggle (Headless UI `Disclosure`)
- List of provider names as draggable items
- HTML5 drag-and-drop (native, no library needed) to reorder
- Keyboard alternative: arrow keys to move selected item up/down
- "Reset to default" button
- Uses `useStudio().setResolutionOrder()` to persist

The provider list comes from `useMetricsContext()` — the available lists are in the metrics data. Default order matches the server's built-in priority (which is the order they appear in the metrics response).

Drag implementation:
- Each item has `draggable={true}`
- `onDragStart` sets the dragged index
- `onDragOver` + `onDrop` swap items
- Visual feedback: dragged item has lower opacity, drop target has accent border

- [ ] **Step 2: Verify lint + types + build**

```bash
cd packages/ui && npx eslint . && npx tsc --noEmit && npx vite build
```

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/lib/components/ListResolutionOrder.tsx
git commit -m "feat(ui): add ListResolutionOrder with drag-and-drop reordering"
```

---

## Task 13: StudioConfigurator Component

**Files:**
- Create: `packages/ui/src/lib/components/StudioConfigurator.tsx`

- [ ] **Step 1: Create StudioConfigurator component**

Create `packages/ui/src/lib/components/StudioConfigurator.tsx`. This is the right panel of Studio, assembling:

1. **Empty state** (when no token selected): Placeholder with "Select a token to start configuring"
2. **Preview area**: Main preview (token image with all config applied), mini context previews (avatar, card, list item)
3. **Appearance controls**: Size (W×H inputs), shape picker, shadow selector, background swatches + picker
4. **Badge section**: `BadgeConfigurator` component
5. **SVG options** (conditional): Render mode toggle, color override — only shown when selected token's image is SVG format
6. **List resolution**: `ListResolutionOrder` component
7. **Code output**: `CodeOutput` component

All controls read/write via `useStudio()` context.

The preview renders the actual token image from the API with CSS matching the configured appearance. The network badge (when enabled) is positioned using the polar→CSS conversion from the badge config.

- [ ] **Step 2: Verify lint + types + build**

```bash
cd packages/ui && npx eslint . && npx tsc --noEmit && npx vite build
```

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/lib/components/StudioConfigurator.tsx
git commit -m "feat(ui): add StudioConfigurator with preview, controls, and code output"
```

---

## Task 14: Studio Page Assembly

**Files:**
- Modify: `packages/ui/src/lib/pages/Studio.tsx` (replace placeholder)

- [ ] **Step 1: Wire up Studio page**

Replace the placeholder in `packages/ui/src/lib/pages/Studio.tsx` with the split-panel layout:

```tsx
import { useState } from 'react'
import StudioBrowser from '../components/StudioBrowser'
import StudioConfigurator from '../components/StudioConfigurator'
import TokenDetailModal from '../components/TokenDetailModal'
import { useStudio } from '../contexts/StudioContext'
import type { Token } from '../types'

export default function Studio() {
  const { activeTab, setActiveTab } = useStudio()
  const [inspectToken, setInspectToken] = useState<Token | null>(null)

  return (
    <div className="h-[calc(100vh-57px)]">
      {/* Desktop: split panel */}
      <div className="hidden lg:grid lg:grid-cols-[380px_1fr] h-full">
        <StudioBrowser onInspectToken={setInspectToken} />
        <StudioConfigurator />
      </div>

      {/* Mobile: tabbed */}
      <div className="lg:hidden h-full flex flex-col">
        <div className="flex border-b border-border-light dark:border-border-dark">
          <button
            onClick={() => setActiveTab('browse')}
            className={`flex-1 py-3 text-sm font-medium transition-colors ${
              activeTab === 'browse'
                ? 'text-accent-500 border-b-2 border-accent-500'
                : 'text-gray-500'
            }`}
          >
            Browse
          </button>
          <button
            onClick={() => setActiveTab('configure')}
            className={`flex-1 py-3 text-sm font-medium transition-colors ${
              activeTab === 'configure'
                ? 'text-accent-500 border-b-2 border-accent-500'
                : 'text-gray-500'
            }`}
          >
            Configure
          </button>
        </div>
        <div className="flex-1 overflow-hidden">
          {activeTab === 'browse' ? (
            <StudioBrowser onInspectToken={setInspectToken} />
          ) : (
            <StudioConfigurator />
          )}
        </div>
      </div>

      {/* Token Detail Modal */}
      <TokenDetailModal
        token={inspectToken}
        onClose={() => setInspectToken(null)}
      />
    </div>
  )
}
```

- [ ] **Step 2: Verify lint + types + build**

```bash
cd packages/ui && npx eslint . && npx tsc --noEmit && npx vite build
```

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/lib/pages/Studio.tsx
git commit -m "feat(ui): wire Studio page with split-panel browser + configurator"
```

---

## Task 15: Docs Page Refresh

**Files:**
- Modify: `packages/ui/src/lib/pages/Docs.tsx`
- Create: `packages/ui/src/lib/components/DocsSidebar.tsx`
- Create: `packages/ui/src/lib/components/EndpointCard.tsx`
- Create: `packages/ui/src/lib/components/FrameworkSwitcher.tsx`

- [ ] **Step 1: Create DocsSidebar**

Create `packages/ui/src/lib/components/DocsSidebar.tsx`. Sticky left sidebar (240px) with anchor links. Uses `IntersectionObserver` to highlight the current section as user scrolls. Mobile: collapses to a dropdown.

- [ ] **Step 2: Create EndpointCard**

Create `packages/ui/src/lib/components/EndpointCard.tsx`. Glass card showing:
- Method badge (`GET` in accent pill)
- Path with parameter highlighting
- Description text
- Expandable "Example" section (Headless UI `Disclosure`) showing a live URL + rendered preview

- [ ] **Step 3: Create FrameworkSwitcher**

Create `packages/ui/src/lib/components/FrameworkSwitcher.tsx`. Tab bar (HTML, JavaScript, React, cURL) that controls which code example variant is shown. Uses the existing `CodeBlock` component for rendering.

- [ ] **Step 4: Rewrite Docs.tsx**

Rewrite `packages/ui/src/lib/pages/Docs.tsx` to use the new components:
- `DocsSidebar` on the left (sticky, 240px)
- Main content on the right with sections for Token Endpoints, Image Endpoints, Features, Code Examples
- Each endpoint uses `EndpointCard`
- Code examples use `FrameworkSwitcher` + `CodeBlock`
- Quick filter bar at the top
- Same endpoint data as current — no new endpoints
- Mobile: sidebar collapses to dropdown menu

- [ ] **Step 5: Verify lint + types + build**

```bash
cd packages/ui && npx eslint . && npx tsc --noEmit && npx vite build
```

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/lib/pages/Docs.tsx packages/ui/src/lib/components/DocsSidebar.tsx packages/ui/src/lib/components/EndpointCard.tsx packages/ui/src/lib/components/FrameworkSwitcher.tsx
git commit -m "feat(ui): refresh Docs page with sidebar nav, endpoint cards, framework switcher"
```

---

## Task 16: Reskin Remaining Components

**Files:**
- Modify: `packages/ui/src/lib/components/Attribution.tsx`
- Modify: `packages/ui/src/lib/components/ThemeToggle.tsx`
- Modify: `packages/ui/src/lib/components/ErrorMessage.tsx`
- Modify: `packages/ui/src/lib/components/CodeBlock.tsx`

- [ ] **Step 1: Update Attribution**

Update `packages/ui/src/lib/components/Attribution.tsx` to use glass card styling. Wrap the provider logo grid in a `glass-card` container. Update text colors to use design system tokens.

- [ ] **Step 2: Update ThemeToggle**

Update `packages/ui/src/lib/components/ThemeToggle.tsx` to use the new button styling. Keep the sun/moon icon behavior and hover messages.

- [ ] **Step 3: Update ErrorMessage**

Update `packages/ui/src/lib/components/ErrorMessage.tsx` to use `elevated-card` styling with red accent instead of green. Keep the GitHub issue link generation.

- [ ] **Step 4: Update CodeBlock**

Update `packages/ui/src/lib/components/CodeBlock.tsx` to use `font-mono` and design system surface colors for the code container. Keep Shiki integration unchanged.

- [ ] **Step 5: Verify lint + types + build**

```bash
cd packages/ui && npx eslint . && npx tsc --noEmit && npx vite build
```

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/lib/components/Attribution.tsx packages/ui/src/lib/components/ThemeToggle.tsx packages/ui/src/lib/components/ErrorMessage.tsx packages/ui/src/lib/components/CodeBlock.tsx
git commit -m "feat(ui): reskin Attribution, ThemeToggle, ErrorMessage, CodeBlock"
```

---

## Task 17: Cleanup Deprecated Components

**Files:**
- Delete: `packages/ui/src/lib/pages/Wizard.tsx`
- Delete: `packages/ui/src/lib/components/ApiTypeSelector.tsx`
- Delete: `packages/ui/src/lib/components/TokenAddressInput.tsx`
- Delete: `packages/ui/src/lib/components/TokenBrowser.tsx`
- Delete: `packages/ui/src/lib/components/TokenListSelector.tsx`
- Delete: `packages/ui/src/lib/components/TokenPreview.tsx`
- Delete: `packages/ui/src/lib/components/UrlDisplay.tsx`

- [ ] **Step 1: Delete deprecated files**

Remove all files listed above. These are replaced by the Studio components.

- [ ] **Step 2: Verify no remaining imports**

Search for any remaining imports of deleted components:

```bash
cd packages/ui && grep -r "ApiTypeSelector\|TokenAddressInput\|TokenBrowser\|TokenListSelector\|TokenPreview\|UrlDisplay\|Wizard" src/ --include="*.tsx" --include="*.ts"
```

Fix any remaining references.

- [ ] **Step 3: Verify lint + types + build**

```bash
cd packages/ui && npx eslint . && npx tsc --noEmit && npx vite build
```

- [ ] **Step 4: Commit**

```bash
git add -u packages/ui/src/
git commit -m "chore(ui): remove deprecated Wizard components replaced by Studio"
```

---

## Task 18: Final Integration + Polish

- [ ] **Step 1: Full build verification**

```bash
cd packages/ui && npx eslint . && npx tsc --noEmit && npx vite build
```

- [ ] **Step 2: Dev server smoke test**

```bash
cd packages/ui && npx vite --port 5173
```

Open `http://localhost:5173` and verify:
- Home page renders with physics canvas, glass cards, gradient text, count-up numbers
- Floating icons bounce off each other, respond to scroll and mouse
- "Open Studio" button navigates to `#/studio`
- Studio split panel renders: browser left, configurator right
- Selecting a token loads it into the configurator
- All appearance controls (size, shape, shadow, background) update the preview live
- Badge configurator: enable badge, drag position around 360°, adjust size/overlap/ring
- Code output updates live with React/HTML/img tabs
- `#/wizard` redirects to `#/studio`
- Docs page has sidebar navigation, endpoint cards, framework switcher
- Dark/light mode toggle works throughout
- Mobile layout: stacked panels with tab switching

- [ ] **Step 3: Commit any polish fixes**

```bash
git add -u packages/ui/src/
git commit -m "fix(ui): polish integration issues from smoke test"
```

- [ ] **Step 4: Update progress.txt**

Update `progress.txt` with the completed visual refresh + Studio work.

---

## Critical Implementation Notes

These corrections override the inline code in the tasks above. Read these before starting.

### Note 1: NetworkSelect Refactoring (Task 8)

The existing `NetworkSelect` component accepts `NetworkInfo` objects, not chain ID strings. Before wiring it into `StudioBrowser`, refactor it:

- Change `onSelect` callback to emit `string` (chain ID) instead of `NetworkInfo`
- Accept `selectedChainId: string | null` prop instead of `network: NetworkInfo`
- Remove the internal `localStorage.selectedChainId` read (moved to `StudioContext` — see Note 3)
- The component already reads `showTestnets` from `SettingsContext` internally — do not pass it as a prop

Read the existing `NetworkSelect.tsx` before modifying. The current props interface is in camelCase (not lowercase). All props passed from `StudioBrowser` must match the actual interface.

### Note 2: TokenSearch Props (Task 8)

The existing `TokenSearch` component uses **camelCase** props, not lowercase. Correct mapping:
- `onSearchUpdate` (not `onsearchupdate`)
- `onToggleList` (not `ontogglelist`)
- `onToggleAll` (not `ontoggleall`)

Additionally, `TokenSearch` **already embeds `TokenListFilter` internally**. Do not render `TokenListFilter` separately in `StudioBrowser` — `TokenSearch` handles it. Pass the required props that `TokenSearch` needs:
- `enabledLists: Set<string>` — from `useTokenBrowser()`
- `tokensByList: Map<string, Token[]>` — from `useTokenBrowser()`
- `selectedChain: number | null` — convert `selectedChainId` string to number

Read the existing `TokenSearch.tsx` props interface before wiring.

### Note 3: localStorage.selectedChainId Ownership (Task 6)

`StudioContext` owns the cross-page `localStorage.selectedChainId` consumption. When refactoring `NetworkSelect` (Note 1), **remove** its internal `useEffect` that reads `localStorage.selectedChainId`. This prevents a race condition where both `StudioContext` and `NetworkSelect` try to consume the same key.

### Note 4: PaginationControls Props (Task 8)

Use `onPageChange` (camelCase), not `onpagechange`. Read the existing component's props interface.

### Note 5: Token List Fetching (Task 8)

The existing `Wizard.tsx` contains the logic for fetching token lists when a chain is selected (calling `GET /list/{providerKey}/{listKey}?chainId={chainId}` and populating `tokensByList` via `setListTokens`). This logic is being deleted in Task 17.

**Before deleting Wizard.tsx**, extract its list-fetching behavior into `StudioBrowser`. The key logic to port:
1. When `selectedChainId` changes, fetch available lists from metrics
2. For each enabled list, fetch tokens via `GET /list/{providerKey}/{listKey}?chainId={chainId}`
3. Call `setListTokens(listKey, tokens)` for each response
4. Handle loading states and errors

Alternatively, extract this into a `useTokenListFetch(chainId)` hook that `StudioBrowser` calls.

### Note 6: Physics Canvas Icon Pool (Task 4)

`PlatformMetrics` contains chain IDs but no token addresses. The `initIcons` function should:
1. Use network icons from `/image/{chainId}` (available from `metrics.networks.supported`)
2. For token icons, fetch a small sample from a single list: `GET /list/coingecko/coingecko-all?chainId=1` (or similar), take the first 30-40 addresses, and use `/image/{chainId}/{address}` URLs
3. If the list fetch fails, fall back to network icons only

This is an async initialization — the canvas can start rendering with network icons and add token icons as they load.

### Note 7: Badge Position Utility (Tasks 11 + 13)

The polar→CSS badge position formula is used in both `CodeOutput` (code generation) and `StudioConfigurator` (live preview). Extract it to a shared utility:

Create `packages/ui/src/lib/utils/badge-position.ts`:
```typescript
export function badgePositionToCSS(
  containerSize: number,
  angleDeg: number,
  sizeRatio: number,
  overlap: number,
): { top: number; left: number; badgeSize: number } {
  const rad = (angleDeg - 90) * (Math.PI / 180)
  const badgeSize = containerSize * sizeRatio
  const radius = (containerSize / 2) + (badgeSize / 2) * (1 - overlap * 2)
  const left = containerSize / 2 + Math.cos(rad) * radius - badgeSize / 2
  const top = containerSize / 2 + Math.sin(rad) * radius - badgeSize / 2
  return { top, left, badgeSize }
}
```

### Note 8: Token Detail Modal — List Presence (Task 9)

The `Token` type only has `sourceList: string` (single list). The modal's "list presence" section can only show the lists that the token was loaded from in the current session (from `tokensByList` Map). It cannot show all lists a token appears in globally — that would require a new API endpoint. Show what's available and note this limitation.

### Note 9: StudioContext reset() (Task 6)

The `reset()` function intentionally preserves `selectedToken` and `selectedChainId` — it resets the configuration, not the selection. Add a JSDoc comment to make this clear:
```typescript
/** Resets appearance and badge config to defaults. Preserves selected token/chain. */
const reset = useCallback(() => { ... }, [])
```
