import { beforeEach, describe, expect, it, vi } from "vitest";
import { posix } from "node:path";
import {
  exists,
  mkdir,
  readDir,
  remove,
  rename,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import { FileExplorer, containsPath, renamedPath } from "./explorer.svelte";

vi.mock("@tauri-apps/api/path", () => ({
  basename: async (path: string) => posix.basename(path),
  dirname: async (path: string) => posix.dirname(path),
  join: async (...parts: string[]) => posix.join(...parts),
}));
vi.mock("@tauri-apps/plugin-fs", () => ({
  readDir: vi.fn(),
  exists: vi.fn(),
  mkdir: vi.fn(),
  remove: vi.fn(),
  rename: vi.fn(),
  writeTextFile: vi.fn(),
}));

const entry = (name: string, isDirectory = false, isSymlink = false) => ({
  name,
  isDirectory,
  isFile: !isDirectory,
  isSymlink,
});
const folder = { name: "nested", path: "/project/nested", isDirectory: true };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(exists).mockResolvedValue(false);
  vi.mocked(readDir).mockResolvedValue([]);
});

describe("file explorer", () => {
  it("loads one level, sorts folders first, and filters non-JSON files and symlinks", async () => {
    vi.mocked(readDir).mockResolvedValueOnce([
      entry("file10.json"),
      entry("nested", true),
      entry("notes.txt"),
      entry("file2.JSON"),
      entry("link.json", false, true),
    ]);
    const explorer = new FileExplorer();
    await explorer.openRoot("/project");
    expect(explorer.rows.map((row) => row.name)).toEqual([
      "project",
      "nested",
      "file2.JSON",
      "file10.json",
    ]);
    expect(readDir).toHaveBeenCalledTimes(1);
    await explorer.toggle(folder);
    expect(readDir).toHaveBeenLastCalledWith(folder.path);
  });

  it("keeps the old folder and selection when opening another folder fails", async () => {
    const explorer = new FileExplorer();
    await explorer.openRoot("/project");
    vi.mocked(readDir).mockRejectedValueOnce(new Error("Permission denied"));
    await expect(explorer.openRoot("/restricted")).rejects.toThrow(
      "Permission denied",
    );
    expect(explorer.root?.path).toBe("/project");
    expect(explorer.selected).toBe("/project");
  });

  it("reveals a nested file and drops vanished directories on refresh", async () => {
    vi.mocked(readDir).mockImplementation(async (path) =>
      path === "/project" ? [entry("nested", true)] : [entry("data.json")],
    );
    const explorer = new FileExplorer();
    await explorer.openRoot("/project");
    await explorer.reveal("/project/nested/data.json");
    expect(explorer.rows.at(-1)?.path).toBe("/project/nested/data.json");
    expect(explorer.selected).toBe("/project/nested/data.json");
    vi.mocked(readDir).mockResolvedValue([]);
    await explorer.refresh();
    expect(explorer.rows).toHaveLength(1);
    expect(explorer.expanded).toEqual(["/project"]);
    expect(explorer.selected).toBe("/project");
  });

  it("creates JSON without overwriting an existing file", async () => {
    const explorer = new FileExplorer();
    await explorer.create("/project", "data.json", false);
    expect(writeTextFile).toHaveBeenCalledWith("/project/data.json", "{}\n", {
      createNew: true,
    });
    vi.mocked(writeTextFile).mockRejectedValueOnce(new Error("Already exists"));
    await expect(
      explorer.create("/project", "data.json", false),
    ).rejects.toThrow("Already exists");
    await explorer.create("/project", "nested", true);
    expect(mkdir).toHaveBeenCalledWith("/project/nested");
  });

  it.each([
    "../escape.json",
    "a/b.json",
    "a\\b.json",
    "notes.txt",
    "",
    ".",
    "..",
    "bad?.json",
  ])("rejects an invalid JSON filename: %s", async (name) => {
    await expect(
      new FileExplorer().create("/project", name, false),
    ).rejects.toThrow();
    expect(writeTextFile).not.toHaveBeenCalled();
  });

  it("refuses collisions, moving into descendants, and changing the root", async () => {
    const explorer = new FileExplorer();
    await explorer.openRoot("/project");
    vi.mocked(exists).mockResolvedValue(true);
    await expect(explorer.rename(folder, "existing")).rejects.toThrow(
      "already exists",
    );
    await expect(
      explorer.move(folder, "/project/nested/child"),
    ).rejects.toThrow("into itself");
    await expect(explorer.rename(explorer.root!, "new-root")).rejects.toThrow(
      "open folder",
    );
    await expect(explorer.delete(explorer.root!)).rejects.toThrow(
      "open folder",
    );
    expect(rename).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it("updates expanded descendants only after a successful move", async () => {
    const explorer = new FileExplorer();
    explorer.expanded = [
      "/project/nested",
      "/project/nested/sub",
      "/project/nested-other",
    ];
    explorer.cut = folder;
    vi.mocked(rename).mockRejectedValueOnce(new Error("Permission denied"));
    await expect(explorer.rename(folder, "renamed")).rejects.toThrow();
    expect(explorer.cut).toBe(folder);
    await explorer.rename(folder, "renamed");
    expect(explorer.expanded).toEqual([
      "/project/renamed",
      "/project/renamed/sub",
      "/project/nested-other",
    ]);
    expect(explorer.selected).toBe("/project/renamed");
    expect(explorer.cut).toBeNull();
  });

  it("matches path boundaries on Windows and Unix when updating the active document", () => {
    expect(containsPath("/project", "/project-copy/file.json")).toBe(false);
    expect(containsPath("/", "/file.json")).toBe(true);
    expect(containsPath("C:\\", "C:\\file.json")).toBe(true);
    expect(
      renamedPath(
        "C:\\project\\a\\file.json",
        "C:\\project\\a",
        "C:\\project\\b",
      ),
    ).toBe("C:\\project\\b\\file.json");
    expect(
      renamedPath("/project/a/file.json", "/project/a", "/project/b"),
    ).toBe("/project/b/file.json");
    expect(renamedPath(null, "/project/a", "/project/b")).toBeNull();
  });
});
