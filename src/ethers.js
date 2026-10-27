import { createSafeCore } from "./core.js";
import { createEthersAdapter, encodeEthersCall } from "./adapters/ethers.js";
import { erc20ApproveCall, erc20TransferCall } from "./helpers.js";

export { SafeKitError } from "./errors.js";
export { ERC20_ABI } from "./helpers.js";

export const encodeCall = encodeEthersCall;
export const erc20Transfer = (token, to, amount) => encodeEthersCall(erc20TransferCall(token, to, amount));
export const erc20Approve = (token, spender, amount) => encodeEthersCall(erc20ApproveCall(token, spender, amount));

/**
 * Ethers v6 entry point: import from "safekit-api-sdk/ethers".
 * @param {{ provider: import("ethers").Provider, signer?: import("ethers").Signer, safeAddress: string }} options
 *   signer must be a local wallet (e.g. new Wallet(privateKey, provider)) to send transactions.
 */
export function createSafe({ provider, signer, safeAddress }) {
  if (!provider) throw new TypeError("provider is required");
  return createSafeCore(createEthersAdapter({ provider, signer }), safeAddress);
}
