// Library-agnostic ERC-20 call builders. Each entry point encodes these with its own library.

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

/** Call that transfers an ERC-20 token from the Safe. Amount is in the token's smallest unit. */
export function erc20TransferCall(token, to, amount) {
  return { address: token, abi: ERC20_ABI, functionName: "transfer", args: [to, amount] };
}

/** Call that approves a spender to use an ERC-20 token held by the Safe. */
export function erc20ApproveCall(token, spender, amount) {
  return { address: token, abi: ERC20_ABI, functionName: "approve", args: [spender, amount] };
}
