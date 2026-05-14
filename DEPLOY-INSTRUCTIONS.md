# 915 Race Control V1.6.4 — Deploy Bundle

Built 2026-05-14. Push index.html + sw.js to GitHub → Railway. Cache: v1.6.4.

## What changed (race-critical — deploy before NORC)

1. **Removed the corrupted perfectTimesSec lookup table.** It was feeding wrong
   perfect times — the NB 80 practice run got 2882.1 s instead of the correct
   2762.1 s, a 120-second error. getPerfectSec now uses the clean
   distance ÷ class × 3600 formula, exact against the official course-note
   distances (SB 90.00 mi, NB 61.38 mi).

2. **Splits + live delta now anchored to polyline-projected course progress**
   (state.courseProgressMi) instead of raw GPS-integration odometer. Raw
   integration over-measures ~0.1-0.4%, which drifted the splits ahead of the
   real course (the false "+0.12 at the line" on the SB run). Validated against
   both real practice runs — course progress lands exactly on the official
   distance at the finish, splits now agree with the main clock.

3. **Start/finish coordinates restored to the official NORC course-note values.**
   They had been drifted 1-4 m by an earlier mistaken "shoulder capture" change.

4. **Class list trimmed to the official set:** 95-160 in 5-mph steps, then 170,
   180. Removed the phantom 55-90 and 165/175/185+ classes.

## Verify after deploy
- Ribbon reads V1.6.4
- NORC Leg 1, class 125 → perfect time 43:12.000
- NORC Leg 2, class 125 → perfect time 29:27.744
