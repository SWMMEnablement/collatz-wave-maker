import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

const REPO = "SWMMEnablement/collatz-wave-maker";
const BRANCH = "main";

type Commit = {
  sha: string;
  html_url: string;
  commit: {
    message: string;
    author: { name: string; date: string };
  };
  author: { login: string; avatar_url: string } | null;
};

async function fetchCommits(): Promise<Commit[]> {
  const res = await fetch(
    `https://api.github.com/repos/${REPO}/commits?sha=${BRANCH}&per_page=10`,
    { headers: { Accept: "application/vnd.github+json" } },
  );
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
  return res.json();
}

function relTime(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function Page() {
  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useQuery({
    queryKey: ["gh-commits", REPO, BRANCH],
    queryFn: fetchCommits,
    refetchInterval: 60_000,
  });

  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 15_000);
    return () => clearInterval(t);
  }, []);

  const latest = data?.[0];
  const inSync = latest && Date.now() - new Date(latest.commit.author.date).getTime() < 5 * 60_000;

  return (
    <div className="mx-auto max-w-3xl px-6 py-10 text-foreground">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <Link to="/" className="text-xs uppercase tracking-wider text-muted-foreground hover:text-primary">
            ← back
          </Link>
          <h1 className="mt-2 text-3xl font-bold">GitHub Sync Status</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            <a href={`https://github.com/${REPO}`} target="_blank" rel="noreferrer" className="text-primary hover:underline">
              {REPO}
            </a>{" "}
            · branch <code className="font-mono text-primary">{BRANCH}</code>
          </p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="rounded border border-border bg-card px-3 py-1.5 text-xs uppercase tracking-wider hover:bg-accent disabled:opacity-50"
        >
          {isFetching ? "refreshing…" : "refresh"}
        </button>
      </div>

      {isLoading && <div className="rounded border border-border bg-card p-6 text-sm text-muted-foreground">Loading…</div>}
      {error && (
        <div className="rounded border border-destructive/40 bg-destructive/10 p-6 text-sm text-destructive">
          {(error as Error).message}
        </div>
      )}

      {latest && (
        <>
          <div className="mb-6 rounded-lg border border-border bg-card p-5">
            <div className="mb-3 flex items-center gap-2">
              <span
                className={`inline-block h-2.5 w-2.5 rounded-full ${
                  inSync ? "bg-green-500" : "bg-amber-500"
                }`}
              />
              <span className="text-sm font-medium">
                {inSync ? "Recently synced" : "Idle"}
              </span>
              <span className="ml-auto font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                checked {dataUpdatedAt ? relTime(new Date(dataUpdatedAt).toISOString()) : "—"}
              </span>
            </div>
            <div className="text-xs text-muted-foreground">
              Last commit to <code className="font-mono">{BRANCH}</code>{" "}
              <span className="text-foreground">{relTime(latest.commit.author.date)}</span> by{" "}
              <span className="text-foreground">{latest.commit.author.name}</span>
            </div>
            <div className="mt-2 text-sm">{latest.commit.message.split("\n")[0]}</div>
            <a
              href={latest.html_url}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-block font-mono text-[11px] text-primary hover:underline"
            >
              {latest.sha.slice(0, 7)} ↗
            </a>
            <p className="mt-4 border-t border-border pt-3 text-[11px] leading-relaxed text-muted-foreground">
              Lovable auto-pushes edits to <code className="font-mono">{BRANCH}</code> after each change. If a recent
              Lovable edit isn't visible here within a minute or two, the sync may be paused — check the GitHub
              connection in the Lovable project menu.
            </p>
          </div>

          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Recent commits
          </h2>
          <ul className="divide-y divide-border rounded-lg border border-border bg-card">
            {data!.map((c) => (
              <li key={c.sha} className="flex items-start gap-3 p-3">
                {c.author?.avatar_url && (
                  <img src={c.author.avatar_url} alt="" className="mt-0.5 h-6 w-6 rounded-full" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{c.commit.message.split("\n")[0]}</div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    <a href={c.html_url} target="_blank" rel="noreferrer" className="font-mono text-primary hover:underline">
                      {c.sha.slice(0, 7)}
                    </a>{" "}
                    · {c.commit.author.name} · {relTime(c.commit.author.date)}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export const Route = createFileRoute("/github-sync")({
  head: () => ({
    meta: [
      { title: "GitHub Sync Status · Collatz SWMM5" },
      { name: "description", content: "Latest commits pushed to main and current sync state with GitHub." },
      { property: "og:title", content: "GitHub Sync Status" },
      { property: "og:description", content: "Latest commits pushed to main and current sync state with GitHub." },
    ],
  }),
  component: Page,
});
