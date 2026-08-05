"use client";
import { useState } from "react";
import { inviteLink } from "@/lib/communities/invite-link";
import styles from "./community-panel.module.css";

function execCommandCopy(text: string): boolean {
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

async function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return execCommandCopy(text);
    }
  }
  return execCommandCopy(text);
}

export function InviteFriends({ code }: { code: string }) {
  const [copied, setCopied] = useState<"link" | "code" | null>(null);
  const [manual, setManual] = useState<string | null>(null);

  async function copy(which: "link" | "code", text: string) {
    const ok = await copyToClipboard(text);
    if (ok) {
      setManual(null);
      setCopied(which);
      window.setTimeout(() => setCopied((current) => (current === which ? null : current)), 1300);
    } else {
      setCopied(null);
      setManual(text);
    }
  }

  return (
    <div className={styles.invite}>
      <p className={styles.inviteHint}>Share this link so friends can join instantly — no email needed.</p>
      <button
        type="button"
        className={styles.inviteBtn}
        onClick={() => copy("link", inviteLink(window.location.origin, code))}
      >
        {copied === "link" ? "Copied!" : "Copy invite link"}
      </button>
      <div className={styles.inviteCodeRow}>
        <span className={styles.inviteCodeLabel}>Code</span>
        <span className={styles.inviteCode}>{code}</span>
        <button type="button" className={styles.inviteCopyCode} onClick={() => copy("code", code)}>
          {copied === "code" ? "Copied" : "Copy"}
        </button>
      </div>
      {manual && (
        <p className={styles.inviteFallback} role="alert">
          Couldn&rsquo;t copy automatically — select and copy:{" "}
          <span className={styles.inviteFallbackText}>{manual}</span>
        </p>
      )}
    </div>
  );
}
