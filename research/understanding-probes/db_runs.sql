-- Aggregate run/gap/recurrence statistics (counts only).
.mode list
.separator ' | '
WITH e AS (
  SELECT timestamp, end_timestamp, app_bundle_id, COALESCE(url_host,'') host, COALESCE(context_key,'') ck, category, COALESCE(content_kind,'') kind, COALESCE(content_id,'') cid,
         date(timestamp/1000,'unixepoch','localtime') d,
         LAG(timestamp) OVER (ORDER BY timestamp) prev_ts,
         LAG(app_bundle_id) OVER (ORDER BY timestamp) prev_app,
         LAG(COALESCE(url_host,'')) OVER (ORDER BY timestamp) prev_host,
         LAG(category) OVER (ORDER BY timestamp) prev_cat
  FROM events WHERE timestamp >= (strftime('%s','now')-30*86400)*1000
)
SELECT 'gap_buckets_min', CASE WHEN prev_ts IS NULL THEN 'first' WHEN (timestamp-prev_ts)/60000.0 <= 3 THEN '<=3' WHEN (timestamp-prev_ts)/60000.0 <= 10 THEN '3-10' WHEN (timestamp-prev_ts)/60000.0 <= 30 THEN '10-30' WHEN (timestamp-prev_ts)/60000.0 <= 120 THEN '30-120' ELSE '>120' END b, COUNT(*) FROM e GROUP BY b;
WITH e AS (
  SELECT timestamp, app_bundle_id, COALESCE(url_host,'') host, category,
         LAG(timestamp) OVER (ORDER BY timestamp) prev_ts,
         LAG(app_bundle_id) OVER (ORDER BY timestamp) prev_app,
         LAG(COALESCE(url_host,'')) OVER (ORDER BY timestamp) prev_host,
         LAG(category) OVER (ORDER BY timestamp) prev_cat
  FROM events WHERE timestamp >= (strftime('%s','now')-30*86400)*1000
)
SELECT 'adjacent_pairs_le10min', COUNT(*),
       'app_change', SUM(app_bundle_id IS NOT prev_app),
       'app_or_host_change', SUM(app_bundle_id IS NOT prev_app OR host<>prev_host),
       'cat_change', SUM(category IS NOT prev_cat),
       'same_app_cat_change', SUM(app_bundle_id IS prev_app AND category IS NOT prev_cat),
       'same_app_pairs', SUM(app_bundle_id IS prev_app),
       'diff_app_same_cat', SUM(app_bundle_id IS NOT prev_app AND category IS prev_cat)
FROM e WHERE prev_ts IS NOT NULL AND (timestamp-prev_ts) <= 600000;
-- sessions: split at gaps > 10 min
WITH e AS (
  SELECT timestamp, date(timestamp/1000,'unixepoch','localtime') d, LAG(timestamp) OVER (ORDER BY timestamp) prev_ts
  FROM events WHERE timestamp >= (strftime('%s','now')-30*86400)*1000
), s AS (
  SELECT timestamp, d, SUM(CASE WHEN prev_ts IS NULL OR timestamp-prev_ts > 600000 THEN 1 ELSE 0 END) OVER (ORDER BY timestamp) sid FROM e
), ss AS (SELECT sid, COUNT(*) n, MIN(d) d FROM s GROUP BY sid)
SELECT 'sessions_gt10min_gap', COUNT(*), 'avg_caps', ROUND(AVG(n),1), 'max_caps', MAX(n), 'sessions_per_active_day', ROUND(COUNT(*)*1.0/COUNT(DISTINCT d),1) FROM ss;
-- per day captures
WITH pd AS (SELECT date(timestamp/1000,'unixepoch','localtime') d, COUNT(*) n FROM events WHERE timestamp >= (strftime('%s','now')-30*86400)*1000 GROUP BY d)
SELECT 'captures_per_active_day', 'min', MIN(n), 'avg', ROUND(AVG(n),1), 'max', MAX(n) FROM pd;
-- context-key runs
WITH e AS (
  SELECT timestamp, app_bundle_id || '|' || COALESCE(url_host,'') k, LAG(app_bundle_id || '|' || COALESCE(url_host,'')) OVER (ORDER BY timestamp) pk
  FROM events WHERE timestamp >= (strftime('%s','now')-30*86400)*1000
), r AS (SELECT timestamp, k, SUM(CASE WHEN pk IS NULL OR pk<>k THEN 1 ELSE 0 END) OVER (ORDER BY timestamp) rid FROM e),
rr AS (SELECT rid, COUNT(*) n FROM r GROUP BY rid)
SELECT 'app_host_runs', COUNT(*), 'avg_len', ROUND(AVG(n),2), 'len1_share', ROUND(SUM(n=1)*1.0/COUNT(*),3), 'len_ge10', SUM(n>=10) FROM rr;
-- recurrence: app|host keys seen on >=2 / >=3 distinct days
WITH k AS (SELECT app_bundle_id || '|' || COALESCE(url_host,'') k, COUNT(DISTINCT date(timestamp/1000,'unixepoch','localtime')) nd, COUNT(*) n FROM events WHERE timestamp >= (strftime('%s','now')-30*86400)*1000 GROUP BY k)
SELECT 'app_host_keys', COUNT(*), 'on_ge2_days', SUM(nd>=2), 'on_ge5_days', SUM(nd>=5), 'captures_in_ge5day_keys_share', ROUND(SUM(CASE WHEN nd>=5 THEN n ELSE 0 END)*1.0/SUM(n),3) FROM k;
WITH t AS (SELECT window_title, COUNT(DISTINCT date(timestamp/1000,'unixepoch','localtime')) nd, COUNT(*) n FROM events WHERE timestamp >= (strftime('%s','now')-30*86400)*1000 AND window_title IS NOT NULL AND window_title<>'' GROUP BY window_title)
SELECT 'window_titles', COUNT(*), 'on_ge2_days', SUM(nd>=2), 'singleton_titles', SUM(n=1) FROM t;
WITH c AS (SELECT content_id, COUNT(DISTINCT date(timestamp/1000,'unixepoch','localtime')) nd FROM events WHERE timestamp >= (strftime('%s','now')-30*86400)*1000 AND content_id IS NOT NULL AND content_id<>'' GROUP BY content_id)
SELECT 'content_ids', COUNT(*), 'on_ge2_days', SUM(nd>=2) FROM c;
-- caption length shape
SELECT 'caption_len_avg', ROUND(AVG(LENGTH(caption)),0), 'title_len_avg', ROUND(AVG(LENGTH(window_title)),0) FROM events WHERE timestamp >= (strftime('%s','now')-30*86400)*1000;
-- hours of day histogram (active)
SELECT 'hour_hist', strftime('%H', timestamp/1000,'unixepoch','localtime') h, COUNT(*) FROM events WHERE timestamp >= (strftime('%s','now')-30*86400)*1000 GROUP BY h;
