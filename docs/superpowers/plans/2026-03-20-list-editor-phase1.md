# List Editor Phase 1: Sliding Layout + Editor Shell

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the Studio from a two-panel layout to a three-panel sliding layout with an editor shell that can be triggered from the token browser.

**Architecture:** The Studio wraps all three panels (editor, browser, canvas) in a single flex container. A `translateX` CSS transition slides the viewport between two views: browser+canvas (default) and editor+browser (edit mode). A `useListEditor` context manages the editor state and slide direction. The editor panel is an empty shell in this phase — subsequent phases fill it in.

**Tech Stack:** React 19, Tailwind CSS 4, CSS transitions

**Spec:** `docs/superpowers/specs/2026-03-20-list-editor-design.md` (Sub-Feature 2, Architecture section)

---

### Task 1: Create ListEditorContext

**Files:**
- Create: `packages/ui/src/lib/contexts/ListEditorContext.tsx`

- [ ] **Step 1: Create the context**

```typescript
import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'

interface ListEditorState {
  isOpen: boolean
  editingList: string | null // sourceList key like 'piteas/exchange', or 'local:uuid' for new lists
}

interface ListEditorContextValue extends ListEditorState {
  openEditor: (sourceList: string) => void
  closeEditor: () => void
}

const ListEditorCtx = createContext<ListEditorContextValue | null>(null)

export function ListEditorProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ListEditorState>({
    isOpen: false,
    editingList: null,
  })

  const openEditor = useCallback((sourceList: string) => {
    setState({ isOpen: true, editingList: sourceList })
  }, [])

  const closeEditor = useCallback(() => {
    setState({ isOpen: false, editingList: null })
  }, [])

  return (
    <ListEditorCtx.Provider value={{ ...state, openEditor, closeEditor }}>
      {children}
    </ListEditorCtx.Provider>
  )
}

export function useListEditor(): ListEditorContextValue {
  const ctx = useContext(ListEditorCtx)
  if (!ctx) throw new Error('useListEditor must be used within ListEditorProvider')
  return ctx
}
```

- [ ] **Step 2: Add provider to App.tsx**

In `packages/ui/src/App.tsx`, wrap the existing provider tree with `ListEditorProvider`. Import it and add it inside the `StudioProvider`:

```typescript
import { ListEditorProvider } from './lib/contexts/ListEditorContext'
```

Add the provider wrapping the router (inside StudioProvider, outside HashRouter or at the same level).

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit -p packages/ui/tsconfig.json
```

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/lib/contexts/ListEditorContext.tsx packages/ui/src/App.tsx
git commit -m "feat(ui): add ListEditorContext for editor state management"
```

---

### Task 2: Create empty ListEditor panel component

**Files:**
- Create: `packages/ui/src/lib/components/ListEditor.tsx`

- [ ] **Step 1: Create the shell component**

```typescript
import { useListEditor } from '../contexts/ListEditorContext'

export default function ListEditor() {
  const { editingList, closeEditor } = useListEditor()

  return (
    <div className="flex h-full flex-col bg-white dark:bg-surface-base">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border-light px-4 py-3 dark:border-border-dark">
        <div className="flex items-center gap-3">
          <h2 className="font-heading text-lg font-bold text-gray-900 dark:text-white">
            List Editor
          </h2>
          {editingList && (
            <span className="rounded-full bg-accent-500/10 px-2 py-0.5 text-xs text-accent-500">
              {editingList}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={closeEditor}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:text-white/40 dark:hover:bg-surface-2 dark:hover:text-white/80"
          title="Close editor"
        >
          <i className="fas fa-times" />
        </button>
      </div>

      {/* Body — placeholder for Phase 2 */}
      <div className="flex flex-1 items-center justify-center p-8 text-center text-gray-400 dark:text-white/30">
        <div>
          <i className="fas fa-list-ul mb-3 text-3xl" />
          <p className="text-sm">List editor coming soon</p>
          {editingList && (
            <p className="mt-1 text-xs text-gray-300 dark:text-white/20">
              Editing: {editingList}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit -p packages/ui/tsconfig.json
```

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/lib/components/ListEditor.tsx
git commit -m "feat(ui): add ListEditor shell component"
```

---

### Task 3: Convert Studio.tsx to three-panel sliding layout

**Files:**
- Modify: `packages/ui/src/lib/pages/Studio.tsx`

This is the core layout change. The current desktop layout is:
```
lg:grid lg:grid-cols-[380px_1fr]
  [Browser 380px] [Configurator flex]
```

The new layout is:
```
overflow-hidden
  [translate container: translateX(0) or translateX(-editorWidth)]
    [Editor flex] [Browser 380px] [Configurator flex]
```

- [ ] **Step 1: Import new components and context**

```typescript
import ListEditor from '../components/ListEditor'
import { useListEditor } from '../contexts/ListEditorContext'
```

- [ ] **Step 2: Replace the desktop layout**

Replace the `hidden lg:grid lg:grid-cols-[380px_1fr]` div with the sliding three-panel layout:

```tsx
const { isOpen: editorOpen } = useListEditor()

{/* Desktop: sliding three-panel */}
<div className="hidden lg:block h-full overflow-hidden">
  <div
    className="flex h-full transition-transform duration-300 ease-in-out"
    style={{
      width: 'calc(200% + 380px)',
      transform: editorOpen ? 'translateX(0)' : 'translateX(calc(-50% - 190px + 50vw))',
    }}
  >
    {/* Left: List Editor */}
    <div className="h-full" style={{ width: 'calc(50% - 190px)' }}>
      <ListEditor />
    </div>

    {/* Center: Browser (always 380px) */}
    <div className="h-full w-[380px] flex-shrink-0 border-x border-border-light dark:border-border-dark bg-white dark:bg-surface-base">
      <div className="h-full flex flex-col">
        {/* Sidebar header: logo + toggles */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-light dark:border-border-dark">
          <Link to="/" className="font-heading text-xl font-bold text-gradient-brand hover:opacity-80 transition-opacity">
            Gib.Show
          </Link>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowTestnets(!showTestnets)}
              className={`relative group w-9 h-9 rounded-xl flex items-center justify-center transition-colors ${
                showTestnets
                  ? 'bg-accent-500/10 text-accent-500'
                  : 'bg-gray-100 dark:bg-surface-2 text-gray-400 dark:text-gray-500'
              }`}
              title={showTestnets ? 'Testnets visible' : 'Testnets hidden'}
            >
              <i className="fas fa-flask text-sm" />
              <span className="absolute -bottom-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-gray-900 dark:bg-gray-700 px-2 py-1 text-xs text-white opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
                {showTestnets ? 'Hide testnets' : 'Show testnets'}
              </span>
            </button>
            <ThemeToggle />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          <StudioBrowser onInspectToken={setInspectToken} />
        </div>
      </div>
    </div>

    {/* Right: Studio Canvas / Configurator */}
    <div className="h-full" style={{ width: 'calc(50% - 190px)' }}>
      <div className="h-full bg-surface-light-1 dark:bg-surface-1 overflow-y-auto">
        <StudioConfigurator />
      </div>
    </div>
  </div>
</div>
```

The math: container width = `200% + 380px` (two flex panels at 50% each + 380px browser). The `translateX` shifts to show either left two panels (editor mode) or right two panels (studio mode).

- [ ] **Step 3: Update mobile layout**

Add an "Editor" tab that appears when a list is being edited:

```tsx
const { isOpen: editorOpen } = useListEditor()

{/* Mobile tab bar — add Editor tab conditionally */}
<div className="flex border-b border-border-light dark:border-border-dark bg-white dark:bg-surface-base">
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
  {editorOpen && (
    <button
      onClick={() => setActiveTab('editor')}
      className={`flex-1 py-3 text-sm font-medium transition-colors ${
        activeTab === 'editor'
          ? 'text-accent-500 border-b-2 border-accent-500'
          : 'text-gray-500'
      }`}
    >
      Editor
    </button>
  )}
</div>
```

And in the tab content area, add:
```tsx
{activeTab === 'editor' && editorOpen ? (
  <ListEditor />
) : activeTab === 'browse' ? (
  <StudioBrowser onInspectToken={setInspectToken} />
) : (
  <StudioConfigurator />
)}
```

Note: `activeTab` type in StudioContext needs to accept `'editor'` as well. Update the type:
```typescript
activeTab: 'browse' | 'configure' | 'editor'
```

- [ ] **Step 4: Typecheck and build**

```bash
npx tsc --noEmit -p packages/ui/tsconfig.json
npx vite build
```

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/lib/pages/Studio.tsx packages/ui/src/lib/contexts/StudioContext.tsx
git commit -m "feat(ui): three-panel sliding layout for Studio with editor slot"
```

---

### Task 4: Wire the [→] button in TokenSubRows to open editor

**Files:**
- Modify: `packages/ui/src/lib/components/StudioBrowser.tsx`
- Modify: `packages/ui/src/lib/components/TokenSubRows.tsx` (already has `onNavigateToList` prop)

- [ ] **Step 1: Import and use `useListEditor` in StudioBrowser**

```typescript
import { useListEditor } from '../contexts/ListEditorContext'
```

Inside the component:
```typescript
const { openEditor } = useListEditor()
```

- [ ] **Step 2: Pass `openEditor` to TokenSubRows**

In the render where `<TokenSubRows>` is used, pass the prop:

```tsx
<TokenSubRows
  references={token.listReferences}
  onNavigateToList={openEditor}
/>
```

- [ ] **Step 3: Make the list name in the token row clickable**

In the token row's bottom line where `{token.sourceList}` is displayed, wrap it in a button that opens the editor:

```tsx
<button
  type="button"
  className="truncate text-[10px] text-accent-500/70 hover:text-accent-500 hover:underline"
  onClick={(e) => {
    e.stopPropagation()
    openEditor(token.sourceList)
  }}
>
  {token.sourceList}
</button>
```

- [ ] **Step 4: Typecheck and build**

```bash
npx tsc --noEmit -p packages/ui/tsconfig.json
npx vite build
```

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/lib/components/StudioBrowser.tsx
git commit -m "feat(ui): wire token sub-rows and list name to open editor"
```

---

### Task 5: Visual verification

- [ ] **Step 1: Start dev server**

```bash
PUBLIC_BASE_URL=http://localhost:3000 npx vite dev --port 5173
```

- [ ] **Step 2: Test default view**

Navigate to `http://localhost:5173/#/studio`. Should see the normal two-panel layout (browser + configurator). No visual changes from the current behavior.

- [ ] **Step 3: Test editor slide**

Click a list name in a token row (or the [→] button in an expanded sub-row). The layout should slide left, revealing the ListEditor panel with "List editor coming soon" placeholder.

- [ ] **Step 4: Test close**

Click the × button in the editor header. Should slide back to the browser + configurator view.

- [ ] **Step 5: Test mobile**

Resize to mobile width. When editor is open, a third "Editor" tab should appear. Tapping it shows the editor panel.

- [ ] **Step 6: Fix any issues and commit**

```bash
git add -A && git commit -m "fix(ui): address issues from editor layout visual QA"
```
