import { test } from "node:test";
import assert from "node:assert/strict";
import { AbiCoder, Interface, TypedDataEncoder, Wallet, getAddress } from "ethers";
import { recoverTypedDataAddress } from "viem";
import { createSafe } from "../src/ethers.js";
import { SAFE_ABI, SAFE_TX_TYPES } from "../src/abi.js";

// Mirrors test/safe.test.js for the ethers entry point, using an ethers-shaped mock runner.

const OWNER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const OTHER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const OWNER = new Wallet(OWNER_KEY);
const OTHER = new Wallet(OTHER_KEY);
const SAFE = "0x1111111111111111111111111111111111111111";
const CHAIN_ID = 11155111;
const TX_HASH = `0x${"ab".repeat(32)}`;
const TX = { to: OTHER.address, value: 1n, data: "0x" };

const safeIface = new Interface(SAFE_ABI);
const abi = AbiCoder.defaultAbiCoder();

function makeRunners({
  owners = [OWNER.address],
  threshold = 1,
  nonce = 0n,
  simulateResult = true,
  failureEvent = false,
  badHash = false,
} = {}) {
  const state = { writes: [] };
  const domain = { chainId: CHAIN_ID, verifyingContract: getAddress(SAFE) };

  const failureLogs = failureEvent
    ? [
        {
          address: getAddress(SAFE),
          topics: [safeIface.getEvent("ExecutionFailure").topicHash],
          data: abi.encode(["bytes32", "uint256"], [TX_HASH, 0n]),
        },
      ]
    : [];

  const provider = {
    async getNetwork() {
      return { chainId: BigInt(CHAIN_ID) };
    },
    async getBalance() {
      return 5n * 10n ** 18n;
    },
    async call({ data }) {
      const { name, args } = safeIface.parseTransaction({ data });
      switch (name) {
        case "getOwners":
          return safeIface.encodeFunctionResult(name, [owners]);
        case "getThreshold":
          return safeIface.encodeFunctionResult(name, [BigInt(threshold)]);
        case "nonce":
          return safeIface.encodeFunctionResult(name, [nonce]);
        case "getTransactionHash": {
          if (badHash) return safeIface.encodeFunctionResult(name, [`0x${"00".repeat(32)}`]);
          const [to, value, txData, operation, safeTxGas, baseGas, gasPrice, gasToken, refundReceiver, n] = args;
          const hash = TypedDataEncoder.hash(domain, SAFE_TX_TYPES, {
            to,
            value,
            data: txData,
            operation,
            safeTxGas,
            baseGas,
            gasPrice,
            gasToken,
            refundReceiver,
            nonce: n,
          });
          return safeIface.encodeFunctionResult(name, [hash]);
        }
        case "execTransaction":
          return safeIface.encodeFunctionResult(name, [simulateResult]);
        default:
          throw new Error(`unexpected call ${name}`);
      }
    },
    async estimateGas() {
      return 123456n;
    },
    async sendTransaction(tx) {
      state.writes.push(tx);
      return { hash: TX_HASH, wait: async () => null };
    },
    async waitForTransaction() {
      return { status: 1, logs: failureLogs };
    },
  };

  const signer = Object.assign({}, provider, {
    address: OWNER.address,
    signTypedData: (d, types, value) => OWNER.signTypedData(d, types, value),
  });

  return { provider, signer, state };
}

function makeSafe(options = {}, { signerKey = OWNER } = {}) {
  const { provider, signer, state } = makeRunners(options);
  const safe = createSafe({ provider, signer: signerKey === OWNER ? signer : undefined, safeAddress: SAFE });
  return { safe, state, signer, provider };
}

test("executeWithSigner sends a single owner signature and returns the hash", async () => {
  const { safe, state } = makeSafe();

  const result = await safe.executeWithSigner(TX, OWNER);

  assert.equal(result.hash, TX_HASH);
  assert.equal(state.writes.length, 1);
  const { args } = safeIface.parseTransaction({ data: state.writes[0].data });
  assert.equal(args[9].length, 132);
});

test("estimateGas accepts a signature produced by signTransaction", async () => {
  const { safe } = makeSafe();

  const signature = await safe.signTransaction(TX, OWNER);
  assert.equal(await safe.estimateGas(TX, signature), 123456n);
});

test("rejects a transaction whose nonce is not the current Safe nonce", async () => {
  const { safe } = makeSafe({ nonce: 0n });

  await assert.rejects(safe.executeWithSigner({ ...TX, nonce: 5n }, OWNER), { code: "STALE_NONCE" });
});

test("rejects a signer that is not an owner", async () => {
  const { safe, state } = makeSafe({ owners: [OTHER.address] });

  await assert.rejects(safe.executeWithSigner(TX, OWNER), { code: "NOT_OWNER" });
  assert.equal(state.writes.length, 0);
});

test("rejects Safes whose threshold is above one", async () => {
  const { safe, state } = makeSafe({ threshold: 2 });

  await assert.rejects(safe.executeWithSigner(TX, OWNER), { code: "THRESHOLD_NOT_SUPPORTED" });
  assert.equal(state.writes.length, 0);
});

test("does not send when the inner call would fail (boolean false)", async () => {
  const { safe, state } = makeSafe({ simulateResult: false });

  await assert.rejects(safe.executeWithSigner(TX, OWNER), { code: "INNER_CALL_WILL_FAIL" });
  assert.equal(state.writes.length, 0);
});

test("reports ExecutionFailure even when the receipt status is success", async () => {
  const { safe } = makeSafe({ failureEvent: true });

  await assert.rejects(safe.executeWithSigner(TX, OWNER), { code: "EXECUTION_FAILED" });
});

test("rejects a signature whose recovered signer does not match the claimed owner", async () => {
  const { safe } = makeSafe({ owners: [OWNER.address, OTHER.address] });

  const forged = { ...(await safe.signTransaction(TX, OTHER)), signer: OWNER.address };
  await assert.rejects(safe.estimateGas(TX, forged), { code: "INVALID_SIGNATURE" });
});

test("detects a local hash that differs from the Safe contract hash", async () => {
  const { safe } = makeSafe({ badHash: true });

  await assert.rejects(safe.signTransaction(TX, OWNER), { code: "HASH_MISMATCH" });
});

test("cancelWithSigner sends a zero-value self call at the current nonce", async () => {
  const { safe, state } = makeSafe({ nonce: 3n });

  await safe.cancelWithSigner(OWNER);

  const { args } = safeIface.parseTransaction({ data: state.writes[0].data });
  assert.equal(args[0], getAddress(SAFE));
  assert.equal(args[1], 0n);
});

test("execute rejects a signature made for an older Safe nonce", async () => {
  const signedAtZero = makeSafe({ nonce: 0n });
  const signature = await signedAtZero.safe.signTransaction(TX, OWNER);

  const later = makeSafe({ nonce: 1n });
  await assert.rejects(later.safe.execute(TX, signature), { code: "STALE_NONCE" });
  assert.equal(later.state.writes.length, 0);
});

test("reads owners, threshold, nonce, membership and balance", async () => {
  const { safe } = makeSafe({ nonce: 7n });

  assert.equal(safe.address, getAddress(SAFE));
  assert.deepEqual(await safe.getOwners(), [OWNER.address]);
  assert.equal(await safe.getThreshold(), 1);
  assert.equal(await safe.getNonce(), 7n);
  assert.equal(await safe.isOwner(OTHER.address), false);
  assert.equal(await safe.getBalance(), 5n * 10n ** 18n);
});

test("requires a signer to execute", async () => {
  const { provider } = makeRunners();
  const safe = createSafe({ provider, safeAddress: SAFE });

  await assert.rejects(safe.executeWithSigner(TX, OWNER), TypeError);
});

test("parity: an ethers signature is recovered by viem as the same owner", async () => {
  const { safe } = makeSafe();

  const signature = await safe.signTransaction(TX, OWNER);
  const { domain, types, primaryType, message } = {
    domain: { chainId: CHAIN_ID, verifyingContract: getAddress(SAFE) },
    types: SAFE_TX_TYPES,
    primaryType: "SafeTx",
    message: { ...TX, to: getAddress(TX.to), value: 1n, data: "0x", operation: 0, safeTxGas: 0n, baseGas: 0n, gasPrice: 0n, gasToken: "0x0000000000000000000000000000000000000000", refundReceiver: "0x0000000000000000000000000000000000000000", nonce: 0n },
  };
  const recovered = await recoverTypedDataAddress({ domain, types, primaryType, message, signature: signature.data });
  assert.equal(recovered, OWNER.address);
});
