import { expect, test } from "@playwright/test";

test("raw edits flow into Vercel visual and diff components", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("tab", { name: "Raw JSON", exact: true }).click();
  await page
    .getByRole("textbox", { name: "JSON source" })
    .fill('{"message":"Hello Svelte","count":2}');
  await page.getByRole("button", { name: "Format JSON", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "JSON source" })).toHaveValue(
    '{\n  "message": "Hello Svelte",\n  "count": 2\n}\n',
  );

  await page.getByRole("tab", { name: "Visual", exact: true }).click();
  await expect(page.getByRole("tabpanel")).toContainText("message");
  await expect(page.getByRole("tabpanel")).toContainText("Hello Svelte");
  await page.getByRole("tab", { name: "Changes", exact: true }).click();
  await expect(page.getByRole("tabpanel")).toContainText("Hello Svelte");
  expect(errors).toEqual([]);
});

test("invalid raw JSON stays editable and blocks view changes", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Raw JSON", exact: true }).click();
  const source = page.getByRole("textbox", { name: "JSON source" });
  await source.fill('{"incomplete":');
  await expect(source).toHaveAttribute("aria-invalid", "true");
  await expect(
    page.getByRole("tab", { name: "Visual", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Format JSON", exact: true }),
  ).toBeDisabled();
  await source.fill("null");
  await expect(source).toHaveAttribute("aria-invalid", "false");
  await expect(
    page.getByRole("tab", { name: "Visual", exact: true }),
  ).toBeEnabled();
});

test("cancelling a new document preserves unsaved edits", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Raw JSON", exact: true }).click();
  const source = page.getByRole("textbox", { name: "JSON source" });
  await source.fill('{"keep":true}');
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "New", exact: true }).click();
  await expect(source).toHaveValue('{"keep":true}');

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "New", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Ready");
  await page.getByRole("tab", { name: "Raw JSON", exact: true }).click();
  await expect(source).toHaveValue("{}\n");
});
