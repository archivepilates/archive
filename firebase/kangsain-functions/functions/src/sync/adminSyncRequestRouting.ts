const MAC_MINI_REQUEST_MODES = new Set([
  "emergency_excel",
  "membership_contract_readback",
]);

export function isMacMiniAdminSyncRequest(requestMode: unknown) {
  return (
    typeof requestMode === "string" &&
    MAC_MINI_REQUEST_MODES.has(requestMode)
  );
}
