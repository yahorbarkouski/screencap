-- Aggregate-only shape of the v1 events table (no titles, captions, OCR or images are selected).
.mode list
.separator ' | '
SELECT 'events_last_30d', COUNT(*) FROM events WHERE timestamp >= (strftime('%s','now')-30*86400)*1000;
SELECT 'ts_unit_check_max', MAX(timestamp) FROM events;
SELECT 'days_with_events_30d', COUNT(DISTINCT date(timestamp/1000,'unixepoch','localtime')) FROM events WHERE timestamp >= (strftime('%s','now')-30*86400)*1000;
SELECT 'duration_s_buckets', CASE WHEN end_timestamp IS NULL THEN 'null' WHEN (end_timestamp-timestamp)/1000 < 90 THEN '<90' WHEN (end_timestamp-timestamp)/1000 < 150 THEN '90-150' WHEN (end_timestamp-timestamp)/1000 < 330 THEN '150-330' ELSE '>=330' END b, COUNT(*) FROM events WHERE timestamp >= (strftime('%s','now')-30*86400)*1000 GROUP BY b;
SELECT 'category', category, COUNT(*) FROM events WHERE timestamp >= (strftime('%s','now')-30*86400)*1000 GROUP BY category ORDER BY 3 DESC;
SELECT 'distinct_apps', COUNT(DISTINCT app_bundle_id) FROM events WHERE timestamp >= (strftime('%s','now')-30*86400)*1000;
SELECT 'distinct_hosts', COUNT(DISTINCT url_host) FROM events WHERE timestamp >= (strftime('%s','now')-30*86400)*1000;
SELECT 'distinct_window_titles', COUNT(DISTINCT window_title) FROM events WHERE timestamp >= (strftime('%s','now')-30*86400)*1000;
SELECT 'with_url_host', SUM(url_host IS NOT NULL AND url_host<>''), 'with_content_kind', SUM(content_kind IS NOT NULL AND content_kind<>''), 'with_title', SUM(window_title IS NOT NULL AND window_title<>'') FROM events WHERE timestamp >= (strftime('%s','now')-30*86400)*1000;
SELECT 'content_kind', content_kind, COUNT(*) FROM events WHERE timestamp >= (strftime('%s','now')-30*86400)*1000 GROUP BY content_kind ORDER BY 3 DESC;
SELECT 'context_provider', context_provider, COUNT(*) FROM events WHERE timestamp >= (strftime('%s','now')-30*86400)*1000 GROUP BY context_provider ORDER BY 3 DESC;
SELECT 'status', status, COUNT(*) FROM events WHERE timestamp >= (strftime('%s','now')-30*86400)*1000 GROUP BY status;
SELECT 'user_labeled', COUNT(*) FROM events WHERE user_label IS NOT NULL AND user_label<>'' ;
SELECT 'project_nonnull_30d', COUNT(*), COUNT(DISTINCT project) FROM events WHERE project IS NOT NULL AND project<>'' AND timestamp >= (strftime('%s','now')-30*86400)*1000;
SELECT 'event_screenshots_rows', COUNT(*) FROM event_screenshots;
