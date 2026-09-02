"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, ArrowUpDown, Contact, Search } from "lucide-react";
import { ScoreBadge } from "@/components/badges";
import { EmptyState, PageHeader } from "@/components/page-header";
import { ContactDialog } from "@/components/record-dialogs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useContacts } from "@/lib/hooks";
import { timeAgo } from "@/lib/format";

type SortKey = "name" | "company" | "score" | "lastActivityAt";

export default function ContactsPage() {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortKey>("lastActivityAt");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const limit = 25;
  const { data, isLoading } = useContacts({ q, sort, dir, page, limit });

  const toggleSort = (key: SortKey) => {
    if (sort === key) setDir(dir === "asc" ? "desc" : "asc");
    else {
      setSort(key);
      setDir(key === "name" || key === "company" ? "asc" : "desc");
    }
    setPage(1);
  };
  const SortHead = ({ k, children, className }: { k: SortKey; children: React.ReactNode; className?: string }) => (
    <TableHead className={className}>
      <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort(k)}>
        {children}
        {sort === k ? dir === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" /> : <ArrowUpDown className="size-3 opacity-40" />}
      </button>
    </TableHead>
  );
  const pages = data ? Math.max(1, Math.ceil(data.total / limit)) : 1;

  return (
    <div className="enter-stack">
      <PageHeader title="Contacts" description="Contact scores mirror their strongest open deal. New contacts are checked for likely duplicates automatically." actions={<ContactDialog />} />
      <div className="mb-4 flex items-center gap-2">
        <div className="relative">
          <Search className="absolute top-2.5 left-2.5 size-4 text-ink-3" />
          <Input
            placeholder="Search name, email, company, tag…"
            className="w-72 pl-8"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
        </div>
        {data && <span className="ml-auto text-sm text-ink-3">{data.total} contacts</span>}
      </div>

      {isLoading && !data ? (
        <Skeleton className="h-96" />
      ) : data && data.items.length === 0 ? (
        <EmptyState icon={Contact} title="No contacts found" action={<ContactDialog />} />
      ) : (
        <div className="rounded-lg border bg-paper">
          <Table>
            <TableHeader>
              <TableRow>
                <SortHead k="name">Name</SortHead>
                <SortHead k="company">Company</SortHead>
                <TableHead>Email</TableHead>
                <TableHead>Tags</TableHead>
                <SortHead k="score" className="text-right">
                  Score
                </SortHead>
                <TableHead className="text-right">Open deals</TableHead>
                <SortHead k="lastActivityAt">Last touch</SortHead>
                <TableHead>Owner</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.items.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <Link href={`/contacts/${c.id}`} className="font-medium hover:underline">
                      {c.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-sm">{c.company ?? "-"}</TableCell>
                  <TableCell className="text-sm text-ink-3">{c.email ?? "-"}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {c.tags.map((t) => (
                        <Badge key={t} variant="outline">
                          {t}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <ScoreBadge score={c.score} />
                  </TableCell>
                  <TableCell className="text-right tabular">{c.openDeals ?? 0}</TableCell>
                  <TableCell className="text-sm text-ink-3">{timeAgo(c.lastActivityAt)}</TableCell>
                  <TableCell className="text-sm text-ink-3">{c.owner?.name ?? "-"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {pages > 1 && (
            <div className="flex items-center justify-end gap-2 border-t p-2 text-sm">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <span className="text-ink-3">
                Page {page} of {pages}
              </span>
              <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
