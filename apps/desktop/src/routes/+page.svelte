<script lang="ts">
  import { onMount } from "svelte";
  import { isTauri } from "@tauri-apps/api/core";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { confirm, open, save } from "@tauri-apps/plugin-dialog";
  import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
  import { DiffView, JsonEditor } from "@visual-json/svelte";
  import { Button } from "$lib/components/ui/button";
  import * as Tabs from "$lib/components/ui/tabs";
  import * as Alert from "$lib/components/ui/alert";
  import { Textarea } from "$lib/components/ui/textarea";
  import { JsonDocument } from "$lib/document.svelte";

  const doc = new JsonDocument();
  const desktop = isTauri();
  const filters = [{ name: "JSON", extensions: ["json"] }];
  let view = $state("visual");
  let busy = $state(false);
  let fileError = $state<string | null>(null);
  const invalid = $derived(!!doc.error);
  const canSave = $derived(desktop && !busy && !invalid);
  const defaultPath = $derived(doc.path ?? doc.filename);
  const status = $derived.by(() => {
    if (busy) return "Working…";
    if (invalid) return "Fix JSON before saving";
    return doc.dirty ? "Unsaved changes" : "Ready";
  });

  async function run(action: () => void | Promise<void>) {
    if (busy) return;
    busy = true;
    fileError = null;
    try {
      await action();
    } catch (error) {
      fileError = error instanceof Error ? error.message : String(error);
    } finally {
      busy = false;
    }
  }

  async function mayDiscard() {
    if (!doc.dirty) return true;
    const message = `Discard unsaved changes to ${doc.filename}?`;
    return desktop
      ? confirm(message, {
          title: "Unsaved changes",
          kind: "warning",
          okLabel: "Discard changes",
          cancelLabel: "Keep editing",
        })
      : window.confirm(message);
  }

  function newDocument() {
    return run(async () => {
      if (!(await mayDiscard())) return;
      doc.load("{}\n", null);
      view = "visual";
    });
  }

  function openDocument() {
    if (!desktop) return;
    return run(async () => {
      if (!(await mayDiscard())) return;
      const path = await open({ multiple: false, directory: false, filters });
      if (!path) return;
      doc.load(await readTextFile(path), path);
      view = "visual";
    });
  }

  function saveDocument(saveAs = false) {
    if (!canSave) return;
    const currentPath = saveAs ? null : doc.path;
    return run(async () => {
      const path = currentPath ?? (await save({ defaultPath, filters }));
      if (!path) return;
      const text = doc.text;
      await writeTextFile(path, text);
      doc.markSaved(path, text);
    });
  }

  const shortcuts: Record<string, (event: KeyboardEvent) => unknown> = {
    n: newDocument,
    o: openDocument,
    s: (event) => saveDocument(event.shiftKey),
  };

  function handleShortcut(event: KeyboardEvent) {
    if (!(event.metaKey || event.ctrlKey)) return;
    const action = shortcuts[event.key.toLowerCase()];
    if (!action) return;
    event.preventDefault();
    void action(event);
  }

  function beforeUnload(event: BeforeUnloadEvent) {
    if (desktop || !doc.dirty) return;
    event.preventDefault();
    event.returnValue = "";
  }

  onMount(() => {
    if (!desktop) return;
    const appWindow = getCurrentWindow();
    const listener = appWindow.onCloseRequested((event) => {
      event.preventDefault();
      void run(async () => {
        if (await mayDiscard()) await appWindow.destroy();
      });
    });
    void listener.catch((error: unknown) => {
      fileError = `Unable to protect unsaved changes: ${String(error)}`;
    });
    return () => {
      void listener.then((unlisten) => unlisten()).catch(() => {});
    };
  });
</script>

<svelte:head>
  <title>{doc.dirty ? "● " : ""}{doc.filename} — JSON Editor</title>
  <meta name="description" content="A local visual JSON editor" />
</svelte:head>

<svelte:window onkeydown={handleShortcut} onbeforeunload={beforeUnload} />

<main class="flex h-dvh flex-col bg-background text-foreground">
  <header class="flex flex-wrap items-center gap-2 border-b px-4 py-3">
    <div class="mr-4 flex min-w-0 flex-1 flex-col">
      <h1 class="text-sm font-semibold">JSON Editor</h1>
      <p class="truncate text-xs text-muted-foreground" title={defaultPath}>
        {doc.filename}{doc.dirty ? " · Unsaved changes" : ""}
      </p>
    </div>
    <Button
      variant="outline"
      size="sm"
      disabled={busy}
      onclick={newDocument}
      title="New (⌘/Ctrl+N)">New</Button
    >
    <Button
      variant="outline"
      size="sm"
      disabled={busy || !desktop}
      onclick={openDocument}
      title="Open (⌘/Ctrl+O)">Open…</Button
    >
    <Button
      variant="outline"
      size="sm"
      disabled={!canSave}
      onclick={() => saveDocument(true)}
      title="Save as (⌘/Ctrl+Shift+S)">Save as…</Button
    >
    <Button
      size="sm"
      disabled={!canSave}
      onclick={() => saveDocument()}
      title="Save (⌘/Ctrl+S)">Save</Button
    >
  </header>

  {#if !desktop}
    <Alert.Root class="mx-4 mt-3 w-auto">
      <Alert.Title>Browser preview</Alert.Title>
      <Alert.Description
        >Launch the desktop app to open and save local files.</Alert.Description
      >
    </Alert.Root>
  {/if}

  {#if fileError || doc.error}
    <Alert.Root variant="destructive" class="mx-4 mt-3 w-auto">
      <Alert.Title
        >{doc.error ? "Invalid JSON" : "File operation failed"}</Alert.Title
      >
      <Alert.Description>{doc.error ?? fileError}</Alert.Description>
    </Alert.Root>
  {/if}

  <div class="flex min-h-0 flex-1 flex-col" inert={busy}>
    <Tabs.Root bind:value={view} class="min-h-0 flex-1 gap-0">
      <div class="flex items-center justify-between gap-3 px-4 py-3">
        <Tabs.List aria-label="Editor view">
          <Tabs.Trigger value="visual" disabled={invalid}>Visual</Tabs.Trigger>
          <Tabs.Trigger value="raw">Raw JSON</Tabs.Trigger>
          <Tabs.Trigger value="diff" disabled={invalid}>Changes</Tabs.Trigger>
        </Tabs.List>
        <Button
          variant="ghost"
          size="sm"
          disabled={invalid}
          onclick={() => doc.editValue(doc.value)}>Format JSON</Button
        >
      </div>
      <Tabs.Content value="visual" class="min-h-0 overflow-hidden border-t">
        {#key doc.revision}
          <JsonEditor
            value={doc.value}
            onchange={(value) => doc.editValue(value)}
            height="100%"
          />
        {/key}
      </Tabs.Content>
      <Tabs.Content value="raw" class="min-h-0 overflow-hidden px-4 pb-4">
        <Textarea
          class="raw-editor h-full resize-none"
          aria-label="JSON source"
          aria-invalid={invalid}
          spellcheck={false}
          value={doc.text}
          oninput={(event) => doc.editText(event.currentTarget.value)}
        />
      </Tabs.Content>
      <Tabs.Content value="diff" class="min-h-0 overflow-auto border-t">
        <DiffView
          originalJson={doc.original}
          currentJson={doc.value}
          class="h-full"
        />
      </Tabs.Content>
    </Tabs.Root>
  </div>

  <footer
    class="flex items-center justify-between border-t px-4 py-2 text-xs text-muted-foreground"
  >
    <span role="status">{status}</span>
    <span>Vercel Labs visual-json · Local files</span>
  </footer>
</main>
