# Rabbit Hole promo — storyboard

70 s, 1440×1080, 60 fps. Music: Quartz 3:18 → 4:28, fading over the last 5 s (99.75 BPM measured,
first downbeat at 0.3675 s; key D#/Eb minor). Every scene boundary sits on a bar line of that grid.
Stills are cut from the final video by `scripts/finish.mjs` (`out/storyboard/`), so they show the CRT
pass exactly as rendered. Every screen is the real dashboard or sidebar (the shipped webview bundle),
driven with the invented showcase data; the VS Code window, terminal and floating tab cards are the
allowed extras.

Sound legend: **K** = Kenney CC0 recording, **S** = synthesised (`scripts/synth.mjs`), **D** = the
Mixkit hum. No two effect onsets are closer than 2 frames (scheduler + test; 347 cues, 29 nudged, by
at most 2 frames).

## 1 · Power-on — 0:00.00–0:05.18 (frames 0–311)

![](out/storyboard/01-powerOn.png)

- **Motion:** black tube; a white-hot line spreads, opens into a picture with a flash; the carrot
  (the extension's own 14×10 grid) draws itself pixel by pixel in reading order, each pixel popping
  white then settling to its colour; it breathes, then flies to where the Activity Bar will be.
- **Caption:** —
- **Sound:** boot (S); one pitched pixel blip per pixel (67, every 3 frames, climbing the Eb minor
  pentatonic, S); a thud on the downbeat as it settles (S); whoosh on the flight (K).

## 2 · Hook — 0:05.18–0:14.80 (311–888)

![](out/storyboard/02-hook.png)

- **Motion:** the VS Code window floats in and settles; a fisheye push-in onto the status bar's
  real `$(rabbithole-carrot) 3h39m / 20m`, which ticks to 3h40m; release; the mouse glides to the
  Activity Bar carrot (overshoot), hovers (glow), clicks; the real Rabbit Hole view slides open and
  counts up; the camera follows into the sidebar; hovering rabbithole-cli narrows the view to it (real
  hover focus); the mouse clicks **open dashboard** and the camera dives into the button.
- **Caption:** **WHERE DID TODAY GO?** — slam with motion blur, top.
- **Sound:** open (K); drone (D) + short riser (S) under the zoom; tick on 3h40m (S); air sweep out
  (S); hover, click, release (K); swipe as the sidebar opens (K); count ticks (S); whoosh on the dive
  (K); thud under the caption slam (S).

## 3 · Today — 0:14.80–0:24.43 (888–1466)

![](out/storyboard/03-today.png)

- **Motion:** the dashboard opens out of the dive (blur to sharp); the hero total counts up to
  3h40m; the day tape fills cell by cell; the target meter grows to "met at 14:32"; the camera pans to
  languages; the mouse hovers go, then typescript — the real focus narrows the tape and the hero
  ("go only", "1h04m of 3h40m").
- **Caption:** **EVERY MINUTE. EVERY LANGUAGE.** — scrambled-letter decode, bottom.
- **Sound:** open (K); count ticks and tape ticks (S, interleaved); riser under the meter (S); a
  bright blip when it is met (S); air sweep on the pan (S); hovers (K); whoosh out (K); the decode's
  sweep and letter chatter (S).

## 4 · The month — 0:24.43–0:34.05 (1466–2043)

![](out/storyboard/04-month.png)

- **Motion:** the dashboard card swings in among floating tab cards; the mouse clicks **30d**; thirty
  day columns drop into place one by one with a bounce; the range head counts to 75h; the time-of-day
  tape fills; the mouse hovers two columns and the real tooltip answers (4h11m, its sessions and
  projects); the camera follows the mouse; the card swings out.
- **Caption:** **EVERY DAY, AT A GLANCE.** — stretch-snap, bottom.
- **Sound:** swipe (K); one blip per column, climbing the scale (30, ~3 frames apart, S); riser
  (S); hovers, click, release (K); ticks as tooltips open (S); whoosh out (K) and in (caption).

## 5 · Wow: the agent — 0:34.05–0:43.68 (2043–2621), on the first dip

![](out/storyboard/05-agent.png)

- **Motion:** README.md stays focused; a terminal slides up and an agent types
  `agent "add a --json flag to rabbithole week"`; its edits stream in (+60 −20 in Go); the real
  languages panel (rabbithole-cli) floats in; the mouse clicks back into the editor — the held span
  resolves and the panel's numbers move: go 42m → 1h04m, markdown 40m → 18m, Go's lines +24 → +84
  (time only moves, never adds); a green flash; the mouse hovers go.
- **Caption:** **YOUR AGENT CODES. RABBIT HOLE KNOWS.** — glitch slices with RGB split, bottom;
  **flickers** once.
- **Sound:** swipe (K); key clicks every third character (S); output ticks (S); air sweep as the card
  enters (S); click (K); long riser under the shift and a blip as it lands (S); thud under the glitch
  entrance, glitch stutter on the flicker (S); whoosh out (K).

## 6 · The year — 0:43.68–0:50.90 (2621–3054)

![](out/storyboard/06-year.png)

- **Motion:** the activity tab rises in; the year stats count up (296 active days, 684h, 34d); the
  heatmap cascades in week by week; the project share bar and rows grow; hovering rabbithole-cli
  narrows the stats and the heatmap to it (real hover); out.
- **Caption:** **A WHOLE YEAR OF YOU.** — slam, bottom.
- **Sound:** swipe (K); count ticks and soft heat ticks (S); riser under the shares (S); hover (K);
  thud (S); whoosh (K).

## 7 · Streaks — 0:50.90–0:58.12 (3054–3487), on the second dip

![](out/storyboard/07-streaks.png)

- **Motion:** the projects tab's cards flip in one after another; quill-api reads "6d · streak, at
  risk today"; the camera pushes in; the mouse clicks it back on track (a real live update: 26m today,
  7d, "at risk" gone) and the card glows.
- **Caption:** **KEEP THE STREAK.** — decode, top; **flickers** on the dip.
- **Sound:** a swipe per card (K); count ticks (S); hover, click, release (K); two rising blips
  (S); decode sweep and chatter (S); glitch on the flicker (S); whoosh (K).

## 8 · Share — 0:58.12–1:02.92 (3487–3775)

![](out/storyboard/08-share.png)

- **Motion:** settings slide in; the mouse clicks **export…**; the real export dialog opens and its
  real share card preview draws in top to bottom; the mouse clicks **export** and the card flies up
  and out of the screen, growing and turning.
- **Caption:** **SHARE IT.** — stretch-snap, top.
- **Sound:** swipe, hover, click, release (K); open (K); draw ticks (S); whoosh plus an air sweep
  as the card flies (K + S).

## 9 · Local — 1:02.92–1:05.33 (3775–3920)

![](out/storyboard/09-local.png)

- **Motion:** the whole dashboard is sucked into a point, light streaks fall inward, and the carrot
  bursts out of it with a ring.
- **Caption:** **NO ACCOUNT. NO CLOUD. JUST YOUR MACHINE.** — decode, bottom; **flickers**; holds
  into the end card.
- **Sound:** a long falling sweep (S); thud as it lands (S); decode sweep and chatter, glitch (S).

## 10 · End card — 1:05.33–1:10.00 (3920–4200)

![](out/storyboard/10-end.png)

- **Motion:** the carrot breathes and glows; **RABBIT HOLE** slams in; **LIVE ON VSCODE MARKETPLACE**
  opens in an amber pill (the dashboard's pressed-button colours) and decodes; a final glow pulse; a
  slow push-in; fade to black with the music.
- **Sound:** thud (S); Eb minor bell arpeggio (S) and an air sweep; a final soft thud (S).
