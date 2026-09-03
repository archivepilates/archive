import fs from "node:fs";
import path from "node:path";

export const CATALOG_RELATIVE_PATH = "config/imweb-paid-video-catalog.json";
export const CLASSROOM_REGION = "archive-paid-video-classroom-catalog";
export const SALES_REGION = "archive-paid-video-sales-catalog";

export function loadPaidVideoCatalog(root, catalogPath = CATALOG_RELATIVE_PATH) {
  const absolutePath = path.resolve(root, catalogPath);
  const catalog = JSON.parse(fs.readFileSync(absolutePath, "utf8"));
  validatePaidVideoCatalog(catalog);
  return catalog;
}

export function validatePaidVideoCatalog(catalog) {
  const errors = [];
  const requiredTopLevel = ["site", "runtime", "defaults", "equipment", "products", "merchandising"];
  for (const key of requiredTopLevel) {
    if (catalog?.[key] == null) errors.push(`missing top-level field: ${key}`);
  }
  if (catalog?.schemaVersion !== 1) errors.push("schemaVersion must be 1");
  if (!Array.isArray(catalog?.products) || catalog.products.length === 0) {
    errors.push("products must be a non-empty array");
  }
  if (!/^S[0-9a-z]+$/.test(catalog?.site?.siteCode || "")) errors.push("site.siteCode is invalid");
  if (!/^u[0-9a-z]+$/.test(catalog?.site?.unitCode || "")) errors.push("site.unitCode is invalid");
  if (!String(catalog?.site?.shopPath || "").startsWith("/")) errors.push("site.shopPath is invalid");
  if (!String(catalog?.site?.classroomPath || "").startsWith("/")) {
    errors.push("site.classroomPath is invalid");
  }
  if (!/^s[0-9a-z]+$/.test(catalog?.site?.onlineCategoryCode || "")) {
    errors.push("site.onlineCategoryCode is invalid");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(catalog?.runtime?.releaseDate || "")) {
    errors.push("runtime.releaseDate is invalid");
  }
  for (const key of ["classroomAssetVersion", "classroomLoaderVersion", "videoSalesVersion"]) {
    if (!/^\d{4}-\d{2}-\d{2}[a-z]$/.test(catalog?.runtime?.[key] || "")) {
      errors.push(`runtime.${key} is invalid`);
    }
  }
  const expectedAssetQuery = `${String(catalog?.runtime?.classroomAssetVersion || "")
    .slice(0, 10)
    .replaceAll("-", "")}${String(catalog?.runtime?.classroomAssetVersion || "").slice(-1)}`;
  if (catalog?.runtime?.classroomAssetQuery !== expectedAssetQuery) {
    errors.push(`runtime.classroomAssetQuery must be ${expectedAssetQuery}`);
  }
  if (!Number.isInteger(catalog?.defaults?.price) || catalog.defaults.price <= 0) {
    errors.push("defaults.price must be a positive integer");
  }
  if (!Number.isInteger(catalog?.defaults?.entitlementDays) || catalog.defaults.entitlementDays <= 0) {
    errors.push("defaults.entitlementDays must be a positive integer");
  }
  if (catalog?.defaults?.productType !== "subscribe") {
    errors.push("defaults.productType must be subscribe");
  }

  const codes = new Set();
  const productNos = new Set();
  const groups = new Set();
  const paths = new Set();
  const equipmentEntries = Object.entries(catalog?.equipment || {}).sort(
    ([, left], [, right]) => right.codePrefix.length - left.codePrefix.length,
  );

  for (const [index, product] of (catalog?.products || []).entries()) {
    const label = `products[${index}]`;
    if (!/^(?:ACA|ACH|AR|AB)\d+(?:-\d+)?$/.test(product.code || "")) {
      errors.push(`${label}.code is invalid`);
    }
    if (!Number.isInteger(product.productNo) || product.productNo <= 0) {
      errors.push(`${label}.productNo must be a positive integer`);
    }
    if (!String(product.title || "").trim()) errors.push(`${label}.title is required`);
    if (!/^g[0-9a-z]+$/.test(product.groupCode || "")) {
      errors.push(`${label}.groupCode is invalid`);
    }
    const expectedPath = `/archive-method-watch-${String(product.code || "").toLowerCase()}`;
    if (product.watchPath !== expectedPath) {
      errors.push(`${label}.watchPath must be ${expectedPath}`);
    }
    if (!new Set(["sale", "nosale", "soldout"]).has(product.saleStatus)) {
      errors.push(`${label}.saleStatus is invalid`);
    }
    if (typeof product.displayed !== "boolean") errors.push(`${label}.displayed must be boolean`);
    if (
      product.previewYouTubeId != null &&
      !/^[A-Za-z0-9_-]{11}$/.test(product.previewYouTubeId)
    ) {
      errors.push(`${label}.previewYouTubeId must be an 11-character YouTube id`);
    }
    if (product.verifyInRelease && !product.previewYouTubeId) {
      errors.push(`${label} is marked verifyInRelease but has no previewYouTubeId`);
    }
    if (product.price != null && (!Number.isInteger(product.price) || product.price <= 0)) {
      errors.push(`${label}.price must be a positive integer`);
    }
    if (
      product.entitlementDays != null &&
      (!Number.isInteger(product.entitlementDays) || product.entitlementDays <= 0)
    ) {
      errors.push(`${label}.entitlementDays must be a positive integer`);
    }

    const equipment = equipmentEntries.find(([, value]) => product.code.startsWith(value.codePrefix));
    if (!equipment) {
      errors.push(`${label}.code has no equipment mapping`);
    } else if (!product.title.startsWith(equipment[0])) {
      errors.push(`${label}.title must start with equipment name ${equipment[0]}`);
    }

    addUnique(codes, product.code, `${label}.code`, errors);
    addUnique(productNos, product.productNo, `${label}.productNo`, errors);
    addUnique(groups, product.groupCode, `${label}.groupCode`, errors);
    addUnique(paths, product.watchPath, `${label}.watchPath`, errors);
  }

  const byCode = new Map((catalog?.products || []).map((product) => [product.code, product]));
  for (const [index, item] of (catalog?.merchandising?.best || []).entries()) {
    if (!byCode.has(item.code)) errors.push(`merchandising.best[${index}] references unknown code`);
  }
  for (const [index, route] of (catalog?.merchandising?.routes || []).entries()) {
    if (!String(route.title || "").trim()) errors.push(`merchandising.routes[${index}].title is required`);
    if (!Array.isArray(route.codes) || route.codes.length === 0) {
      errors.push(`merchandising.routes[${index}].codes must be non-empty`);
    }
    for (const code of route.codes || []) {
      if (!byCode.has(code)) errors.push(`merchandising.routes[${index}] references unknown ${code}`);
    }
  }
  for (const [source, target] of Object.entries(catalog?.merchandising?.nextByCode || {})) {
    if (!byCode.has(source)) errors.push(`merchandising.nextByCode has unknown source ${source}`);
    if (!byCode.has(target)) errors.push(`merchandising.nextByCode has unknown target ${target}`);
  }
  for (const code of catalog?.merchandising?.nextPriority || []) {
    if (!byCode.has(code)) errors.push(`merchandising.nextPriority references unknown ${code}`);
  }

  if (errors.length) {
    throw new Error(`Invalid paid-video catalog:\n- ${errors.join("\n- ")}`);
  }
  return catalog;
}

export function releaseProducts(catalog) {
  return catalog.products.filter((product) => product.verifyInRelease === true);
}

export function equipmentFor(catalog, product) {
  const matches = Object.entries(catalog.equipment)
    .filter(([, value]) => product.code.startsWith(value.codePrefix))
    .sort(([, left], [, right]) => right.codePrefix.length - left.codePrefix.length);
  if (!matches.length) throw new Error(`No equipment mapping for ${product.code}`);
  return { name: matches[0][0], ...matches[0][1] };
}

export function productName(catalog, product) {
  return `[온라인] ARCHIVE METHOD ${product.title} (${product.code}) ${daysFor(catalog, product)}D 이용권`;
}

export function groupName(catalog, product) {
  return `ARCHIVE METHOD ${product.code} ${daysFor(catalog, product)}D`;
}

export function classroomTitle(product) {
  return product.classroomTitle || `${product.title} (${product.code})`;
}

export function priceFor(catalog, product) {
  return product.price ?? catalog.defaults.price;
}

export function daysFor(catalog, product) {
  return product.entitlementDays ?? catalog.defaults.entitlementDays;
}

export function renderClassroomCatalog(catalog) {
  const rows = catalog.products.map((product) => ({
    code: product.code,
    path: product.watchPath,
    title: classroomTitle(product),
  }));
  return [
    `  // <${CLASSROOM_REGION}:begin>`,
    `  var PAID_VIDEO_CATALOG=${formatJsonArray(rows, "  ")};`,
    `  // <${CLASSROOM_REGION}:end>`,
  ].join("\n");
}

export function renderVideoSalesCatalog(catalog) {
  const byCode = new Map(catalog.products.map((product) => [product.code, product]));
  const catalogRows = catalog.products.map((product) => [
    product.productNo,
    { code: product.code, title: product.title, price: priceFor(catalog, product) },
  ]);
  const lines = [
    `  // <${SALES_REGION}:begin>`,
    "  var CATALOG = {",
    ...catalogRows.map(
      ([productNo, product], index) =>
        `    ${productNo}: ${inlineObject(product)}${index === catalogRows.length - 1 ? "" : ","}`,
    ),
    "  };",
    "",
    "  var BEST = [",
    ...(catalog.merchandising.best || []).map((item, index, rows) => {
      const product = byCode.get(item.code);
      return `    ${inlineObject({ idx: product.productNo, label: item.label, reason: item.reason })}${index === rows.length - 1 ? "" : ","}`;
    }),
    "  ];",
    "",
    "  var ROUTES = [",
    ...(catalog.merchandising.routes || []).flatMap((route, index, rows) => [
      "    {",
      `      title: ${JSON.stringify(route.title)},`,
      `      copy: ${JSON.stringify(route.copy)},`,
      `      items: [${route.codes.map((code) => byCode.get(code).productNo).join(", ")}]`,
      `    }${index === rows.length - 1 ? "" : ","}`,
    ]),
    "  ];",
    "",
    "  var NEXT_BY_CODE = {",
    ...Object.entries(catalog.merchandising.nextByCode || {}).map(
      ([source, target], index, rows) =>
        `    ${source}: ${byCode.get(target).productNo}${index === rows.length - 1 ? "" : ","}`,
    ),
    "  };",
    `  var NEXT_PRIORITY = ${JSON.stringify(catalog.merchandising.nextPriority || [])};`,
    `  // <${SALES_REGION}:end>`,
  ];
  return lines.join("\n");
}

export function replaceGeneratedRegion(source, region, rendered) {
  const escaped = region.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `^[ \\t]*// <${escaped}:begin>[\\s\\S]*?^[ \\t]*// <${escaped}:end>`,
    "m",
  );
  const matches = source.match(new RegExp(pattern.source, "gm")) || [];
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one generated region ${region}, found ${matches.length}`);
  }
  return source.replace(pattern, rendered);
}

function addUnique(set, value, field, errors) {
  if (set.has(value)) errors.push(`${field} is duplicated: ${value}`);
  set.add(value);
}

function formatJsonArray(rows, indent) {
  if (!rows.length) return "[]";
  return `[\n${rows
    .map((row, index) => `${indent}  ${JSON.stringify(row)}${index === rows.length - 1 ? "" : ","}`)
    .join("\n")}\n${indent}]`;
}

function inlineObject(value) {
  return `{ ${Object.entries(value)
    .map(([key, item]) => `${key}: ${JSON.stringify(item)}`)
    .join(", ")} }`;
}
