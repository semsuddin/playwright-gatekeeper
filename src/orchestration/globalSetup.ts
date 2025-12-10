import { getGlobalState } from './testContext';

/**
 * Global setup - runs once before all tests start
 * Initializes the gatekeeper state file
 */
async function globalSetup() {
  const state = getGlobalState();
  state.initialize();
}

export default globalSetup;
