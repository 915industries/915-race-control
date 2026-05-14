# 915 Race Control V1.6.2 — Deploy Bundle

**Built:** 2026-05-13
**Target:** Railway
**Reason:** Line-crossing detector now wired into the START trigger as well as the finish. Official race clock begins at the actual line crossing, not when the prestage countdown hits zero. Aligns app timing with how SSCC/NORC officially score (line-to-line).

---

## What's in this bundle

Four files (replace existing on Railway): `index.html`, `sw.js`, `manifest.json`, `playstore-icon.png`. Service worker cache `v1.6.2`.

---

## What changed since V1.6.1

### START-line crossing detector (V1.6.2 — primary change)

The prestage countdown still runs as visual + audio mental prep. But for races with a defined `startLine` (sscc, norc_sb, norc_nb), the official race clock no longer starts when the countdown hits zero. Instead:

1. Countdown ends → race screen appears with **"WAITING FOR START LINE"** displayed in place of the delta.
2. As Tim rolls forward and the car physically crosses the start line, the detector fires.
3. App speaks **"Line. Clock running."** and the elapsed timer begins from that exact moment.
4. Distance odometer is reset to zero at the line crossing so the displayed distance matches official line-to-line measurement.

This matches how SSCC/NORC officially score: your elapsed time runs from when you cross the start timing line to when you cross the finish timing line. The released-at-time you enter in the app is just the prestage anchor; the official clock starts at the line.

### Gates protecting the start detector

- **Time gate:** Detector only ARMs after `state.armedStartUtcMs` (the scheduled released-at time) has elapsed. Detector cannot fire before countdown=0.
- **Geofence:** Detector requires car within 200 m of the line center.
- **Sign-flip:** Signed perpendicular distance must transition from <0 (approaching) to ≥0 (past).
- **Heading sanity:** Car heading must be within ±35° of polyline-derived race direction. Skipped if GPS heading is unavailable (e.g. at very low rollout speed), since the other gates are already strong.
- **Fail-safe for staged-past-line edge case:** If the very first armed fix shows the car already past the line (signed > 0), fire immediately. Covers the rare case where the car was staged in front of the timing line at countdown=0.

### `startLine` data added to Nevada race entries

| Race entry | Start line (shoulder A / shoulder B) |
|---|---|
| `sscc` | (38.837041, -115.010760) / (38.837021, -115.010662) — Lund |
| `norc_sb` | (38.837041, -115.010760) / (38.837021, -115.010662) — Lund |
| `norc_nb` | (37.627343, -115.221233) / (37.627372, -115.221326) — Hiko |

### Backwards compatibility

Races without `startLine` (BBORR south, BBORR north, custom): zero behavior change. The launchRace branch falls through to the existing behavior (`state.startedAtMs = state.armedStartUtcMs`), and the tickRace short-circuit never activates because `startArmedAtMs` is null for those races.

---

## Behavior dry-run (done before this bundle was built)

Synthetic NORC SB launch at Lund:

- Race-direction bearing computed at Lund: **199.6° (SSW)** — correct for SR-318 SB.
- **Scenario A (normal rollout):** Car staged 30 m behind line, rolls at 12.5 mph (typical rollout). Detector fires on the sign-flip at the fix where the car is +3.6 m past line center.
- **Scenario B (edge case, staged past line):** Car somehow staged 5 m past line at countdown=0. First armed fix detects `signed > 0`, fires immediately via fail-safe.

---

## Deploy procedure

1. Open Railway dashboard.
2. Find the Race Control service.
3. Upload all four files from this folder, replacing existing files.
4. Trigger redeploy.
5. Verify the public URL serves V1.6.2 before telling Tim/Josh to refresh.

## Post-deploy verification

1. Open the public URL on your laptop. Hard-refresh.
2. Setup ribbon should read **V1.6.2**.
3. Open DevTools → Application → Cache Storage. Should show `915rc-v1.6.2`.
4. Pick NORC Leg 1, set class 125 mph, advance through prestage to a manual launch. On the race screen the delta should display **"— — —"** with hint **"WAITING FOR START LINE"** until you can simulate a line crossing (which requires being physically near Lund — you won't be able to fully end-to-end test this from San Antonio).
5. Pick BBORR Leg 1, advance through prestage, manual launch. Race should behave **exactly as before** — clock running immediately, delta showing normally. (If BBORR behavior changed, V1.6.2 has a bug — rollback to V1.6.1.)

## Phones in the field

After Railway shows green:

1. Tim and Josh: close Race Control app fully (swipe up).
2. Re-open. Service worker pulls V1.6.2 in the background.
3. Confirm ribbon reads V1.6.2 before pre-stage.

---

## What changes in the car at race day

When Tim is on the grid and Josh sets up Setup → Prestage → countdown:

1. Same flow as before: countdown ticks down to released-at time.
2. At countdown=0, race screen appears.
3. **NEW:** instead of the live delta and elapsed time running immediately, the delta block reads **"WAITING FOR START LINE"** until Tim crosses the timing line.
4. The instant Tim's GPS position flips past the shoulder-A-to-shoulder-B line, the app speaks **"Line. Clock running."** and the race timer begins.
5. Everything after that is identical to V1.6.1 — delta, splits, course notes, sprint mode, finish detector, all unchanged.

For Josh: he no longer needs to mentally compensate for "released-at-time vs actual line-crossing time" — the app does it. The delta numbers Josh calls to Tim are now measured from the same start point the officials use.

---

## Known gaps (carries forward)

- **The Narrows audio warning** — still not implemented. Pace notes cover it.
- **Combined Mode UI** — still not implemented.

---

## Rollback

- V1.6.1 bundle: `../RACE-CONTROL-V1.6.1-DEPLOY.zip`
- V1.6.0 bundle: `../RACE-CONTROL-V1.6.0-DEPLOY.zip`
- V1.5.5 bundle: `../RACE-CONTROL-V1.5.5-DEPLOY.zip`

If the start detector fails to fire on the actual line (no GPS coverage at Lund, XGPS160 issue, etc.) and Tim is sitting at the line with "WAITING FOR START LINE" stuck on screen, **rollback option exists but is overkill** — instead, Josh can press the manual LAUNCH NOW button on Prestage which sets `state.startedAtMs` to the scheduled time, falling back to V1.5.x behavior. The line-crossing detector is opt-in via the `startLine` race definition; the existing manual override path is unchanged.
