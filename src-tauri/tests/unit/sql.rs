use super::*;
use crate::db;

fn text(row: &Row<'_>) -> rusqlite::Result<String> {
    row.get(0)
}

#[test]
fn bind_converts_the_supported_types_and_null() {
    let values = Values(vec![
        Value::from("a"),
        Value::from(5_i64),
        Value::from(2_i32),
        Value::from(true),
        Value::String(None),
    ]);

    assert_eq!(
        bind(&values).unwrap(),
        vec![
            SqlValue::Text("a".into()),
            SqlValue::Integer(5),
            SqlValue::Integer(2),
            SqlValue::Integer(1),
            SqlValue::Null,
        ]
    );
}

#[test]
fn bind_rejects_a_type_the_schema_does_not_use() {
    let error = bind(&Values(vec![Value::from(1.5_f64)])).unwrap_err();

    assert!(error.to_string().contains("unsupported SQL value type"));
}

#[test]
fn find_by_key_returns_the_row_or_none() {
    let connection = db::in_memory();

    connection
        .execute("INSERT INTO meta (key, value) VALUES ('a', '1')", [])
        .unwrap();

    let found = find_by_key(&connection, "meta", &["value"], "key", "a", text).unwrap();
    let missing = find_by_key(&connection, "meta", &["value"], "key", "b", text).unwrap();

    assert_eq!(found.as_deref(), Some("1"));
    assert_eq!(missing, None);
}

#[test]
fn upsert_inserts_then_replaces_the_row() {
    let connection = db::in_memory();
    let row = |value: &str| vec![("key", Value::from("k")), ("value", Value::from(value))];

    upsert(&connection, "meta", &["key"], row("one")).unwrap();
    upsert(&connection, "meta", &["key"], row("two")).unwrap();

    let rows: i64 = connection
        .query_row("SELECT COUNT(*) FROM meta", [], |row| row.get(0))
        .unwrap();
    let value = find_by_key(&connection, "meta", &["value"], "key", "k", text).unwrap();

    assert_eq!(rows, 1);
    assert_eq!(value.as_deref(), Some("two"));
}

#[test]
fn list_ordered_sorts_by_position_and_filters() {
    let connection = db::in_memory();

    for (id, position, name) in [("c", 2_i64, "third"), ("a", 0, "first"), ("b", 1, "second")] {
        let row = vec![
            ("id", Value::from(id)),
            ("position", Value::from(position)),
            ("name", Value::from(name)),
            ("folders", Value::from("[]")),
            ("env", Value::from("{}")),
        ];

        upsert(&connection, "projects", &["id"], row).unwrap();
    }

    let all = list_ordered(
        &connection,
        "projects",
        &["name"],
        Condition::all(),
        "position",
        text,
    )
    .unwrap();
    let filtered = list_ordered(
        &connection,
        "projects",
        &["name"],
        Condition::all().add(Expr::col(Alias::new("position")).gte(1_i64)),
        "position",
        text,
    )
    .unwrap();

    assert_eq!(all, ["first", "second", "third"]);
    assert_eq!(filtered, ["second", "third"]);
}

#[test]
fn delete_where_removes_only_matching_rows() {
    let connection = db::in_memory();

    for key in ["a", "b"] {
        upsert(
            &connection,
            "meta",
            &["key"],
            vec![("key", Value::from(key)), ("value", Value::from("x"))],
        )
        .unwrap();
    }

    let removed = delete_where(
        &connection,
        "meta",
        Condition::all().add(Expr::col(Alias::new("key")).eq("a")),
    )
    .unwrap();
    let left = find_by_key(&connection, "meta", &["key"], "key", "b", text).unwrap();

    assert_eq!(removed, 1);
    assert_eq!(left.as_deref(), Some("b"));
}
