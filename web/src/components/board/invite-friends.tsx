"use client";
import { useState } from "react";
import { inviteLink } from "@/lib/communities/invite-link";
import styles from "./community-panel.module.css";

export function InviteFriends({ code }: { code: string }) {
  const [copied, setCopied] = useState<"link" | "code" | null>(null);

  function copy(which: "link" | "code", text: string) {
    const clipboard = navigator.clipboard;
    if (!clipboard) return;
    Promise.resolve(clipboard.writeText(text))
      .then(() => setCopied(which))
      .catch(() => {});
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
    </div>
  );
}
