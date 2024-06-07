import _ from 'lodash'
import type * as pg from 'pg'
import type { Knex } from 'knex'
import type { TableNames, Tx } from './tables'

import userConfig from '../../config'

export const isConflict = (e: pg.DatabaseError) => e.code === '23505'

// best to not take in data from outside world when doing raw queries
// - always hard code inputs
export const createListConstraint = (
  tableName: string,
  column: string,
  constraints: string[],
): string => {
  const col = _.snakeCase(column)
  const constrained = constraints.map((c) => `'${c}'`).join(',')
  return `
ALTER TABLE ${tableName}
ADD CONSTRAINT check_${col}
CHECK (${col} IN (${constrained}))`
}

export const preventUpdateConstraint = () => {
  return `CREATE OR REPLACE FUNCTION prevent_update()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RAISE EXCEPTION 'Update operation is not allowed';
    END IF;
END;
$$ LANGUAGE plpgsql`
}

export const generateIdFunction = (t: TableNames, key: string, sCols: string[]) => {
  return `CREATE OR REPLACE FUNCTION generate_composite_id_${t}_${key}_${sCols.join('_')}()
RETURNS TRIGGER AS $$
BEGIN
    NEW.${key} := keccak256(${sCols.map((col) => `NEW.${col}::text`).join(' || ')});
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;`
}

export const generateIdTrigger = (t: TableNames, key: string, sCols: string[]) => {
  return `CREATE TRIGGER set_composite_id_${t}
BEFORE INSERT OR UPDATE OF ${sCols.join(', ')} ON ${t}
FOR EACH ROW
EXECUTE FUNCTION generate_composite_id_${t}_${key}_${sCols.join('_')}()`
}

export const dropFunction = (name: string) => (
  `DROP FUNCTION IF EXISTS ${name}()`
)

export const dropTrigger = (name: string, t: TableNames) => (
  `DROP TRIGGER IF EXISTS ${name} ON ${t}`
)

export const dropGenerateIdFunction = (t: TableNames, k: string, cols: string[]) => {
  return dropFunction(`set_composite_id_${t}_${k}_${cols.join('_')}`)
}

export const generateCompositeIdFrom = async (knex: Knex, t: TableNames, key: string, cols: string[]) => {
  const k = _.snakeCase(key)
  const sCols = cols.map(col => _.snakeCase(col))
  await knex.raw(generateIdFunction(t, k, sCols))
  await knex.raw(generateIdTrigger(t, k, sCols))
}

export const dropGenerateCompositeIdAndTrigger = async (knex: Knex, t: TableNames, key: string, cols: string[]) => {
  const k = _.snakeCase(key)
  const sCols = cols.map(col => _.snakeCase(col))
  await knex.raw(dropTrigger(`set_composite_id_${t}`, t))
  await knex.raw(dropGenerateIdFunction(t, k, sCols))
}

export const compositeId = (t: TableNames, k: string, cols: string[]) => ({
  up: (knex: Knex) => generateCompositeIdFrom(knex, t, k, cols),
  down: (knex: Knex) => dropGenerateCompositeIdAndTrigger(knex, t, k, cols),
})

// export const generateIdWithDelimiterFunction = (t: TableNames, key: string, sCols: string[], delimiter: string) => {
//   return `CREATE OR REPLACE FUNCTION generate_composite_id_${t}_${key}_${sCols.join('_')}()
// RETURNS TRIGGER AS $$
// BEGIN
//     NEW.${key} := ${sCols.map((col) => `NEW.${col}::text`).join(` || "${delimiter}" || `)};
//     RETURN NEW;
// END;
// $$ LANGUAGE plpgsql;`
// }

// export const generateIdWithDelimiterTrigger = (t: TableNames, key: string, sCols: string[]) => {
//   return `CREATE TRIGGER set_composite_id_${t}
// BEFORE INSERT OR UPDATE OF ${sCols.join(', ')} ON ${t}
// FOR EACH ROW
// EXECUTE FUNCTION generate_composite_id_${t}_${key}_${sCols.join('_')}()`
// }

// export const generateIdWithDelimiter = async (knex: Knex, t: TableNames, key: string, cols: string[], delimiter = '.') => {
//   const k = _.snakeCase(key)
//   const sCols = cols.map(col => _.snakeCase(col))
//   await knex.raw(generateIdWithDelimiterFunction(t, k, sCols, delimiter))
//   await knex.raw(generateIdWithDelimiterTrigger(t, k, sCols))
// }

// export const preventUpdateTrigger = (tableName: TableNames) => {
//   return `CREATE TRIGGER prevent_update_trigger_${tableName}
// BEFORE UPDATE ON ${tableName}
// FOR EACH ROW
// EXECUTE PROCEDURE prevent_update()`
// }

// export const createReadonlyColumnConstraint = (col: string) => {
//   return `CREATE OR REPLACE FUNCTION read_only_${col}()
// RETURNS TRIGGER AS '
//   BEGIN
//     IF NEW.${col} != OLD.${col} THEN
//       RAISE EXCEPTION ''Update to % Not Permitted'', ${col}
//     END IF;

//     RETURN NEW;
//   END;
// ' LANGUAGE PLPGSQL`
// }

export const autoUpdateTimestamp = (tableName: string | string[]) => {
  const tableNameParts = (_.isArray(tableName) ? tableName : [tableName])
    .map((a) => _.snakeCase(a))
  return `
CREATE TRIGGER autoupdate_${tableNameParts.join('_')}_timestamp
BEFORE UPDATE ON ${tableNameParts.map((word) => `"${word}"`).join('.')}
FOR EACH ROW
WHEN (OLD.* IS DISTINCT FROM NEW.*)
EXECUTE PROCEDURE autoupdate_timestamp()`
}

export const resultToCamelCase = <T>(obj: unknown): T | T[] => {
  if (!_.isObject(obj) || _.isDate(obj)) {
    return obj as T
  }
  if (_.isArray(obj)) {
    return obj.map(objectToCamelCase) as T[]
  }
  return objectToCamelCase(obj) as T
}

export const objectToCamelCase = (obj: {
  [key: string]: any;
}) => {
  if (_.isString(obj)) {
    return obj
  }
  return obj && _.reduce(obj, (memo, value, key) => {
    memo[_.camelCase(key)] = resultToCamelCase<string>(value)
    return memo
  }, {} as { [key: string]: any })
}

export const ignoreValues: {
  [key: string]: boolean;
} = {
  '*': true,
}

export const addCheckIn = (knex: Knex, schema: string, tableName: TableNames, name: string, list: string[]) => (
  knex.raw(`alter table "${schema}"."${tableName}" add constraint ${name} check(status in ('${list.join('\',\'')}'))`)
)

export const insertIntoTable = async (
  t: Tx,
  table: TableNames,
  rows: any[],
  conflictColumns = ['id'],
  mergeColumns = conflictColumns,
) => {
  const chunked = _.chunk(rows, 1_000)
  for (const r of chunked) {
    const q = t(table)
      .withSchema(userConfig.database.schema)
      .insert(r)
      .onConflict(conflictColumns)
    if (mergeColumns.length) await q.merge(mergeColumns)
    else await q.merge()
  }
}
