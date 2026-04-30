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

describe("compileFlow — auto snapshot", () => {
  it("attaches snapshot when click fails", async () => {
    const result = (await evalFlow(
      "<button>Cancel</button><button>Save</button>",
      [{ click: { text: "Confirm" } }],
    )) as { snapshot?: { visibleButtons: string[]; url: string } };
    expect(result.snapshot).toBeDefined();
    expect(result.snapshot!.visibleButtons).toContain("Save");
    expect(result.snapshot!.url).toBe("/");
  });

  it("attaches snapshot when waitFor times out", async () => {
    const result = (await evalFlow("<button>Hi</button>", [
      { waitFor: { selector: "#never" }, timeout: 100 },
    ])) as { snapshot?: { dialogPresent: boolean } };
    expect(result.snapshot).toBeDefined();
    expect(result.snapshot!.dialogPresent).toBe(false);
  });
});

describe("compileFlow — inspect step", () => {
  it("captures computed style for selector", async () => {
    const html = '<h1 id="t" style="font-size: 24px; font-weight: 500;">Hi</h1>';
    const result = (await evalFlow(html, [
      {
        inspect: {
          title: { selector: "#t", style: ["fontSize", "fontWeight"] },
        },
      },
    ])) as {
      marks: { kind: string; ok: boolean }[];
      captured?: { inspect?: Record<string, Record<string, string>> };
    };
    expect(result.marks[0]).toMatchObject({ kind: "inspect", ok: true });
    expect(result.captured?.inspect?.title?.fontSize).toBe("24px");
    expect(result.captured?.inspect?.title?.fontWeight).toBe("500");
  });

  it("captures text + classList + rect when requested", async () => {
    const html =
      '<button id="cta" class="btn primary" style="width: 100px; height: 40px;">Next</button>';
    const result = (await evalFlow(html, [
      {
        inspect: {
          cta: {
            selector: "#cta",
            text: true,
            classList: true,
            rect: ["width", "height"],
          },
        },
      },
    ])) as {
      captured?: {
        inspect?: {
          cta?: { text?: string; classList?: string[]; width?: number; height?: number };
        };
      };
    };
    expect(result.captured?.inspect?.cta?.text).toBe("Next");
    expect(result.captured?.inspect?.cta?.classList).toEqual(["btn", "primary"]);
    // happy-dom has no layout engine; rect returns numbers but values may be 0
    expect(typeof result.captured?.inspect?.cta?.width).toBe("number");
    expect(typeof result.captured?.inspect?.cta?.height).toBe("number");
  });

  it("emits __error when selector not found", async () => {
    const result = (await evalFlow("<div></div>", [
      { inspect: { missing: { selector: "#nope", style: ["color"] } } },
    ])) as {
      captured?: { inspect?: Record<string, { __error?: string }> };
    };
    expect(result.captured?.inspect?.missing?.__error).toBe("SELECTOR_NOT_FOUND");
  });

  it("supports multiple targets in one inspect step", async () => {
    const html =
      '<h1 id="a" style="color: red;">A</h1><p id="b" style="color: blue;">B</p>';
    const result = (await evalFlow(html, [
      {
        inspect: {
          h1: { selector: "#a", style: ["color"], text: true },
          p: { selector: "#b", style: ["color"], text: true },
        },
      },
    ])) as {
      captured?: { inspect?: Record<string, { color?: string; text?: string }> };
    };
    expect(result.captured?.inspect?.h1?.color).toMatch(/red|rgb/);
    expect(result.captured?.inspect?.h1?.text).toBe("A");
    expect(result.captured?.inspect?.p?.color).toMatch(/blue|rgb/);
    expect(result.captured?.inspect?.p?.text).toBe("B");
  });

  it("supports HTML attr extraction", async () => {
    const html = '<button data-state="checked" aria-label="toggle">x</button>';
    const result = (await evalFlow(html, [
      {
        inspect: {
          sw: { selector: "button", attr: ["data-state", "aria-label"] },
        },
      },
    ])) as {
      captured?: { inspect?: { sw?: Record<string, string> } };
    };
    expect(result.captured?.inspect?.sw?.["data-state"]).toBe("checked");
    expect(result.captured?.inspect?.sw?.["aria-label"]).toBe("toggle");
  });
});

describe("compileFlow — osTap step", () => {
  it("returns center coordinates scaled by devicePixelRatio", async () => {
    const result = (await evalFlow('<button id="b">x</button>', [
      {
        raw: `
          const btn = document.getElementById('b');
          btn.getBoundingClientRect = () => ({ x: 100, y: 200, width: 50, height: 30, top: 200, left: 100, bottom: 230, right: 150 });
          Object.defineProperty(window, 'devicePixelRatio', { value: 2, configurable: true });
        `,
      },
      { osTap: "#b" },
    ])) as {
      marks: { kind: string; ok: boolean }[];
      osTap?: { i: number; x: number; y: number; selector: unknown };
    };
    expect(result.marks[1]).toMatchObject({ kind: "osTap", ok: true });
    expect(result.osTap).toBeDefined();
    expect(result.osTap!.i).toBe(1);
    // center = (100 + 25, 200 + 15) = (125, 215); * dpr 2 = (250, 430)
    expect(result.osTap!.x).toBe(250);
    expect(result.osTap!.y).toBe(430);
  });

  it("applies optional offset before scaling", async () => {
    const result = (await evalFlow('<button id="b">x</button>', [
      {
        raw: `
          const btn = document.getElementById('b');
          btn.getBoundingClientRect = () => ({ x: 0, y: 0, width: 100, height: 50, top: 0, left: 0, bottom: 50, right: 100 });
          Object.defineProperty(window, 'devicePixelRatio', { value: 1, configurable: true });
        `,
      },
      { osTap: { selector: "#b", offsetX: 10, offsetY: -5 } },
    ])) as { osTap?: { x: number; y: number } };
    // center = (50, 25); +offset = (60, 20); *dpr 1 = (60, 20)
    expect(result.osTap!.x).toBe(60);
    expect(result.osTap!.y).toBe(20);
  });

  it("fails with SELECTOR_NOT_FOUND when target missing", async () => {
    const result = (await evalFlow("<div></div>", [
      { osTap: "#nope" },
    ])) as {
      marks: { ok: boolean; error?: string }[];
      failedAt?: number;
      osTap?: unknown;
    };
    expect(result.marks[0].ok).toBe(false);
    expect(result.marks[0].error).toBe("SELECTOR_NOT_FOUND");
    expect(result.failedAt).toBe(0);
    expect(result.osTap).toBeUndefined();
  });

  it("halts flow at osTap (subsequent steps not compiled into same eval)", async () => {
    const result = (await evalFlow('<button id="b">x</button>', [
      {
        raw: `
          const btn = document.getElementById('b');
          btn.getBoundingClientRect = () => ({ x: 0, y: 0, width: 10, height: 10, top: 0, left: 0, bottom: 10, right: 10 });
        `,
      },
      { osTap: "#b" },
      { sleep: 1000 },
    ])) as { marks: { kind: string }[] };
    // raw + osTap should run; sleep must NOT run (flow halted at osTap so handler can do ADB tap before resuming)
    const kinds = result.marks.map((m) => m.kind);
    expect(kinds).toEqual(["raw", "osTap"]);
  });
});
