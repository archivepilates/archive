import assert from "node:assert/strict";
import test from "node:test";
import { codebasesForFile } from "../lib/affected-functions.mjs";

for (const file of ["recommendedMealSurvey.ts", "recommendedMealProgram.ts", "recommendedMealAlimtalk.ts", "recommendedMealChoicePolicy.ts"])
  test(`meal shared source reaches both physical codebases: ${file}`, () => {
    assert.deepEqual(codebasesForFile(`firebase/kangsain-functions/functions/src/mealPlan/${file}`), ["functions-alimtalk", "functions-app"]);
  });
