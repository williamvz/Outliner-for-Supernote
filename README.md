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

1. **Download the plugin.** Open the latest **CI** run for this branch on
   GitHub and download the **TanaSync-snplg** artifact. Unzip it to get
   `TanaSync.snplg`.
2. **Copy it to the Nomad.** Put it in the `MyStyle` folder, over USB or via
   *Browse & Access*.
3. **Install it.** On the Nomad, go to *Settings → Apps → Plugins → Add
   Plugin* and pick `TanaSync.snplg`.
4. **Find the buttons.** Open any notebook. The toolbar now has **Today**,
   **Sync** and **Tana**.
5. **Grant permissions.** Tap **Tana**, then **Run checks**. Allow all three
   permissions with **Always allow**.
6. **Configure the Worker.** In **Config**, enter the Worker URL and the device
   passphrase, then tap **Save**. Run checks again: the network line should
   pass.
7. **Create a page.** Tap **Today**. The plugin creates `Note/Tana/Spike.note`
   with a templated page and writes up to six tasks on it.
8. **Write on the page.**
   - Tick two tasks: one in the box, one by striking it through.
   - Below the line, write a few lines with dashes and indentation.
   - Write one line starting with a small box ☐.
9. **Sync.** Tap **Sync** and wait a few seconds. The status line at the top
   right should update.
10. **Report.** Tap **Tana** to read the report, then **Send report**.

## Worker

```sh
cd worker
npm ci
npx wrangler login
npx wrangler deploy
printf '%s' 'four random words here' | sha256sum | cut -d' ' -f1 | npx wrangler secret put DEVICE_TOKEN_HASH
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
