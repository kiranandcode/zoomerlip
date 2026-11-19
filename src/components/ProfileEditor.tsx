import { useEffect, useRef, useState } from "react";
import { request } from "../api";
import { fieldChoices, profileChanges } from "../profile";
import type { ProfileField } from "../profile";
import type { Account, User } from "../types";

export function ProfileEditor({
  account,
  users,
  onClose,
  onSaved,
}: {
  account: Account;
  users: User[];
  onClose: () => void;
  onSaved: (user: User) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const controller = useRef<AbortController | null>(null);
  const baseline = useRef<{
    user: User;
    values: Record<string, string>;
  } | null>(null);
  const [fields, setFields] = useState<ProfileField[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState<File>();
  const [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    const dialog = ref.current!,
      previous = document.activeElement as HTMLElement | null;
    const lifetime = new AbortController();
    controller.current = lifetime;
    dialog.showModal();
    void Promise.all([
      request<User>(account, "/users/me", {}, "GET", lifetime.signal),
      request<{ custom_fields: ProfileField[] }>(
        account,
        "/realm/profile_fields",
        {},
        "GET",
        lifetime.signal,
      ),
    ])
      .then(([user, result]) => {
        if (lifetime.signal.aborted) return;
        const values = Object.fromEntries(
          Object.entries(user.profile_data || {}).map(([id, value]) => [
            id,
            value.value,
          ]),
        );
        baseline.current = { user, values };
        setValues(values);
        setName(user.full_name);
        setFields([...result.custom_fields].sort((a, b) => a.order - b.order));
      })
      .catch((e) => {
        if (!lifetime.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!lifetime.signal.aborted) setLoading(false);
      });
    return () => {
      lifetime.abort();
      dialog.close();
      previous?.focus();
    };
  }, [account]);
  const change = (id: number, value: string) =>
    setValues((values) => ({ ...values, [id]: value }));
  return (
    <dialog
      ref={ref}
      className="profile-editor"
      aria-label="Edit profile"
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (!baseline.current || saving) return;
          const signal = controller.current!.signal;
          setSaving(true);
          setError("");
          let saved = false;
          try {
            const base = baseline.current;
            if (name.trim() !== base.user.full_name) {
              await request(
                account,
                "/settings",
                { full_name: name.trim() },
                "PATCH",
                signal,
              );
              base.user = { ...base.user, full_name: name.trim() };
              saved = true;
            }
            const changes = profileChanges(fields, base.values, values);
            if (changes.length) {
              await request(
                account,
                "/users/me/profile_data",
                { data: changes },
                "PATCH",
                signal,
              );
              base.values = { ...values };
              saved = true;
            }
            if (avatar) {
              if (
                !/^image\/(png|jpeg|webp)$/.test(avatar.type) ||
                avatar.size > 5 * 1024 * 1024
              )
                throw Error("Choose a PNG, JPEG or WebP image under 5 MiB.");
              const file = new FormData();
              file.set("file", avatar);
              await request(account, "/users/me/avatar", file, "POST", signal);
              setAvatar(undefined);
              saved = true;
            }
            const updated = await request<User>(
              account,
              "/users/me",
              {},
              "GET",
              signal,
            );
            if (!signal.aborted) {
              onSaved(updated);
              onClose();
            }
          } catch (e) {
            if (!signal.aborted)
              setError(
                `${saved ? "Some changes were saved. " : ""}${e instanceof Error ? e.message : "Could not save the profile."}`,
              );
          } finally {
            if (!signal.aborted) setSaving(false);
          }
        }}
      >
        <header>
          <h2>Edit profile</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close profile editor"
          >
            Close
          </button>
        </header>
        <p>{new URL(account.url).host}</p>
        {loading ? (
          <p role="status">Loading profile…</p>
        ) : (
          baseline.current && (
            <fieldset disabled={saving}>
              <label>
                Display name
                <input
                  required
                  maxLength={100}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label>
                Profile picture
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(e) => setAvatar(e.target.files?.[0])}
                />
                <small>PNG, JPEG or WebP, up to 5 MiB.</small>
              </label>
              {fields.map((field) => {
                const disabled =
                  field.editable_by_user === false ||
                  field.type < 1 ||
                  field.type > 8;
                const value = values[field.id] || "";
                const common = {
                  disabled,
                  required: !!field.required,
                  value,
                  onChange: (
                    e: React.ChangeEvent<
                      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
                    >,
                  ) => change(field.id, e.target.value),
                };
                let selected: string[] = [];
                if (field.type === 6) {
                  try {
                    selected = JSON.parse(value || "[]").map(String);
                  } catch {
                    /* Invalid values remain unchanged unless edited. */
                  }
                }
                return (
                  <label key={field.id}>
                    {field.name}
                    {field.type === 2 ? (
                      <textarea {...common} maxLength={10000} />
                    ) : field.type === 3 ? (
                      <select {...common}>
                        <option value="">Choose…</option>
                        {fieldChoices(field).map(([id, text]) => (
                          <option key={id} value={id}>
                            {text}
                          </option>
                        ))}
                      </select>
                    ) : field.type === 6 ? (
                      <select
                        disabled={disabled}
                        multiple
                        value={selected}
                        onChange={(e) =>
                          change(
                            field.id,
                            JSON.stringify(
                              [...e.currentTarget.selectedOptions].map(
                                (option) => Number(option.value),
                              ),
                            ),
                          )
                        }
                      >
                        {users.map((user) => (
                          <option key={user.user_id} value={user.user_id}>
                            {user.full_name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        {...common}
                        type={
                          field.type === 4
                            ? "date"
                            : field.type === 5
                              ? "url"
                              : "text"
                        }
                        maxLength={1000}
                      />
                    )}
                    {field.hint && <small>{field.hint}</small>}
                    {disabled && <small>Managed by your organisation.</small>}
                  </label>
                );
              })}
            </fieldset>
          )
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button
          className="primary"
          disabled={loading || saving || !baseline.current}
        >
          {saving ? "Saving…" : "Save profile"}
        </button>
      </form>
    </dialog>
  );
}
