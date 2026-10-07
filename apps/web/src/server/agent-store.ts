/**
 * Durable memory of the agent runtime: what this server must remember across restarts to keep acting for each
 * employee without a new Ledger signature. Per employee: the agent session key and its session (delegated once by an
 * AgentSession), and the ids of the tasks and desk requests the agent created (the enclave answers per id).
 *
 * One JSON file, owner-only (0600 in a 0700 directory), written atomically. The session key is a secret: it lets
 * whoever holds it ask the enclave for context as the employee (every share still needs the owner's Ledger). A file
 * that other users could read is therefore never trusted, and the key is never logged.
 * Desk identities are deliberately not stored: they are Semaphore secrets re-derived from one Ledger signature.
 */
import { chmodSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sessionSchema } from "@badge/client";
import { z } from "zod";
import { EMPLOYEE_IDS } from "@/lib/directory";

export const AGENT_STORE_FILE_NAME = "agent-runtime.json";
const STORE_VERSION = 1;
const OWNER_ONLY_FILE = 0o600;
const OWNER_ONLY_DIR = 0o700;
/** Permission bits for group and others: any of them set means someone else may have read the session keys. */
const GROUP_OTHER_BITS = 0o077;

const bytes32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/) as z.ZodType<`0x${string}`>;

const employeeStateSchema = z.object({
  enrolledAt: z.iso.datetime().optional(),
  agent: z.object({ privateKey: bytes32, session: sessionSchema }).optional(),
  tasks: z.array(z.object({ id: bytes32, task: z.string(), trapped: z.boolean() })),
  deskRequests: z.array(z.object({ id: bytes32, task: z.string() })),
});
export type PersistedEmployee = z.infer<typeof employeeStateSchema>;

const fileSchema = z.object({
  version: z.literal(STORE_VERSION),
  employees: z.partialRecord(z.enum(EMPLOYEE_IDS), employeeStateSchema),
});
export type PersistedRuntime = z.infer<typeof fileSchema>["employees"];

/** Reads and writes the runtime file under `dataDir`. */
export class AgentStore {
  readonly path: string;

  constructor(
    private readonly dataDir: string,
    private readonly warn: (message: string) => void = (message) => console.warn(`[badge/web] ${message}`),
  ) {
    this.path = join(dataDir, AGENT_STORE_FILE_NAME);
  }

  /**
   * The persisted runtime, or an empty one when there is no usable file. A file readable by other users or not
   * matching the schema is ignored (with a warning): the employees then delegate again, which is safe, whereas
   * trusting a possibly leaked or tampered session key is not.
   */
  load(): PersistedRuntime {
    let mode: number;
    try {
      mode = statSync(this.path).mode;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw error;
    }
    if ((mode & GROUP_OTHER_BITS) !== 0) {
      this.warn(`${this.path} is readable by other users: ignored, agent sessions must be delegated again`);
      return {};
    }
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(this.path, "utf8"));
    } catch {
      this.warn(`${this.path} is not valid JSON: ignored`);
      return {};
    }
    const parsed = fileSchema.safeParse(raw);
    if (!parsed.success) {
      // Field paths only: the issue values could include a key.
      const fields = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
      this.warn(`${this.path} does not match the expected format (${fields}): ignored`);
      return {};
    }
    return parsed.data.employees;
  }

  /** Replaces the file atomically (temporary file then rename), owner-only. */
  save(employees: PersistedRuntime): void {
    mkdirSync(this.dataDir, { recursive: true, mode: OWNER_ONLY_DIR });
    // mkdir leaves an existing directory's mode alone; the file mode below is what protects the keys.
    const temporary = `${this.path}.${process.pid}.tmp`;
    const content = JSON.stringify({ version: STORE_VERSION, employees }, null, 2);
    writeFileSync(temporary, `${content}\n`, { mode: OWNER_ONLY_FILE });
    // writeFileSync's mode is masked by the umask and ignored for an existing file: set it explicitly.
    chmodSync(temporary, OWNER_ONLY_FILE);
    renameSync(temporary, this.path);
  }
}
