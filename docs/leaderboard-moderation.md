# Leaderboard moderation and removal

The player-supplied nickname is publicly visible UGC. The [Play UGC policy](https://support.google.com/googleplay/android-developer/answer/9876937?hl=en) requires rules acceptance before uploading, objectionable-content rules, effective ongoing moderation, and in-app reporting/blocking for public UGC. Filtering unsafe HTML/characters alone is insufficient.

This checkout adds the minimum workflow without accounts: disclosure/acceptance beside Submit; Privacy / Leaderboard Rules; High Scores > Report / Block; selection of an entry from the current page; three fixed reasons; HTTPS report submission with explicit failure/retry; and persistent device-local nickname blocking/unblocking. Reports target both the public content and its displayed nickname. Blocks hide matching rows and names in the High Scores personal-best line. Server rank/total/page numbers stay authoritative. Duplicate nicknames are shared, and a person changing names evades a name block. **This is a limitation, not verified compliance with Google's user-blocking requirement.** Confirm this accountless interpretation with Play review/support before claiming full UGC compliance; if rejected, decide between stable pseudonymous player identity (new scope) or replacing freeform nicknames. Do not silently claim names are unique users.

Existing nickname sanitation, admin hide/unhide API and credentials are preserved. Reports do not automatically hide scores (avoids report brigading); per-IP 10/hour and global 1,000/hour limits cap reporting writes. One record per score/IP hash, fixed reasons only, 30-day cron cleanup. No report history/nickname text/reporter data is public. No email, user profile, analytics client, public moderation endpoint or complex dashboard was added.

## Operator queue and decisions

Migration `0003_reports.sql` must be applied in the same environment before using the new Worker. Production migration/deployment was not performed. Review reports promptly and routinely (recommended daily while testing, set sustainable coverage before public release). The 30-day retention is a cleanup limit, not a promise to review only monthly. There are no automatic notifications; assign a responsible person. The operator can read the queue through authorized D1 tooling, using this bounded query:

```sql
SELECT r.score_id, r.reason, r.created_at, s.nickname, s.score,
       s.completed_at, s.visibility
FROM score_reports r JOIN scores s ON s.id = r.score_id
ORDER BY r.created_at ASC LIMIT 100;
```

Use the existing `POST /api/v1/admin/scores/:id/visibility` with Bearer `ADMIN_TOKEN` and `{ "visible": false, "reason": "policy violation" }` to hide, or `visible: true` to unhide. Do not paste the secret into a browser frontend or shell history. Resolved reports can be removed by an authorized operator in D1 with a parameterized `DELETE FROM score_reports WHERE score_id = ?`; otherwise they expire automatically. Never place reporter hashes in public replies. Keep moderation explanations short and avoid copying abusive/personal content into `hidden_reason`. Hiding retains both score and run.

## Privacy removal

Before publication establish the public mailbox, who monitors it, how ownership/context is checked, and correspondence retention. Nickname or public score ID alone is not ownership proof, and the app has no account identity. Ask for minimal context (score/date/device-local record or other contextual evidence); do not ask for identity documents or infer sole ownership from a shared IP. Multiple entries with a shared nickname are not necessarily the same player. Do not bulk-delete all records matching a name or IP without assessing the request.

Additional server erasure is required if the policy offers removal of linked records: hide/unhide alone is insufficient. New `POST /api/v1/admin/scores/:id/delete` uses the same admin authorization and failed-auth throttling, is absent with administration disabled, has no browser CORS, and atomically deletes the score followed by its accepted run (including replay/token/IP hashes); reports cascade. It does not change unrelated scores/runs. This is an operator action after request review, not a public deletion button based on a guessable ID. No production records were deleted by this task.

Public caches advertise five seconds; other people's copies cannot be recalled. Per-IP rate counters expire separately at cron cleanup; the route does not delete all activity from a shared network. Account-level Cloudflare logs, D1 Time Travel and exports are outside this route. Confirm provider retention; record and reapply approved erasures if restoring a pre-deletion database, without retaining the deleted personal fields unnecessarily. No promise of immediate backup deletion or a guaranteed response time is made.

For local verification use unit tests against disposable SQLite and browser tests against `wrangler dev --local` with temporary D1. Never point migration, queue test seeding or erasure tests at `--remote` production.
