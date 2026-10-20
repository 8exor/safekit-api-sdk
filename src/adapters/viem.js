import {
  getAddress,
  hashTypedData,
  isAddress,
  parseEventLogs,
  recoverTypedDataAddress,
} from "viem";
import { SAFE_ABI, SAFE_TX_TYPES } from "../abi.js";

// Every viem-specific call the SDK makes lives in this file.
// The core only talks to the adapter's methods.

function safeTxTypedData(address, chainId, tx) {
  return {
    domain: { chainId, verifyingContract: address },
    types: SAFE_TX_TYPES,
    primaryType: "SafeTx",
    message: tx,
  };
}

export function createViemAdapter({ publicClient, walletClient }) {
  const account = walletClient?.account;

  return {
    hasAccount: Boolean(account),

    isAddress: (value) => isAddress(value),
    checksum: (value) => getAddress(value),

    chainId: async () => Number(await publicClient.getChainId()),
    getBalance: (address) => publicClient.getBalance({ address }),

    read: (address, functionName, args = []) =>
      publicClient.readContract({ address, abi: SAFE_ABI, functionName, args }),

    hashSafeTx: async (address, chainId, tx) => hashTypedData(safeTxTypedData(address, chainId, tx)),

    recoverSafeTxSigner: async (address, chainId, tx, data) =>
      recoverTypedDataAddress({ ...safeTxTypedData(address, chainId, tx), signature: data }),

    signSafeTx: async (address, chainId, tx, signer) => signer.signTypedData(safeTxTypedData(address, chainId, tx)),

    simulateExec: async (address, args) => {
      const simulation = await publicClient.simulateContract({
        address,
        abi: SAFE_ABI,
        functionName: "execTransaction",
        args,
        account,
      });
      return Boolean(simulation.result);
    },

    estimateExec: (address, args) =>
      publicClient.estimateContractGas({ address, abi: SAFE_ABI, functionName: "execTransaction", args, account }),

    sendExec: (address, args) =>
      walletClient.writeContract({ address, abi: SAFE_ABI, functionName: "execTransaction", args, account }),

    // Returns the receipt, its status, and the Safe's own events from this transaction.
    waitForExec: async (address, hash) => {
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      const safeLogs = receipt.logs.filter((log) => log.address.toLowerCase() === address.toLowerCase());
      const events = parseEventLogs({
        abi: SAFE_ABI,
        logs: safeLogs,
        eventName: ["ExecutionSuccess", "ExecutionFailure"],
      });
      return { receipt, status: receipt.status, safeEvents: events.map((event) => event.eventName) };
    },
  };
}
