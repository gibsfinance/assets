import './image-store-directory'
import { test } from 'node:test'
import assert from 'assert'
import * as fs from 'node:fs'
import * as path from 'node:path'
import supertest from 'supertest'
import sharp from 'sharp'
import { eq, inArray, sql as dsql } from 'drizzle-orm'
import { app } from '../src/server/app'
import config from '../config'
import * as db from '../src/db'
import { getDrizzle } from '../src/db/drizzle'
import * as s from '../src/db/schema'
import { getImageStore, hashBytes } from '../src/image-store'
import { exportImages, importImages, verifyImages } from '../src/image-store/backfill'
import { collectGarbage } from '../src/image-store/garbage-collection'
import { isDbAvailable } from './db-available'

/**
 * Image bytes in the image store: the migration, the database guard, the write path, and the
 * backfill, verification, rollback and clean-up, against a real database and a real directory.
 */

const skip = !(await isDbAvailable()) && 'no database connection'
const SOURCE = 'https://example.com/image-store-test'

/** Deterministic noise: a distinct, servable raster above the 200-byte floor for each seed. */
const noisePng = async (seed: number): Promise<Buffer> => {
  const pixels = Buffer.alloc(32 * 32 * 4)
  let state = seed
  for (let i = 0; i < pixels.length; i++) {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648
    pixels[i] = state % 256
  }
  return sharp(pixels, { raw: { width: 32, height: 32, channels: 4 } })
    .png()
    .toBuffer()
}

/** Read a response as raw bytes whatever its content type. */
const fetchDirect = (imageHash: string) =>
  supertest(app)
    .get(`/image/direct/${imageHash}`)
    .buffer(true)
    .parse((res, callback) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => callback(null, Buffer.concat(chunks)))
    })

const readRow = async (imageHash: string) => {
  const result = await getDrizzle().execute<{
    content: Buffer | null
    contentSha256: string | null
    byteSize: number | null
  }>(
    dsql`SELECT content, content_sha256 AS "contentSha256", byte_size AS "byteSize" FROM image WHERE image_hash = ${imageHash}`,
  )
  return result.rows[0]
}

const storeFileExists = (sha256: string) =>
  fs.existsSync(path.join(config.imageStoreDirectory, 'sha256', sha256.slice(0, 2), sha256))

test('migration 0022 can be applied a second time without error', { skip }, async () => {
  const migration = fs.readFileSync(new URL('../drizzle/0022_image_store_columns.sql', import.meta.url), 'utf8')
  const statements = migration
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter(Boolean)
  assert.ok(statements.length >= 5)
  for (const statement of statements) await getDrizzle().execute(dsql.raw(statement))
  // The columns and the index are still there exactly once.
  const columns = await getDrizzle().execute<{ column_name: string }>(
    dsql`SELECT column_name FROM information_schema.columns WHERE table_name = 'image' AND column_name IN ('content_sha256', 'byte_size')`,
  )
  assert.strictEqual(columns.rows.length, 2)
})

test(
  'the database clears a digest that stops describing its bytes, and leaves a correct one alone',
  { skip },
  async (t) => {
    const drizzle = getDrizzle()
    const imageHash = hashBytes(Buffer.from('trigger-test-row'))
    t.after(async () => {
      await drizzle.delete(s.image).where(eq(s.image.imageHash, imageHash))
    })
    const original = Buffer.from('original bytes for the trigger test')
    await drizzle
      .insert(s.image)
      .values({
        imageHash,
        content: original,
        contentSha256: hashBytes(original),
        byteSize: original.length,
        uri: `${SOURCE}/trigger.png`,
        ext: '.png',
        mode: 'save',
      })
      .onConflictDoNothing()

    // The previous release replaces the bytes and knows nothing of the digest.
    const replaced = Buffer.from('bytes written by the previous release')
    await drizzle.update(s.image).set({ content: replaced }).where(eq(s.image.imageHash, imageHash))
    assert.deepStrictEqual(await readRow(imageHash), { content: replaced, contentSha256: null, byteSize: null })

    // This release writes bytes and their digest together.
    const rewritten = Buffer.from('bytes written with their own digest')
    await drizzle
      .update(s.image)
      .set({ content: rewritten, contentSha256: hashBytes(rewritten), byteSize: rewritten.length })
      .where(eq(s.image.imageHash, imageHash))
    assert.deepStrictEqual(await readRow(imageHash), {
      content: rewritten,
      contentSha256: hashBytes(rewritten),
      byteSize: rewritten.length,
    })

    // Writing no bytes keeps the digest: the bytes are in the store.
    await drizzle.update(s.image).set({ content: null }).where(eq(s.image.imageHash, imageHash))
    assert.deepStrictEqual(await readRow(imageHash), {
      content: null,
      contentSha256: hashBytes(rewritten),
      byteSize: rewritten.length,
    })

    // Putting the same bytes back, as `images import` does, keeps the digest too.
    await drizzle.update(s.image).set({ content: rewritten }).where(eq(s.image.imageHash, imageHash))
    assert.strictEqual((await readRow(imageHash)).contentSha256, hashBytes(rewritten))
  },
)

test(
  'insertImage writes the file first, records digest and length, and serves the same bytes with and without a database copy',
  { skip },
  async (t) => {
    const drizzle = getDrizzle()
    const hashes: string[] = []
    const savedSetting = config.imageBytesInDatabase
    t.after(async () => {
      config.imageBytesInDatabase = savedSetting
      if (hashes.length) {
        await drizzle.delete(s.link).where(inArray(s.link.imageHash, hashes))
        await drizzle.delete(s.image).where(inArray(s.image.imageHash, hashes))
      }
    })

    const download = await noisePng(101)
    const withDatabaseCopy = await db.insertImage({
      providerKey: 'image-store-test',
      originalUri: `${SOURCE}/with-copy.png`,
      image: download,
      listId: null,
    })
    assert.ok(withDatabaseCopy)
    hashes.push(withDatabaseCopy.image.imageHash)

    const dualRow = await readRow(withDatabaseCopy.image.imageHash)
    assert.ok(dualRow.content, 'the database copy is still written while the setting is on')
    assert.strictEqual(dualRow.contentSha256, hashBytes(dualRow.content))
    assert.strictEqual(dualRow.byteSize, dualRow.content.length)
    assert.ok(storeFileExists(dualRow.contentSha256), 'the file exists once the row does')
    assert.deepStrictEqual(await getImageStore().get(dualRow.contentSha256), dualRow.content)

    config.imageBytesInDatabase = false
    const withoutDatabaseCopy = await db.insertImage({
      providerKey: 'image-store-test',
      originalUri: `${SOURCE}/without-copy.png`,
      image: await noisePng(102),
      listId: null,
    })
    assert.ok(withoutDatabaseCopy)
    hashes.push(withoutDatabaseCopy.image.imageHash)
    const storeOnlyRow = await readRow(withoutDatabaseCopy.image.imageHash)
    assert.strictEqual(storeOnlyRow.content, null)
    assert.ok(storeOnlyRow.contentSha256 && storeFileExists(storeOnlyRow.contentSha256))
    assert.strictEqual(storeOnlyRow.byteSize, (await getImageStore().get(storeOnlyRow.contentSha256))!.length)

    // The same picture under a second address is a second row and one file.
    config.imageBytesInDatabase = true
    const sameBytes = await db.insertImage({
      providerKey: 'image-store-test',
      originalUri: `${SOURCE}/with-copy-again.png`,
      image: download,
      listId: null,
    })
    assert.ok(sameBytes)
    hashes.push(sameBytes.image.imageHash)
    assert.notStrictEqual(sameBytes.image.imageHash, withDatabaseCopy.image.imageHash)
    assert.strictEqual((await readRow(sameBytes.image.imageHash)).contentSha256, dualRow.contentSha256)

    // Both rows answer on the public address, from the file, with the bytes that were stored.
    const stored = await getImageStore().get(storeOnlyRow.contentSha256)
    const direct = await fetchDirect(withoutDatabaseCopy.image.imageHash).expect(200)
    assert.deepStrictEqual(direct.body, stored)
    assert.match(String(direct.headers['content-type']), /image\/png/)
    assert.strictEqual(direct.headers['x-resize'], 'original')
    const dualDirect = await fetchDirect(withDatabaseCopy.image.imageHash).expect(200)
    assert.deepStrictEqual(dualDirect.body, dualRow.content)
  },
)

test(
  'export, verify, import and gc against a database that holds rows written before the store existed',
  { skip },
  async (t) => {
    const drizzle = getDrizzle()
    const hashes: string[] = []
    const savedSetting = config.imageBytesInDatabase
    t.after(async () => {
      config.imageBytesInDatabase = savedSetting
      await drizzle.delete(s.image).where(inArray(s.image.imageHash, hashes))
    })

    // Rows as the previous release wrote them: bytes in `content`, no digest, no length.
    const legacyBytes = await Promise.all([201, 202, 203].map(noisePng))
    const legacy = [
      ...legacyBytes.map((content, index) => ({ label: `legacy-${index}`, content, mode: 'save' })),
      { label: 'legacy-duplicate', content: legacyBytes[0], mode: 'save' },
      { label: 'legacy-link', content: Buffer.alloc(0), mode: 'link' },
    ].map((row) => ({
      ...row,
      imageHash: hashBytes(Buffer.from(`image-store-test:${row.label}`)),
    }))
    for (const row of legacy) {
      hashes.push(row.imageHash)
      await drizzle
        .insert(s.image)
        .values({
          imageHash: row.imageHash,
          content: row.content,
          uri: `${SOURCE}/${row.label}.png`,
          ext: '.png',
          mode: row.mode,
        })
        .onConflictDoUpdate({
          target: s.image.imageHash,
          set: { content: row.content, contentSha256: null, byteSize: null },
        })
    }

    const before = await Promise.all(legacy.map((row) => fetchDirect(row.imageHash)))

    const summary = await exportImages({ batchSize: 2 })
    assert.ok(summary.exported >= 4, JSON.stringify(summary))
    assert.ok(summary.empty >= 1, JSON.stringify(summary))

    for (const row of legacy.filter((candidate) => candidate.mode === 'save')) {
      const exported = await readRow(row.imageHash)
      assert.strictEqual(exported.contentSha256, hashBytes(row.content))
      assert.strictEqual(exported.byteSize, row.content.length)
      assert.ok(storeFileExists(exported.contentSha256!))
    }
    const linkRow = await readRow(legacy[4].imageHash)
    assert.deepStrictEqual(
      { sha: linkRow.contentSha256, size: linkRow.byteSize },
      { sha: null, size: 0 },
      'a link-only row gets length 0 and no digest',
    )
    // Three distinct pictures, four rows that carry bytes: the duplicate shares a file.
    assert.strictEqual(
      new Set(legacy.filter((row) => row.mode === 'save').map((row) => hashBytes(row.content))).size,
      3,
    )

    const verified = await verifyImages({ rehash: true })
    assert.strictEqual(verified.pendingRows, 0, JSON.stringify(verified))
    assert.strictEqual(verified.databaseMismatchRows, 0, JSON.stringify(verified))
    assert.deepStrictEqual(verified.missingFiles, [])
    assert.ok(verified.ok, JSON.stringify(verified))

    // Served from the files, the answers are the ones given before the export.
    const after = await Promise.all(legacy.map((row) => fetchDirect(row.imageHash)))
    for (const [index, response] of after.entries()) {
      assert.strictEqual(response.status, before[index].status)
      assert.deepStrictEqual(response.body, before[index].body)
      for (const header of ['content-type', 'cache-control', 'x-resize', 'link', 'x-license', 'etag']) {
        assert.strictEqual(response.headers[header], before[index].headers[header], header)
      }
    }

    // Stop writing bytes, add rows, and take the bytes out of the database as a later release would.
    await drizzle
      .update(s.image)
      .set({ content: null })
      .where(
        inArray(
          s.image.imageHash,
          legacy.filter((row) => row.mode === 'save').map((row) => row.imageHash),
        ),
      )
    const unreadable = await fetchDirect(legacy[0].imageHash)
    assert.deepStrictEqual(unreadable.body, legacy[0].content, 'with no database copy, the file answers')

    // gc keeps every referenced file, and a dry run removes nothing even for an orphan.
    const orphan = await getImageStore().put(Buffer.from(`orphan ${Date.now()}`))
    const dryRun = await collectGarbage({ gracePeriodMs: 0, now: () => Date.now() + 1000 })
    assert.strictEqual(dryRun.dryRun, true)
    assert.strictEqual(dryRun.deleted, 0)
    assert.ok(dryRun.unreferenced >= 1)
    assert.ok(storeFileExists(orphan.sha256))
    const inGrace = await collectGarbage({ dryRun: false })
    assert.strictEqual(inGrace.deleted, 0, 'a file younger than the grace period is kept')
    const swept = await collectGarbage({ dryRun: false, gracePeriodMs: 0, now: () => Date.now() + 1000 })
    assert.ok(swept.deleted >= 1)
    assert.ok(!storeFileExists(orphan.sha256), 'the orphan is gone')
    for (const row of legacy.filter((candidate) => candidate.mode === 'save')) {
      assert.ok(storeFileExists(hashBytes(row.content)), 'a referenced file survives')
    }

    // Rollback: bytes back in the database, for the previous release.
    const restored = await importImages({ batchSize: 2 })
    assert.ok(restored.restored >= 3, JSON.stringify(restored))
    for (const row of legacy.filter((candidate) => candidate.mode === 'save')) {
      const rolledBack = await readRow(row.imageHash)
      assert.deepStrictEqual(rolledBack.content, row.content)
    }
  },
)
