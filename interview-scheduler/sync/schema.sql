CREATE TABLE IF NOT EXISTS remote_busy (
 event_id TEXT PRIMARY KEY,
 interviewer TEXT NOT NULL CHECK (interviewer IN ('li','zhang')),
 start_ms INTEGER NOT NULL,
 end_ms INTEGER NOT NULL,
 updated_ms INTEGER NOT NULL,
 CHECK (end_ms > start_ms)
);
CREATE INDEX IF NOT EXISTS remote_by_person_time ON remote_busy(interviewer,start_ms,end_ms);
CREATE TABLE IF NOT EXISTS manual_bookings (
 id TEXT PRIMARY KEY,
 interviewer TEXT NOT NULL CHECK (interviewer IN ('li','zhang')),
 start_ms INTEGER NOT NULL,
 end_ms INTEGER NOT NULL,
 note TEXT NOT NULL DEFAULT '',
 created_ms INTEGER NOT NULL,
 CHECK (end_ms > start_ms)
);
CREATE INDEX IF NOT EXISTS manual_by_person_time ON manual_bookings(interviewer,start_ms,end_ms);
