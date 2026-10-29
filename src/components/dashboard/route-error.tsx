import { TriangleAlert } from "lucide-react";
import { isRouteErrorResponse, Link, useParams, useRouteError } from "react-router";
import { Button } from "@/components/ui/button";
import { Card, CardPanel } from "@/components/ui/card";
import { viewPath } from "@/lib/routes";

const MAX_DETAIL_LENGTH = 400;

function truncate(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "未知错误";
  return trimmed.length > MAX_DETAIL_LENGTH ? `${trimmed.slice(0, MAX_DETAIL_LENGTH)}…` : trimmed;
}

function describeError(error: unknown): { detail: string; stack: string | null } {
  if (isRouteErrorResponse(error)) {
    const status = `${error.status} ${error.statusText}`.trim();
    const body = typeof error.data === "string" ? error.data.trim() : "";
    const detail = body && body !== error.statusText ? `${status} · ${body}` : status;
    return { detail: truncate(detail), stack: null };
  }

  if (error instanceof Error) {
    return { detail: truncate(error.message || error.name), stack: error.stack ?? null };
  }

  if (typeof error === "string") {
    return { detail: truncate(error), stack: null };
  }

  if (error !== null && typeof error === "object") {
    try {
      const json = JSON.stringify(error);
      if (json && json !== "{}" && json !== "null") {
        return { detail: truncate(json), stack: null };
      }
    } catch {
      return { detail: "未知错误", stack: null };
    }
  }

  return { detail: "未知错误", stack: null };
}

export function RouteError() {
  const error = useRouteError();
  const { datasetId } = useParams();
  const { detail, stack } = describeError(error);
  const overviewPath = datasetId ? viewPath(datasetId, "home") : "/";

  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-16">
      <Card className="w-full max-w-lg">
        <CardPanel className="flex flex-col items-center gap-4 text-center">
          <span className="flex size-11 items-center justify-center rounded-full bg-destructive/8 text-destructive">
            <TriangleAlert aria-hidden="true" className="size-5" />
          </span>

          <div className="flex flex-col gap-1.5">
            <p className="font-heading font-semibold text-headline">页面出错了</p>
            <p className="text-body text-muted-foreground">
              页面出了点问题，可以重试一次，或者回到总览继续浏览。
            </p>
          </div>

          {import.meta.env.DEV ? (
            <p className="max-h-32 w-full overflow-auto break-words rounded-lg border bg-muted/48 px-3 py-2 text-left font-mono text-footnote text-muted-foreground">
              {detail}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button onClick={() => window.location.reload()} type="button">
              重试
            </Button>
            <Button render={<Link to={overviewPath} />} variant="outline">
              回到总览
            </Button>
          </div>

          {import.meta.env.DEV && stack ? (
            <details className="w-full text-left">
              <summary className="cursor-pointer text-caption text-muted-foreground">错误详情</summary>
              <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted/48 p-3 font-mono text-caption leading-relaxed">
                {stack}
              </pre>
            </details>
          ) : null}
        </CardPanel>
      </Card>
    </div>
  );
}
