import { useEffect, useRef, useState } from "react";
import { startRobloxLink, unlinkRobloxAccount } from "../api";
import type { LinkedRobloxAccount } from "../types";
import { Link } from "../router";

export default function RobloxConnection({ account, enabled, csrfToken, onChanged }: {
  account: LinkedRobloxAccount | null;
  enabled: boolean;
  csrfToken: string;
  onChanged: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [prompt, setPrompt] = useState<"link" | "unlink" | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (prompt && !dialog.current?.open) dialog.current?.showModal();
    else if (!prompt) dialog.current?.close();
  }, [prompt]);
  function openPrompt(value: "link" | "unlink") { setError(null); setPrompt(value); }
  async function confirm() {
    setWorking(true); setError(null);
    try {
      if (prompt === "unlink" && account) {
        await unlinkRobloxAccount(account.userId, csrfToken);
        setPrompt(null);
        onChanged();
      } else {
        const { authorizationUrl } = await startRobloxLink(csrfToken);
        window.location.assign(authorizationUrl);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update your Roblox connection. Please try again.");
    } finally { setWorking(false); }
  }
  return <>
    <div className="account-connection">
      <img className="account-connection-symbol" src="/social/roblox.png" alt="" />
      <div>
        <h4>Roblox</h4>
        {account ? <><p><a className="account-profile-link" href={`https://www.roblox.com/users/${account.userId}/profile`} target="_blank" rel="noopener noreferrer">@{account.username} ↗</a></p><small>User ID: {account.userId}</small></>
          : <><p>Link your Roblox account</p><small>Show your verified Roblox username and user ID on your profile.</small></>}
      </div>
      <div className="account-connection-actions">
        {account && <span className="account-tag is-connected">CONNECTED</span>}
        <button className={account ? "account-text-button" : "primary-button"} onClick={() => openPrompt("link")}>{account ? "Update link" : "LINK ROBLOX"}</button>
        {account && <button className="account-text-button account-signout" onClick={() => openPrompt("unlink")}>Unlink</button>}
      </div>
    </div>
    <dialog className="account-link-dialog" ref={dialog} aria-labelledby="roblox-link-heading" aria-describedby="roblox-link-description"
      onCancel={event => { if (working) event.preventDefault(); else setPrompt(null); }} onClose={() => setPrompt(null)}>
      <img className="account-connection-symbol" src="/social/roblox.png" alt="" />
      <h3 id="roblox-link-heading">{prompt === "unlink" ? "Unlink Roblox?" : account ? "Update your Roblox connection" : "Link your Roblox account"}</h3>
      <p id="roblox-link-description">{prompt === "unlink"
        ? `Remove @${account?.username} from your website profile? Your Discord account and bug reports will stay saved.`
        : "Continue to Roblox to choose your account and approve sharing your username and user ID with Tower Eclipse."}</p>
      {prompt === "link" && <p className="account-footnote">{account ? "Choose another account, or select the same one to refresh your username. " : ""}You’ll return to your profile after approval.</p>}
      {prompt === "link" && <p className="legal-inline-notice">By continuing, you agree to our <Link to="/terms">Terms of Service</Link>. Our <Link to="/privacy">Privacy Policy</Link> explains how we use and remove your linked account information.</p>}
      {prompt === "unlink" && <p className="account-footnote">You can link it again later. You can also manage app permissions in your Roblox account settings.</p>}
      {prompt === "link" && !enabled && <p className="account-link-unavailable" role="status">Roblox linking is being prepared. Please check back soon.</p>}
      {error && <p className="message error" role="alert">{error}</p>}
      <div className="account-dialog-actions">
        <button className="secondary-button" disabled={working} onClick={() => setPrompt(null)}>CANCEL</button>
        <button className="primary-button" disabled={working || (prompt === "link" && !enabled)} onClick={() => void confirm()}>{working ? "PLEASE WAIT…" : prompt === "unlink" ? "UNLINK ROBLOX" : "CONTINUE TO ROBLOX"}</button>
      </div>
    </dialog>
  </>;
}
