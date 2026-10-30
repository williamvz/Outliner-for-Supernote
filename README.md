# Tana Sync for Supernote

A Supernote plugin and a small Cloudflare Worker that connect a Supernote
Nomad to Tana Outliner:

- **Tasks:** today's tasks from Tana are written onto a daily page. Tick one with
  the pen and it is completed in Tana.
- **Writing:** handwriting on the same page, with dashes and indentation like an
  outline, becomes nodes on that day's node in Tana.

The full design is in [docs/DESIGN.md](docs/DESIGN.md).

**Status: M0 spike.** The current code answers the open questions in
DESIGN.md §10 on a real device. It does not write anything to Tana yet,
except one clearly marked test node, and only when you ask for it.

## Layout

| Path | What |
| --- | --- |
| `plugin/` | React Native Supernote plugin (`sn-plugin-lib`), built into `TanaSync.snplg` |
| `plugin/src/core/` | Page logic without device dependencies, with unit tests: page layout, tick detection, grouping strokes into lines and indent levels, outline rules |
| `plugin/src/spike/` | Spike actions behind the toolbar buttons, plus the report |
| `plugin/tools/` | Scripts that draw the page template and toolbar icons from `layout.json` |
| `worker/` | Cloudflare Worker. It logs in to Tana's hosted MCP (OAuth), builds the task snapshot, and receives spike reports |
| `.github/workflows/ci.yml` | Typecheck, lint and tests for both parts. Builds the `.snplg` as a downloadable artifact |

## Try the spike on the Nomad

1. **Download the plugin.** Open the latest **CI** run on `main` on GitHub and
   download the **TanaSync-snplg** artifact. Unzip it to get
   `TanaSync.snplg` (upload that file, not the zip).
2. **Copy it to the Nomad.** Put it directly in the `MyStyle` folder. On a
   Mac, *Browse & Access* over Wi-Fi is easiest; USB needs an app such as
   OpenMTP.
3. **Install it.** On the Nomad, go to *Settings → Apps → Plugins → Choose
   Installation Package* and pick `TanaSync.snplg`. Copying the file alone
   does not install it. To update, install the new file the same way.
4. **Allow file access.** In *Settings → Apps → Plugins → Tana Sync*, allow
   file read and write (**Always allow**). Internet access is asked on first
   use.
5. **Find the buttons.** Open any notebook. The toolbar has **Today**,
   **Sync**, **Tana** and **Ping**.
6. **Configure the Worker.** Tap **Tana**, then **Config**. Enter the Worker
   URL and the device passphrase and tap **Save**. They are kept across
   restarts. Then tap **Run checks**: the network line should pass.
7. **Create a page.** Tap **Today**. A status screen opens. The plugin
   creates `Note/Tana/Spike.note` with a templated page and up to six tasks,
   then closes the screen and shows the page.
8. **Write on the page.**
   - Tick two tasks: one in the box, one by striking it through.
   - Below the line, write a few lines with dashes and indentation.
   - Write one line starting with a small box ☐.
9. **Sync.** Tap **Sync**. The status screen shows what was read, and the
   status line on the page updates.
10. **Ping.** Tap **Ping** once. It opens nothing; it tests whether a button
    without a screen reaches the plugin.
11. **Report.** Tap **Tana**, then **Send report**. The activity box at the
    top shows the latest steps and errors.

## Worker

```sh
cd worker
npm ci
npx wrangler login
npx wrangler deploy
# sha256 of the passphrase (macOS: shasum -a 256, Linux: sha256sum)
printf '%s' 'four random words here' | shasum -a 256 | cut -d' ' -f1 | npx wrangler secret put DEVICE_TOKEN_HASH
```

To link Tana, open `https://<worker-host>/oauth/start?token=<passphrase>` in a
browser and approve. After that, `/health` reports `"tana": "linked"`.

| Endpoint | Purpose |
| --- | --- |
| `GET /health` | Shows whether Tana is linked and how old the task snapshot is |
| `GET /oauth/start`, `GET /oauth/callback` | One-time link to Tana |
| `GET /tasks?view=today\|all` | Task snapshot. Rebuilt when older than 10 minutes, or with `&fresh=1` |
| `POST /spike/report`, `GET /spike/report` | Spike findings sent from the Nomad |
| `GET /spike/mcp` | Diagnostics: MCP tools, snapshot timing and counts |
| `POST /spike/import-test` | Spike Q7: imports one "Supernote sync test" node on today's day node and returns Tana's raw reply |

Every endpoint except `/` and `/oauth/callback` needs the passphrase as a
bearer token.

## Development

```sh
cd plugin && npm ci
npm test && npm run typecheck && npm run lint
bash buildPlugin.sh                 # → build/outputs/TanaSync.snplg
python3 tools/make_template.py      # after changing src/core/layout.json

cd ../worker && npm ci
npm test && npm run typecheck
```

To run the Worker locally against a stand-in Tana (130 tasks, two workspaces):

```sh
node scripts/mock-mcp.mjs &
npx wrangler dev --var TANA_MCP_URL:http://127.0.0.1:8788/mcp --var DEV_TANA_ACCESS_TOKEN:dev \
  --var DEVICE_TOKEN_HASH:$(printf '%s' test | shasum -a 256 | cut -d' ' -f1)
curl -H 'authorization: Bearer test' 'localhost:8787/tasks?view=today'
```

The task list is built in the background, in batches of 35 calls to Tana:
Cloudflare's free plan allows 50 outbound requests per Worker invocation. The
first `/tasks` call returns an empty list with `refreshing` progress. Later
calls return the finished snapshot, which is refreshed when it is older than
10 minutes.
