// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Node's own loader refuses a relative import with no extension, and the build keeps import paths as written.
 * The package is built with bundler resolution, which accepts them, so nothing else catches a missing `.js`:
 * version 1.0.0 shipped `from './client'` and failed to load in plain Node.
 */
const sourceDirectory = fileURLToPath(new URL(".", import.meta.url));
const RELATIVE_IMPORT = /(?:from|import)\s*'(\.\.?\/[^']*)'/g;

const publishedSourceFiles = readdirSync(sourceDirectory).filter(
  (name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name),
);

describe("published import paths", () => {
  it.each(publishedSourceFiles)(
    "%s names the .js file of every relative import",
    (name) => {
      const text = readFileSync(`${sourceDirectory}/${name}`, "utf8");
      const missing = [...text.matchAll(RELATIVE_IMPORT)]
        .map((match) => match[1])
        .filter((path) => !path.endsWith(".js"));
      expect(missing).toEqual([]);
    },
  );
});
