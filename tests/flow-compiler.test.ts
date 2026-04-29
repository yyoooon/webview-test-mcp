import { describe, it, expect } from "vitest";
import { Window } from "happy-dom";
import { compileFlow } from "../src/flow-compiler.js";

async function evalFlow(html: string, steps: unknown[]): Promise<unknown> {
  const window = new Window({ url: "http://localhost:3000/" });
  window.document.body.innerHTML = html;
  if (!window.performance)
    (window as any).performance = { now: () => Date.now() };
  const expr = compileFlow({ steps: steps as any });
  return await window.eval(expr);
}

describe("compileFlow — basic", () => {
  it("compiles empty steps to a marks-only result", async () => {
    const result = (await evalFlow("", [])) as {
      marks: unknown[];
      totalMs: number;
    };
    expect(result.marks).toEqual([]);
    expect(typeof result.totalMs).toBe("number");
  });

  it("click step records ok mark when target found", async () => {
    const result = (await evalFlow('<button id="x">Hi</button>', [
      { click: "#x" },
    ])) as { marks: { kind: string; ok: boolean }[] };
    expect(result.marks[0]).toMatchObject({ kind: "click", ok: true });
  });

  it("click step fails with selector_not_found mark when no target", async () => {
    const result = (await evalFlow("<div></div>", [{ click: "#missing" }])) as {
      marks: { ok: boolean; error?: string }[];
      failedAt?: number;
    };
    expect(result.marks[0].ok).toBe(false);
    expect(result.marks[0].error).toBe("SELECTOR_NOT_FOUND");
    expect(result.failedAt).toBe(0);
  });

  it("sleep step waits and records", async () => {
    const result = (await evalFlow("", [{ sleep: 50 }])) as {
      marks: { kind: string; ms: number }[];
    };
    expect(result.marks[0].kind).toBe("sleep");
    expect(result.marks[0].ms).toBeGreaterThanOrEqual(45);
  });

  it("raw step evaluates JS and records", async () => {
    const result = (await evalFlow("", [{ raw: "1 + 2" }])) as {
      marks: { kind: string; ok: boolean }[];
    };
    expect(result.marks[0]).toMatchObject({ kind: "raw", ok: true });
  });
});

describe("compileFlow — waitFor + capture", () => {
  it("waitFor selector resolves when element exists", async () => {
    const result = (await evalFlow('<button id="ready">Ready</button>', [
      { waitFor: { selector: "#ready" }, timeout: 500 },
    ])) as { marks: { ok: boolean }[] };
    expect(result.marks[0].ok).toBe(true);
  });

  it("waitFor times out and reports WAIT_TIMEOUT", async () => {
    const result = (await evalFlow("", [
      { waitFor: { selector: "#never" }, timeout: 200 },
    ])) as { marks: { ok: boolean; error?: string }[]; failedAt?: number };
    expect(result.marks[0].ok).toBe(false);
    expect(result.marks[0].error).toBe("WAIT_TIMEOUT");
    expect(result.failedAt).toBe(0);
  });

  it("waitFor text scoped within container", async () => {
    const result = (await evalFlow(
      `<button>Confirm</button><div role="dialog"><span>Complete</span></div>`,
      [
        {
          waitFor: { text: "Complete", within: "[role=dialog]" },
          timeout: 200,
        },
      ],
    )) as { marks: { ok: boolean }[] };
    expect(result.marks[0].ok).toBe(true);
  });

  it("capture with url + scenario", async () => {
    const result = (await evalFlow("", [
      { raw: `sessionStorage.setItem('scenario_step', '"FOO"')` },
      { capture: { url: true, scenario: true } },
    ])) as { captured: { url: string; scenario: string } };
    expect(result.captured.url).toBe("/");
    expect(result.captured.scenario).toBe("FOO");
  });

  it("bail=on-error stops after first failure", async () => {
    const result = (await evalFlow("", [
      { click: "#nope" },
      { click: "#also-nope" },
    ])) as { marks: unknown[]; failedAt?: number };
    expect(result.marks).toHaveLength(1);
    expect(result.failedAt).toBe(0);
  });
});
