console.error(
  [
    "Blocked: the legacy firebase/kangsain-functions default Functions deploy is retired.",
    "Run the repository-root affected-only flow instead:",
    "  node scripts/deploy-affected-functions.mjs --base <base-sha> --head HEAD --apply",
  ].join("\n"),
);
process.exit(1);
