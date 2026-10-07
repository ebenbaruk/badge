import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { IN_MEMORY_DATABASE, openDatabase } from "./database";
import { SqliteKeyVersionStore } from "./key-versions";

describe("SqliteKeyVersionStore", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("returns null for an employee who never rotated, then the latest version", () => {
    const store = new SqliteKeyVersionStore(openDatabase(IN_MEMORY_DATABASE));
    expect(store.getVersion("alice")).toBeNull();
    store.setVersion("alice", 2);
    store.setVersion("alice", 3);
    expect(store.getVersion("alice")).toBe(3);
    expect(store.getVersion("bob")).toBeNull();
  });

  it("keeps a rotation across a restart (reopened database file)", () => {
    const dir = mkdtempSync(join(tmpdir(), "badge-keys-"));
    dirs.push(dir);
    const path = join(dir, "enclave.sqlite");
    const first = openDatabase(path);
    new SqliteKeyVersionStore(first).setVersion("bob", 2);
    first.close();
    const reopened = openDatabase(path);
    expect(new SqliteKeyVersionStore(reopened).getVersion("bob")).toBe(2);
    reopened.close();
  });

  it("refuses a version below 1", () => {
    const store = new SqliteKeyVersionStore(openDatabase(IN_MEMORY_DATABASE));
    expect(() => store.setVersion("alice", 0)).toThrow();
  });
});
