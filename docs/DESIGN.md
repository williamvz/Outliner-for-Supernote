# Design sketch: Nomad pen + Tana companion

Status: **sketch for discussion**, 2026-10-27. Nothing is built yet.

## TL;DR

- **Build a Supernote plugin, not a standalone APK.** Supernote now ships an
  official plugin SDK for Manta/Nomad (`sn-plugin-lib`, React Native 0.79.2).
  A plugin:
  - puts buttons in the *native* Notes toolbar and lasso toolbar,
  - opens a full-screen panel,
  - reads lasso-selected handwriting and runs the device's own handwriting
    recognition on it,
  - exports the selection as a PNG,
  - makes network requests once you grant it permission.

  You keep writing with Supernote's own pen and ink engine, so the brief's
  biggest unknown ("is our own canvas fast enough on e-ink?") goes away.
- **The backend stays as briefed.** A Cloudflare Worker holds every secret. It
  talks to Tana through the hosted MCP server (`app.tana.inc/mcp`, which uses
  OAuth) and to Claude for vision and translation.
- **Milestone 1 becomes a half-day feasibility spike** instead of a
  pen-latency spike. GitHub Actions builds a "hello" plugin, you install it on
  the Nomad, and it proves recognition, PNG export and network access.
- **The brief's native-APK plan stays as the fallback.** Sideloading has
  existed since firmware 3.16.27. The cloud-folder OCR plan is the fallback
  after that.

---

## 1. What changed since the brief

| Brief assumption | What I found |
| --- | --- |
| Custom code means a sideloaded APK with its own drawing canvas, and pen feel is the big unknown. | Supernote has an official **plugin system**. NOTE and DOC load plugins through a "PluginHost" service, plugins register toolbar and lasso-toolbar buttons, and you install a `.snplg` package via *Settings → Apps → Plugins*. Writing happens in the native NOTE app. One review called third-party APKs "laggy with the stylus". |
| Unknown whether Supernote exposes a fast-ink or refresh hook. | I found no public fast-ink or refresh API for APKs. The plugin route makes the question irrelevant. |
| OCR goes to a vision model. | The plugin SDK has `recognizeElements(strokes) → text`, which uses the device's own recognizer, and `generateLassoPreview(path) → PNG`. We can send both and let the model use the device OCR as a draft. |
| Tana access: hosted MCP or Input API, to verify. | **Hosted MCP**: OAuth only, works without the desktop app, needs a paid plan, still in beta. Its tools include `search_nodes`, `read_node`, `check_node`, `uncheck_node`, `import_tana_paste`, `get_or_create_calendar_node`, `set_field_content` and `edit_node`. The **local MCP** needs the desktop app running, so a Worker can't use it. The **Input API** is write-only, so it can't read tasks. **Decision: hosted MCP.** |

---

## 2. Architecture

```
 Supernote Nomad (Chauvet, Android 11 based)
┌───────────────────────────────────────────────────────────────┐
│  NOTE app: native pen, native ink, native refresh             │
│    toolbar:  [Today]              lasso toolbar:  [→ Tana]    │
│        │ (AIDL button events)                                 │
│  PluginHost (React Native 0.79 runtime)                       │
│    "Tana" plugin                                              │
│      TaskPanel · SendPanel · ConfigPanel                      │
│      plugin private dir: config.json, tasks.json, outbox/     │
└───────────────┬───────────────────────────────────────────────┘
                │ HTTPS, Authorization: Bearer <device passphrase>
                │ (only when Wi-Fi is on; otherwise the outbox waits)
┌───────────────▼───────────────────────────────────────────────┐
│  Cloudflare Worker  (TypeScript)                              │
│    GET  /tasks     POST /done     POST /note                  │
│    KV: idempotency (opId → result)                            │
│    Durable Object "TanaSession": OAuth tokens + MCP client    │
│    secrets: DEVICE_TOKEN_HASH, ANTHROPIC_API_KEY              │
└───────┬──────────────────────────────────────┬────────────────┘
        │ MCP over Streamable HTTP (OAuth)     │ Messages API (image + text)
        ▼                                      ▼
   app.tana.inc/mcp                       Claude (vision)
```

### 2.1 Plugin (`plugin/`)

- **Project:** generated from `@supernote-plugin/sn-plugin-template` and
  pinned to RN 0.79.2, which the host requires. `PluginConfig.json` holds a
  `pluginID` generated on the first build. We commit it and never change it.
- **Entry points:**
  - Toolbar button **Today** (NOTE) → TaskPanel.
  - Lasso toolbar button **→ Tana** (NOTE, `editDataTypes: [0]`, which means
    handwritten strokes) → SendPanel for the selection.
  - Config button → ConfigPanel, where you enter the Worker URL and the device
    passphrase.
  - *Later:* toolbar button **Page → Tana** to send the whole page.
- **Local state** lives in the plugin's private directory, the only path that
  needs no permission:
  - `config.json`
  - `tasks.json`: the last fetched top 5 plus local strike state
  - `outbox/*.json` and `outbox/*.png`: queued operations
- **Permissions:**
  - `plugin.permission.INTERNET` only. Choose **"Always allow"**: "Allow
    this time only" expires every session.
  - We avoid `FILE:READ` and `FILE:WRITE` by writing PNGs into the private
    directory. M0 verifies that `generateLassoPreview` accepts that path.
- **No secrets in the package.** The `.snplg` built in CI contains no token.
  You type the passphrase once in ConfigPanel. Four random words are easier to
  type on the e-ink keyboard than a hex string, and still strong enough when
  the Worker rate-limits failed attempts.

### 2.2 Worker (`worker/`)

- **Auth:** constant-time compare of `sha256(bearer)` with `DEVICE_TOKEN_HASH`.
  Everything else gets a 401.
- **Idempotency:** every write carries a client-generated `opId` (UUID). The
  Worker stores `opId → result` in KV for 7 days, so a replayed outbox never
  double-checks or double-creates.
- **TanaSession Durable Object:** owns the OAuth tokens. It refreshes them and
  runs MCP calls one at a time, so two concurrent requests never race a token
  refresh.
  - One-time setup: open `/oauth/start` in a phone browser, approve in Tana,
    and `/oauth/callback` stores the tokens. This uses standard MCP OAuth
    (dynamic client registration + PKCE).
  - Cloudflare's Agents SDK has built-in support for OAuth-protected remote MCP
    servers, which is likely the shortest path (verify in M0b). The fallback is
    `@modelcontextprotocol/sdk` with our own token store.
- **Claude** is used only in `/note`. Task reads and writes are plain,
  deterministic MCP calls with no LLM in the loop.
- **"Today"** is computed in `Europe/Amsterdam`. The plugin also sends its local
  date, which wins if it differs (travel).

---

## 3. Flows

### 3.1 Today's top 5

```
tap [Today]
  └─ TaskPanel renders tasks.json immediately (no network wait, one e-ink paint)
     └─ if online: GET /tasks → replace list → one repaint, "Synced 07:42"

tap a task row
  └─ toggle strike-through locally (instant, one repaint), write tasks.json
     └─ outbox: { opId, type: "done" | "undone", taskId, at }

close panel / tap [Sync] / next open
  └─ flush outbox (coalesced: done+undone on the same task cancel out)
     └─ POST /done → Worker → check_node / uncheck_node
```

Ops flush when the panel closes, not on every tap. An accidental tap is undone
by tapping again, with no network round trip and no undo timer, which wouldn't
work on e-ink anyway.

### 3.2 Handwriting → Tana

```
write in any NOTE page with the native pen
lasso the lines → tap [→ Tana]
  └─ SendPanel:
       getLassoElements()            → strokes
       recognizeElements(strokes)    → draft text (on-device)
       generateLassoPreview(privDir) → PNG
     shows the draft text + [Send] [Cancel]
tap [Send]
  └─ outbox: { opId, type: "note", draft, png, capturedAt, page }
     └─ POST /note → Worker:
          1. idempotency check (opId)
          2. Claude: image + draft → JSON { title, outline[], tasks[], ideas[], ... }
             (system prompt: output English only; translate if written in Dutch;
              keep the hierarchy from indents and bullets; don't invent content)
          3. build Tana Paste deterministically from that JSON
             (the LLM never writes raw Tana Paste)
          4. get_or_create_calendar_node(today) → import_tana_paste under it
          5. store opId → { memoId, title }
  └─ SendPanel: "Sent: <title>" or "Queued, 2 waiting for Wi-Fi"
```

*Optional, later:* after a successful send, stamp a small "→ Tana 27/10" text
box next to the lasso (`insertText`). Then the page shows what has already
been sent, like a ticked-off paper note. This needs `FILE:WRITE`.

### 3.3 Offline

- The Nomad usually has Wi-Fi off, so the outbox is not optional. It is also
  cheap: a folder of JSON files in the private directory.
- **Flush triggers:**
  - opening any panel,
  - closing the TaskPanel,
  - the [Sync] button,
  - right after queueing a note.

  Plugins have no reliable background execution, so we don't count on any.
- **Retries:** exponential backoff per op. After 5 failures an op is
  "stuck" and shown in ConfigPanel with the error. It is never silently
  dropped.
- **Recognition works offline** (to verify in M0), so the draft text is
  captured even without Wi-Fi.

---

## 4. API contract

All requests send `Authorization: Bearer <passphrase>`. Responses are JSON.

```http
GET /tasks?date=2026-10-27
→ 200 { "date": "2026-10-27", "generatedAt": "…",
        "tasks": [ { "id": "…", "name": "…", "priority": "P1",
                     "deadline": "2026-10-27", "overdueDays": 0 } ] }

POST /done   { "opId": "uuid", "taskId": "…", "done": true }
→ 200 { "ok": true }              (replaying the same opId returns the same body)

POST /note   { "opId": "uuid", "capturedAt": "ISO", "date": "2026-10-27",
               "draft": "device OCR text", "png": "<base64>",
               "source": { "file": "…", "page": 3 } }
→ 200 { "memoId": "…", "title": "…", "nodes": 7 }

→ 401 bad token · 409 opId in flight · 503 { "reauth": true } Tana OAuth needs a redo
```

---

## 5. Mapping to your Tana graph

I read your workspace schema (read-only) so this fits how you already work:

- **#task**:
  - done-status is the **checkbox** (`check_node`). The Task Status field is
    not the done-status.
  - Fields: Deadline Date, Priority (P1 Now / P2 Leverage / P3 Neutral,
    which is the default / P4 Overhead), Someday, Delegated to.
  - Your rule: new items go on **today's day node**.
- **#recurring task** extends #task, and **must never be checked**: that ends
  the series. Completing one means running Tana's *Complete and reschedule*
  command, which MCP can't trigger.
- **#memo** is your "raw capture with sorting bins": Tasks, Recurring tasks,
  Ideas, 1:1 notes, Discussion points. That is exactly what a handwritten
  brain-dump is.

### Proposed "top 5" query (v1)

```
#task  AND unchecked  AND NOT #recurring task
AND (   Deadline Date ≤ today AND Someday unchecked
     OR the task lives on today's day node )
AND name does not start with "🤖" (work for routines) or "Decide:" (answered with an Outcome child, not a check)
ORDER BY  Priority (P1, P2, then P3/P4),  Deadline Date ascending (oldest overdue first)
LIMIT 5
```

Why exclude recurring tasks in v1: a read-only test today for "unchecked #task
with Deadline Date ≤ today" returned **8 matches, all #recurring task**
(household chores, some with deadlines from 2023). A naive list would be
mostly chores you're not allowed to tick from the device. Later (M4), the
Worker could emulate *Complete and reschedule*: write a checked history copy,
then move Deadline Date forward by the Occurrence field ("In four weeks").

### Note shape in Tana

Today's day node gets a #memo. The Worker builds it from the model's JSON:

```
- Q4 hiring thoughts #memo
  - Tasks::
    - Ask finance for the Q4 headcount numbers
  - Ideas::
    - Pair new hires with a buddy for the first month
  - Need a second designer before January
    - Check whether the budget allows a senior
```

The bins are filled in English. The body keeps your handwritten hierarchy,
translated into English. The tag and field IDs live in Worker config, not in
code.

---

## 6. E-ink UI rules (plugin panels)

Nomad: 7.8", 1404×1872 px, 300 ppi.

- Pure black on white, with no greys that dither badly. The system font is
  large: 20sp+ body text, 28sp headers.
- **No scrolling.** The TaskPanel shows exactly 5 rows, each about 15 mm tall,
  and the whole row is the tap target. Names are clamped to 2 lines.
- **No animations.** Use `Pressable` without opacity or ripple feedback. No
  spinners: show static text ("Syncing…") instead.
- At most **two paints per interaction**: the cached state first, then the
  fresh state. Never a progressive render.
- Every panel has a full-width [Close] and a [Sync] or refresh button.

```
┌──────────────────────────────────────────┐
│  Tue 27 Oct · Top 5              [Sync]  │
├──────────────────────────────────────────┤
│  ☐  Send budget proposal to finance      │
│     P1 · due today                       │
├──────────────────────────────────────────┤
│  ☑  ~~Review landing page copy~~         │
│     P2 · 3 days overdue  (struck, queued)│
├──────────────────────────────────────────┤
│  ☐  …                                    │
├──────────────────────────────────────────┤
│  ☐  …                                    │
├──────────────────────────────────────────┤
│  ☐  …                                    │
├──────────────────────────────────────────┤
│  Synced 07:42 · 1 pending      [Close]   │
└──────────────────────────────────────────┘
```

---

## 7. Security

- Secrets live only in the Worker: the Tana OAuth tokens (Durable Object
  storage) and `ANTHROPIC_API_KEY` (Worker secret).
- The plugin package contains only code. The device passphrase is typed in
  once and stored in the plugin's private directory. If the Nomad is lost,
  rotate `DEVICE_TOKEN_HASH`.
- The Worker exposes three narrow verbs, not a generic Tana proxy. A leaked
  passphrase can read the top 5, tick tasks and add memos, nothing more.
- Rate limiting: 30 requests/min per token, plus a lockout after repeated
  401s.

---

## 8. Repo layout and CI

```
plugin/                     React Native Supernote plugin
worker/                     Cloudflare Worker (wrangler, TypeScript, vitest)
docs/DESIGN.md
.github/workflows/plugin.yml   ubuntu: npm ci → ./buildPlugin.sh → upload *.snplg artifact
.github/workflows/worker.yml   typecheck + tests; deploy stays a manual `wrangler deploy`
```

**Install:** download the `.snplg` artifact, copy it to `MyStyle/` on the
Nomad over USB or via the browser transfer page, then *Settings → Apps →
Plugins → Add Plugin*.

---

## 9. Milestones (revised)

| # | Goal | Done when |
| --- | --- | --- |
| **M0a** Plugin spike (½ day) | A "hello" plugin built in CI | It installs on your Nomad. The [→ Tana] lasso button shows the recognized text of your handwriting, writes a PNG to the private directory, and a `fetch()` to a test URL succeeds after granting INTERNET. Note your firmware version. |
| **M0b** Tana link spike (½ day) | Worker + OAuth to `app.tana.inc/mcp` | `/oauth/start` → approve → `GET /tasks` returns the real top 5 as JSON. Note how long the refresh token lives. |
| **M1** Task panel | Read, strike and sync | Ticking on the Nomad checks the node in Tana. It works with Wi-Fi off and syncs later. Replays don't double-apply. |
| **M2** Send to Tana | Lasso → #memo | A handwritten Dutch or English paragraph lands as an English #memo on today's day node, with bins filled. |
| **M3** Polish | E-ink pass, stuck-op view, "Page → Tana", sent-stamp | One week of daily use without opening Tana on another device for these two jobs. |
| **M4** (maybe) | Recurring tasks, "paper mode" | See §11. |

If **M0a fails** (no plugin support on your firmware, INTERNET blocked,
unusable panels), we fall back to the brief: a native Kotlin APK and the pen
spike. If the pen is sluggish there too, the cloud-folder OCR fallback is next.

---

## 10. Risks and unknowns

| Risk | Impact | Mitigation |
| --- | --- | --- |
| The plugin system is young. Firmware 3.29.x added permission management and broke older plugin builds. | An update can break the plugin. | Pin `sn-plugin-lib`, keep the plugin small, and re-test after each firmware update. |
| Hosted Tana MCP is **beta**. OAuth refresh lifetime is unknown, and it's unconfirmed whether non-Claude clients can register. | Tasks stop syncing until you re-auth. | M0b checks this first. The Worker returns `reauth: true` and the plugin shows "Re-link Tana" with the URL. |
| Device recognition quality on your handwriting, or on mixed Dutch/English. | Bad drafts. | The vision model sees the PNG too. The draft is only a hint. |
| Plugin panels may render slowly on e-ink (RN in a full-screen container). | Feels sluggish. | Few repaints, no animation, cached-first render. Measure in M0a. |
| `generateLassoPreview` may not write to the private directory. | Needs `FILE:WRITE`. | Request it (one more "Always allow"), or use `generateNotePng` on the page and crop. |
| The Linux build of `.snplg` in CI: the docs ship `buildPlugin.sh`, but some community posts say dev tooling is Windows/macOS only. | CI can't build the package. | Verify in M0a. If it fails, build on a macOS runner. |

---

## 11. Ideas for later

- **Paper mode.** The plugin writes today's top 5 as text boxes onto a "Today"
  note page. You tick them **with the pen**. A pen-up listener
  (`registerEventListener('event_pen_up')`) sees a stroke inside a task's box,
  marks it done and queues `/done`. That is the closest to "real paper wired
  into a real system". It is unverified whether pen-up events reach the plugin
  while its panel is closed.
- **Recurring tasks:** emulate *Complete and reschedule* in the Worker (see §5).
- **Two-way stamp:** a memo node links back to the note file and page it came
  from.

---

## 12. Open decisions

| # | Question | My recommendation |
| --- | --- | --- |
| 1 | Plugin vs native APK? | **Plugin** (§1). Keep the APK as the fallback. |
| 2 | What defines "today's top 5"? | **The computed query in §5**, built from fields you already maintain: Deadline ≤ today or on today's day node, P1 → P2 → rest, one-off tasks only. No new tagging habit. |
| 3 | Where do OCR'd notes land? | **A #memo on today's day node**, bins filled by the Worker. It matches your existing capture flow and your "new items go on today's day node" rule. |
| 4 | Offline queue in v1? | **Yes, from the start.** Wi-Fi is usually off on the Nomad, the queue is a folder of JSON files, and idempotent `opId`s have to be designed in on day one anyway. |
| 5 | Recurring tasks in the top 5? | **Not in v1** (§5). Add them in M4 with an emulated reschedule. |

---

## Sources

- Supernote plugin docs: <https://docs.supernote.com/llms.txt>. Pages used:
  [Plugin principles](https://docs.supernote.com/en/principle.md),
  [Your first plugin](https://docs.supernote.com/en/first-plugin.md),
  [Permissions](https://docs.supernote.com/en/plugin-base/permission.md),
  [recognizeElements](https://docs.supernote.com/en/api-reference/supernote-plugin/plugin-comm-api/recognize-elements.md),
  [generateLassoPreview](https://docs.supernote.com/en/api-reference/supernote-plugin/plugin-comm-api/generate-lasso-preview.md),
  [registerEventListener](https://docs.supernote.com/en/api-reference/supernote-plugin/plugin-manager/register-event-listener.md)
- Supernote Manta and Nomad changelog (sideloading switch in 3.16.27):
  <https://support.supernote.com/en_US/change-log/changelog-for-manta-and-nomad>
- Nomad review (third-party apps laggy with the stylus):
  <https://www.androidpolice.com/supernote-nomad-review/>
- Tana Outliner API and MCP (local vs hosted, OAuth, plan, tools):
  <https://outliner.tana.inc/learn/features/local-api-mcp>
