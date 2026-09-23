import { basename, dirname, join } from "@tauri-apps/api/path";
import {
  exists,
  mkdir,
  readDir,
  remove,
  rename,
  writeTextFile,
} from "@tauri-apps/plugin-fs";

export interface ExplorerEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

export function containsPath(parent: string, path: string | null) {
  if (!path) return false;
  const prefix = parent.replace(/[\\/]+$/, "");
  return (
    path === parent ||
    path.startsWith(`${prefix}/`) ||
    path.startsWith(`${prefix}\\`)
  );
}

export function renamedPath(path: string | null, from: string, to: string) {
  return path && containsPath(from, path) ? to + path.slice(from.length) : path;
}

function entryName(name: string, isDirectory: boolean) {
  const value = name.trim();
  const hasControlCharacter = [...value].some(
    (char) => char.charCodeAt(0) < 32,
  );
  if (!value || /[\\/<>:"|?*]|\.$/.test(value) || hasControlCharacter) {
    throw new Error(
      "Enter a name without path separators or reserved characters.",
    );
  }
  if (!isDirectory && !/\.json$/i.test(value)) {
    throw new Error("JSON files must have a .json extension.");
  }
  return value;
}

async function readChildren(path: string): Promise<ExplorerEntry[]> {
  const entries = (await readDir(path)).filter(
    (entry) =>
      !entry.isSymlink &&
      (entry.isDirectory || (entry.isFile && /\.json$/i.test(entry.name))),
  );
  const children = await Promise.all(
    entries.map(async (entry) => ({
      name: entry.name,
      path: await join(path, entry.name),
      isDirectory: entry.isDirectory,
    })),
  );
  return children.sort(
    (a, b) =>
      Number(b.isDirectory) - Number(a.isDirectory) ||
      a.name.localeCompare(b.name, undefined, {
        numeric: true,
        sensitivity: "base",
      }),
  );
}

export class FileExplorer {
  root = $state.raw<ExplorerEntry | null>(null);
  children = $state.raw<Record<string, ExplorerEntry[]>>({});
  expanded = $state.raw<string[]>([]);
  selected = $state<string | null>(null);
  cut = $state.raw<ExplorerEntry | null>(null);

  get rows() {
    const rows: (ExplorerEntry & {
      depth: number;
      parent: string | null;
      position: number;
      siblings: number;
    })[] = [];
    const visit = (
      entries: ExplorerEntry[],
      depth: number,
      parent: string | null,
    ) => {
      entries.forEach((entry, index) => {
        rows.push({
          ...entry,
          depth,
          parent,
          position: index + 1,
          siblings: entries.length,
        });
        if (this.expanded.includes(entry.path))
          visit(this.children[entry.path] ?? [], depth + 1, entry.path);
      });
    };
    if (this.root) visit([this.root], 0, null);
    return rows;
  }

  get selection() {
    return this.rows.find((row) => row.path === this.selected) ?? this.root;
  }

  async openRoot(path: string) {
    const children = await readChildren(path);
    this.root = {
      name: (await basename(path)) || path,
      path,
      isDirectory: true,
    };
    this.children = { [path]: children };
    this.expanded = [path];
    this.selected = path;
    this.cut = null;
  }

  close() {
    this.root = null;
    this.children = {};
    this.expanded = [];
    this.selected = null;
    this.cut = null;
  }

  async toggle(entry: ExplorerEntry) {
    if (!entry.isDirectory) return;
    if (this.expanded.includes(entry.path)) {
      this.expanded = this.expanded.filter((path) => path !== entry.path);
    } else {
      this.children = {
        ...this.children,
        [entry.path]: await readChildren(entry.path),
      };
      this.expanded = [...this.expanded, entry.path];
    }
    this.selected = entry.path;
  }

  async refresh() {
    if (!this.root) return;
    const children: Record<string, ExplorerEntry[]> = {};
    const visit = async (path: string) => {
      children[path] = await readChildren(path);
      for (const entry of children[path]) {
        if (entry.isDirectory && this.expanded.includes(entry.path))
          await visit(entry.path);
      }
    };
    await visit(this.root.path);
    this.children = children;
    this.expanded = this.expanded.filter((path) => path in children);
    if (!this.rows.some((row) => row.path === this.selected))
      this.selected = this.root.path;
  }

  async reveal(path: string) {
    if (!this.root || !containsPath(this.root.path, path)) return;
    const parents: string[] = [];
    let parent = await dirname(path);
    while (containsPath(this.root.path, parent)) {
      parents.push(parent);
      if (parent === this.root.path) break;
      parent = await dirname(parent);
    }
    this.expanded = [...new Set([...this.expanded, ...parents])];
    await this.refresh();
    this.selected = path;
  }

  async destination(entry: ExplorerEntry) {
    return entry.isDirectory ? entry.path : dirname(entry.path);
  }

  async create(parent: string, name: string, isDirectory: boolean) {
    const path = await join(parent, entryName(name, isDirectory));
    if (isDirectory) await mkdir(path);
    else await writeTextFile(path, "{}\n", { createNew: true });
    this.expanded = [...new Set([...this.expanded, parent])];
    this.selected = path;
    return path;
  }

  async rename(entry: ExplorerEntry, name: string) {
    return this.move(
      entry,
      await join(await dirname(entry.path), entryName(name, entry.isDirectory)),
    );
  }

  async move(entry: ExplorerEntry, destination: string) {
    if (entry.path === this.root?.path)
      throw new Error("The open folder cannot be moved or renamed.");
    if (entry.path === destination) return destination;
    if (containsPath(entry.path, destination))
      throw new Error("A folder cannot be moved into itself.");
    if (await exists(destination))
      throw new Error("An item with that name already exists.");
    await rename(entry.path, destination);
    this.expanded = this.expanded.map(
      (path) => renamedPath(path, entry.path, destination)!,
    );
    this.selected = destination;
    this.cut = null;
    return destination;
  }

  async delete(entry: ExplorerEntry) {
    if (entry.path === this.root?.path)
      throw new Error("The open folder cannot be deleted.");
    await remove(entry.path, { recursive: entry.isDirectory });
    if (this.cut && containsPath(entry.path, this.cut.path)) this.cut = null;
    this.selected = await dirname(entry.path);
  }
}
