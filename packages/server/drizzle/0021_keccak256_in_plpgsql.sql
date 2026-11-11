-- Replace the PL/Python keccak256(text) with a pure PL/pgSQL one, then drop plpython3u.
--
-- Why: the database needed an image carrying Python, PL/Python and safe-pysha3 (about
-- 450 MB) for this one function. Every primary key (provider_id, network_id, list_id,
-- metadata_id, token_id, list_token_id, list_order_id, bridge_id, bridge_link_id) is
-- keccak256 of its natural key, built by insert triggers. The plain postgres image now
-- runs the database.
--
-- The output is the same, byte for byte: Keccak-256 of the UTF-8 text, lowercase
-- hexadecimal, no 0x prefix, NULL hashed as the empty string. Rows already stored
-- reference each other by these ids, so test/keccak256.test.ts holds the function to
-- viem's keccak256 over fixed vectors.
--
-- CREATE OR REPLACE may change the language of an existing function, so a database that
-- still has the PL/Python version takes this path in place. The triggers keep calling
-- the same name. Cost: about 1 millisecond per hash, against about 0.03 for PL/Python.
--
-- Written by hand (drizzle-kit cannot emit it); the snapshot is unchanged from 0020.
CREATE OR REPLACE FUNCTION keccak256(input TEXT)
RETURNS TEXT AS $$
DECLARE
  -- Keccak-256 (the original padding byte 0x01, not NIST SHA3's 0x06), the same
  -- function viem.keccak256 and Solidity keccak256 compute. NULL hashes as the empty
  -- string and the result is lowercase hexadecimal with no 0x prefix, matching the
  -- plpython3u definition this replaces. Lanes are signed 64-bit integers; shifts and
  -- masks emulate unsigned rotation. Fully unrolled because per-statement cost
  -- dominates in PL/pgSQL.
  round_constants CONSTANT BIGINT[] := ARRAY[1,32898,-9223372036854742902,-9223372034707259392,32907,2147483649,-9223372034707259263,-9223372036854743031,138,136,2147516425,2147483658,2147516555,-9223372036854775669,-9223372036854742903,-9223372036854743037,-9223372036854743038,-9223372036854775680,32778,-9223372034707292150,-9223372034707259263,-9223372036854742912,2147483649,-9223372034707259384]::BIGINT[];
  message BYTEA := convert_to(COALESCE(input, ''), 'UTF8');
  message_length INTEGER := octet_length(message);
  padded BYTEA;
  padded_length INTEGER;
  block_offset INTEGER;
  lane_index INTEGER;
  byte_index INTEGER;
  round_index INTEGER;
  lane BIGINT;
  digest BYTEA := decode(repeat('00', 32), 'hex');
  a0 BIGINT;
  a1 BIGINT;
  a2 BIGINT;
  a3 BIGINT;
  a4 BIGINT;
  a5 BIGINT;
  a6 BIGINT;
  a7 BIGINT;
  a8 BIGINT;
  a9 BIGINT;
  a10 BIGINT;
  a11 BIGINT;
  a12 BIGINT;
  a13 BIGINT;
  a14 BIGINT;
  a15 BIGINT;
  a16 BIGINT;
  a17 BIGINT;
  a18 BIGINT;
  a19 BIGINT;
  a20 BIGINT;
  a21 BIGINT;
  a22 BIGINT;
  a23 BIGINT;
  a24 BIGINT;
  b0 BIGINT;
  b1 BIGINT;
  b2 BIGINT;
  b3 BIGINT;
  b4 BIGINT;
  b5 BIGINT;
  b6 BIGINT;
  b7 BIGINT;
  b8 BIGINT;
  b9 BIGINT;
  b10 BIGINT;
  b11 BIGINT;
  b12 BIGINT;
  b13 BIGINT;
  b14 BIGINT;
  b15 BIGINT;
  b16 BIGINT;
  b17 BIGINT;
  b18 BIGINT;
  b19 BIGINT;
  b20 BIGINT;
  b21 BIGINT;
  b22 BIGINT;
  b23 BIGINT;
  b24 BIGINT;
  c0 BIGINT;
  c1 BIGINT;
  c2 BIGINT;
  c3 BIGINT;
  c4 BIGINT;
  d0 BIGINT;
  d1 BIGINT;
  d2 BIGINT;
  d3 BIGINT;
  d4 BIGINT;
BEGIN
  padded_length := (message_length / 136 + 1) * 136;
  padded := message || decode(repeat('00', padded_length - message_length), 'hex');
  padded := set_byte(padded, message_length, get_byte(padded, message_length) # 1);
  padded := set_byte(padded, padded_length - 1, get_byte(padded, padded_length - 1) # 128);
  a0 := 0;
  a1 := 0;
  a2 := 0;
  a3 := 0;
  a4 := 0;
  a5 := 0;
  a6 := 0;
  a7 := 0;
  a8 := 0;
  a9 := 0;
  a10 := 0;
  a11 := 0;
  a12 := 0;
  a13 := 0;
  a14 := 0;
  a15 := 0;
  a16 := 0;
  a17 := 0;
  a18 := 0;
  a19 := 0;
  a20 := 0;
  a21 := 0;
  a22 := 0;
  a23 := 0;
  a24 := 0;
  block_offset := 0;
  WHILE block_offset < padded_length LOOP
    FOR lane_index IN 0..16 LOOP
      lane := 0;
      FOR byte_index IN 0..7 LOOP
        lane := lane | (get_byte(padded, block_offset + lane_index * 8 + byte_index)::BIGINT << (byte_index * 8));
      END LOOP;
      CASE lane_index
        WHEN 0 THEN a0 := a0 # lane;
        WHEN 1 THEN a1 := a1 # lane;
        WHEN 2 THEN a2 := a2 # lane;
        WHEN 3 THEN a3 := a3 # lane;
        WHEN 4 THEN a4 := a4 # lane;
        WHEN 5 THEN a5 := a5 # lane;
        WHEN 6 THEN a6 := a6 # lane;
        WHEN 7 THEN a7 := a7 # lane;
        WHEN 8 THEN a8 := a8 # lane;
        WHEN 9 THEN a9 := a9 # lane;
        WHEN 10 THEN a10 := a10 # lane;
        WHEN 11 THEN a11 := a11 # lane;
        WHEN 12 THEN a12 := a12 # lane;
        WHEN 13 THEN a13 := a13 # lane;
        WHEN 14 THEN a14 := a14 # lane;
        WHEN 15 THEN a15 := a15 # lane;
        WHEN 16 THEN a16 := a16 # lane;
      END CASE;
    END LOOP;
    FOR round_index IN 1..24 LOOP
      c0 := a0 # a5 # a10 # a15 # a20;
      c1 := a1 # a6 # a11 # a16 # a21;
      c2 := a2 # a7 # a12 # a17 # a22;
      c3 := a3 # a8 # a13 # a18 # a23;
      c4 := a4 # a9 # a14 # a19 # a24;
      d0 := c4 # ((c1 << 1) | ((c1 >> 63) & 1));
      d1 := c0 # ((c2 << 1) | ((c2 >> 63) & 1));
      d2 := c1 # ((c3 << 1) | ((c3 >> 63) & 1));
      d3 := c2 # ((c4 << 1) | ((c4 >> 63) & 1));
      d4 := c3 # ((c0 << 1) | ((c0 >> 63) & 1));
      b0 := (a0 # d0);
      b16 := (((a5 # d0) << 36) | (((a5 # d0) >> 28) & 68719476735));
      b7 := (((a10 # d0) << 3) | (((a10 # d0) >> 61) & 7));
      b23 := (((a15 # d0) << 41) | (((a15 # d0) >> 23) & 2199023255551));
      b14 := (((a20 # d0) << 18) | (((a20 # d0) >> 46) & 262143));
      b10 := (((a1 # d1) << 1) | (((a1 # d1) >> 63) & 1));
      b1 := (((a6 # d1) << 44) | (((a6 # d1) >> 20) & 17592186044415));
      b17 := (((a11 # d1) << 10) | (((a11 # d1) >> 54) & 1023));
      b8 := (((a16 # d1) << 45) | (((a16 # d1) >> 19) & 35184372088831));
      b24 := (((a21 # d1) << 2) | (((a21 # d1) >> 62) & 3));
      b20 := (((a2 # d2) << 62) | (((a2 # d2) >> 2) & 4611686018427387903));
      b11 := (((a7 # d2) << 6) | (((a7 # d2) >> 58) & 63));
      b2 := (((a12 # d2) << 43) | (((a12 # d2) >> 21) & 8796093022207));
      b18 := (((a17 # d2) << 15) | (((a17 # d2) >> 49) & 32767));
      b9 := (((a22 # d2) << 61) | (((a22 # d2) >> 3) & 2305843009213693951));
      b5 := (((a3 # d3) << 28) | (((a3 # d3) >> 36) & 268435455));
      b21 := (((a8 # d3) << 55) | (((a8 # d3) >> 9) & 36028797018963967));
      b12 := (((a13 # d3) << 25) | (((a13 # d3) >> 39) & 33554431));
      b3 := (((a18 # d3) << 21) | (((a18 # d3) >> 43) & 2097151));
      b19 := (((a23 # d3) << 56) | (((a23 # d3) >> 8) & 72057594037927935));
      b15 := (((a4 # d4) << 27) | (((a4 # d4) >> 37) & 134217727));
      b6 := (((a9 # d4) << 20) | (((a9 # d4) >> 44) & 1048575));
      b22 := (((a14 # d4) << 39) | (((a14 # d4) >> 25) & 549755813887));
      b13 := (((a19 # d4) << 8) | (((a19 # d4) >> 56) & 255));
      b4 := (((a24 # d4) << 14) | (((a24 # d4) >> 50) & 16383));
      a0 := b0 # ((~b1) & b2);
      a1 := b1 # ((~b2) & b3);
      a2 := b2 # ((~b3) & b4);
      a3 := b3 # ((~b4) & b0);
      a4 := b4 # ((~b0) & b1);
      a5 := b5 # ((~b6) & b7);
      a6 := b6 # ((~b7) & b8);
      a7 := b7 # ((~b8) & b9);
      a8 := b8 # ((~b9) & b5);
      a9 := b9 # ((~b5) & b6);
      a10 := b10 # ((~b11) & b12);
      a11 := b11 # ((~b12) & b13);
      a12 := b12 # ((~b13) & b14);
      a13 := b13 # ((~b14) & b10);
      a14 := b14 # ((~b10) & b11);
      a15 := b15 # ((~b16) & b17);
      a16 := b16 # ((~b17) & b18);
      a17 := b17 # ((~b18) & b19);
      a18 := b18 # ((~b19) & b15);
      a19 := b19 # ((~b15) & b16);
      a20 := b20 # ((~b21) & b22);
      a21 := b21 # ((~b22) & b23);
      a22 := b22 # ((~b23) & b24);
      a23 := b23 # ((~b24) & b20);
      a24 := b24 # ((~b20) & b21);
      a0 := a0 # round_constants[round_index];
    END LOOP;
    block_offset := block_offset + 136;
  END LOOP;
  FOR lane_index IN 0..3 LOOP
    lane := CASE lane_index WHEN 0 THEN a0 WHEN 1 THEN a1 WHEN 2 THEN a2 ELSE a3 END;
    FOR byte_index IN 0..7 LOOP
      digest := set_byte(digest, lane_index * 8 + byte_index, ((lane >> (byte_index * 8)) & 255)::INTEGER);
    END LOOP;
  END LOOP;
  RETURN encode(digest, 'hex');
END;
$$ LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE;
--> statement-breakpoint
-- Nothing depends on the extension any more. A database role that may not drop it keeps
-- working; the extension is then only unused.
DO $do$ BEGIN
  DROP EXTENSION IF EXISTS plpython3u;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'plpython3u is unused but could not be dropped: insufficient privilege';
END $do$;
