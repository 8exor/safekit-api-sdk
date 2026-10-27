import { encodeViemCall } from "./adapters/viem.js";
import { erc20ApproveCall, erc20TransferCall } from "./helpers.js";

export { createSafe, SafeKitError } from "./safe.js";
export { SAFE_ABI, SAFE_TX_TYPES } from "./abi.js";
export { ERC20_ABI } from "./helpers.js";

export const encodeCall = encodeViemCall;
export const erc20Transfer = (token, to, amount) => encodeViemCall(erc20TransferCall(token, to, amount));
export const erc20Approve = (token, spender, amount) => encodeViemCall(erc20ApproveCall(token, spender, amount));
