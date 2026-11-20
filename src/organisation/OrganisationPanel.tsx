import { useState } from "react";
import { request } from "../api";
import type { Account, User } from "../types";
import type { Access, UserGroup } from "./permissions";
import {
  canGroup,
  canInvite,
  canManageUser,
  isAdmin,
  isOwner,
} from "./permissions";
import {
  canCreateGroup,
  createGroup,
  deactivateGroup,
  defaultSettings,
  groupMembers,
  listMembers,
  memberIds,
  revokeInvitation,
  roleNames,
  sendInvitations,
  setMemberActive,
  updateDefaults,
  updateGroup,
  updateMember,
} from "./management";
import type { Invite } from "./management";
import { useOperation, useResource } from "./useResource";
import { OperationStatus } from "./OperationStatus";
import { invalidateOrganisation } from "./lifecycle";
export function OrganisationPanel({
  account,
  access,
  users,
}: {
  account: Account;
  access: Access;
  users: User[];
}) {
  const [tab, setTab] = useState("members");
  return (
    <section className="organisation-panel" aria-label="Organisation controls">
      <div className="organisation-toolbar">
        {["members", "invitations", "groups", "settings"].map((name) => (
          <button
            key={name}
            aria-pressed={tab === name}
            onClick={() => setTab(name)}
          >
            {name[0].toUpperCase() + name.slice(1)}
          </button>
        ))}
      </div>
      {tab === "members" && <Members account={account} access={access} />}
      {tab === "invitations" && (
        <Invitations account={account} access={access} />
      )}
      {tab === "groups" &&
        (access.me?.role === 600 ? (
          <p>User groups are unavailable to guests.</p>
        ) : (
          <Groups account={account} access={access} users={users} />
        ))}
      {tab === "settings" && (
        <Settings
          key={JSON.stringify(access.settings.realm_user_settings_defaults)}
          account={account}
          access={access}
        />
      )}
    </section>
  );
}
function Invitations({
  account,
  access,
}: {
  account: Account;
  access: Access;
}) {
  const list = useResource(account.id, "invitations", (signal) =>
    request<{ invites: Invite[] }>(account, "/invites", {}, "GET", signal),
  );
  const [emails, setEmails] = useState(""),
    [role, setRole] = useState(400);
  const op = useOperation();
  const refresh = () => {
    list.refresh();
    invalidateOrganisation(account.id);
  };
  return (
    <>
      <h2>Invitations</h2>
      {canInvite(access) && access.featureLevel >= 180 ? (
        <form
          className="organisation-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (
              !window.confirm(
                `Send invitations to ${emails} as ${roleNames[role]}? Invitations expire in 7 days.`,
              )
            )
              return;
            void op.run(
              (signal) =>
                sendInvitations(account, access, emails, role, signal),
              () => {
                setEmails("");
                refresh();
              },
            );
          }}
        >
          <label>
            Email addresses
            <textarea
              aria-label="Email addresses"
              required
              value={emails}
              maxLength={10000}
              onChange={(e) => setEmails(e.target.value)}
            />
          </label>
          <label>
            Invitation role
            <select
              aria-label="Invitation role"
              value={role}
              onChange={(e) => setRole(Number(e.target.value))}
            >
              {Object.entries(roleNames)
                .filter(([id]) => Number(id) >= (access.me?.role || 600))
                .map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
            </select>
          </label>
          <p>
            {access.featureLevel >= 261
              ? "New users will join the organisation's default channels."
              : "These invitations do not subscribe new users to channels."}
          </p>
          <button disabled={op.busy}>Send invitations</button>
        </form>
      ) : (
        <p>
          Invitation creation is unavailable with your permissions or server
          version.
        </p>
      )}
      <OperationStatus operation={op} />
      {op.error && (
        <p>
          Some invitations may already have been sent. Refresh the invitation
          list before retrying.
        </p>
      )}
      <button onClick={list.refresh}>Refresh invitations</button>
      {list.loading && <p role="status">Loading invitations…</p>}
      {list.error && <p role="alert">{list.error}</p>}
      {list.data && !list.data.invites.length && <p>No pending invitations.</p>}
      <div className="organisation-list">
        {list.data?.invites.slice(0, 200).map((invite) => (
          <div key={`${invite.is_multiuse}:${invite.id}`}>
            <span>
              {invite.email || "Reusable invitation"} ·{" "}
              {roleNames[invite.invited_as] || "Member"} ·{" "}
              {invite.expiry_date
                ? `Expires ${new Date(invite.expiry_date * 1000).toLocaleString()}`
                : "No expiry"}
            </span>
            {(isAdmin(access) ||
              invite.invited_by_user_id === account.userId) && (
              <button
                disabled={op.busy}
                onClick={() => {
                  if (
                    window.confirm(
                      "Revoke this invitation? It will no longer let anyone join.",
                    )
                  )
                    void op.run(
                      (signal) =>
                        revokeInvitation(account, access, invite, signal),
                      refresh,
                    );
                }}
              >
                Revoke invitation
              </button>
            )}
          </div>
        ))}
      </div>
      {(list.data?.invites.length || 0) > 200 && (
        <p>Showing the first 200 pending invitations.</p>
      )}
    </>
  );
}
function Members({ account, access }: { account: Account; access: Access }) {
  const resource = useResource(account.id, "members", (signal) =>
    listMembers(account, signal),
  );
  const [filter, setFilter] = useState(""),
    [selected, setSelected] = useState<number | null>(null),
    [limit, setLimit] = useState(50);
  const target = resource.data?.find((u) => u.user_id === selected);
  return (
    <>
      <h2>Members</h2>
      <button onClick={resource.refresh}>Refresh members</button>
      {resource.loading && <p role="status">Loading members…</p>}
      {resource.error && <p role="alert">{resource.error}</p>}
      {target ? (
        <>
          <button onClick={() => setSelected(null)}>Back to members</button>
          <MemberEditor
            key={`${target.user_id}:${target.role}:${target.is_active}:${target.full_name}`}
            account={account}
            access={access}
            target={target}
            refresh={resource.refresh}
          />
        </>
      ) : (
        <>
          <label className="organisation-form">
            Find members
            <input
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
                setLimit(50);
              }}
            />
          </label>
          <div className="organisation-list">
            {resource.data
              ?.filter((u) =>
                `${u.full_name} ${u.email} ${u.user_id}`
                  .toLowerCase()
                  .includes(filter.toLowerCase()),
              )
              .slice(0, limit)
              .map((u) => (
                <button key={u.user_id} onClick={() => setSelected(u.user_id)}>
                  {u.full_name} · ID {u.user_id} · {roleNames[u.role || 400]}
                  {u.is_active ? "" : " · Deactivated"}
                </button>
              ))}
          </div>
          {resource.data &&
            resource.data.filter((u) =>
              `${u.full_name} ${u.email} ${u.user_id}`
                .toLowerCase()
                .includes(filter.toLowerCase()),
            ).length > limit && (
              <button onClick={() => setLimit((n) => n + 50)}>
                Show more members
              </button>
            )}
          {resource.data &&
            !resource.data.some((u) =>
              `${u.full_name} ${u.email} ${u.user_id}`
                .toLowerCase()
                .includes(filter.toLowerCase()),
            ) && <p>No members found.</p>}
        </>
      )}
    </>
  );
}
function MemberEditor({
  account,
  access,
  target,
  refresh,
}: {
  account: Account;
  access: Access;
  target: User;
  refresh: () => void;
}) {
  const [name, setName] = useState(target.full_name),
    [role, setRole] = useState(target.role || 400);
  const op = useOperation();
  const changed = () => {
    invalidateOrganisation(account.id);
    refresh();
  };
  return (
    <>
      <h3>{target.full_name}</h3>
      <p>
        {target.email} · {target.is_active ? "Active" : "Deactivated"}
      </p>
      <OperationStatus operation={op} />
      {canManageUser(access, target) ? (
        <>
          <form
            className="organisation-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (
                role !== target.role &&
                !window.confirm(
                  `Change ${target.full_name} from ${roleNames[target.role || 400]} to ${roleNames[role]}? This changes organisation access and privileges. Zulip may notify the member.`,
                )
              )
                return;
              void op.run(
                (signal) =>
                  updateMember(account, access, target, { name, role }, signal),
                changed,
              );
            }}
          >
            <label>
              Display name
              <input
                required
                value={name}
                maxLength={100}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label>
              Member role
              <select
                aria-label="Member role"
                value={role}
                onChange={(e) => setRole(Number(e.target.value))}
              >
                {Object.entries(roleNames)
                  .filter(([id]) => id !== "100" || isOwner(access))
                  .map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
              </select>
            </label>
            <button disabled={op.busy}>Save member</button>
          </form>
          <button
            disabled={op.busy}
            onClick={() => {
              if (
                window.confirm(
                  target.is_active
                    ? `Deactivate ${target.full_name}? Their access will end. Bots they own will also be deactivated. Reassign bot ownership first if those bots must stay active.`
                    : `Reactivate ${target.full_name}? Their organisation access will be restored.`,
                )
              )
                void op.run(
                  (signal) =>
                    setMemberActive(
                      account,
                      access,
                      target,
                      !target.is_active,
                      signal,
                    ),
                  changed,
                );
            }}
          >
            {target.is_active ? "Deactivate member" : "Reactivate member"}
          </button>
        </>
      ) : (
        <p>You cannot administer this account here.</p>
      )}
    </>
  );
}
function Groups({
  account,
  access,
  users,
}: {
  account: Account;
  access: Access;
  users: User[];
}) {
  const resource = useResource(account.id, "groups", (signal) =>
    request<{ user_groups: UserGroup[] }>(
      account,
      "/user_groups",
      {},
      "GET",
      signal,
    ),
  );
  const [filter, setFilter] = useState(""),
    [selected, setSelected] = useState<number | "new" | null>(null);
  const group = resource.data?.user_groups.find((g) => g.id === selected);
  const changed = () => {
    invalidateOrganisation(account.id);
    resource.refresh();
  };
  return (
    <>
      <h2>User groups</h2>
      <div className="organisation-toolbar">
        <button onClick={resource.refresh}>Refresh groups</button>
        {canCreateGroup(access) && (
          <button onClick={() => setSelected("new")}>Create user group</button>
        )}
      </div>
      {resource.loading && <p role="status">Loading groups…</p>}
      {resource.error && <p role="alert">{resource.error}</p>}
      {selected === "new" || group ? (
        <>
          <button onClick={() => setSelected(null)}>Back to groups</button>
          <GroupEditor
            key={group ? JSON.stringify(group) : "new"}
            account={account}
            access={access}
            group={group}
            users={users}
            changed={() => {
              changed();
              if (!group) setSelected(null);
            }}
          />
        </>
      ) : (
        <>
          <label className="organisation-form">
            Find groups
            <input value={filter} onChange={(e) => setFilter(e.target.value)} />
          </label>
          <div className="organisation-list">
            {resource.data?.user_groups
              .filter(
                (g) =>
                  !g.deactivated &&
                  g.name.toLowerCase().includes(filter.toLowerCase()),
              )
              .slice(0, 100)
              .map((g) => (
                <button key={g.id} onClick={() => setSelected(g.id)}>
                  {g.name} · {g.members.length} direct members
                  {g.is_system_group ? " · System group" : ""}
                </button>
              ))}
          </div>
          <p>Up to 100 matching groups are shown. Search to narrow the list.</p>
        </>
      )}
    </>
  );
}
function GroupEditor({
  account,
  access,
  group,
  users,
  changed,
}: {
  account: Account;
  access: Access;
  group?: UserGroup;
  users: User[];
  changed: () => void;
}) {
  const [name, setName] = useState(group?.name || ""),
    [description, setDescription] = useState(group?.description || ""),
    [ids, setIds] = useState("");
  const op = useOperation();
  const editable = group
    ? canGroup(access, group, "manage")
    : canCreateGroup(access);
  return (
    <>
      <h3>{group?.name || "New user group"}</h3>
      <OperationStatus operation={op} />
      <form
        className="organisation-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (
            !group &&
            !window.confirm(
              "Create this group with the selected members? Group memberships can grant permissions when the group is used in organisation policies.",
            )
          )
            return;
          void op.run(
            (signal) =>
              group
                ? updateGroup(
                    account,
                    access,
                    group,
                    { name, description },
                    signal,
                  )
                : createGroup(
                    account,
                    access,
                    name,
                    description,
                    memberIds(ids, users),
                    signal,
                  ),
            changed,
          );
        }}
      >
        <label>
          Group name
          <input
            required
            value={name}
            disabled={!editable}
            maxLength={100}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          Group description
          <textarea
            aria-label="Group description"
            value={description}
            disabled={!editable}
            maxLength={1000}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        {!group && (
          <label>
            Initial member IDs
            <input
              value={ids}
              onChange={(e) => setIds(e.target.value)}
              placeholder="1, 2, 3"
            />
          </label>
        )}
        {editable && (
          <button disabled={op.busy}>
            {group ? "Save group" : "Create group"}
          </button>
        )}
      </form>
      {group && (
        <>
          <p>
            Direct members:{" "}
            {group.members
              .slice(0, 100)
              .map(
                (id) =>
                  `${users.find((u) => u.user_id === id)?.full_name || "Member"} (${id})`,
              )
              .join(", ") || "None"}
            {group.members.length > 100 ? "; first 100 shown" : ""}.
          </p>
          {!group.is_system_group && (
            <div className="organisation-form">
              <label>
                Member IDs
                <input
                  value={ids}
                  onChange={(e) => setIds(e.target.value)}
                  placeholder="1, 2, 3"
                />
              </label>
              <div className="organisation-toolbar">
                {(["add", "remove"] as const)
                  .filter((action) => canGroup(access, group, action))
                  .map((action) => (
                    <button
                      key={action}
                      disabled={op.busy || !ids.trim()}
                      onClick={() => {
                        if (
                          window.confirm(
                            `${action === "add" ? "Add" : "Remove"} these members ${action === "add" ? "to" : "from"} ${group.name}? This can grant or remove permissions across the organisation.`,
                          )
                        )
                          void op.run(
                            (signal) =>
                              groupMembers(
                                account,
                                access,
                                group,
                                memberIds(ids, users),
                                action === "add",
                                signal,
                              ),
                            () => {
                              setIds("");
                              changed();
                            },
                          );
                      }}
                    >
                      {action === "add"
                        ? "Add group members"
                        : "Remove group members"}
                    </button>
                  ))}
              </div>
            </div>
          )}
          {editable && access.featureLevel >= 290 && (
            <button
              disabled={op.busy}
              onClick={() => {
                if (
                  window.confirm(
                    `Deactivate ${group.name}? It will stop granting permissions and cannot be mentioned. The server may refuse if active policies depend on it.`,
                  )
                )
                  void op.run(
                    (signal) => deactivateGroup(account, access, group, signal),
                    changed,
                  );
              }}
            >
              Deactivate group
            </button>
          )}
        </>
      )}
    </>
  );
}
function Settings({ account, access }: { account: Account; access: Access }) {
  const defaults = access.settings.realm_user_settings_defaults as
    Record<string, unknown> | undefined;
  const [values, setValues] = useState<Record<string, boolean>>(
    Object.fromEntries(
      Object.keys(defaultSettings)
        .filter((key) => typeof defaults?.[key] === "boolean")
        .map((key) => [key, defaults![key] as boolean]),
    ),
  );
  const op = useOperation();
  return (
    <>
      <h2>Organisation settings</h2>
      <p>{String(access.settings.realm_name || account.name)}</p>
      <p>
        {typeof access.settings.realm_description === "string"
          ? access.settings.realm_description
          : ""}
      </p>
      <p>
        Supported here: notification defaults for new users. Name,
        authentication, retention, billing and organisation permission policies
        are not editable here.
      </p>
      {isAdmin(access) &&
      access.featureLevel >= 96 &&
      Object.keys(values).length ? (
        <form
          className="organisation-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (
              !window.confirm(
                "Change notification defaults for future members? Existing members' preferences will stay unchanged.",
              )
            )
              return;
            void op.run((signal) =>
              updateDefaults(account, access, values, signal),
            );
          }}
        >
          <h3>New-user defaults</h3>
          {Object.entries(defaultSettings)
            .filter(([key]) => key in values)
            .map(([key, label]) => (
              <label key={key} className="check-label">
                <input
                  type="checkbox"
                  checked={values[key]}
                  onChange={(e) =>
                    setValues({ ...values, [key]: e.target.checked })
                  }
                />
                {label}
              </label>
            ))}
          <button disabled={op.busy}>Save new-user defaults</button>
        </form>
      ) : (
        <p>
          Editable defaults are unavailable with your permissions or server
          response.
        </p>
      )}
      <OperationStatus operation={op} />
    </>
  );
}
