import { expect, test as base } from "@playwright/test";
import {
  mkdtemp,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { tmpdir } from "node:os";

type DialogState = { accept: boolean; messages: string[] };
type IpcArgs = {
  path: string;
  paths: string[];
  oldPath: string;
  newPath: string;
  message: string;
  buttons: { OkCancelCustom: string[] };
  options?: { recursive?: boolean };
};

// Exercise the real UI and filesystem through a mock Tauri IPC boundary.
// Native dialog grants and capabilities require a separate desktop smoke check.
const test = base.extend<{ workspace: { root: string; dialogs: DialogState } }>(
  {
    workspace: async ({ page }, use) => {
      const root = await mkdtemp(join(tmpdir(), "json-explorer-test-"));
      const dialogs: DialogState = { accept: true, messages: [] };
      await mkdir(join(root, "nested"));
      await writeFile(join(root, "alpha.json"), '{"name":"alpha"}\n');
      await writeFile(join(root, "nested", "beta.JSON"), '{"name":"beta"}\n');
      await writeFile(join(root, "readme.txt"), "Not a JSON file");
      await writeFile(join(root, "broken.json"), "{invalid}");

      const handlers: Record<string, (args: IpcArgs) => unknown> = {
        "plugin:dialog|open": () => root,
        "plugin:dialog|message": (args) => {
          dialogs.messages.push(args.message);
          return args.buttons.OkCancelCustom[dialogs.accept ? 0 : 1];
        },
        "plugin:path|join": ({ paths }) => join(...paths),
        "plugin:path|dirname": ({ path }) => dirname(path),
        "plugin:path|basename": ({ path }) => basename(path),
        "plugin:fs|read_dir": async ({ path }) =>
          (await readdir(path, { withFileTypes: true })).map((entry) => ({
            name: entry.name,
            isDirectory: entry.isDirectory(),
            isFile: entry.isFile(),
            isSymlink: entry.isSymbolicLink(),
          })),
        "plugin:fs|read_text_file": async ({ path }) => [
          ...(await readFile(path)),
        ],
        "plugin:fs|exists": ({ path }) => existsSync(path),
        "plugin:fs|mkdir": ({ path }) => mkdir(path),
        "plugin:fs|rename": ({ oldPath, newPath }) => rename(oldPath, newPath),
        "plugin:fs|remove": ({ path, options }) =>
          rm(path, { recursive: options?.recursive }),
        "plugin:event|listen": () => 1,
        "plugin:event|unlisten": () => undefined,
      };
      await page.exposeFunction(
        "explorerTestInvoke",
        async (
          command: string,
          args: IpcArgs,
          options?: { headers: { path: string; options?: string } },
        ) => {
          if (command === "plugin:fs|write_text_file" && options) {
            const settings = JSON.parse(options.headers.options ?? "{}");
            return writeFile(
              decodeURIComponent(options.headers.path),
              Buffer.from(Object.values(args).map(Number)),
              { flag: settings.createNew ? "wx" : "w" },
            );
          }
          const handler = handlers[command];
          if (!handler) throw new Error(`Unexpected IPC: ${command}`);
          return handler(args);
        },
      );
      await page.addInitScript(() => {
        Object.assign(window, {
          isTauri: true,
          __TAURI_INTERNALS__: {
            metadata: {
              currentWindow: { label: "main" },
              currentWebview: { label: "main" },
            },
            transformCallback: () => 1,
            unregisterCallback: () => {},
            invoke: (...args: unknown[]) =>
              Reflect.get(window, "explorerTestInvoke")(...args),
          },
          __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => {} },
        });
      });
      try {
        await use({ root, dialogs });
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },
);

test.beforeEach(async ({ page, workspace }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open folder", exact: true }).click();
  await expect(
    page.getByRole("treeitem", { name: basename(workspace.root), exact: true }),
  ).toBeVisible();
});

test("right sidebar navigates JSON folders, resizes and toggles without losing state", async ({
  page,
}) => {
  const explorer = page.getByRole("complementary", { name: "File explorer" });
  const sourceArea = page.getByRole("tabpanel");
  const panel = await explorer.boundingBox();
  const editor = await sourceArea.boundingBox();
  expect(panel!.x).toBeGreaterThan(editor!.x);
  await expect(page.getByRole("treeitem", { name: "readme.txt" })).toHaveCount(
    0,
  );
  const nested = page.getByRole("treeitem", { name: "nested", exact: true });
  await nested.click();
  await expect(page.getByRole("treeitem", { name: "beta.JSON" })).toBeVisible();
  await nested.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("treeitem", { name: "beta.JSON" })).toBeFocused();
  await page.keyboard.press("Enter");
  await page.getByRole("tab", { name: "Raw JSON", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "JSON source" })).toHaveValue(
    '{"name":"beta"}\n',
  );
  const handle = page.getByRole("separator", { name: "Resize file explorer" });
  const grip = await handle.boundingBox();
  await page.mouse.move(grip!.x, grip!.y + 100);
  await page.mouse.down();
  await page.mouse.move(grip!.x - 80, grip!.y + 100);
  await page.mouse.up();
  expect((await explorer.boundingBox())!.width).toBeGreaterThan(panel!.width);
  await page
    .getByRole("button", { name: "Hide explorer", exact: true })
    .click();
  await expect(explorer).toHaveCount(0);
  await page.keyboard.press("Control+b");
  await expect(page.getByRole("treeitem", { name: "beta.JSON" })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("explorer.png") });
  await page.setViewportSize({ width: 720, height: 480 });
  await expect(
    page.getByRole("button", { name: "Reveal active file", exact: true }),
  ).toBeInViewport();
  await expect(
    page.getByRole("textbox", { name: "JSON source" }),
  ).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    720,
  );
});

test("file switching protects dirty edits and malformed JSON leaves the document intact", async ({
  page,
  workspace,
}) => {
  await page.getByRole("treeitem", { name: "alpha.json" }).click();
  await page.getByRole("tab", { name: "Raw JSON", exact: true }).click();
  const source = page.getByRole("textbox", { name: "JSON source" });
  await source.fill('{"keep":true}');
  workspace.dialogs.accept = false;
  await page.getByRole("treeitem", { name: "broken.json" }).click();
  await expect(source).toHaveValue('{"keep":true}');
  expect(workspace.dialogs.messages).toHaveLength(1);
  workspace.dialogs.accept = true;
  await page.getByRole("treeitem", { name: "broken.json" }).click();
  await expect(
    page.getByText("File operation failed", { exact: true }),
  ).toBeVisible();
  await expect(source).toHaveValue('{"keep":true}');
  await expect(page).toHaveTitle(/alpha.json/);
});

test("create, rename, move, save and delete keep the editor attached to the correct file", async ({
  page,
  workspace,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page
    .getByRole("button", { name: "New JSON file", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Name", exact: true })
    .fill("created.json");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  const created = page.getByRole("treeitem", { name: "created.json" });
  await expect(created).toBeVisible();
  expect(await readFile(join(workspace.root, "created.json"), "utf8")).toBe(
    "{}\n",
  );
  await page.getByRole("tab", { name: "Raw JSON", exact: true }).click();
  await page
    .getByRole("textbox", { name: "JSON source" })
    .fill('{"edited":true}');
  await created.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Rename…" }).click();
  await page
    .getByRole("textbox", { name: "Name", exact: true })
    .fill("renamed.json");
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  await expect(page).toHaveTitle(/renamed.json/);
  const renamed = page.getByRole("treeitem", { name: "renamed.json" });
  await renamed.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Cut", exact: true }).click();
  await expect(page.getByRole("menu")).toHaveCount(0);
  await page
    .getByRole("treeitem", { name: "nested", exact: true })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Paste", exact: true }).click();
  await expect(renamed).toHaveAttribute(
    "title",
    join(workspace.root, "nested", "renamed.json"),
  );
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Ready");
  expect(
    await readFile(join(workspace.root, "nested", "renamed.json"), "utf8"),
  ).toBe('{"edited":true}');
  expect(existsSync(join(workspace.root, "created.json"))).toBe(false);
  workspace.dialogs.accept = false;
  await renamed.focus();
  await page.keyboard.press("Delete");
  await expect(renamed).toBeVisible();
  workspace.dialogs.accept = true;
  await renamed.focus();
  await page.keyboard.press("Delete");
  await expect(renamed).toHaveCount(0);
  await expect(page).toHaveTitle(/untitled.json/);
  expect(existsSync(join(workspace.root, "nested", "renamed.json"))).toBe(
    false,
  );
  expect(errors).toEqual([]);
});

test("folder rename preserves dirty descendant edits and refresh sees external files", async ({
  page,
  workspace,
}) => {
  await page.getByRole("treeitem", { name: "nested", exact: true }).click();
  await page.getByRole("treeitem", { name: "beta.JSON" }).click();
  await page.getByRole("tab", { name: "Raw JSON", exact: true }).click();
  await page
    .getByRole("textbox", { name: "JSON source" })
    .fill('{"changed":true}');
  const folder = page.getByRole("treeitem", { name: "nested", exact: true });
  await folder.focus();
  await page.keyboard.press("F2");
  await page.getByRole("textbox", { name: "Name", exact: true }).fill("moved");
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Ready");
  expect(
    await readFile(join(workspace.root, "moved", "beta.JSON"), "utf8"),
  ).toBe('{"changed":true}');
  await writeFile(join(workspace.root, "external.json"), "null");
  await page
    .getByRole("button", { name: "Refresh explorer", exact: true })
    .click();
  await expect(
    page.getByRole("treeitem", { name: "external.json" }),
  ).toBeVisible();
});
