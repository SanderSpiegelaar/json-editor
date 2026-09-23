# JSON Editor

A Tauri 2 desktop JSON editor built with SvelteKit, TypeScript, shadcn-svelte,
and Vercel Labs' `@visual-json/svelte` components. The application lives in
[`apps/desktop`](apps/desktop). The original visual-json packages and examples
remain in the workspace.

## Run the desktop app

Install Node.js 22.12+ (or a newer supported LTS), pnpm 10.30.1, stable Rust,
and the [Tauri prerequisites for your platform](https://v2.tauri.app/start/prerequisites/).

```bash
pnpm install
pnpm dev
```

`pnpm dev` builds the local Vercel component packages, starts SvelteKit on
`http://127.0.0.1:1420`, and launches the native application.

- Open and save `.json` files through native dialogs. Save as creates a separate file.
- Edit with Vercel's visual tree/form editor, raw JSON, or inspect changes since the last open/save.
- Invalid raw JSON stays in the editor and blocks saving and switching to other views.
- New, Open, window close, and application quit ask before discarding unsaved changes.
- Use `Cmd/Ctrl+N`, `Cmd/Ctrl+O`, `Cmd/Ctrl+S`, and `Cmd/Ctrl+Shift+S`.

Files remain local. Filesystem permissions cover paths selected in the native
dialogs; the app does not request blanket access to your home directory.
The editor currently accepts strict JSON, including scalar roots and UTF-8 BOMs.
JSONC, JSON5, YAML, remote schemas, and the original web app's AI features are
not part of the desktop application.

## Build and verify

```bash
pnpm build                 # Native release bundle for the current platform
pnpm build:frontend        # Static SvelteKit output only
pnpm check:desktop         # Desktop Svelte/TypeScript checks
pnpm test:desktop          # Focused document-state tests
pnpm --filter @visual-json/desktop exec playwright install chromium
pnpm --filter @visual-json/desktop test:e2e
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
```

Native bundles are written to `apps/desktop/src-tauri/target/release/bundle/`.
Signing and notarization require your own distribution credentials.
For a local macOS development bundle, use `pnpm build --debug --bundles app`.

If a machine-local Cargo cache wrapper stalls during packaging, use Rustup's
toolchain directly with a separate build directory:

```bash
RUSTC_WRAPPER= RUSTC_WORKSPACE_WRAPPER= RUSTC="$(rustup which rustc)" \
  CARGO_TARGET_DIR="$PWD/apps/desktop/src-tauri/target/local" \
  pnpm tauri build --debug --bundles app --runner "$(rustup which cargo)"
```

`pnpm dev:frontend` runs a browser preview with native file actions disabled.
The desktop app uses SvelteKit's static adapter with SSR disabled, following the
[Tauri SvelteKit integration](https://v2.tauri.app/start/frontend/sveltekit/).
Add shell components with
`pnpm --filter @visual-json/desktop ui:add <component>`.

## Upstream visual-json

<p>
  <a href="https://vercel.com/labs#active-experiments"><img alt="Vercel Labs Experiment" src="https://img.shields.io/badge/LABS-EXPERIMENT-0a0a0a.svg?style=for-the-badge&amp;logo=Vercel&amp;labelColor=000000" height="28"></a>
  <a href="https://www.npmjs.com/package/@visual-json/core"><img alt="npm version: @visual-json/core" src="https://img.shields.io/npm/v/%40visual-json%2Fcore.svg?style=for-the-badge&amp;labelColor=000000" height="28"></a>
  <a href="https://github.com/vercel-labs/visual-json/blob/main/LICENSE"><img alt="License: Apache-2.0" src="https://img.shields.io/github/license/vercel-labs/visual-json.svg?style=for-the-badge&amp;labelColor=000000" height="28"></a>
  <a href="https://www.npmjs.com/package/@visual-json/core"><img alt="npm downloads per month: @visual-json/core" src="https://img.shields.io/npm/dm/%40visual-json%2Fcore.svg?style=for-the-badge&amp;labelColor=000000&amp;label=npm%20downloads" height="28"></a>
</p>

The visual JSON editor. Schema-aware, embeddable, extensible.

## Packages

<table>
  <thead>
    <tr>
      <th>Package</th>
      <th>Description</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><a href="packages/@visual-json/core"><code>@visual-json/core</code></a></td>
      <td>Headless tree model, operations, and schema types</td>
    </tr>
    <tr>
      <td><a href="packages/@visual-json/react"><code>@visual-json/react</code></a></td>
      <td>React UI components (TreeView, FormView, DiffView, and more)</td>
    </tr>
    <tr>
      <td><a href="packages/@visual-json/svelte"><code>@visual-json/svelte</code></a></td>
      <td>Svelte 5 UI components (TreeView, FormView, DiffView, and more)</td>
    </tr>
    <tr>
      <td><a href="packages/@visual-json/vue"><code>@visual-json/vue</code></a></td>
      <td>Vue UI components (TreeView, FormView, DiffView, and more)</td>
    </tr>
    <tr>
      <td><a href="packages/@visual-json/yaml"><code>@visual-json/yaml</code></a></td>
      <td>YAML support — parse, serialize, and schema-detect YAML files</td>
    </tr>
    <tr>
      <td><a href="apps/vscode"><code>@visual-json/vscode</code></a></td>
      <td>VS Code extension — visual editor with tree sidebar, schema support, JSONC, and YAML</td>
    </tr>
  </tbody>
</table>

## Library development

```bash
pnpm install
pnpm build:all
pnpm --filter @visual-json/svelte dev
```

## License

Apache-2.0
