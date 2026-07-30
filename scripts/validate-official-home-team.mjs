import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const PUBLIC = path.join(ROOT, "official-home");
const TEAM_DIR = path.join(PUBLIC, "teams");
const TEAM_INDEX = path.join(TEAM_DIR, "index.html");
const SITEMAP = path.join(PUBLIC, "sitemap.xml");
const FIREBASE = path.join(ROOT, "firebase.archive-home.json");

const teamHtml = fs.readFileSync(TEAM_INDEX, "utf8");
const sitemap = fs.readFileSync(SITEMAP, "utf8");
const firebase = JSON.parse(fs.readFileSync(FIREBASE, "utf8"));

const cardSlugs = unique(
  Array.from(teamHtml.matchAll(/href="\/teams\/([a-z0-9-]+)"/g), (match) => match[1])
);
assert(cardSlugs.length > 0, "The team page must contain at least one profile card.");

const profileSlugs = fs
  .readdirSync(TEAM_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
assertSameSet(cardSlugs, profileSlugs, "Team cards and profile directories differ.");

for (const slug of cardSlugs) {
  assert(
    fs.existsSync(path.join(TEAM_DIR, slug, "index.html")),
    `Missing profile page for ${slug}.`
  );
}

const imagePaths = unique(
  Array.from(
    teamHtml.matchAll(/src="(\/assets\/team\/[^"]+)"/g),
    (match) => match[1]
  )
);
for (const imagePath of imagePaths) {
  assert(
    fs.existsSync(path.join(PUBLIC, imagePath.replace(/^\//, ""))),
    `Missing team image: ${imagePath}.`
  );
}

const sitemapSlugs = unique(
  Array.from(
    sitemap.matchAll(/https:\/\/archivepilates\.com\/teams\/([a-z0-9-]+)/g),
    (match) => match[1]
  )
);
assertSameSet(cardSlugs, sitemapSlugs, "Team cards and sitemap profiles differ.");

assert(!teamHtml.includes("김아영"), "Retired instructor remains on the team list.");
assert(!sitemap.includes("/teams/ayoung"), "Retired profile remains in the sitemap.");
assert(
  !fs.existsSync(path.join(TEAM_DIR, "ayoung", "index.html")),
  "Retired profile page still exists."
);
assert(
  !fs.existsSync(path.join(PUBLIC, "assets/team/kim-ayoung.jpeg")),
  "Retired profile image still exists."
);

const redirect = (firebase.hosting?.redirects || []).find(
  (entry) => entry.source === "/teams/ayoung"
);
assert(redirect, "The retired profile redirect is missing.");
assert(redirect.destination === "/teams", "The retired profile redirect target is wrong.");
assert(redirect.type === 301, "The retired profile redirect must be permanent.");

console.log(
  `Validated official team roster: ${cardSlugs.length} profiles, ${imagePaths.length} images.`
);

function unique(values) {
  return [...new Set(values)].sort();
}

function assertSameSet(left, right, message) {
  assert(
    left.length === right.length && left.every((value, index) => value === right[index]),
    `${message} cards=${left.join(",")} other=${right.join(",")}`
  );
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
