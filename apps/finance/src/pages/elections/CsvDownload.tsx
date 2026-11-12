import { useEffect, useRef, useState } from "react";
import { useFinanceSession } from "../../auth/session";
import { REQUEST_TIMEOUT_MS } from "../../api/client";

export function CsvDownload({
  path,
  onChanged,
  filename = "Funders and election outcomes.csv",
}: {
  path: string | null;
  onChanged: () => void;
  filename?: string;
}) {
  const session = useFinanceSession();
  const [state, setState] = useState<
    "idle" | "busy" | "failed" | "done" | "changed"
  >("idle");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    controller.current?.abort();
    controller.current = null;
    setState("idle");
    return () => {
      controller.current?.abort();
      controller.current = null;
    };
  }, [path, session.accessToken, session.email, session.status]);
  async function run() {
    if (
      !path ||
      controller.current !== null ||
      state === "busy" ||
      !session.accessToken ||
      session.status !== "granted" ||
      session.revoked
    )
      return;
    const active = new AbortController();
    controller.current = active;
    setState("busy");
    const timer = window.setTimeout(() => active.abort(), REQUEST_TIMEOUT_MS);
    let objectUrl: string | null = null;
    try {
      const response = await fetch(
        `${session.apiBaseUrl.replace(/\/+$/, "")}/api/v1/${path}`,
        {
          headers: { Authorization: `Bearer ${session.accessToken}` },
          cache: "no-store",
          redirect: "error",
          signal: active.signal,
        },
      );
      if (active.signal.aborted || controller.current !== active) return;
      if (response.status === 401 || response.status === 403) {
        session.retry();
        throw new Error("Access changed");
      }
      if (response.status === 409) {
        const problem = await response.json().catch(() => null);
        if (
          problem?.type === "https://api.alethical.com/problems/records-changed"
        ) {
          if (controller.current === active && !active.signal.aborted)
            setState("changed");
          return;
        }
      }
      if (
        !response.ok ||
        response.redirected ||
        !response.headers.get("content-type")?.startsWith("text/csv")
      )
        throw new Error("Download unavailable");
      const blob = await response.blob();
      if (active.signal.aborted || controller.current !== active) return;
      objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = filename;
      document.body.append(link);
      link.click();
      link.remove();
      setState("done");
    } catch {
      if (controller.current === active) setState("failed");
    } finally {
      window.clearTimeout(timer);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      if (controller.current === active) controller.current = null;
    }
  }
  return (
    <div className="ec-download">
      <button
        className="ec-button"
        disabled={!path || state === "busy"}
        onClick={run}
      >
        {state === "busy"
          ? "Preparing download…"
          : state === "failed"
            ? "Try again"
            : "Download CSV"}
      </button>
      <span
        className={state === "done" ? "f-visually-hidden" : ""}
        role="status"
      >
        {state === "failed" ? (
          "Couldn’t download report"
        ) : state === "done" ? (
          "Download started"
        ) : state === "changed" ? (
          <>
            These records changed{" "}
            <button className="ec-link" onClick={onChanged}>
              Reload comparison
            </button>
          </>
        ) : (
          ""
        )}
      </span>
    </div>
  );
}
