// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import {
  invalidateOrganisation,
  useOrganisationRevision,
} from "../src/organisation/lifecycle";
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
it("aborts invalidated work synchronously, isolates accounts and detaches listeners", () => {
  const controller = new AbortController(),
    cancel = vi.fn(() => controller.abort());
  const element = document.createElement("div"),
    root = createRoot(element);
  function Consumer() {
    const revision = useOrganisationRevision("one", "permissions", cancel);
    return createElement("span", null, revision);
  }
  act(() => root.render(createElement(Consumer)));
  act(() => {
    invalidateOrganisation("two");
    invalidateOrganisation("one", [{ id: 1, type: "update_message_flags" }]);
  });
  expect(cancel).not.toHaveBeenCalled();
  act(() => {
    invalidateOrganisation("one", [
      { id: 2, type: "subscription", op: "remove" },
    ]);
    expect(controller.signal.aborted).toBe(true);
  });
  expect(element.textContent).toBe("1");
  expect(cancel).toHaveBeenCalledTimes(1);
  act(() => root.unmount());
  invalidateOrganisation("one");
  expect(cancel).toHaveBeenCalledTimes(1);
});
