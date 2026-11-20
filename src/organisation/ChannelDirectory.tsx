import { useState } from "react";
import type { Account, Channel, User } from "../types";
import { request } from "../api";
import { getCache } from "../cache";
import type { Access } from "./permissions";
import {
  canAdminChannel,
  canCreateChannel,
  canJoinChannel,
  canMembership,
  isAdmin,
} from "./permissions";
import {
  channelDirectory,
  changeSubscription,
  createChannel,
  updateChannel,
  setChannelArchived,
} from "./channels";
import { useOperation, useResource } from "./useResource";
import { invalidateOrganisation } from "./lifecycle";
import {
  BulkChannelPreferences,
  ChannelMuteControl,
} from "./ChannelPreferences";
import { OperationStatus } from "./OperationStatus";
export function ChannelDirectory({
  account,
  access,
  users,
  initialChannelId,
}: {
  account: Account;
  access: Access;
  users: User[];
  initialChannelId?: number;
}) {
  const [archived, setArchived] = useState(false);
  const resource = useResource(
    account.id,
    `directory:${archived}:${access.featureLevel}:${isAdmin(access)}`,
    (signal) => channelDirectory(account, signal, access, archived),
  );
  const [filter, setFilter] = useState(""),
    [limit, setLimit] = useState(50),
    [selected, setSelected] = useState<number | null>(initialChannelId ?? null),
    [creating, setCreating] = useState(false);
  const selectedChannel = resource.data?.channels.find(
    (c) => c.stream_id === selected,
  );
  return (
    <section className="organisation-panel" aria-label="Channel directory">
      <BulkChannelPreferences
        key={account.id}
        account={account}
        featureLevel={access.featureLevel}
        active={!!access.me?.is_active}
      />
      {access.featureLevel >= 315 && (
        <label className="organisation-form">
          Channel state
          <select
            aria-label="Channel state"
            value={archived ? "archived" : "active"}
            onChange={(e) => {
              setArchived(e.target.value === "archived");
              setSelected(null);
              setCreating(false);
              setLimit(50);
            }}
          >
            <option value="active">Active channels</option>
            <option value="archived">Archived channels</option>
          </select>
        </label>
      )}
      <div className="organisation-toolbar">
        <button
          onClick={() => {
            setSelected(null);
            setCreating(false);
            resource.refresh();
          }}
        >
          Refresh directory
        </button>
        {(canCreateChannel(access, false) ||
          canCreateChannel(access, true)) && (
          <button
            onClick={() => {
              setCreating(true);
              setSelected(null);
            }}
          >
            Create channel
          </button>
        )}
      </div>
      {resource.loading && <p role="status">Loading channels…</p>}
      {resource.error && <p role="alert">{resource.error}</p>}
      {creating ? (
        <ChannelCreate
          account={account}
          access={access}
          onCreated={() => {
            setCreating(false);
            resource.refresh();
          }}
        />
      ) : selectedChannel ? (
        <ChannelDetails
          key={selectedChannel.stream_id}
          account={account}
          channel={selectedChannel}
          subscribed={resource.data!.subscribed.has(selectedChannel.stream_id)}
          access={access}
          users={users}
          back={() => setSelected(null)}
        />
      ) : (
        <>
          <label className="organisation-form">
            Find channels
            <input
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
                setLimit(50);
              }}
            />
          </label>
          {resource.data &&
            !resource.data.channels.some((c) =>
              c.name.toLowerCase().includes(filter.toLowerCase()),
            ) && <p>No channels found.</p>}
          <div className="organisation-list">
            {resource.data?.channels
              .filter((c) =>
                c.name.toLowerCase().includes(filter.toLowerCase()),
              )
              .slice(0, limit)
              .map((c) => (
                <button
                  key={c.stream_id}
                  onClick={() => setSelected(c.stream_id)}
                >
                  {c.name}
                  {c.is_archived ? " · Archived" : ""} ·{" "}
                  {c.is_web_public
                    ? "Web public"
                    : c.invite_only
                      ? "Private"
                      : "Public"}
                  {resource.data!.subscribed.has(c.stream_id)
                    ? " · Joined"
                    : ""}
                  {c.is_muted ? " · Muted" : ""}
                </button>
              ))}
          </div>
          {resource.data &&
            resource.data.channels.filter((c) =>
              c.name.toLowerCase().includes(filter.toLowerCase()),
            ).length > limit && (
              <button onClick={() => setLimit((n) => n + 50)}>
                Show more channels
              </button>
            )}
        </>
      )}
    </section>
  );
}
function ChannelCreate({
  account,
  access,
  onCreated,
}: {
  account: Account;
  access: Access;
  onCreated: () => void;
}) {
  const [name, setName] = useState(""),
    [description, setDescription] = useState(""),
    [privateChannel, setPrivate] = useState(!canCreateChannel(access, false));
  const op = useOperation();
  return (
    <form
      className="organisation-form"
      onSubmit={(e) => {
        e.preventDefault();
        void op.run(
          (signal) =>
            createChannel(
              account,
              access,
              name,
              description,
              privateChannel,
              signal,
            ),
          () => {
            invalidateOrganisation(account.id);
            onCreated();
          },
        );
      }}
    >
      <h2>Create channel</h2>
      <label>
        Channel name
        <input
          required
          value={name}
          maxLength={Number(access.settings.max_stream_name_length || 60)}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label>
        Description
        <textarea
          aria-label="Description"
          value={description}
          maxLength={Number(
            access.settings.max_stream_description_length || 1024,
          )}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>
      <label>
        Visibility
        <select
          aria-label="Visibility"
          value={String(privateChannel)}
          onChange={(e) => setPrivate(e.target.value === "true")}
        >
          {canCreateChannel(access, false) && (
            <option value="false">
              Public — organisation members can discover it
            </option>
          )}
          {canCreateChannel(access, true) && (
            <option value="true">Private — invited members only</option>
          )}
        </select>
      </label>
      <p>
        New members will have access to channel history. You will join the
        channel.
      </p>
      <OperationStatus operation={op} />
      <button disabled={op.busy}>Create channel</button>
    </form>
  );
}
function ChannelDetails({
  account,
  channel,
  subscribed,
  access,
  users,
  back,
}: {
  account: Account;
  channel: Channel;
  subscribed: boolean;
  access: Access;
  users: User[];
  back: () => void;
}) {
  const [name, setName] = useState(channel.name),
    [description, setDescription] = useState(channel.description),
    [privateChannel, setPrivate] = useState(!!channel.invite_only),
    [person, setPerson] = useState("");
  const op = useOperation();
  const members = useResource(
    account.id,
    `subscribers:${channel.stream_id}`,
    (signal) =>
      channel.is_archived
        ? Promise.resolve({ subscribers: [] as number[] })
        : request<{ subscribers: number[] }>(
            account,
            `/streams/${channel.stream_id}/members`,
            {},
            "GET",
            signal,
          ),
  );
  const changed = () => {
    getCache(account).invalidate();
    invalidateOrganisation(account.id);
  };
  const manage = !channel.is_archived && canAdminChannel(access, channel);
  return (
    <>
      <div className="organisation-toolbar">
        <button onClick={back}>Back to directory</button>
        {!channel.is_archived &&
          (subscribed ? (
            <button
              disabled={op.busy}
              onClick={() => {
                if (
                  window.confirm(
                    `Leave ${channel.name}? You will stop receiving its messages.${channel.invite_only ? " You may need another invitation to rejoin and may lose history access." : ""}`,
                  )
                )
                  void op.run(
                    (signal) =>
                      changeSubscription(
                        account,
                        access,
                        channel,
                        false,
                        subscribed,
                        signal,
                      ),
                    () => {
                      getCache(account).purgeStreams([channel.stream_id]);
                      changed();
                    },
                  );
              }}
            >
              Leave channel
            </button>
          ) : (
            canJoinChannel(access, channel) && (
              <button
                disabled={op.busy}
                onClick={() =>
                  void op.run(
                    (signal) =>
                      changeSubscription(
                        account,
                        access,
                        channel,
                        true,
                        subscribed,
                        signal,
                      ),
                    changed,
                  )
                }
              >
                Join channel
              </button>
            )
          ))}
      </div>
      <h2>
        {channel.name}
        {channel.is_archived ? " · Archived" : ""}
      </h2>
      <p>{channel.description || "No description."}</p>
      <p>
        {channel.is_web_public
          ? "Web public: visible without signing in."
          : channel.invite_only
            ? "Private: invited members only."
            : "Public: visible to organisation members."}{" "}
        {channel.history_public_to_subscribers === false
          ? "History is limited to messages received while subscribed."
          : "New subscribers can read channel history."}
      </p>
      <OperationStatus operation={op} />
      {subscribed && !channel.is_archived && (
        <ChannelMuteControl
          account={account}
          channel={channel}
          featureLevel={access.featureLevel}
        />
      )}
      {(channel.is_archived
        ? canAdminChannel(access, channel)
        : isAdmin(access)) && (
        <div className="organisation-form">
          {channel.is_archived && access.featureLevel < 388 ? (
            <p>Restoring channels requires Zulip feature level 388 or later.</p>
          ) : (
            <button
              disabled={op.busy}
              onClick={() => {
                const archive = !channel.is_archived;
                if (
                  !window.confirm(
                    archive
                      ? `Archive ${channel.name}? Sending new messages will stop. Existing messages remain on the server. Members may lose access. Restore requires a compatible server.`
                      : `Restore ${channel.name}? Existing subscribers can use the channel again under its current visibility and history settings.`,
                  )
                )
                  return;
                void op.run(
                  (signal) =>
                    setChannelArchived(
                      account,
                      access,
                      channel,
                      archive,
                      signal,
                    ),
                  () => {
                    if (archive)
                      getCache(account).purgeStreams([channel.stream_id]);
                    changed();
                  },
                );
              }}
            >
              {channel.is_archived ? "Restore channel" : "Archive channel"}
            </button>
          )}
        </div>
      )}
      {manage && (
        <form
          className="organisation-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (
              privateChannel !== !!channel.invite_only &&
              !window.confirm(
                privateChannel
                  ? "Make this channel private? Public discovery will stop. Existing members keep access; prior public content cannot be made secret retroactively."
                  : "Make this channel public? Organisation members will be able to discover it and access its history.",
              )
            )
              return;
            void op.run(
              (signal) =>
                updateChannel(
                  account,
                  access,
                  channel,
                  { name, description, privateChannel },
                  subscribed,
                  signal,
                ),
              changed,
            );
          }}
        >
          <label>
            Channel name
            <input
              required
              value={name}
              maxLength={Number(access.settings.max_stream_name_length || 60)}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            Description
            <textarea
              aria-label="Description"
              value={description}
              maxLength={Number(
                access.settings.max_stream_description_length || 1024,
              )}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          {subscribed && !channel.is_web_public && (
            <label>
              Visibility
              <select
                aria-label="Visibility"
                value={String(privateChannel)}
                onChange={(e) => setPrivate(e.target.value === "true")}
              >
                <option
                  value="false"
                  disabled={!canCreateChannel(access, false)}
                >
                  Public
                </option>
                <option value="true" disabled={!canCreateChannel(access, true)}>
                  Private
                </option>
              </select>
            </label>
          )}
          <button disabled={op.busy}>Save channel settings</button>
        </form>
      )}
      {!channel.is_archived && (
        <>
          <h3>Membership</h3>
          {members.loading && <p role="status">Loading subscribers…</p>}
          {members.error && (
            <p role="alert">
              {members.error}{" "}
              <button onClick={members.refresh}>Retry subscribers</button>
            </p>
          )}
          <p>
            {members.data
              ? `${members.data.subscribers.length} subscribers`
              : ""}
          </p>
          <form
            className="organisation-form"
            onSubmit={(e) => e.preventDefault()}
          >
            <label>
              Member ID
              <input
                type="number"
                min="1"
                value={person}
                onChange={(e) => setPerson(e.target.value)}
              />
            </label>
            {person && (
              <p>
                {users.find((u) => u.user_id === Number(person))?.full_name ||
                  "Unknown member"}
                {members.data?.subscribers.includes(Number(person))
                  ? " · Subscribed"
                  : ""}
              </p>
            )}
            <div className="organisation-toolbar">
              {(["add", "remove"] as const)
                .filter((action) =>
                  canMembership(access, channel, action, subscribed),
                )
                .map((action) => (
                  <button
                    key={action}
                    disabled={
                      op.busy ||
                      !users.some(
                        (u) => u.user_id === Number(person) && u.is_active,
                      )
                    }
                    onClick={() => {
                      if (
                        !window.confirm(
                          `${action === "add" ? "Add" : "Remove"} ${users.find((u) => u.user_id === Number(person))?.full_name} ${action === "add" ? "to" : "from"} ${channel.name}? ${action === "add" ? "This grants access to the channel and its available history." : "They will lose subscription access."}`,
                        )
                      )
                        return;
                      void op.run(
                        (signal) =>
                          changeSubscription(
                            account,
                            access,
                            channel,
                            action === "add",
                            subscribed,
                            signal,
                            Number(person),
                          ),
                        changed,
                      );
                    }}
                  >
                    {action === "add" ? "Add member" : "Remove member"}
                  </button>
                ))}
            </div>
          </form>
          <div className="organisation-list">
            {members.data?.subscribers.slice(0, 100).map((id) => (
              <span key={id}>
                {users.find((u) => u.user_id === id)?.full_name || "Member"} ·
                ID {id}
              </span>
            ))}
          </div>
          {(members.data?.subscribers.length || 0) > 100 && (
            <p>
              Showing the first 100 subscribers. Enter a member ID to manage
              another subscriber.
            </p>
          )}
        </>
      )}
    </>
  );
}
