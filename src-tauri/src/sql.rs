//! Small shared SQL helpers on top of `sea-query` for the one SQLite file of the IDE.
//!
//! `sea-query` builds the statement text and its values; the values are bound to `rusqlite` here (the ready-made `sea-query-rusqlite` crate needs another `rusqlite` version).
//!
//! Table and column names are fixed names written in the code, never user input; every value goes through a bound parameter.

use rusqlite::types::Value as SqlValue;
use rusqlite::{params_from_iter, Connection, Row};
use sea_query::{
    Alias, Condition, DeleteStatement, Expr, ExprTrait, InsertStatement, OnConflict, Order, Query,
    QueryStatementWriter, SelectStatement, SqliteQueryBuilder, Value, Values,
};
use std::fmt;

/// A value type that the schema never uses, so it has no SQLite binding here.
#[derive(Debug)]
struct UnsupportedValue(String);

impl fmt::Display for UnsupportedValue {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "unsupported SQL value type: {}", self.0)
    }
}

impl std::error::Error for UnsupportedValue {}

fn unsupported(value: &Value) -> rusqlite::Error {
    let name = format!("{value:?}");
    let name = name.split('(').next().unwrap_or_default().to_string();

    rusqlite::Error::ToSqlConversionFailure(Box::new(UnsupportedValue(name)))
}

/// Converts the values of a built statement to `rusqlite` values (text, integers, booleans and NULL).
///
/// # Errors
/// Fails on any other value type (floats, blobs, ...) or an unsigned number that does not fit `i64`.
pub fn bind(values: &Values) -> rusqlite::Result<Vec<SqlValue>> {
    values
        .0
        .iter()
        .map(|value| match value {
            Value::Bool(flag) => {
                Ok(flag.map_or(SqlValue::Null, |flag| SqlValue::Integer(flag.into())))
            }
            Value::TinyInt(number) => Ok(integer(number.map(i64::from))),
            Value::SmallInt(number) => Ok(integer(number.map(i64::from))),
            Value::Int(number) => Ok(integer(number.map(i64::from))),
            Value::BigInt(number) => Ok(integer(*number)),
            // `LIMIT` and `OFFSET` are bound as unsigned numbers.
            Value::TinyUnsigned(number) => Ok(integer(number.map(i64::from))),
            Value::SmallUnsigned(number) => Ok(integer(number.map(i64::from))),
            Value::Unsigned(number) => Ok(integer(number.map(i64::from))),
            Value::BigUnsigned(number) => match number.map(i64::try_from).transpose() {
                Ok(number) => Ok(integer(number)),
                Err(_) => Err(unsupported(value)),
            },
            Value::String(text) => Ok(text
                .as_ref()
                .map_or(SqlValue::Null, |text| SqlValue::Text(text.clone()))),
            _ => Err(unsupported(value)),
        })
        .collect()
}

fn integer(number: Option<i64>) -> SqlValue {
    number.map_or(SqlValue::Null, SqlValue::Integer)
}

fn column_list(columns: &[&str]) -> Vec<Alias> {
    columns.iter().map(|column| Alias::new(*column)).collect()
}

/// Runs an INSERT, UPDATE or DELETE built with `sea-query`; returns the number of rows changed.
///
/// # Errors
/// Fails when a value cannot be bound or SQLite rejects the statement.
pub fn execute(
    connection: &Connection,
    statement: &impl QueryStatementWriter,
) -> rusqlite::Result<usize> {
    let (text, values) = statement.build(SqliteQueryBuilder);

    connection.execute(&text, params_from_iter(bind(&values)?))
}

/// Runs a SELECT built with `sea-query` and maps every row.
///
/// # Errors
/// Fails when a value cannot be bound, SQLite rejects the statement, or `map` fails on a row.
pub fn query_all<T>(
    connection: &Connection,
    statement: &SelectStatement,
    map: impl FnMut(&Row<'_>) -> rusqlite::Result<T>,
) -> rusqlite::Result<Vec<T>> {
    let (text, values) = statement.build(SqliteQueryBuilder);

    connection
        .prepare(&text)?
        .query_map(params_from_iter(bind(&values)?), map)?
        .collect()
}

/// Runs a SELECT built with `sea-query` and maps its first row, if there is one.
///
/// # Errors
/// Fails when a value cannot be bound, SQLite rejects the statement, or `map` fails on the row.
pub fn query_first<T>(
    connection: &Connection,
    statement: &SelectStatement,
    map: impl FnOnce(&Row<'_>) -> rusqlite::Result<T>,
) -> rusqlite::Result<Option<T>> {
    let (text, values) = statement.build(SqliteQueryBuilder);
    let mut prepared = connection.prepare(&text)?;
    let mut rows = prepared.query(params_from_iter(bind(&values)?))?;

    rows.next()?.map(map).transpose()
}

/// The row of `table` whose `key_column` equals `key`: `columns` mapped by `map`, `None` when there is no such row.
///
/// # Errors
/// See [`query_first`].
pub fn find_by_key<T>(
    connection: &Connection,
    table: &str,
    columns: &[&str],
    key_column: &str,
    key: impl Into<Value>,
    map: impl FnOnce(&Row<'_>) -> rusqlite::Result<T>,
) -> rusqlite::Result<Option<T>> {
    let statement = Query::select()
        .columns(column_list(columns))
        .from(Alias::new(table))
        .and_where(Expr::col(Alias::new(key_column)).eq(key))
        .limit(1)
        .to_owned();

    query_first(connection, &statement, map)
}

/// The rows of `table` matching `filter`, in ascending `order_column` order (usually `position`).
///
/// # Errors
/// See [`query_all`].
pub fn list_ordered<T>(
    connection: &Connection,
    table: &str,
    columns: &[&str],
    filter: Condition,
    order_column: &str,
    map: impl FnMut(&Row<'_>) -> rusqlite::Result<T>,
) -> rusqlite::Result<Vec<T>> {
    let statement = Query::select()
        .columns(column_list(columns))
        .from(Alias::new(table))
        .cond_where(filter)
        .order_by(Alias::new(order_column), Order::Asc)
        .to_owned();

    query_all(connection, &statement, map)
}

/// Inserts `row` (column and value pairs) into `table`; when a row with the same `key_columns` exists, its other columns are replaced.
///
/// # Errors
/// Fails when a value cannot be bound or SQLite rejects the statement.
pub fn upsert(
    connection: &Connection,
    table: &str,
    key_columns: &[&str],
    row: Vec<(&str, Value)>,
) -> rusqlite::Result<usize> {
    let columns: Vec<&str> = row.iter().map(|(column, _)| *column).collect();
    let updated: Vec<Alias> = columns
        .iter()
        .filter(|column| !key_columns.contains(column))
        .map(|column| Alias::new(*column))
        .collect();
    let values: Vec<Expr> = row.into_iter().map(|(_, value)| Expr::val(value)).collect();
    let mut conflict = OnConflict::columns(column_list(key_columns));

    if updated.is_empty() {
        conflict.do_nothing();
    } else {
        conflict.update_columns(updated);
    }

    let mut statement = InsertStatement::new();

    statement
        .into_table(Alias::new(table))
        .columns(column_list(&columns))
        .on_conflict(conflict);
    statement
        .values(values)
        .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;

    execute(connection, &statement)
}

/// Deletes the rows of `table` matching `filter`; returns how many were deleted.
///
/// # Errors
/// Fails when a value cannot be bound or SQLite rejects the statement.
pub fn delete_where(
    connection: &Connection,
    table: &str,
    filter: Condition,
) -> rusqlite::Result<usize> {
    let statement: DeleteStatement = Query::delete()
        .from_table(Alias::new(table))
        .cond_where(filter)
        .to_owned();

    execute(connection, &statement)
}

#[cfg(test)]
#[path = "../tests/unit/sql.rs"]
mod tests;
