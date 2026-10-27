import { SafeKitError } from "./errors.js";

// Library-agnostic Safe logic: checks, locking, and the public methods.
// Everything that touches a chain client or a crypto library goes through `adapter`.

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const locks = new Map();

function withLock(key, fn) {
  const previous = locks.get(key) ?? Promise.resolve();
  const run = previous.catch(() => {}).then(fn);
  locks.set(key, run.catch(() => {}));
  return run;
}

function normalizeTx(adapter, tx, nonce) {
  if (!adapter.isAddress(tx.to)) throw new TypeError(`Invalid tx.to: ${tx.to}`);
  return {
    to: adapter.checksum(tx.to),
    value: BigInt(tx.value ?? 0),
    data: tx.data ?? "0x",
    operation: tx.operation ?? 0,
    safeTxGas: 0n,
    baseGas: 0n,
    gasPrice: 0n,
    gasToken: ZERO_ADDRESS,
    refundReceiver: ZERO_ADDRESS,
    nonce,
  };
}

function execArgs(tx, signatures) {
  return [
    tx.to,
    tx.value,
    tx.data,
    tx.operation,
    tx.safeTxGas,
    tx.baseGas,
    tx.gasPrice,
    tx.gasToken,
    tx.refundReceiver,
    signatures,
  ];
}

/**
 * @param {object} adapter  chain and crypto operations for one library (see adapters/)
 * @param {string} safeAddress
 */
export function createSafeCore(adapter, safeAddress) {
  if (!adapter.isAddress(safeAddress)) throw new TypeError(`Invalid safeAddress: ${safeAddress}`);

  const address = adapter.checksum(safeAddress);
  const lockKey = address.toLowerCase();

  const read = (functionName, args = []) => adapter.read(address, functionName, args);

  const requireWallet = () => {
    if (!adapter.hasAccount) {
      throw new TypeError("walletClient with a local account is required to execute transactions");
    }
  };

  const getOwners = async () => (await read("getOwners")).map((owner) => adapter.checksum(owner));

  const getThreshold = async () => Number(await read("getThreshold"));

  const getNonce = async () => read("nonce");

  const isOwner = async (account) => (await getOwners()).includes(adapter.checksum(account));

  // Builds the transaction against the Safe's current nonce; an explicit nonce must match it.
  const resolveTx = async (tx = {}) => {
    const current = await getNonce();
    if (tx.nonce !== undefined && BigInt(tx.nonce) !== current) {
      throw new SafeKitError(
        "STALE_NONCE",
        `Transaction nonce ${tx.nonce} does not match the Safe nonce ${current}`,
      );
    }
    return normalizeTx(adapter, tx, current);
  };

  const signTyped = async (tx, signer) => {
    const chainId = await adapter.chainId();
    const localHash = await adapter.hashSafeTx(address, chainId, tx);
    const onchainHash = await read("getTransactionHash", [
      tx.to,
      tx.value,
      tx.data,
      tx.operation,
      tx.safeTxGas,
      tx.baseGas,
      tx.gasPrice,
      tx.gasToken,
      tx.refundReceiver,
      tx.nonce,
    ]);
    if (localHash.toLowerCase() !== onchainHash.toLowerCase()) {
      throw new SafeKitError("HASH_MISMATCH", "Local SafeTx hash differs from the Safe contract hash");
    }
    const data = await adapter.signSafeTx(address, chainId, tx, signer);
    return { signer: adapter.checksum(signer.address), data, nonce: tx.nonce };
  };

  const verifySignature = async (tx, signature) => {
    if (!/^0x[0-9a-fA-F]{130}$/.test(signature.data)) {
      throw new SafeKitError("INVALID_SIGNATURE", "Signature must be 65 bytes of hex");
    }
    const v = parseInt(signature.data.slice(-2), 16);
    if (v !== 27 && v !== 28) {
      throw new SafeKitError("INVALID_SIGNATURE", "Signature v must be 27 or 28");
    }
    const recovered = await adapter.recoverSafeTxSigner(address, await adapter.chainId(), tx, signature.data);
    if (adapter.checksum(recovered) !== adapter.checksum(signature.signer)) {
      throw new SafeKitError("INVALID_SIGNATURE", "Signature does not match the signer address");
    }
  };

  // Everything that must hold before a transaction is sent, so failures cost no gas.
  const preflight = async (tx, signature) => {
    const threshold = await getThreshold();
    if (threshold !== 1) {
      throw new SafeKitError(
        "THRESHOLD_NOT_SUPPORTED",
        `Safe threshold is ${threshold}; this SDK version only executes threshold-1 Safes`,
      );
    }
    if (!(await isOwner(signature.signer))) {
      throw new SafeKitError("NOT_OWNER", `${signature.signer} is not an owner of this Safe`);
    }
    await verifySignature(tx, signature);

    const args = execArgs(tx, signature.data);
    if (!(await adapter.simulateExec(address, args))) {
      throw new SafeKitError("INNER_CALL_WILL_FAIL", "The inner call would fail; execution was not sent");
    }
    return args;
  };

  const send = async (tx, signature) => {
    const args = await preflight(tx, signature);
    const hash = await adapter.sendExec(address, args);
    const { receipt, status, safeEvents } = await adapter.waitForExec(address, hash);
    if (status !== "success") {
      throw new SafeKitError("REVERTED", "Safe transaction reverted", { hash });
    }
    // Safe reports an inner call failure as ExecutionFailure, not as a reverted receipt.
    if (safeEvents.includes("ExecutionFailure")) {
      throw new SafeKitError("EXECUTION_FAILED", "Safe reported ExecutionFailure", { hash });
    }
    return { hash, receipt };
  };

  const executeWithSigner = async (tx, account) => {
    requireWallet();
    return withLock(lockKey, async () => {
      const resolved = await resolveTx(tx);
      const signature = await signTyped(resolved, account);
      return send(resolved, signature);
    });
  };

  return {
    address,
    getOwners,
    getThreshold,
    getNonce,
    isOwner,

    async signTransaction(tx, account) {
      return signTyped(await resolveTx(tx), account);
    },

    async estimateGas(tx, signature) {
      const resolved = await resolveTx(tx);
      if (signature.nonce !== undefined && BigInt(signature.nonce) !== resolved.nonce) {
        throw new SafeKitError("STALE_NONCE", "Signature was made for a different Safe nonce");
      }
      const args = await preflight(resolved, signature);
      return adapter.estimateExec(address, args);
    },

    async execute(tx, signature) {
      requireWallet();
      return withLock(lockKey, async () => {
        const resolved = await resolveTx(tx);
        if (signature.nonce !== undefined && BigInt(signature.nonce) !== resolved.nonce) {
          throw new SafeKitError("STALE_NONCE", "Signature was made for a different Safe nonce");
        }
        return send(resolved, signature);
      });
    },

    executeWithSigner,

    async writeContract(call, account) {
      return executeWithSigner(adapter.encodeCall(call), account);
    },

    async getBalance() {
      return adapter.getBalance(address);
    },

    async cancelWithSigner(account) {
      requireWallet();
      return withLock(lockKey, async () => {
        const resolved = await resolveTx({ to: address, value: 0n, data: "0x" });
        const signature = await signTyped(resolved, account);
        return send(resolved, signature);
      });
    },
  };
}
