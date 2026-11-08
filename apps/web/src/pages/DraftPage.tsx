import { Link, useParams } from "react-router";
import { ENCLAVE_X25519_HEX } from "../config";
import { findDraft } from "../lib/session";
import { Notice } from "../ui";

export function DraftPage() {
  const { draftId } = useParams();
  const draft = draftId ? findDraft(draftId) : undefined;
  if (!draft) {
    return (
      <>
        <h1>Draft</h1>
        <Notice tone="warn" title="Not in this session">This draft is not in the current tab. Prepare one from Protection.</Notice>
        <Link to="/app/protection">Back to protection</Link>
      </>
    );
  }
  return (
    <>
      <p className="kicker">Local result</p>
      <h1>Draft</h1>
      <Notice title="Not submitted">The ciphertext is in this browser only. The vault still has no record of it, and no approval was requested.</Notice>
      <dl className="sheet spaced">
        <dt>Account</dt><dd>{draft.accountId}</dd>
        <dt>Commitment</dt><dd className="num">{draft.commitment}</dd>
        <dt>Salt</dt><dd className="num">{draft.salt}</dd>
        <dt>Enclave key</dt><dd className="num">{ENCLAVE_X25519_HEX}</dd>
      </dl>
      <div className="field aside">
        <span>Ciphertext</span>
        <textarea readOnly value={draft.ciphertext} />
      </div>
      <div className="split-actions">
        <Link className="btn secondary" to="/app/security">Why this is not registered</Link>
        <Link className="btn" to={`/app/positions/${encodeURIComponent(draft.accountId)}?network=testnet`}>Open the named account</Link>
      </div>
    </>
  );
}
