/**
 * These are assertions kept next to the code they describe rather than a test runner
 * suite — the web app has no test harness and adding one is not worth the time budget.
 * `npm run check` executes this file with tsx.
 */

import { mm, mmValue } from "./format";

let failures = 0;

function expect(label: string, actual: unknown, want: unknown) {
  const ok = Object.is(actual, want);
  if (!ok) {
    failures++;
    console.error(`FAIL ${label}: got ${String(actual)}, want ${String(want)}`);
  }
}

// mmValue must return exactly what mm() displays, so arithmetic shown beside rounded
// figures agrees with them. The regression: 149.4 and 49.4 displayed as 149 and 49 but
// their raw difference, 100.0, was shown as "+99" after its own rounding.
expect("mmValue rounds >=10 to integer", mmValue(149.4), 149);
expect("mmValue rounds >=10 to integer", mmValue(49.4), 49);
expect("difference of rounded matches displayed", mmValue(149.4) - mmValue(49.4), 100);
expect("mmValue keeps one decimal below 10", mmValue(4.449), 4.4);
expect("mmValue clamps negatives to zero", mmValue(-3), 0);
expect("mmValue of zero", mmValue(0), 0);

// mm() and mmValue() must agree on what is shown.
for (const v of [0, 0.04, 0.6, 4.449, 9.96, 10.4, 49.4, 149.4, 1234.6]) {
  const shown = mm(v);
  if (shown === "<0.1" || shown === "0") continue;
  const parsed = Number(shown.replace(/,/g, ""));
  expect(`mm(${v}) agrees with mmValue`, parsed, mmValue(v));
}

// Throwing rather than process.exit keeps this file free of Node type dependencies;
// tsx still exits non-zero, so `npm run check` fails the build.
if (failures) throw new Error(`${failures} format assertion(s) failed`);
console.log("format assertions passed");
