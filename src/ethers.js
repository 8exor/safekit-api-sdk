import { createSafeCore } from "./core.js";
import { createEthersAdapter } from "./adapters/ethers.js";

export { SafeKitError } from "./errors.js";

/**
 * Ethers v6 entry point: import from "safekit-api-sdk/ethers".
 * @param {{ provider: import("ethers").Provider, signer?: import("ethers").Signer, safeAddress: string }} options
 *   signer must be a local wallet (e.g. new Wallet(privateKey, provider)) to send transactions.
 */
export function createSafe({ provider, signer, safeAddress }) {
  if (!provider) throw new TypeError("provider is required");
  return createSafeCore(createEthersAdapter({ provider, signer }), safeAddress);
}
