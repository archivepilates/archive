import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(path.join(root, "firebase/kangsain-functions/functions/package.json"));
const ts = require("typescript");
export const sourceRoot = "firebase/kangsain-functions/functions/src/";
export const hash = (value) => createHash("sha256").update(value).digest("hex");

// Read selected constant expressions only. Never execute backend imports, inspect env,
// initialize Firebase, or read secret modules while building the public catalog.
export function sourceReader() {
  const files = new Map();
  function file(relative) {
    if (!files.has(relative)) {
      if (!/^(firebase\/kangsain-functions\/functions\/src\/|core\/assets\/app\.js)/.test(relative) || /secret|config\/firebase/.test(relative))
        throw new Error(`Catalog source is not allowed: ${relative}`);
      const text = fs.readFileSync(path.join(root, relative), "utf8");
      files.set(relative, ts.createSourceFile(relative, text, ts.ScriptTarget.Latest, true));
    }
    return files.get(relative);
  }
  function declaration(relative, name) {
    const source = file(relative);
    for (const statement of source.statements) {
      if (ts.isVariableStatement(statement)) {
        const found = statement.declarationList.declarations.find((entry) => entry.name.getText(source) === name);
        if (found) return found;
      }
      if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) return statement;
    }
    throw new Error(`Missing catalog source symbol ${relative}#${name}`);
  }
  function constant(relative, name) {
    const source = file(relative);
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement)) continue;
      const bindings = statement.importClause?.namedBindings;
      if (!bindings || !ts.isNamedImports(bindings)) continue;
      const imported = bindings.elements.find((entry) => entry.name.text === name);
      if (imported) {
        const specifier = statement.moduleSpecifier.text;
        if (!specifier.startsWith(".")) throw new Error(`External constant import: ${specifier}`);
        return constant(path.posix.normalize(path.posix.join(path.posix.dirname(relative), `${specifier}.ts`)), imported.propertyName?.text || name);
      }
    }
    return evaluate(relative, declaration(relative, name).initializer);
  }
  function evaluate(relative, node) {
    if (!node) throw new Error(`No constant initializer in ${relative}`);
    if (ts.isAsExpression(node) || ts.isParenthesizedExpression(node) || ts.isSatisfiesExpression(node)) return evaluate(relative, node.expression);
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (ts.isNumericLiteral(node)) return Number(node.text);
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (node.kind === ts.SyntaxKind.NullKeyword) return null;
    if (ts.isIdentifier(node)) return constant(relative, node.text);
    if (ts.isPropertyAccessExpression(node)) {
      if (node.expression.getText(file(relative)) === "process.env") return undefined;
      return evaluate(relative, node.expression)[node.name.text];
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.BarBarToken)
      return evaluate(relative, node.left) || evaluate(relative, node.right);
    if (ts.isArrayLiteralExpression(node)) return node.elements.map((entry) => evaluate(relative, entry));
    if (ts.isObjectLiteralExpression(node)) {
      const result = {};
      for (const entry of node.properties) {
        if (ts.isSpreadAssignment(entry)) Object.assign(result, evaluate(relative, entry.expression));
        else if (ts.isPropertyAssignment(entry)) {
          const key = ts.isComputedPropertyName(entry.name) ? evaluate(relative, entry.name.expression) : entry.name.text;
          result[key] = evaluate(relative, entry.initializer);
        } else throw new Error(`Unsupported catalog property: ${entry.getText(file(relative))}`);
      }
      return result;
    }
    if (ts.isTemplateExpression(node)) return node.head.text + node.templateSpans.map((entry) => `${evaluate(relative, entry.expression)}${entry.literal.text}`).join("");
    if (ts.isNewExpression(node) && node.expression.getText(file(relative)) === "Set") return evaluate(relative, node.arguments[0]);
    if (ts.isCallExpression(node) && node.expression.getText(file(relative)) === "Object.freeze") return evaluate(relative, node.arguments[0]);
    throw new Error(`Unsupported catalog constant in ${relative}: ${node.getText(file(relative)).slice(0, 100)}`);
  }
  function reference(relative, symbol) {
    const source = file(relative);
    const node = declaration(relative, symbol);
    return { path: relative, symbol, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1 };
  }
  function schedule(relative, symbol) {
    const node = declaration(relative, symbol).initializer;
    if (!ts.isCallExpression(node) || node.expression.getText(file(relative)) !== "onSchedule") throw new Error(`Not a schedule: ${symbol}`);
    const prop = node.arguments[0].properties.find((entry) => entry.name?.getText(file(relative)) === "schedule");
    return { expression: evaluate(relative, prop.initializer), source: reference(relative, symbol) };
  }
  function excerpt(relative, symbol) {
    return declaration(relative, symbol).getText(file(relative));
  }
  return { constant, reference, schedule, excerpt, touch: file, fingerprints: () => [...files].sort(([a], [b]) => a.localeCompare(b)).map(([path, source]) => ({ path, sha256: hash(source.text) })) };
}
