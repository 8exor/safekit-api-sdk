import { createSafeCore } from "./core.js";
import { createViemAdapter } from "./adapters/viem.js";

export { SafeKitError } from "./errors.js";

/**
 * @param {{ publicClient: import("viem").PublicClient, walletClient?: import("viem").WalletClient, safeAddress: string }} options
 *   walletClient must hold a local account (e.g. createWalletClient({ account: privateKeyToAccount(pk), transport })).
 */
export function createSafe({ publicClient, walletClient, safeAddress }) {
  if (!publicClient) throw new TypeError("publicClient is required");
  return createSafeCore(createViemAdapter({ publicClient, walletClient }), safeAddress);
}
