import type { Knex } from 'knex'

import config from '../../../config'

export async function up(knex: Knex): Promise<void> {
  await knex.raw('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"')
  await knex.raw('CREATE EXTENSION IF NOT EXISTS citext')
  await knex.raw('CREATE EXTENSION IF NOT EXISTS plpython3u')
  await knex.raw(`
CREATE OR REPLACE FUNCTION autoupdate_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END; $$
LANGUAGE 'plpgsql'`)
  await knex.raw(`CREATE OR REPLACE FUNCTION keccak256(input TEXT)
RETURNS TEXT AS $$
import sha3
k = sha3.keccak_256()
k.update(input.encode('utf-8'))
return k.hexdigest()
$$ LANGUAGE plpython3u`)
  await knex.raw(`create or replace function
count_rows(schema text, tablename text) returns integer
as
$body$
declare
  result integer;
  query varchar;
begin
  query := 'SELECT count(1) FROM ' || schema || '.' || tablename;
  execute query into result;
  return result;
end;
$body$
language plpgsql;`)
  await knex.raw(`CREATE OR REPLACE FUNCTION numeric_to_bit(NUMERIC)
  RETURNS BIT VARYING AS $$
DECLARE
  num ALIAS FOR $1;
  -- 1 + largest positive BIGINT --
  max_bigint NUMERIC := '9223372036854775808' :: NUMERIC(19, 0);
  result BIT VARYING;
BEGIN
  WITH
      chunks (exponent, chunk) AS (
        SELECT
          exponent,
          floor((num / (max_bigint ^ exponent) :: NUMERIC(256, 0)) % max_bigint) :: BIGINT
        FROM generate_series(0, 5) exponent
    )
  SELECT bit_or(chunk :: BIT(256) :: BIT VARYING << (63 * (exponent))) :: BIT VARYING
  FROM chunks INTO result;
  RETURN result;
END;
$$ LANGUAGE plpgsql;`)
  await knex.raw("SET enable_seqscan = 'OFF';")
  await knex.raw(`ALTER DATABASE ${config.database.name} SET statement_timeout = '60s';`)
}

export async function down(knex: Knex): Promise<void> {
  if (config.database.schema !== 'public') {
    return
  }
  await knex.raw('DROP EXTENSION IF EXISTS "uuid-ossp"')
  await knex.raw('DROP EXTENSION IF EXISTS citext')
  await knex.raw('DROP EXTENSION IF EXISTS citext')
  await knex.raw('DROP FUNCTION IF EXISTS keccak256()')
  await knex.raw('DROP FUNCTION IF EXISTS autoupdate_timestamp()')
  await knex.raw('DROP FUNCTION IF EXISTS count_rows(text,text)')
  await knex.raw('DROP FUNCTION IF EXISTS numeric_to_bit(numeric)')
  await knex.raw("SET enable_seqscan = 'ON';")
}
