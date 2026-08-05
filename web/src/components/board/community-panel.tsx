import type { CommunityMeta } from "@tokenboard/contracts";
import type { ViewerMembership } from "@/lib/communities/get-membership";
import { LeaveCommunity } from "./leave-community";
import { InviteFriends } from "./invite-friends";
import styles from "./community-panel.module.css";

function policyHint(c: CommunityMeta): string {
  if (c.joinPolicy === "email_domain") return "work-email board";
  if (c.joinPolicy === "code") return "invite-only";
  return "open to join";
}

export function CommunityPanel({
  community,
  membership,
  inviteCode,
}: {
  community: CommunityMeta;
  membership: ViewerMembership | null;
  inviteCode: string | null;
}) {
  return (
    <>
      <section className={styles.panel}>
        <h2 className={styles.phead}>{community.name}</h2>
        <dl className={styles.meta}>
          <div className={styles.metaRow}>
            <dt className={styles.k}>Members</dt>
            <dd className={styles.v}>{community.memberCount}</dd>
          </div>
          <div className={styles.metaRow}>
            <dt className={styles.k}>Access</dt>
            <dd className={styles.v}>{policyHint(community)}</dd>
          </div>
        </dl>
      </section>
      {membership && (
        <section className={styles.panel}>
          {inviteCode && <InviteFriends code={inviteCode} />}
          <LeaveCommunity communityId={membership.communityId} name={community.name} />
        </section>
      )}
    </>
  );
}
