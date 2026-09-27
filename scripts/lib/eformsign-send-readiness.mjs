export async function runEformStage(page, stage, action) {
  try {
    return await action();
  } catch (cause) {
    const state = await page.evaluate(() => ({
      path: location.pathname,
      framePresent: Boolean(document.querySelector('#viewer_frame')),
      viewerStatus: document.querySelector('#viewer_layer')?.getAttribute('load_status') || '',
      processText: (document.querySelector('#btn_unstructured_process_request')?.textContent || '').trim().slice(0, 40),
    })).catch(() => ({ unavailable: true }));
    // Do not capture form values, recipient data, query tokens, or page HTML.
    const timeout = String(cause?.message || '').match(/Timeout\s+(\d+)ms/i)?.[1];
    throw new Error(`[eformsign:${stage}] ${cause?.name || 'Error'}${timeout ? ` timeoutMs=${timeout}` : ''} ${JSON.stringify(state)}`, { cause });
  }
}

export async function waitForEformOperatorFields(page, fieldIds) {
  await page.locator('#viewer_frame').waitFor({ state: 'attached', timeout: 30_000 });
  const frame = page.frameLocator('#viewer_frame');
  for (const id of Object.values(fieldIds)) {
    await frame.locator(`#${id}`).waitFor({ state: 'visible', timeout: 30_000 });
  }
  return frame;
}

export function resolvedEformErrorPatch(current, expectedError) {
  if (!expectedError || current.lastError !== String(expectedError).slice(0, 500)) return {};
  const otherFailure = Object.entries(current.steps || {}).some(([key, step]) =>
    key !== 'eformsign' && ['failed', 'retry', 'review_required'].includes(step?.status));
  if (otherFailure) return {};
  return { lastError: null, lastResolvedEformError: current.lastError };
}
