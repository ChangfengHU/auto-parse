'use client';

import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { WorkflowEditor } from '@/components/workflow-editor';
import type { WorkflowDef } from '@/lib/workflow/types';

export default function WorkflowDetailPage() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const [workflow, setWorkflow] = useState<WorkflowDef | null>(null);
  const [error, setError] = useState<string | null>(null);

  const initialContext = {
    videoUrl: searchParams.get('ossUrl') ?? '',
    title:    searchParams.get('title') ?? '',
    tags:     searchParams.get('tags') ?? '',
    clientId: searchParams.get('clientId') ?? '',
  };

  useEffect(() => {
    fetch(`/api/workflows/${id}`)
      .then(r => r.ok ? r.json() : r.text().then(t => { throw new Error(t); }))
      .then(setWorkflow)
      .catch(e => setError(String(e)));
  }, [id]);

  if (error) return (
    <div className="h-screen flex items-center justify-center text-red-400">{error}</div>
  );
  if (!workflow) return (
    <div className="h-screen flex items-center justify-center text-muted-foreground">加载中...</div>
  );

  return (
    <div className="h-screen flex flex-col">
      <header className="bg-card border-b border-border px-6 py-3 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-4">
          <a href="/" className="text-xl font-bold text-foreground hover:text-primary transition-colors">doouyin</a>
          <span className="text-muted-foreground">/</span>
          <a href="/workflows" className="text-sm text-muted-foreground hover:text-foreground transition-colors">工作流</a>
          <span className="text-muted-foreground">/</span>
          <h1 className="text-sm font-semibold text-foreground">{workflow.name}</h1>
        </div>
        <a href="/publish" className="px-3 py-1.5 bg-muted hover:bg-muted/80 text-sm rounded-lg transition-colors">返回发布</a>
      </header>
      <div className="flex-1 overflow-hidden">
        <WorkflowEditor workflow={workflow} initialContext={initialContext} />
      </div>
    </div>
  );
}
