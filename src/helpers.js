import { encodeFunctionData, getAddress } from "viem";

export const ERC20_ABI = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
];

/**
 * Encodes a contract call into a transaction for the Safe to execute.
 * @param {{ address: string, abi: unknown[], functionName: string, args?: unknown[], value?: bigint }} call
 * @returns {{ to: string, value: bigint, data: string }}
 */
export function encodeCall({ address, abi, functionName, args = [], value = 0n }) {
  return {
    to: getAddress(address),
    value: BigInt(value),
    data: encodeFunctionData({ abi, functionName, args }),
  };
}

/** Transfers an ERC-20 token from the Safe. Amount is in the token's smallest unit. */
export function erc20Transfer(token, to, amount) {
  return encodeCall({ address: token, abi: ERC20_ABI, functionName: "transfer", args: [to, amount] });
}

/** Approves a spender to use an ERC-20 token held by the Safe. */
export function erc20Approve(token, spender, amount) {
  return encodeCall({ address: token, abi: ERC20_ABI, functionName: "approve", args: [spender, amount] });
}
