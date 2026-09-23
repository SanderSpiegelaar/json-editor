<script lang="ts">
  import { tick } from "svelte";
  import { join } from "@tauri-apps/api/path";
  import { confirm, open } from "@tauri-apps/plugin-dialog";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import Folder from "@lucide/svelte/icons/folder";
  import FolderOpen from "@lucide/svelte/icons/folder-open";
  import FileJson from "@lucide/svelte/icons/file-json";
  import FilePlus from "@lucide/svelte/icons/file-plus";
  import FolderPlus from "@lucide/svelte/icons/folder-plus";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import ChevronsDownUp from "@lucide/svelte/icons/chevrons-down-up";
  import Locate from "@lucide/svelte/icons/locate";
  import X from "@lucide/svelte/icons/x";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import * as ContextMenu from "$lib/components/ui/context-menu";
  import * as Dialog from "$lib/components/ui/dialog";
  import * as Field from "$lib/components/ui/field";
  import * as Empty from "$lib/components/ui/empty";
  import * as Alert from "$lib/components/ui/alert";
  import {
    containsPath,
    renamedPath,
    type ExplorerEntry,
    type FileExplorer,
  } from "$lib/explorer.svelte";
  import type { JsonDocument } from "$lib/document.svelte";
  import { cn } from "$lib/utils";

  let {
    explorer,
    doc,
    desktop,
    busy,
    run,
    mayDiscard,
    onopen,
    onhide,
  }: {
    explorer: FileExplorer;
    doc: JsonDocument;
    desktop: boolean;
    busy: boolean;
    run: (action: () => void | Promise<void>) => Promise<void>;
    mayDiscard: () => Promise<boolean>;
    onopen: (path: string, discardConfirmed?: boolean) => Promise<void>;
    onhide: () => void;
  } = $props();

  let tree = $state<HTMLDivElement>();
  let editing = $state(false);
  let editKind = $state<"file" | "folder" | "rename">("file");
  let editEntry = $state.raw<ExplorerEntry | null>(null);
  let name = $state("");
  let editError = $state<string | null>(null);
  const editTitle = $derived(
    editKind === "rename"
      ? "Rename"
      : editKind === "folder"
        ? "New folder"
        : "New JSON file",
  );
  const rows = $derived(explorer.rows);
  const selected = $derived(explorer.selection);

  function openFolder() {
    return run(async () => {
      const path = await open({
        directory: true,
        recursive: true,
        multiple: false,
        title: "Open folder",
      });
      if (path) await explorer.openRoot(path);
    });
  }

  async function focusSelected() {
    await tick();
    const row = tree?.querySelector<HTMLElement>(
      '[role="treeitem"][tabindex="0"]',
    );
    row?.focus();
    row?.scrollIntoView({ block: "nearest" });
  }

  function activate(entry: ExplorerEntry) {
    return run(async () => {
      if (entry.isDirectory) await explorer.toggle(entry);
      else if (entry.path !== doc.path) await onopen(entry.path);
      explorer.selected = entry.path;
    }).then(focusSelected);
  }

  function startEdit(kind: typeof editKind, entry = selected) {
    if (!entry || busy) return;
    editKind = kind;
    editEntry = entry;
    name = { rename: entry.name, file: "untitled.json", folder: "" }[kind];
    editError = null;
    editing = true;
  }

  async function createEntry(entry: ExplorerEntry) {
    if (editKind === "file" && !(await mayDiscard())) return false;
    const parent = await explorer.destination(entry);
    const path = await explorer.create(parent, name, editKind === "folder");
    if (editKind === "file") await onopen(path, true);
    return true;
  }

  async function applyEdit(entry: ExplorerEntry) {
    if (editKind === "rename") {
      const path = await explorer.rename(entry, name);
      doc.path = renamedPath(doc.path, entry.path, path);
    } else if (!(await createEntry(entry))) return;
    editing = false;
    const path = explorer.selected;
    if (path) await explorer.reveal(path);
  }

  function submitEdit(event: SubmitEvent) {
    event.preventDefault();
    if (!editEntry) return;
    const entry = editEntry;
    void run(async () => {
      editError = null;
      try {
        await applyEdit(entry);
      } catch (error) {
        editError = String(error instanceof Error ? error.message : error);
        if (!editing) throw error;
      }
    });
  }

  function confirmDelete(entry: ExplorerEntry) {
    const detail = entry.isDirectory
      ? " This includes all contents, even files hidden from this explorer."
      : "";
    return confirm(
      `Permanently delete “${entry.name}”?${detail} This cannot be undone.`,
      {
        title: "Delete from disk",
        kind: "warning",
        okLabel: "Delete",
        cancelLabel: "Cancel",
      },
    );
  }

  async function mayDelete(entry: ExplorerEntry) {
    if (containsPath(entry.path, doc.path) && !(await mayDiscard()))
      return false;
    return confirmDelete(entry);
  }

  function deleteEntry(entry: ExplorerEntry) {
    return run(async () => {
      if (!(await mayDelete(entry))) return;
      const affectsDocument = containsPath(entry.path, doc.path);
      await explorer.delete(entry);
      if (affectsDocument) doc.load("{}\n", null);
      await explorer.refresh();
    });
  }

  function paste(entry: ExplorerEntry) {
    return run(async () => {
      const source = explorer.cut;
      if (!source) return;
      const path = await join(await explorer.destination(entry), source.name);
      await explorer.move(source, path);
      doc.path = renamedPath(doc.path, source.path, path);
      await explorer.reveal(path);
    });
  }

  function revealActive() {
    return run(async () => {
      if (!doc.path) return;
      await explorer.reveal(doc.path);
      await focusSelected();
    });
  }

  function focusRow(path: string | undefined) {
    if (path) explorer.selected = path;
  }

  async function navigate(key: string) {
    const index = rows.findIndex((row) => row.path === explorer.selected);
    const row = rows[index];
    if (!row) return;
    const expanded = explorer.expanded.includes(row.path);
    const actions: Record<string, () => unknown> = {
      ArrowDown: () => focusRow(rows[index + 1]?.path),
      ArrowUp: () => focusRow(rows[index - 1]?.path),
      Home: () => focusRow(rows[0]?.path),
      End: () => focusRow(rows.at(-1)?.path),
      ArrowLeft: () =>
        expanded ? explorer.toggle(row) : focusRow(row.parent ?? undefined),
      ArrowRight: () =>
        expanded
          ? focusRow(explorer.children[row.path]?.[0]?.path)
          : explorer.toggle(row),
    };
    await actions[key]?.();
  }

  function treeActions(entry: ExplorerEntry, event: KeyboardEvent) {
    const mutable = entry.path !== explorer.root?.path;
    const actions: Record<string, () => unknown> = {
      Enter: () => activate(entry),
      " ": () => activate(entry),
      F2: () => mutable && startEdit("rename"),
      Delete: () => mutable && deleteEntry(entry),
      Escape: () => {
        explorer.cut = null;
      },
    };
    if ([event.metaKey, event.ctrlKey].includes(true)) {
      actions.x = () => {
        if (mutable) explorer.cut = entry;
      };
      actions.v = () => paste(entry);
    }
    for (const key of [
      "ArrowDown",
      "ArrowUp",
      "ArrowLeft",
      "ArrowRight",
      "Home",
      "End",
    ]) {
      actions[key] = () => run(() => navigate(key)).then(focusSelected);
    }
    return actions;
  }

  function treeKeydown(event: KeyboardEvent) {
    if (busy || !selected) return;
    const actions = treeActions(selected, event);
    const action = actions[event.key];
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    void action();
  }
</script>

{#snippet entryIcon(entry: ExplorerEntry, expanded: boolean)}
  {#if entry.isDirectory}
    <ChevronRight class={cn("size-3.5 shrink-0", expanded && "rotate-90")} />
    {#if expanded}<FolderOpen
        class="size-4 shrink-0 text-muted-foreground"
      />{:else}<Folder class="size-4 shrink-0 text-muted-foreground" />{/if}
  {:else}
    <span class="size-3.5 shrink-0"></span><FileJson
      class="size-4 shrink-0 text-muted-foreground"
    />
  {/if}
{/snippet}

{#snippet rowMenu(entry: ExplorerEntry, expanded: boolean, isRoot: boolean)}
  <ContextMenu.Content>
    <ContextMenu.Group>
      <ContextMenu.Item onSelect={() => activate(entry)}
        >{entry.isDirectory
          ? expanded
            ? "Collapse folder"
            : "Expand folder"
          : "Open JSON"}</ContextMenu.Item
      >
      <ContextMenu.Item onSelect={() => startEdit("file", entry)}
        >New JSON file…</ContextMenu.Item
      >
      <ContextMenu.Item onSelect={() => startEdit("folder", entry)}
        >New folder…</ContextMenu.Item
      >
    </ContextMenu.Group>
    <ContextMenu.Separator />
    <ContextMenu.Group>
      <ContextMenu.Item
        disabled={isRoot}
        onSelect={() => startEdit("rename", entry)}
        >Rename…<ContextMenu.Shortcut>F2</ContextMenu.Shortcut
        ></ContextMenu.Item
      >
      <ContextMenu.Item
        disabled={isRoot}
        onSelect={() => {
          explorer.cut = entry;
        }}>Cut</ContextMenu.Item
      >
      <ContextMenu.Item disabled={!explorer.cut} onSelect={() => paste(entry)}
        >Paste</ContextMenu.Item
      >
      <ContextMenu.Item
        disabled={isRoot}
        variant="destructive"
        onSelect={() => deleteEntry(entry)}>Delete…</ContextMenu.Item
      >
    </ContextMenu.Group>
    {#if isRoot}
      <ContextMenu.Separator />
      <ContextMenu.Group
        ><ContextMenu.Item onSelect={() => explorer.close()}
          >Close folder</ContextMenu.Item
        ></ContextMenu.Group
      >
    {/if}
  </ContextMenu.Content>
{/snippet}

{#snippet treeRow(entry: FileExplorer["rows"][number])}
  {@const expanded = explorer.expanded.includes(entry.path)}
  {@const isRoot = entry.path === explorer.root?.path}
  <ContextMenu.Root>
    <ContextMenu.Trigger
      disabled={busy}
      oncontextmenu={() => {
        explorer.selected = entry.path;
      }}
    >
      {#snippet child({ props })}
        <button
          {...props}
          type="button"
          role="treeitem"
          aria-label={entry.name}
          aria-level={entry.depth + 1}
          aria-posinset={entry.position}
          aria-setsize={entry.siblings}
          aria-selected={explorer.selected === entry.path}
          aria-expanded={entry.isDirectory ? expanded : undefined}
          aria-current={doc.path === entry.path ? "page" : undefined}
          tabindex={explorer.selected === entry.path ? 0 : -1}
          disabled={busy}
          onfocus={() => {
            explorer.selected = entry.path;
          }}
          onclick={() => activate(entry)}
          title={entry.path}
          style:padding-left={`${8 + entry.depth * 16}px`}
          class={cn(
            "flex h-7 w-full items-center gap-1.5 pr-3 text-left text-xs outline-none hover:bg-sidebar-accent focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-sidebar-ring",
            explorer.selected === entry.path &&
              "bg-sidebar-accent text-sidebar-accent-foreground",
            doc.path === entry.path && "font-semibold",
            explorer.cut?.path === entry.path && "opacity-50",
          )}
        >
          {@render entryIcon(entry, expanded)}
          <span class="truncate">{entry.name}</span>
          {#if doc.path === entry.path && doc.dirty}<span
              aria-label="Unsaved changes"
              class="ml-auto">●</span
            >{/if}
        </button>
      {/snippet}
    </ContextMenu.Trigger>
    {@render rowMenu(entry, expanded, isRoot)}
  </ContextMenu.Root>
{/snippet}

{#snippet nameDialog()}
  <Dialog.Root bind:open={editing}>
    <Dialog.Content
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        document.getElementById("explorer-name")?.focus();
      }}
    >
      <Dialog.Header
        ><Dialog.Title>{editTitle}</Dialog.Title><Dialog.Description
          >{editKind === "rename"
            ? editEntry?.path
            : "Choose a name in the selected folder."}</Dialog.Description
        ></Dialog.Header
      >
      <form onsubmit={submitEdit} class="flex flex-col gap-4">
        <Field.FieldGroup
          ><Field.Field data-invalid={!!editError}
            ><Field.FieldLabel for="explorer-name">Name</Field.FieldLabel><Input
              id="explorer-name"
              bind:value={name}
              onfocus={(event) => event.currentTarget.select()}
              aria-invalid={!!editError}
              disabled={busy}
              autocomplete="off"
            /></Field.Field
          ></Field.FieldGroup
        >
        {#if editError}<Alert.Root variant="destructive"
            ><Alert.Title>File operation failed</Alert.Title><Alert.Description
              >{editError}</Alert.Description
            ></Alert.Root
          >{/if}
        <Dialog.Footer
          ><Button
            variant="outline"
            disabled={busy}
            onclick={() => {
              editing = false;
            }}>Cancel</Button
          ><Button type="submit" disabled={busy || !name.trim()}
            >{editKind === "rename" ? "Rename" : "Create"}</Button
          ></Dialog.Footer
        >
      </form>
    </Dialog.Content>
  </Dialog.Root>
{/snippet}

<aside
  id="file-explorer"
  aria-label="File explorer"
  class="flex h-full min-w-0 flex-col bg-sidebar text-sidebar-foreground"
  aria-busy={busy}
>
  <div
    class="flex h-12 shrink-0 items-center justify-between gap-1 border-b px-3"
  >
    <h2 class="text-xs font-semibold tracking-wide uppercase">Explorer</h2>
    <div class="flex items-center gap-0.5">
      <Button
        variant="ghost"
        size="icon-sm"
        disabled={busy || !desktop}
        onclick={openFolder}
        title="Open folder"
        aria-label="Open folder"><FolderOpen /></Button
      >
      <Button
        variant="ghost"
        size="icon-sm"
        onclick={onhide}
        title="Hide explorer (⌘/Ctrl+B)"
        aria-label="Hide explorer"><X /></Button
      >
    </div>
  </div>

  {#if explorer.root}
    <div class="flex shrink-0 items-center gap-0.5 border-b px-2 py-1">
      <Button
        variant="ghost"
        size="icon-sm"
        disabled={busy}
        onclick={() => startEdit("file")}
        title="New JSON file"
        aria-label="New JSON file"><FilePlus /></Button
      >
      <Button
        variant="ghost"
        size="icon-sm"
        disabled={busy}
        onclick={() => startEdit("folder")}
        title="New folder"
        aria-label="New folder"><FolderPlus /></Button
      >
      <Button
        variant="ghost"
        size="icon-sm"
        disabled={busy}
        onclick={() => run(() => explorer.refresh())}
        title="Refresh explorer"
        aria-label="Refresh explorer"><RefreshCw /></Button
      >
      <Button
        variant="ghost"
        size="icon-sm"
        disabled={busy}
        onclick={() => {
          explorer.expanded = [];
          explorer.selected = explorer.root!.path;
        }}
        title="Collapse all folders"
        aria-label="Collapse all folders"><ChevronsDownUp /></Button
      >
      <Button
        variant="ghost"
        size="icon-sm"
        disabled={busy || !containsPath(explorer.root.path, doc.path)}
        onclick={revealActive}
        title="Reveal active file"
        aria-label="Reveal active file"><Locate /></Button
      >
    </div>
    <div
      bind:this={tree}
      role="tree"
      tabindex={-1}
      aria-label="JSON files"
      onkeydown={treeKeydown}
      class="min-h-0 flex-1 overflow-auto py-1"
    >
      {#each rows as entry (entry.path)}
        {@render treeRow(entry)}
      {/each}
      {#if explorer.expanded.includes(explorer.root.path) && !explorer.children[explorer.root.path]?.length}
        <p class="px-4 py-5 text-xs text-muted-foreground">
          No JSON files or folders. Create a JSON file to get started.
        </p>
      {/if}
    </div>
    <p class="shrink-0 border-t px-3 py-2 text-[11px] text-muted-foreground">
      Folders and JSON files · Right-click for actions
    </p>
  {:else}
    <Empty.Root class="gap-4 px-4">
      <Empty.Header
        ><Empty.Media variant="icon"><FolderOpen /></Empty.Media><Empty.Title
          >No folder open</Empty.Title
        ><Empty.Description
          >{desktop
            ? "Open a folder to browse and organize your JSON files."
            : "Launch the desktop app to browse local JSON files."}</Empty.Description
        ></Empty.Header
      >
      <Empty.Content
        ><Button
          variant="outline"
          size="sm"
          disabled={!desktop || busy}
          onclick={openFolder}>Open folder…</Button
        ></Empty.Content
      >
    </Empty.Root>
  {/if}
</aside>

{@render nameDialog()}
