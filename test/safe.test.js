import { test } from "node:test";
import assert from "node:assert/strict";
import { privateKeyToAccount } from "viem/accounts";
import { encodeAbiParameters, encodeEventTopics, getAddress, hashTypedData } from "viem";
import { createSafe } from "../src/index.js";
import { SAFE_ABI, SAFE_TX_TYPES } from "../src/abi.js";

const OWNER = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const OTHER = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const SAFE = "0x1111111111111111111111111111111111111111";
const CHAIN_ID = 11155111;
const TX_HASH = `0x${"ab".repeat(32)}`;

function makeClients({
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
          topics: encodeEventTopics({ abi: SAFE_ABI, eventName: "ExecutionFailure" }),
          data: encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }], [TX_HASH, 0n]),
          blockNumber: 1n,
          blockHash: TX_HASH,
          transactionHash: TX_HASH,
          transactionIndex: 0,
          logIndex: 0,
          removed: false,
        },
      ]
    : [];

  const publicClient = {
    async getChainId() {
      return CHAIN_ID;
    },
    async readContract({ functionName, args }) {
      switch (functionName) {
        case "getOwners":
          return owners;
        case "getThreshold":
          return BigInt(threshold);
        case "nonce":
          return nonce;
        case "getTransactionHash": {
          if (badHash) return `0x${"00".repeat(32)}`;
          const [to, value, data, operation, safeTxGas, baseGas, gasPrice, gasToken, refundReceiver, n] = args;
          return hashTypedData({
            domain,
            types: SAFE_TX_TYPES,
            primaryType: "SafeTx",
            message: { to, value, data, operation, safeTxGas, baseGas, gasPrice, gasToken, refundReceiver, nonce: n },
          });
        }
        default:
          throw new Error(`unexpected read ${functionName}`);
      }
    },
    async simulateContract() {
      return { result: simulateResult };
    },
    async estimateContractGas() {
      return 123456n;
    },
    async waitForTransactionReceipt() {
      return { status: "success", logs: failureLogs };
    },
  };

  const walletClient = {
    account: OWNER,
    async writeContract(params) {
      state.writes.push(params);
      return TX_HASH;
    },
  };

  return { publicClient, walletClient, state };
}

const TX = { to: OTHER.address, value: 1n, data: "0x" };

test("executeWithSigner sends a single owner signature and returns the hash", async () => {
  const { publicClient, walletClient, state } = makeClients();
  const safe = createSafe({ publicClient, walletClient, safeAddress: SAFE });

  const result = await safe.executeWithSigner(TX, OWNER);

  assert.equal(result.hash, TX_HASH);
  assert.equal(state.writes.length, 1);
  const signatures = state.writes[0].args[9];
  assert.equal(signatures.length, 132);
});

test("estimateGas accepts a signature produced by signTransaction", async () => {
  const { publicClient, walletClient } = makeClients();
  const safe = createSafe({ publicClient, walletClient, safeAddress: SAFE });

  const signature = await safe.signTransaction(TX, OWNER);
  assert.equal(await safe.estimateGas(TX, signature), 123456n);
});

test("rejects a transaction whose nonce is not the current Safe nonce", async () => {
  const { publicClient, walletClient } = makeClients({ nonce: 0n });
  const safe = createSafe({ publicClient, walletClient, safeAddress: SAFE });

  await assert.rejects(safe.executeWithSigner({ ...TX, nonce: 5n }, OWNER), { code: "STALE_NONCE" });
});

test("rejects a signer that is not an owner", async () => {
  const { publicClient, walletClient, state } = makeClients({ owners: [OTHER.address] });
  const safe = createSafe({ publicClient, walletClient, safeAddress: SAFE });

  await assert.rejects(safe.executeWithSigner(TX, OWNER), { code: "NOT_OWNER" });
  assert.equal(state.writes.length, 0);
});

test("rejects Safes whose threshold is above one", async () => {
  const { publicClient, walletClient, state } = makeClients({ threshold: 2 });
  const safe = createSafe({ publicClient, walletClient, safeAddress: SAFE });

  await assert.rejects(safe.executeWithSigner(TX, OWNER), { code: "THRESHOLD_NOT_SUPPORTED" });
  assert.equal(state.writes.length, 0);
});

test("does not send when the inner call would fail", async () => {
  const { publicClient, walletClient, state } = makeClients({ simulateResult: false });
  const safe = createSafe({ publicClient, walletClient, safeAddress: SAFE });

  await assert.rejects(safe.executeWithSigner(TX, OWNER), { code: "INNER_CALL_WILL_FAIL" });
  assert.equal(state.writes.length, 0);
});

test("reports ExecutionFailure even when the receipt status is success", async () => {
  const { publicClient, walletClient } = makeClients({ failureEvent: true });
  const safe = createSafe({ publicClient, walletClient, safeAddress: SAFE });

  await assert.rejects(safe.executeWithSigner(TX, OWNER), { code: "EXECUTION_FAILED" });
});

test("rejects a signature whose recovered signer does not match the claimed owner", async () => {
  const { publicClient, walletClient } = makeClients({ owners: [OWNER.address, OTHER.address] });
  const safe = createSafe({ publicClient, walletClient, safeAddress: SAFE });

  const forged = { ...(await safe.signTransaction(TX, OTHER)), signer: OWNER.address };
  await assert.rejects(safe.estimateGas(TX, forged), { code: "INVALID_SIGNATURE" });
});

test("detects a local hash that differs from the Safe contract hash", async () => {
  const { publicClient, walletClient } = makeClients({ badHash: true });
  const safe = createSafe({ publicClient, walletClient, safeAddress: SAFE });

  await assert.rejects(safe.signTransaction(TX, OWNER), { code: "HASH_MISMATCH" });
});

test("cancelWithSigner sends a zero-value self call at the current nonce", async () => {
  const { publicClient, walletClient, state } = makeClients({ nonce: 3n });
  const safe = createSafe({ publicClient, walletClient, safeAddress: SAFE });

  await safe.cancelWithSigner(OWNER);

  const [to, value, data] = state.writes[0].args;
  assert.equal(to, getAddress(SAFE));
  assert.equal(value, 0n);
  assert.equal(data, "0x");
});

test("execte sends a signature that was produced earlier", async () => {
  const { publicClient, walletClient, state } = makeClients();
  const safe = createSafe({ publicClient, walletClient, safeAddress: SAFE });

  const signature = await safe.signTransaction(TX, OWNER);
  const result = await safe.execute(TX, signature);

  assert.equal(result.hash, TX_HASH);
  assert.equal(state.writes.length, 1);
});

test("execute rejects a signature made for an older Safe nonce", async () => {
  const signedAtZero = makeClients({ nonce: 0n });
  const signature = await createSafe({
    publicClient: signedAtZero.publicClient,
    walletClient: signedAtZero.walletClient,
    safeAddress: SAFE,
  }).signTransaction(TX, OWNER);

  const later = makeClients({ nonce: 1n });
  const safe = createSafe({ publicClient: later.publicClient, walletClient: later.walletClient, safeAddress: SAFE });

  await assert.rejects(safe.execute(TX, signature), { code: "STALE_NONCE" });
  assert.equal(later.state.writes.length, 0);
});

test("execution requires a walletClient with a local account", async () => {
  const { publicClient } = makeClients();
  const safe = createSafe({ publicClient, safeAddress: SAFE });

  await assert.rejects(safe.executeWithSigner(TX, OWNER), TypeError);
});

test("rejects an invalid Safe address or recipient", async () => {
  const { publicClient, walletClient } = makeClients();

  assert.throws(() => createSafe({ publicClient, walletClient, safeAddress: "0x1234" }), TypeError);

  const safe = createSafe({ publicClient, walletClient, safeAddress: SAFE });
  await assert.rejects(safe.executeWithSigner({ to: "0xnot-an-address" }, OWNER), TypeError);
});

test("reads owners, threshold, nonce and membership", async () => {
  const { publicClient, walletClient } = makeClients({ owners: [OWNER.address], threshold: 1, nonce: 7n });
  const safe = createSafe({ publicClient, walletClient, safeAddress: SAFE });

  assert.equal(safe.address, getAddress(SAFE));
  assert.deepEqual(await safe.getOwners(), [OWNER.address]);
  assert.equal(await safe.getThreshold(), 1);
  assert.equal(await safe.getNonce(), 7n);
  assert.equal(await safe.isOwner(OWNER.address.toLowerCase()), true);
  assert.equal(await safe.isOwner(OTHER.address), false);
});
