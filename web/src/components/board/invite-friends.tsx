"use client";
import { useEffect, useRef, useState } from "react";
import { inviteLink } from "@/lib/communities/invite-link";
import styles from "./community-panel.module.css";

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function InviteFriends({ slug, code }: { slug: string; code: string | null }) {
  const [copied, setCopied] = useState<"link" | "code" | null>(null);
  const [manual, setManual] = useState<string | null>(null);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (resetTimer.current) clearTimeout(resetTimer.current);
  }, []);

  async function copy(which: "link" | "code", text: string) {
    const ok = await copyToClipboard(text);
    if (ok) {
      setManual(null);
      setCopied(which);
      if (resetTimer.current) clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => {
        setCopied(null);
        resetTimer.current = null;
      }, 1300);
    } else {
      setCopied(null);
      setManual(text);
    }
  }

  return (
    <div className={styles.invite}>
      <p className={styles.inviteHint}>Share this link so friends can join.</p>
      <button
        type="button"
        className={styles.inviteBtn}
        onClick={() =>
          copy(
            "link",
            code
              ? inviteLink(window.location.origin, code)
              : `${window.location.origin}/community/${encodeURIComponent(slug)}`,
          )
        }
      >
        {copied === "link" ? "Copied" : "Copy invite link"}
      </button>
      {code && (
        <div className={styles.inviteCodeRow}>
          <span className={styles.inviteCodeLabel}>Code</span>
          <span className={styles.inviteCode}>{code}</span>
          <button type="button" className={styles.inviteCopyCode} onClick={() => copy("code", code)}>
            {copied === "code" ? "Copied" : "Copy"}
          </button>
        </div>
      )}
      <span className={styles.srOnly} aria-live="polite">
        {copied ? "Copied to clipboard" : ""}
      </span>
      {manual && (
        <p className={styles.inviteFallback} role="alert">
          Couldn&rsquo;t copy automatically — select and copy:{" "}
          <span className={styles.inviteFallbackText}>{manual}</span>
        </p>
      )}
    </div>
  );
}
