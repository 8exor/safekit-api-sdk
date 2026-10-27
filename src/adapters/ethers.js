import {
  Contract,
  Interface,
  TypedDataEncoder,
  getAddress,
  isAddress,
  verifyTypedData,
} from "ethers";
import { SAFE_ABI, SAFE_TX_TYPES } from "../abi.js";

// Every ethers-specific call the SDK makes lives in this file.
// Mirrors adapters/viem.js method for method so the core behaves the same with either.

const safeInterface = new Interface(SAFE_ABI);

function safeTxDomain(address, chainId) {
  return { chainId, verifyingContract: address };
}

/**
 * Encodes a contract call into a transaction for the Safe to execute.
 * @param {{ address: string, abi: unknown[], functionName: string, args?: unknown[], value?: bigint }} call
 * @returns {{ to: string, value: bigint, data: string }}
 */
export function encodeEthersCall({ address, abi, functionName, args = [], value = 0n }) {
  return {
    to: getAddress(address),
    value: BigInt(value),
    data: new Interface(abi).encodeFunctionData(functionName, args),
  };
}

export function createEthersAdapter({ provider, signer }) {
  const runner = signer ?? provider;

  const safeContract = (address, runnerOverride = runner) => new Contract(address, SAFE_ABI, runnerOverride);

  return {
    hasAccount: Boolean(signer),

    isAddress: (value) => isAddress(value),
    checksum: (value) => getAddress(value),
    encodeCall: (call) => encodeEthersCall(call),

    chainId: async () => Number((await provider.getNetwork()).chainId),
    getBalance: (address) => provider.getBalance(address),

    read: (address, functionName, args = []) => safeContract(address, provider)[functionName](...args),

    hashSafeTx: async (address, chainId, tx) =>
      TypedDataEncoder.hash(safeTxDomain(address, chainId), SAFE_TX_TYPES, tx),

    recoverSafeTxSigner: async (address, chainId, tx, data) =>
      verifyTypedData(safeTxDomain(address, chainId), SAFE_TX_TYPES, tx, data),

    signSafeTx: async (address, chainId, tx, wallet) =>
      wallet.signTypedData(safeTxDomain(address, chainId), SAFE_TX_TYPES, tx),

    // staticCall returns the Safe's boolean result. A revert throws, as it does in the viem adapter.
    simulateExec: (address, args) => safeContract(address).execTransaction.staticCall(...args),

    estimateExec: (address, args) => safeContract(address).execTransaction.estimateGas(...args),

    sendExec: async (address, args) => {
      const response = await safeContract(address).execTransaction(...args);
      return response.hash;
    },

    // Returns the receipt, its status, and the Safe's own events from this transaction.
    waitForExec: async (address, hash) => {
      const receipt = await provider.waitForTransaction(hash);
      if (!receipt) throw new Error(`Transaction ${hash} was not mined`);
      const safeEvents = receipt.logs
        .filter((log) => log.address.toLowerCase() === address.toLowerCase())
        .map((log) => safeInterface.parseLog(log))
        .filter((parsed) => parsed && ["ExecutionSuccess", "ExecutionFailure"].includes(parsed.name))
        .map((parsed) => parsed.name);
      return { receipt, status: receipt.status === 1 ? "success" : "reverted", safeEvents };
    },
  };
}
