import { createSandboxWorker } from "./index.mjs";
import { sandboxFaultController } from "./sandbox-faults.mjs";

// This is the only entrypoint that can attach the module-private fault
// controller. Production continues to bundle src/index.mjs directly.
export default createSandboxWorker(sandboxFaultController);
