# 915 Race Control V1.6.3 — Deploy Bundle

**Built:** 2026-05-13
**Target:** Railway (same service as V1.6.2)
**Reason:** Independent Event now supports two-shoulder line capture. Any custom course gets the same line-crossing accuracy upgrade as the prebaked Nevada races.

---

## Bundle contents
Four files: `index.html`, `sw.js` (cache `v1.6.3`), `manifest.json`, `playstore-icon.png`.

## What changed since V1.6.2

- **Two-shoulder line capture for any race.** Setup screen Start Line and Finish Line cards each now have a "Shoulder Capture" section with four buttons total: Shoulder A, Shoulder B for the start line; Shoulder A, Shoulder B for the finish line. When both shoulders of a line are captured, the app computes the midpoint, persists it as the line center, stores the segment as `RACES[raceKey].startLine` / `finishLine`, and the V1.6.1/V1.6.2 line-crossing detector activates automatically for that race.
- **Independent Event race-direction fallback.** Races without a route polyline (Independent Event) now derive race direction from the start→finish bearing instead of returning null. Validates the sign convention so line-crossing math works on any custom course.
- **Persistence.** Shoulder captures are saved to `localStorage` and re-applied on app launch via `reapplyAllShoulders()`. A phone reboot doesn't lose the wiring.
- **Backwards compatibility.** Single-point Capture Here still works exactly as in V1.5.x. If only one shoulder is captured, the line-crossing detector silently skips and the race falls back to point + 25 m radius. Capturing a new single point also clears any stale shoulders for that direction.
- **Sanity check.** Shoulder spread is expected to be 5–20 m (road width). If the user captures shoulders that are under 3 m or over 30 m apart, the app asks "Are you sure?" with the option to redo.
- **Display feedback.** Each card shows a status line: "LINE-CROSSING ACTIVE" with coords + spread + bearing, or "PARTIAL — shoulder A captured, need shoulder B", or fallback "Falls back to point + 25 m radius gate."

## Upgrade procedure
Same as V1.6.2: replace four files on Railway, redeploy, hard-refresh laptop to confirm V1.6.3 ribbon, have Tim and Josh relaunch their phones.

## Post-deploy verification
1. Setup ribbon reads **V1.6.3**.
2. NORC Leg 1 still shows perfect time **43:12.000** at class 125. Both NORC entries still show "LINE-CROSSING ACTIVE (factory shoulders)" in the new status line.
3. Select **Independent Event** from the race picker. Set distance, capture start, capture finish. The shoulder section should show "Falls back to point + 25 m radius gate" because no shoulders have been captured. Then tap Shoulder A, walk a few feet, tap Shoulder B. Status should change to "LINE-CROSSING ACTIVE" with the spread + bearing line.

## What this enables in the field
Any club event, closed-course test, or non-published race can now get the same line-crossing precision as NORC and SSCC. Park on shoulder A, capture. Drive across, capture B. Repeat at the finish. Race-day timing is sub-100 ms when XGPS160 is feeding clean.

## Known gaps (carried forward)
- Narrows audio warning still not in.
- Combined Mode UI still not in.

## Rollback
- V1.6.2 bundle: `../RACE-CONTROL-V1.6.2-DEPLOY.zip`
- V1.6.1 bundle: `../RACE-CONTROL-V1.6.1-DEPLOY.zip`
- V1.5.5 bundle: `../RACE-CONTROL-V1.5.5-DEPLOY.zip`
