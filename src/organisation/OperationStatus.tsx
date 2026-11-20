import type { useOperation } from "./useResource";

export function OperationStatus({
  operation,
}: {
  operation: ReturnType<typeof useOperation>;
}) {
  return (
    <>
      {operation.busy && <p role="status">Saving…</p>}
      {operation.error && <p role="alert">{operation.error}</p>}
      {operation.notice && <p role="status">{operation.notice}</p>}
    </>
  );
}
