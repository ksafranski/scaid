/**
 * Grades the parts of the design response that a model can get wrong without being wrong.
 *
 * Structured output does not hold a model to an enum. The allowed values reach it as a
 * line of description rather than as a constraint, so a word outside the set is a thing
 * that happens — and when it did, validation threw and took a finished build down with it.
 *
 * These checks exist because that failure was expensive and invisible: the program was
 * fine, the steps were fine, and all of it was discarded over a label the interface had
 * always known how to ignore.
 *
 *   npm run verify:agent
 */
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

const { IconField, ActionField, reportIconDrift } = await import("../src/lib/designSchema.ts");
const { ICON_NAMES, FALLBACK_ICON } = await import("../src/lib/iconNames.ts");

let passed = 0;
const failures = [];

// The fallback logs, which is the point of it — but not into the middle of a test run.
const realWarn = console.warn;
const warnings = [];
console.warn = (...args) => warnings.push(args.join(" "));

function check(name, fn) {
  try {
    fn();
    realWarn(`  ok  ${name}`);
    passed++;
  } catch (error) {
    failures.push({ name, reason: error.message });
  }
}

const is = (actual, expected, what) => {
  if (actual !== expected) {
    throw new Error(`${what} is ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
  }
};

check("icon › every name the interface can draw survives untouched", () => {
  for (const name of ICON_NAMES) is(IconField.parse(name), name, `icon ${name}`);
});

check("icon › a name nobody has heard of becomes the fallback instead of throwing", () => {
  // The real one, from the build this was written for.
  for (const bad of ["slider", "dial", "parameter", "", "CUBE", "wrench"]) {
    is(IconField.parse(bad), FALLBACK_ICON, `icon ${JSON.stringify(bad)}`);
  }
});

check("icon › a value that isn't even a string still doesn't throw", () => {
  for (const bad of [null, undefined, 42, {}, []]) {
    is(IconField.parse(bad), FALLBACK_ICON, `icon ${JSON.stringify(bad) ?? "undefined"}`);
  }
});

check("icon › the model is still told which names exist", () => {
  // Built exactly the way the route builds it, because this is the half that can't be
  // made forgiving: the names travel to the model as description text, and if they ever
  // stop travelling it has nothing to choose from and every build quietly becomes the
  // fallback — which would look like the icons simply stopped working.
  const sent = JSON.stringify(zodOutputFormat(z.object({ icon: IconField })));
  for (const name of ICON_NAMES) {
    if (!sent.includes(name)) throw new Error(`the model is no longer told about ${name}`);
  }
});

check("action › both real answers survive, and anything else builds", () => {
  is(ActionField.parse("ask"), "ask", "ask");
  is(ActionField.parse("build"), "build", "build");
  for (const bad of ["BUILD", "answer", null, 7]) {
    is(ActionField.parse(bad), "build", `action ${JSON.stringify(bad) ?? "null"}`);
  }
});

check("schema › the whole thing can still be expressed as JSON Schema", () => {
  // The check that would have caught the first attempt at this fix. Handing `.catch()` a
  // function to log with makes this throw, and it throws when the request is built — so
  // every build would have failed rather than the occasional one.
  zodOutputFormat(z.object({ icon: IconField, action: ActionField }));
});

check("drift › a corrected icon is reported rather than swallowed", () => {
  warnings.length = 0;
  const strays = reportIconDrift('{"steps":[{"icon":"slider"},{"icon":"cube"},{"icon":"dial"}]}');
  is(strays.join(","), "slider,dial", "the names that were made up");
  if (!warnings.some((line) => line.includes("slider"))) {
    throw new Error("nothing was logged, so a prompt going wrong would look like nothing");
  }
});

check("drift › a response using only real icons says nothing", () => {
  warnings.length = 0;
  const strays = reportIconDrift('{"steps":[{"icon":"cube"},{"icon":"smooth"}]}');
  is(strays.length, 0, "strays");
  is(warnings.length, 0, "warnings");
});

console.warn = realWarn;
console.log();
if (failures.length) {
  console.log(`${failures.length} check${failures.length === 1 ? "" : "s"} failed:\n`);
  for (const failure of failures) {
    console.log(`  FAIL  ${failure.name}`);
    console.log(`        ${failure.reason}\n`);
  }
  console.log(`${passed} passed, ${failures.length} failed.`);
  process.exit(1);
}
console.log(`${passed} agent check${passed === 1 ? "" : "s"} passed.`);
