import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['src/**/*.browser.test.{ts,tsx}', 'node_modules/**'],
    environment: 'jsdom',
    // Repairs storage on a runtime that did not supply it — see tests/setup.ts.
    // Lives outside src/ deliberately, so the coverage `include` below never
    // counts test scaffolding as production code.
    setupFiles: ['./tests/setup.ts'],
    coverage: {
      // Vitest 4 reports nothing at all unless `include` is set — an unset
      // include yields an empty table rather than an error, which reads as a
      // clean run. Name the sources explicitly so the report is real.
      include: ['src/**/*.{ts,tsx}'],
      // Providing `exclude` replaces Vitest's defaults, so the standard entries
      // have to be restated: a test file never counts toward the coverage of
      // the code it tests. Browser-mode specs run under a separate config, and
      // `main.tsx` is the Vite bootstrap that no unit test mounts.
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/**/*.browser.test.{ts,tsx}',
        'src/**/*.d.ts',
        'src/lib/networks.json',
        'src/main.tsx',
      ],
      // Ratchet floors, not aspirations. An earlier value of 100 sat roughly
      // forty-four points above reality, failed on every run from 2026-07-22
      // onward, and made the gate useless; the floors have been honest numbers
      // that can actually regress ever since.
      //
      // Deliberately ~0.2 below measured, because this workspace's coverage is
      // not identical across environments — an earlier suite reported 55.73
      // statements / 57.26 functions locally but 55.66 / 57.12 on the CI
      // runner, and floors set to the local figures failed CI by hundredths.
      // Leave the margin: a threshold that only passes on the machine it was
      // measured on is the same trap as a 100 nobody can reach.
      //
      // 2026-08-03: measured 92.65 / 86.58 / 91.87 / 93.89 over 1546 tests,
      // up from 59 percent. Every page and all but one component now have
      // tests; what remains uncovered is mostly unreachable defensive guards
      // and Studio.tsx.
      //
      // 2026-08-03, later the same day: measured 93.21 / 87.54 / 92.62 / 94.40
      // over 1566 tests. The token search moved out of TokenSearch.tsx into
      // useTokenSearch, which is covered outright, and the browser's search
      // wiring, icon fallback and merged-row expansion picked up tests of
      // their own.
      //
      // Then 93.16 / 87.57 / 92.52 / 94.36, after deleting the dead code the
      // fan-out left behind — limitConcurrency and two unused search helpers.
      // Three of the four figures went DOWN, which is worth understanding
      // before reading it as a regression: all of that code was fully covered
      // and above the file average, so removing it removed more covered lines
      // than uncovered ones. No test was dropped for code that still exists.
      // The floors below follow it down for that reason and no other; the
      // margin is unchanged, which is the thing to keep honest.
      //
      // 2026-08-05: measured 93.70 / 88.00 / 92.80 / 94.88 over 1557 tests,
      // after deleting `GET` and `initializeApiBase` from lib/utils and giving
      // the one survivor, `getApiUrl`, tests of its own. Every figure rose,
      // which is the opposite of the deletion above it and worth the contrast:
      // that code was covered and above average, so removing it cost coverage,
      // whereas this code was uncovered, so removing it and testing what stayed
      // gained on both ends.
      //
      // Browser-mode specs run under a separate config and are excluded above,
      // so component behaviour verified there does not count here. Raise these
      // as tests land; never lower them to make a failing run pass.
      //
      // 2026-09-07: measured 95.77 / 90.57 / 96.09 / 96.79 over 1587 tests, after a
      // risk-tiered pass rather than a sweep for red lines. Highest-value first:
      // Studio.tsx's URL-hydration effects (editor open/close, chain/token writeback,
      // the testnet toggle, the inspect-token modal) went from 61.7/71.11/45.45/64.86
      // to fully covered; StudioConfigurator's untested height stepper, the
      // square-shape "round corners" shortcut, and the zoom controls (clampZoom's
      // ceiling/floor) picked up their first tests; CodeOutput.tsx — the component
      // that decides which generator runs and wires the clipboard buttons, as
      // distinct from the generators themselves, which were already covered — went
      // from 62.85/58.97/53.84/62.5 to fully covered; StudioBrowser's auto-create-a-
      // scratch-list path picked up its race-guard test (two rapid clicks must not
      // create two lists). Two dead exports, `useTokenList` and
      // `fetchTokenListByProvider`, were deleted rather than tested — a prior commit
      // had already flagged them as callerless and left them; per the coverage
      // triage skill's ghost-handler guidance, the honest move is removal, not a
      // test that exercises code nothing in the app calls. A pre-existing setup bug
      // was also fixed here, unrelated to coverage: tests/setup.ts's storage repair
      // threw `ReferenceError: Storage is not defined` inside the one test file that
      // deliberately renders with `@vitest-environment node` (no browser globals at
      // all), which failed that suite outright on every run; it now checks for
      // `Storage` before touching its prototype.
      //
      // Deliberately left uncovered, by risk tier and reason: ListEditor.tsx's
      // remaining lines are `if (!activeList) return`-style guards for a UI state
      // its own controls do not allow (Rule 13/the coverage-triage skill both call
      // this out as low-value defensive coverage, not a real gap). StudioBrowser's
      // client-only popularity sort (chainTokens' non-"merged" branch) is very hard
      // to reach honestly: with a single merged token endpoint now the only writer
      // into tokensByList, that fallback only ever runs over an empty array in
      // practice, so forcing a non-empty case would mean fabricating a state the
      // real app cannot produce. StudioConfigurator's InfiniteCanvas pointer-drag and
      // wheel-zoom math and its CodePanel ResizeObserver effect are genuine Tier 4 —
      // a visual pan/zoom widget with no security or data-loss surface — and were
      // left for a future pass; RadialPositionPicker, NetworkSelect, and the
      // remaining single-digit-line branch gaps across small presentational
      // components are the same tier and were likewise left. Raise these floors
      // further as that work lands; never lower them to make a failing run pass.
      //
      // 2026-09-08: measured 98.14 / 92.85 / 98.69 / 99.31 over 1636 tests, taking the
      // four surfaces the note above deferred. RadialPositionPicker and TokenListFilter
      // had no test file at all; StudioConfigurator's InfiniteCanvas pan and wheel zoom,
      // its badge ring offset and its CodePanel measurement went from 74.32/59.64/74.24
      // to 98.64/85.96/100; NetworkSelect's clear-selection button and its priority-chain
      // comparator went from 90.74/85/91.3 to 98.14/95/97.82. Every one of these was
      // written against a mutation: the component was broken on purpose and the test that
      // should have caught it had to fail. Three did not on the first attempt and were
      // rewritten rather than kept - a test that survives its own mutation is measuring
      // nothing. Two were discarded outright: RadialPositionPicker's pointer-up guard
      // cannot be reached without a prior pointer-down (there is no listener to fire),
      // and its Number.isNaN check cannot be reached through a number input at all.
      //
      // Deliberately left, with reasons: NetworkSelect line 148 is the virtualizer's
      // getScrollElement callback, and jsdom has no layout, so the real virtualizer
      // mounts zero rows and the mock never calls it - reaching it means faking a
      // layout the browser would produce and jsdom cannot. StudioBrowser's client-only
      // popularity sort and ListEditor's `if (!activeList) return` guards are unchanged
      // from the note above and unchanged in reasoning.
      thresholds: { statements: 97.9, branches: 92.6, functions: 98.4, lines: 99.1 },
    },
  },
  resolve: {
    alias: {
      $lib: new URL('./src/lib', import.meta.url).pathname,
      $public: new URL('./public', import.meta.url).pathname,
      $images: new URL('./src/images', import.meta.url).pathname,
    },
  },
})
