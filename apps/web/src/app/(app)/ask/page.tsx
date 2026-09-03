"use client";

import { AssistantThread } from "@/components/assistant-thread";
import { PageHeader } from "@/components/page-header";

export default function AskPage() {
  return (
    <div className="enter-stack mx-auto flex max-w-5xl flex-col">
      <PageHeader
        title="Ask your CRM"
        description="Ask about your pipeline, add contacts, deals, tasks and notes, open a record, or ask how something works. Questions become validated read-only queries; changes go through a fixed allowlist that cannot delete anything."
      />
      <AssistantThread />
    </div>
  );
}
