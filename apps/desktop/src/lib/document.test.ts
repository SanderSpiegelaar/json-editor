import { describe, expect, it } from "vitest";
import { JsonDocument } from "./document.svelte";

describe("JSON document", () => {
  it("keeps the active document intact when opening malformed JSON", () => {
    const doc = new JsonDocument();
    doc.load('{"name":"original"}', "/tmp/original.json");
    doc.editValue({ name: "edited" });

    expect(() => doc.load("{invalid}", "/tmp/broken.json")).toThrow();
    expect(doc.value).toEqual({ name: "edited" });
    expect(doc.path).toBe("/tmp/original.json");
    expect(doc.original).toEqual({ name: "original" });
    expect(doc.dirty).toBe(true);
  });

  it("preserves incomplete raw edits until they are corrected", () => {
    const doc = new JsonDocument();
    doc.load('{"count":1}', "/tmp/count.json");
    doc.editText('{"count":');

    expect(doc.text).toBe('{"count":');
    expect(doc.value).toEqual({ count: 1 });
    expect(doc.error).toBeTruthy();
    expect(doc.dirty).toBe(true);

    doc.editText('{"count":2}');
    expect(doc.value).toEqual({ count: 2 });
    expect(doc.error).toBeNull();
  });

  it("resets the dirty flag when raw changes are undone", () => {
    const doc = new JsonDocument();
    doc.editText('{"changed":true}');
    doc.editText("{}\n");
    expect(doc.dirty).toBe(false);
  });

  it("updates the diff baseline only to the successfully saved snapshot", () => {
    const doc = new JsonDocument();
    doc.editValue({ version: 1 });
    const saved = doc.text;
    doc.editValue({ version: 2 });
    doc.markSaved("/tmp/saved.json", saved);

    expect(doc.original).toEqual({ version: 1 });
    expect(doc.value).toEqual({ version: 2 });
    expect(doc.dirty).toBe(true);

    doc.markSaved(doc.path!, doc.text);
    expect(doc.dirty).toBe(false);
  });

  it("preserves whitespace and UTF-8 BOM when a file is opened and saved", () => {
    const doc = new JsonDocument();
    const text = '\uFEFF{ "city": "Zürich" }\r\n';
    doc.load(text, "C:\\data\\cities.json");
    expect(doc.filename).toBe("cities.json");
    expect(doc.value).toEqual({ city: "Zürich" });
    doc.markSaved(doc.path!, doc.text);
    expect(doc.text).toBe(text);
    expect(doc.dirty).toBe(false);
  });

  it.each([null, false, 42, "hello", [1, 2]])(
    "supports JSON root value %j",
    (value) => {
      const doc = new JsonDocument();
      doc.load(JSON.stringify(value), null);
      expect(doc.value).toEqual(value);
      expect(doc.filename).toBe("untitled.json");
    },
  );
});
