export const OPS_FLAG_NAMES = Object.freeze([
  "OPS_MONITORING_ENABLED",
  "OPS_ALERTS_ENABLED",
  "OPS_BACKUPS_ENABLED",
  "OPS_RESTORE_TESTS_ENABLED",
]);

export default {
  async scheduled(_controller, env, _ctx) {
    const enabledFlags = OPS_FLAG_NAMES.filter((flagName) => flag(env?.[flagName]));

    // This repository slice intentionally stops before connecting a signal
    // source, alert transport, backup bucket, or restore executor. Returning
    // here is the checked-in operating state: no binding is touched and no
    // external operation is attempted.
    if (enabledFlags.length === 0) return;

    // Fail closed if a flag is changed before the corresponding implementation
    // and acceptance gate land. A configuration edit alone must never activate
    // a partial monitoring, alerting, backup, or restore workflow.
    throw new Error("SQUARE_OPS_SCAFFOLD_NOT_ACTIVATION_READY");
  },
};

function flag(value) {
  return String(value ?? "").trim().toLowerCase() === "true";
}
