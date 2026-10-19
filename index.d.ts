import type { Abi, Account, Address, Hash, Hex, PublicClient, TransactionReceipt, WalletClient } from "viem";

/** Minimal Safe ABI used by the SDK. */
export const SAFE_ABI: Abi;

/** EIP-712 types for the SafeTx struct. */
export const SAFE_TX_TYPES: Record<string, readonly { name: string; type: string }[]>;

export interface SafeTxInput {
  to: Address;
  value?: bigint;
  data?: Hex;
  operation?: 0 | 1;
  /** Must equal the Safe's current nonce when provided. */
  nonce?: bigint;
}

export interface SafeSignature {
  signer: Address;
  data: Hex;
  nonce?: bigint;
}

export interface ExecuteResult {
  hash: Hash;
  receipt: TransactionReceipt;
}

export type SafeKitErrorCode =
  | "STALE_NONCE"
  | "HASH_MISMATCH"
  | "THRESHOLD_NOT_SUPPORTED"
  | "NOT_OWNER"
  | "INVALID_SIGNATURE"
  | "INNER_CALL_WILL_FAIL"
  | "REVERTED"
  | "EXECUTION_FAILED";

export class SafeKitError extends Error {
  code: SafeKitErrorCode;
  details?: { hash: Hash };
}

export interface SafeOptions {
  publicClient: PublicClient;
  /** Must hold a local account so it can send transactions. */
  walletClient?: WalletClient;
  safeAddress: Address;
}

export interface Safe {
  readonly address: Address;
  getOwners(): Promise<Address[]>;
  getThreshold(): Promise<number>;
  getNonce(): Promise<bigint>;
  isOwner(account: Address): Promise<boolean>;
  signTransaction(tx: SafeTxInput, account: Account): Promise<SafeSignature>;
  estimateGas(tx: SafeTxInput, signature: SafeSignature): Promise<bigint>;
  execute(tx: SafeTxInput, signature: SafeSignature): Promise<ExecuteResult>;
  executeWithSigner(tx: SafeTxInput, account: Account): Promise<ExecuteResult>;
  cancelWithSigner(account: Account): Promise<ExecuteResult>;
  /** Encodes a call on any contract and executes it through the Safe. */
  writeContract(call: ContractCall, account: Account): Promise<ExecuteResult>;
  /** Native token balance held by the Safe, in wei. */
  getBalance(): Promise<bigint>;
}

export function createSafe(options: SafeOptions): Safe;

export interface ContractCall {
  /** Target contract address. */
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
  /** Native value sent with the call, in wei. */
  value?: bigint;
}

export interface EncodedCall {
  to: Address;
  value: bigint;
  data: Hex;
}

export const ERC20_ABI: Abi;

/** Encodes a contract call into a transaction the Safe can execute. */
export function encodeCall(call: ContractCall): EncodedCall;
/** Transfers an ERC-20 token from the Safe. Amount is in the token's smallest unit. */
export function erc20Transfer(token: Address, to: Address, amount: bigint): EncodedCall;
/** Approves a spender to use an ERC-20 token held by the Safe. */
export function erc20Approve(token: Address, spender: Address, amount: bigint): EncodedCall;
