# Race Control V1.6.5 — Deploy Bundle

Cache: v1.6.5. Push index.html + sw.js to GitHub → Railway. Phones close + reopen to refresh.

## What's new vs V1.6.4
**CP6 / red-flag finish awareness.** Per Josh: if the course is red-flagged mid-event,
Checkpoint 6 becomes the official scoring finish point for both legs. V1.6.5 wires this
into the timer:

- CP6 is now a special split at mile 57.243 (SB) / 32.767 (NB) — from the official 2026
  NORC course notes.
- A dedicated **CP6 / RED-FLAG FINISH** banner is on the race screen above the splits:
  - **Before CP6:** live cumulative average mph + projected delta at CP6 + miles to CP6.
  - **At CP6:** banner flashes green and the snapshot LOCKS — those are the numbers if
    the race is red-flagged from this point on.
  - **After CP6:** the locked snapshot stays visible as the red-flag reference.
- Audio callout fires the instant CP6 is crossed: "Checkpoint six. Red flag finish point.
  Average X miles per hour. Delta plus/minus Y seconds."
- The CP6 entry in the course-notes panel is now a hazard, so Josh gets a verbal warning
  a moment before arrival.
- The JSON run export carries `red_flag_checkpoint` with mile, elapsed, perfect_sec,
  delta, avg_mph, class — recorded whether or not a red flag actually happens.

## Validation
Replayed against Josh's May 14 SB practice track: CP6 (mile 57.243) crossed at elapsed
2673 s, cumulative average 77.1 mph vs class target 75, delta -74.7 s at CP6
(consistent with the prior pacing finding — they ran hot through the first 63 miles).
