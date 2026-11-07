//! Nhật ký lượt chat theo ngày: `logs/<yyyy-mm-dd>.log`, mỗi dòng một JSON
//! `{ts, runId, cli, kind, ...}`. Chỉ ghi trường nằm trong danh sách cho phép:
//! tên công cụ và mã lỗi; không bao giờ ghi prompt, câu trả lời, khoá API hay
//! biến môi trường.

use crate::project_data::ProjectData;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const LOGS_DIR: &str = "logs";
const KEEP_DAYS: i64 = 14;
const MAX_FILE_BYTES: u64 = 5 * 1024 * 1024;
const MAX_FIELD_CHARS: usize = 64;
const SECONDS_PER_DAY: i64 = 86_400;

/// Điều đáng ghi của một lượt; không mang văn bản tự do.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LogEntry<'a> {
    Start,
    Tool(&'a str),
    Error(&'a str),
    End,
}

pub struct RunLog {
    dir: PathBuf,
    run_id: String,
    cli: String,
}

impl RunLog {
    /// `dir` là kết quả của [`ProjectData::dir`]. Xoá tệp log quá 14 ngày.
    pub fn new(dir: PathBuf, run_id: &str, cli: &str) -> Self {
        let log = Self {
            dir,
            run_id: run_id.to_string(),
            cli: cli.to_string(),
        };

        log.prune(now_seconds());
        log
    }

    /// Ghi một dòng; lỗi ghi bị bỏ qua để không làm hỏng lượt chat.
    pub fn record(&self, entry: &LogEntry<'_>) {
        let _ = self.try_record(entry, now_seconds());
    }

    fn try_record(&self, entry: &LogEntry<'_>, seconds: i64) -> std::io::Result<()> {
        let line = line_for(&self.run_id, &self.cli, entry, seconds);
        let file = Path::new(LOGS_DIR).join(format!("{}.log", date_of(seconds)));

        ProjectData::append_line(&self.dir, &file, &line, MAX_FILE_BYTES).map(|_| ())
    }

    fn prune(&self, seconds: i64) {
        let oldest = seconds.div_euclid(SECONDS_PER_DAY) - KEEP_DAYS;
        let Ok(entries) = fs::read_dir(self.dir.join(LOGS_DIR)) else {
            return;
        };

        for entry in entries.flatten() {
            let name = entry.file_name();
            let old = name
                .to_str()
                .and_then(|name| name.strip_suffix(".log"))
                .and_then(day_number_of)
                .is_some_and(|day| day < oldest);

            if old {
                let _ = fs::remove_file(entry.path());
            }
        }
    }
}

/// Dòng JSON của một mục; `runId` và `cli` do app đặt, phần còn lại qua danh sách cho phép.
fn line_for(run_id: &str, cli: &str, entry: &LogEntry<'_>, seconds: i64) -> String {
    let mut line = serde_json::json!({
        "ts": timestamp_of(seconds),
        "runId": run_id,
        "cli": cli,
    });

    match entry {
        LogEntry::Start => line["kind"] = "start".into(),
        LogEntry::End => line["kind"] = "end".into(),
        LogEntry::Tool(name) => {
            line["kind"] = "tool".into();
            line["name"] = safe_field(name, |c| {
                c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | ':' | '.')
            })
            .into();
        }
        LogEntry::Error(message) => {
            line["kind"] = "error".into();
            // * Only the key before `|`: what follows can be CLI text.
            let key = message.split('|').next().unwrap_or_default();

            line["key"] =
                safe_field(key, |c| c.is_ascii_lowercase() || matches!(c, '_' | '.')).into();
        }
    }

    line.to_string()
}

/// `value` nếu mọi ký tự hợp lệ và không quá dài, ngược lại `"other"`.
fn safe_field(value: &str, allowed: impl Fn(char) -> bool) -> &str {
    let valid =
        !value.is_empty() && value.chars().count() <= MAX_FIELD_CHARS && value.chars().all(allowed);

    if valid {
        value
    } else {
        "other"
    }
}

fn now_seconds() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| i64::try_from(elapsed.as_secs()).unwrap_or(0))
}

/// Ngày (năm, tháng, ngày) theo UTC của số ngày kể từ 1970-01-01.
fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let shifted = days + 719_468;
    let era = shifted.div_euclid(146_097);
    let day_of_era = shifted.rem_euclid(146_097);
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_part = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_part + 2) / 5 + 1;
    let month = if month_part < 10 {
        month_part + 3
    } else {
        month_part - 9
    };
    let year = year_of_era + era * 400 + i64::from(month <= 2);

    (year, month, day)
}

/// Số ngày kể từ 1970-01-01 của ngày (năm, tháng, ngày) theo UTC.
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let year = year - i64::from(month <= 2);
    let era = year.div_euclid(400);
    let year_of_era = year.rem_euclid(400);
    let month_part = if month > 2 { month - 3 } else { month + 9 };
    let day_of_year = (153 * month_part + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;

    era * 146_097 + day_of_era - 719_468
}

fn date_of(seconds: i64) -> String {
    let (year, month, day) = civil_from_days(seconds.div_euclid(SECONDS_PER_DAY));

    format!("{year:04}-{month:02}-{day:02}")
}

fn timestamp_of(seconds: i64) -> String {
    let in_day = seconds.rem_euclid(SECONDS_PER_DAY);

    format!(
        "{}T{:02}:{:02}:{:02}Z",
        date_of(seconds),
        in_day / 3_600,
        in_day % 3_600 / 60,
        in_day % 60
    )
}

/// Số ngày của tên tệp `yyyy-mm-dd`; `None` nếu tên không đúng dạng ngày.
fn day_number_of(date: &str) -> Option<i64> {
    let mut parts = date.split('-');
    let year = parts.next()?.parse().ok()?;
    let month: i64 = parts.next()?.parse().ok()?;
    let day: i64 = parts.next()?.parse().ok()?;

    if parts.next().is_some() || !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }

    Some(days_from_civil(year, month, day))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    // 2026-11-07T10:20:30Z
    const SAMPLE: i64 = 1_794_046_830;

    #[test]
    fn dates_round_trip_and_format() {
        assert_eq!(timestamp_of(0), "1970-01-01T00:00:00Z");
        assert_eq!(timestamp_of(951_782_400 + 86_399), "2000-02-29T23:59:59Z");
        let day = SAMPLE.div_euclid(SECONDS_PER_DAY);
        assert_eq!(date_of(SAMPLE), "2026-11-07");
        assert_eq!(day_number_of("2026-11-07"), Some(day));
        assert_eq!(day_number_of("nonsense"), None);
        assert_eq!(day_number_of("2026-13-01"), None);
    }

    #[test]
    fn lines_hold_only_allowed_fields() {
        let tool = line_for("r1", "claude", &LogEntry::Tool("Bash"), SAMPLE);
        let value: serde_json::Value = serde_json::from_str(&tool).unwrap();
        assert_eq!(
            value,
            serde_json::json!({
                "ts": "2026-11-07T10:20:30Z", "runId": "r1", "cli": "claude",
                "kind": "tool", "name": "Bash"
            })
        );

        let secret = line_for("r", "c", &LogEntry::Tool("rm -rf sk-ant-123"), SAMPLE);
        assert!(secret.contains("\"other\"") && !secret.contains("sk-ant"));

        let key = line_for(
            "r",
            "c",
            &LogEntry::Error("agent.limit_reached|five_hour"),
            SAMPLE,
        );
        assert!(key.contains("agent.limit_reached") && !key.contains("five_hour"));

        let free = line_for("r", "c", &LogEntry::Error("Invalid API key sk-123"), SAMPLE);
        assert!(free.contains("\"other\"") && !free.contains("sk-123"));
    }

    #[test]
    fn records_go_to_the_day_file_and_stop_at_the_size_limit() {
        let data = tempdir().unwrap();
        let dir = ProjectData::dir(data.path(), "app", "p1").unwrap();
        let log = RunLog::new(dir.clone(), "r1", "claude");

        log.try_record(&LogEntry::Start, SAMPLE).unwrap();
        log.try_record(&LogEntry::End, SAMPLE).unwrap();
        let text = fs::read_to_string(dir.join("logs/2026-11-07.log")).unwrap();
        assert_eq!(text.lines().count(), 2);

        let big = dir.join("logs/2026-11-08.log");
        fs::write(&big, vec![b'x'; usize::try_from(MAX_FILE_BYTES).unwrap()]).unwrap();
        log.try_record(&LogEntry::Start, SAMPLE + SECONDS_PER_DAY)
            .unwrap();
        assert_eq!(fs::metadata(&big).unwrap().len(), MAX_FILE_BYTES);
    }

    #[test]
    fn files_older_than_fourteen_days_are_removed() {
        let data = tempdir().unwrap();
        let dir = ProjectData::dir(data.path(), "app", "p1").unwrap();
        let logs = dir.join(LOGS_DIR);
        fs::create_dir_all(&logs).unwrap();
        for name in [
            "2026-10-20.log",
            "2026-10-24.log",
            "2026-11-07.log",
            "notes.txt",
        ] {
            fs::write(logs.join(name), "x").unwrap();
        }

        RunLog {
            dir: dir.clone(),
            run_id: String::new(),
            cli: String::new(),
        }
        .prune(SAMPLE);

        assert!(!logs.join("2026-10-20.log").exists());
        assert!(logs.join("2026-10-24.log").exists());
        assert!(logs.join("2026-11-07.log").exists());
        assert!(logs.join("notes.txt").exists());
    }
}
