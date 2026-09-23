import type { JsonValue } from "@visual-json/core";

export class JsonDocument {
  value = $state.raw<JsonValue>({});
  original = $state.raw<JsonValue>({});
  text = $state("{}\n");
  path = $state<string | null>(null);
  error = $state<string | null>(null);
  revision = $state(0);
  private savedText = $state("{}\n");

  get dirty() {
    return this.text !== this.savedText;
  }

  get filename() {
    return this.path?.split(/[\\/]/).pop() ?? "untitled.json";
  }

  load(text: string, path: string | null) {
    const value: JsonValue = JSON.parse(text.replace(/^\uFEFF/, ""));
    this.value = value;
    this.original = value;
    this.text = text;
    this.savedText = text;
    this.path = path;
    this.error = null;
    this.revision++;
  }

  editText(text: string) {
    this.text = text;
    try {
      this.value = JSON.parse(text.replace(/^\uFEFF/, ""));
      this.error = null;
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    }
  }

  editValue(value: JsonValue) {
    this.value = value;
    this.text = `${JSON.stringify(value, null, 2)}\n`;
    this.error = null;
  }

  markSaved(path: string, text: string) {
    this.path = path;
    this.savedText = text;
    this.original = JSON.parse(text.replace(/^\uFEFF/, ""));
  }
}
