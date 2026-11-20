-- Drops the superseded PKCE session table.
--
-- 0003_codex_device.sql moved Codex authorization to the device-code flow;
-- codex_oauth_sessions has had no DAO, reader, or writer since. Dropping it
-- removes dead schema without touching any live data path. Reversible only by
-- re-creating the table from 0002 if a future flow needs it again.
DROP TABLE IF EXISTS codex_oauth_sessions;
