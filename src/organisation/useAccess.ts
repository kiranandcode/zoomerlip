import { useEffect, useState } from "react";
import { request } from "../api";
import type { Account } from "../types";
import type { Session } from "../sessionModel";
import type { Access, UserGroup } from "./permissions";
import { useOrganisationRevision } from "./lifecycle";
export function useAccess(account: Account, session?: Session): Access {
  const revision = useOrganisationRevision(account.id);
  const [state, setState] = useState<{ revision: number; groups: UserGroup[] }>(
    { revision: -1, groups: [] },
  );
  const me = session?.users.find((u) => u.user_id === account.userId);
  useEffect(() => {
    if (!session?.ready || session.locked || !me || me.role === 600) return;
    const controller = new AbortController();
    void request<{ user_groups: UserGroup[] }>(
      account,
      "/user_groups",
      {},
      "GET",
      controller.signal,
    )
      .then((data) => {
        if (!controller.signal.aborted)
          setState({ revision, groups: data.user_groups.slice(0, 10000) });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ revision, groups: [] });
      });
    return () => controller.abort();
  }, [account, revision, session?.ready, session?.locked, me?.role]);
  return {
    me,
    settings: session?.organisation || {},
    featureLevel: Number(session?.organisation?.zulip_feature_level) || 0,
    groups: state.revision === revision ? state.groups : [],
  };
}
