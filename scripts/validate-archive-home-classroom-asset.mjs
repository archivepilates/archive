import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const assetPath = path.resolve("official-home/assets/imweb-my-classroom-20260723a.js");

if (!fs.existsSync(assetPath)) {
  throw new Error(`Required Imweb My Classroom asset is missing: ${assetPath}`);
}

const source = fs.readFileSync(assetPath, "utf8");
const requiredMarkers = [
  'VERSION="2026-09-04c"',
  "var MAX_PROBES=6",
  'data-ap-classroom-v2',
  '"/archive-method-watch-ach8"',
  '"/archive-method-watch-ab9"',
  '"/archive-method-watch-aca6"',
  '"/archive-method-watch-ach9"',
  '"/private-lesson-pelvis-hip-b-barrel-260725"',
  '"/private-lesson-jey-260718"',
  '"/private-lesson-support-movement-a-260829"',
  '"/private-lesson-support-movement-b-260829"',
  '"/private-lesson-support-movement-c-260830"',
  '"/private-lesson-support-movement-d-260830"',
];

for (const marker of requiredMarkers) {
  if (!source.includes(marker)) {
    throw new Error(`Imweb My Classroom asset is missing required marker: ${marker}`);
  }
}

if (Buffer.byteLength(source, "utf8") < 10_000) {
  throw new Error("Imweb My Classroom asset is unexpectedly small.");
}

new Function(source);

const hookPoint =
  '  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",run,{once:true});else run();';
assert(source.includes(hookPoint), "Imweb My Classroom test hook point is missing.");

const instrumented = source.replace(
  hookPoint,
  `  globalThis.__apClassroomTest={L:L,okDocument:okDocument,probeOrder:probeOrder,responseMatches:responseMatches};\n${hookPoint}`,
);
const attributes = new Map();
const sandbox = {
  URL,
  document: {
    addEventListener() {},
    documentElement: {
      getAttribute(name) {
        return attributes.get(name) ?? null;
      },
      setAttribute(name, value) {
        attributes.set(name, String(value));
      },
    },
    getElementById() {
      return {};
    },
    readyState: "loading",
  },
  location: {
    href: "https://archivepilates.imweb.me/my-classroom",
    pathname: "/my-classroom",
  },
};
vm.runInNewContext(instrumented, sandbox);

const hooks = sandbox.__apClassroomTest;
assert(hooks, "Imweb My Classroom test hooks did not initialize.");

const privateDoc = {
  querySelector(selector) {
    return selector.includes(".ap-private-watch") ? {} : null;
  },
  querySelectorAll() {
    return [];
  },
};
assert(hooks.okDocument(privateDoc), "Private watch containers must count as playable pages.");
const nativeVideoWidgetDoc = {
  querySelector(selector) {
    return selector.includes('[data-widget-type="video"]') ? {} : null;
  },
  querySelectorAll() {
    return [];
  },
};
assert(
  hooks.okDocument(nativeVideoWidgetDoc),
  "Native Imweb video widgets must count as playable pages.",
);
assert(
  hooks.responseMatches(
    {
      ok: true,
      url: "https://archivepilates.imweb.me/private-lesson-support-movement-c-260830?probe=1",
    },
    { path: "/private-lesson-support-movement-c-260830" },
  ),
  "An authorized private watch response must match its expected page.",
);
assert(
  !hooks.responseMatches(
    {
      ok: true,
      url: "https://archivepilates.imweb.me/login?back_url=private-lesson-support-movement-c-260830",
    },
    { path: "/private-lesson-support-movement-c-260830" },
  ),
  "A login redirect must never create a classroom card.",
);

const orderedLessons = hooks.probeOrder().map((index) => hooks.L[index]);
assert(
  orderedLessons.length === hooks.L.length && new Set(orderedLessons).size === hooks.L.length,
  "The prioritized probe queue must include every lesson exactly once.",
);
let reachedStandardLesson = false;
for (const lesson of orderedLessons) {
  if (!lesson.private) reachedStandardLesson = true;
  assert(
    !(reachedStandardLesson && lesson.private),
    "Private lesson pages must be probed before standard paid-video pages.",
  );
}

console.log(`Validated Imweb My Classroom asset (${Buffer.byteLength(source, "utf8")} bytes).`);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
