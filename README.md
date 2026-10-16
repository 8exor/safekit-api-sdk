# safekit-api-sdk

Execute transactions on a Safe directly on-chain, without the Safe Transaction Service API.
No API key, no monthly quota, and no 429 errors from the service.

v1 supports single-signer Safes (threshold 1). Built on `viem`.

## Install

```bash
npm install safekit-api-sdk viem
```

## Usage

```js
import { createPublicClient, createWalletClient, http } from "viem";
import { sepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { createSafe } from "safekit-api-sdk";

const transport = http(process.env.RPC_URL);
const account = privateKeyToAccount(process.env.SAFE_OWNER_PK);

const safe = createSafe({
  publicClient: createPublicClient({ chain: sepolia, transport }),
  walletClient: createWalletClient({ account, chain: sepolia, transport }),
  safeAddress: "0x...",
});

await safe.getOwners();   // ["0x..."]
await safe.getThreshold(); // 1
await safe.isOwner(account.address);

const tx = { to: "0xReceiver", value: 0n, data: "0x" };

const gas = await safe.estimateGas(tx, await safe.signTransaction(tx, account));
const { hash, receipt } = await safe.executeWithSigner(tx, account);
```

## API

- `createSafe({ publicClient, walletClient, safeAddress })`
- `getOwners()`, `getThreshold()`, `getNonce()`, `isOwner(address)`
- `signTransaction(tx, account)`: returns a signature to pass to `estimateGas` or `execute`.
- `estimateGas(tx, signature)`: pre-flight checks, then gas estimate.
- `execute(tx, signature)`: sends a transaction signed earlier.
- `executeWithSigner(tx, account)`: signs and sends in one call.
- `cancelWithSigner(account)`: sends a zero-value self call at the current nonce. This replaces a pending transaction only if it executes first.

`tx` is `{ to, value?, data?, operation?, nonce? }`. If `nonce` is set it must equal the Safe's current nonce.

## Pre-flight checks

Before anything is sent, the SDK checks:
- the Safe threshold is 1
- the signer is an owner
- the signature recovers to the signer and has v 27 or 28
- the local SafeTx hash matches the Safe contract's hash
- the nonce is current
- the inner call succeeds in simulation

Failures throw a `SafeKitError` with a `code`: `STALE_NONCE`, `HASH_MISMATCH`, `THRESHOLD_NOT_SUPPORTED`, `NOT_OWNER`, `INVALID_SIGNATURE`, `INNER_CALL_WILL_FAIL`, `REVERTED`, `EXECUTION_FAILED`.

`EXECUTION_FAILED` is thrown when the transaction mines with status success but Safe emitted `ExecutionFailure`, which happens when the inner call reverts. A plain receipt check misses this.

## Limitations (v1)

- Single signer only. Safes with threshold above 1 are rejected.
- Transactions are serialized per Safe within one process. Running several processes against the same Safe needs an external lock, or nonce collisions can occur.
- No transaction queue or history. Use the chain or your own logs.
- Safe transaction gas parameters (`safeTxGas`, `baseGas`, `gasPrice`) are fixed to 0.
- Signatures are EIP-712 only (v 27/28). Contract and eth_sign signatures are not supported.

## Test

```bash
npm test
```

The test suite runs offline against a mock client.
