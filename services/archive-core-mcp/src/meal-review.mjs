import { publicResult } from './safety.mjs';

const preferenceKeys = ['primaryGoal', 'mealsPerDay', 'breakfastPattern', 'mainMealSource', 'cookingAccess',
  'mealBudget', 'mealBreakWindow', 'workIntensity', 'exerciseSchedule', 'snackPattern', 'preferredFoods'];

// Never return the complete response or InBody/health fields through a generic review.
export function mealReview(bundle) {
  const response = bundle.response || {};
  const answers = response.answers || response;
  const preferences = answers.schemaVersion === 'meal-choice-v2' || response.schemaVersion === 'meal-choice-v2'
    ? Object.fromEntries(preferenceKeys.filter(k => Object.hasOwn(answers, k)).map(k => [k, answers[k]])) : {};
  return publicResult({ requestId: bundle.requestId || bundle.request?.requestId,
    request: { status: bundle.request?.status, memberId: bundle.request?.memberId, memberName: bundle.request?.memberName },
    responseHash: response.sourceHash, preferences, reviewRequired: !!(response.reviewReasons?.length),
    reviewReasons: response.reviewReasons || [], draft: bundle.draft, report: bundle.report,
    source: 'CORE canonical stored records; not StudioMate live', observedAt: new Date().toISOString(),
  }, { review: true });
}
