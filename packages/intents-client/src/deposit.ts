/** Describes a NEAR `ft_transfer`. Does not sign or broadcast. */
export interface NearFungibleTransfer {
  receiverId: string;
  methodName: "ft_transfer";
  args: { receiver_id: string; amount: string; memo: string | null };
  gas: "30000000000000";
  attachedDepositYocto: "1";
}

/**
 * Transfer origin tokens to the quote's deposit address.
 * Rejects dry-run placeholders. A memo is included when the quote requires one.
 */
export function buildNearDepositTransfer(
  tokenId: string,
  depositAddress: string,
  amountRaw: string,
  memo?: string,
): NearFungibleTransfer {
  if (!tokenId) throw new Error("token id is required");
  if (!depositAddress || depositAddress === "dry_run") {
    throw new Error("dry-run quotes have no deposit address");
  }
  if (!/^\d+$/.test(amountRaw) || amountRaw === "0") throw new Error("amount must be a positive integer string");
  return {
    receiverId: tokenId,
    methodName: "ft_transfer",
    args: { receiver_id: depositAddress, amount: amountRaw, memo: memo ?? null },
    gas: "30000000000000",
    attachedDepositYocto: "1",
  };
}
