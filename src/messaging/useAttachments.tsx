import { useEffect, useRef, useState } from "react";
import type { Account } from "../types";
import { messagingCapabilities } from "./capabilities";
import { uploadAttachment } from "./attachments";
type Upload = {
  id: number;
  file: File;
  state: "uploading" | "failed" | "cancelled";
  error?: string;
  control: AbortController;
};
export function useAttachments(
  account: Account,
  insert: (text: string) => void,
  onError: (error: string) => void,
) {
  const [uploads, setUploads] = useState<Upload[]>([]);
  const jobs = useRef(new Map<number, Upload>()),
    serial = useRef(0),
    active = useRef(true),
    insertRef = useRef(insert);
  insertRef.current = insert;
  const picker = useRef<HTMLInputElement>(null);
  useEffect(() => {
    active.current = true;
    const reset = (e: Event) => {
      if ((e as CustomEvent).detail.accountId === account.id) {
        for (const j of jobs.current.values()) j.control.abort();
        jobs.current.clear();
        setUploads([]);
      }
    };
    window.addEventListener("zoomerlip-messaging-reset", reset);
    return () => {
      active.current = false;
      for (const j of jobs.current.values()) j.control.abort();
      jobs.current.clear();
      window.removeEventListener("zoomerlip-messaging-reset", reset);
    };
  }, [account.id]);
  const publish = () => {
    if (active.current) setUploads([...jobs.current.values()]);
  };
  async function start(job: Upload) {
    jobs.current.set(job.id, job);
    publish();
    try {
      const link = await uploadAttachment(
        account,
        job.file,
        messagingCapabilities(account.id).uploadMiB,
        job.control.signal,
      );
      if (!active.current || job.control.signal.aborted) return;
      insertRef.current(link);
      jobs.current.delete(job.id);
    } catch (e) {
      if (active.current && jobs.current.has(job.id)) {
        job.state = job.control.signal.aborted ? "cancelled" : "failed";
        job.error =
          job.state === "cancelled"
            ? "Upload cancelled. The server may already have stored the file."
            : `${e instanceof Error ? e.message : "Upload failed."} Check your connection and retry. Large files may need a faster connection.`;
      }
    } finally {
      publish();
    }
  }
  function add(files: FileList | File[]) {
    const selected = Array.from(files);
    if (
      jobs.current.size + selected.length > 3 ||
      selected.reduce((n, f) => n + f.size, 0) +
        [...jobs.current.values()].reduce((n, j) => n + j.file.size, 0) >
        100 * 1024 * 1024
    ) {
      onError(
        "Choose at most three files totaling 100 MiB. Finish or remove current uploads first.",
      );
      return;
    }
    for (const file of selected)
      void start({
        id: ++serial.current,
        file,
        state: "uploading",
        control: new AbortController(),
      });
  }
  return {
    add,
    busy: uploads.some((u) => u.state === "uploading"),
    openPicker: () => picker.current?.click(),
    input: (
      <input
        hidden
        ref={picker}
        type="file"
        multiple
        accept="*/*"
        aria-label="Attach files"
        onChange={(e) => {
          if (e.target.files) add(e.target.files);
          e.target.value = "";
        }}
      />
    ),
    status: uploads.length > 0 && (
      <section className="messaging-panel" aria-label="Uploads">
        {uploads.map((u) => (
          <article key={u.id}>
            <span>
              {u.file.name} · {(u.file.size / 1024 / 1024).toFixed(2)} MiB
            </span>
            {u.state === "uploading" ? (
              <>
                <progress aria-label={`Uploading ${u.file.name}`} />
                <span role="status">Uploading…</span>
                <button type="button" onClick={() => u.control.abort()}>
                  Cancel upload
                </button>
              </>
            ) : (
              <>
                <p role="status">{u.error}</p>
                <button
                  type="button"
                  onClick={() =>
                    void start({
                      ...u,
                      state: "uploading",
                      error: undefined,
                      control: new AbortController(),
                    })
                  }
                >
                  Retry upload
                </button>
                <button
                  type="button"
                  onClick={() => {
                    jobs.current.delete(u.id);
                    publish();
                  }}
                >
                  Remove upload
                </button>
              </>
            )}
          </article>
        ))}
      </section>
    ),
  };
}
