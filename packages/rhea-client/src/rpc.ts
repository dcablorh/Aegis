export const BURROW_MAINNET = "contract.main.burrow.near";
export const BURROW_TESTNET = "contract.1638481328.burrow.testnet";
export const RPC_MAINNET = "https://rpc.mainnet.near.org";
export const RPC_TESTNET = "https://rpc.testnet.near.org";

export interface ViewOptions {
  rpcUrl: string;
  fetch?: typeof fetch;
}

interface RpcResponse {
  result?: { result?: number[]; error?: string };
  error?: { message?: string };
}

export async function viewFunction<T>(
  contractId: string,
  method: string,
  args: unknown,
  options: ViewOptions,
): Promise<T> {
  const doFetch = options.fetch ?? fetch;
  const response = await doFetch(options.rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "aegis",
      method: "query",
      params: {
        request_type: "call_function",
        account_id: contractId,
        method_name: method,
        args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
        finality: "final",
      },
    }),
  });
  if (!response.ok) throw new Error(`NEAR RPC failed: ${response.status}`);
  const body = (await response.json()) as RpcResponse;
  if (body.error) throw new Error(body.error.message ?? "NEAR RPC error");
  if (body.result?.error) throw new Error(body.result.error);
  if (!body.result?.result) throw new Error(`empty result from ${method}`);
  return JSON.parse(Buffer.from(body.result.result).toString("utf8")) as T;
}
