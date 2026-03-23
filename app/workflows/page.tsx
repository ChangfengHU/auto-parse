'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { WorkflowEditor } from '@/components/workflow-editor';
import { DOUYIN_PUBLISH_WORKFLOW } from '@/components/workflow-visualizer';

function WorkflowsPageInner() {
  const searchParams = useSearchParams();
  const initialContext = {
    videoUrl:   searchParams.get('ossUrl') ?? '',
    title:      searchParams.get('title') ?? '',
    tags:       searchParams.get('tags') ?? '',
    clientId:   searchParams.get('clientId') ?? '',
  };

  return (
    <div className="h-screen flex flex-col">
      <header className="bg-card border-b border-border px-6 py-3 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-4">
          <a href="/" className="text-xl font-bold text-foreground hover:text-primary transition-colors">
            doouyin
          </a>
          <span className="text-muted-foreground">/</span>
          <h1 className="text-lg font-semibold text-foreground">工作流管理</h1>
        </div>
        <a
          href="/publish"
          className="px-4 py-2 bg-muted hover:bg-muted/80 text-foreground text-sm rounded-lg transition-colors"
        >
          返回发布
        </a>
      </header>

      <div className="flex-1 overflow-hidden">
        <WorkflowEditor
          workflow={{ id: 'douyin-publish', name: '抖音视频发布流程', steps: DOUYIN_PUBLISH_WORKFLOW }}
          initialContext={initialContext}
        />
      </div>
    </div>
  );
}

export default function WorkflowsPage() {
  return (
    <Suspense>
      <WorkflowsPageInner />
    </Suspense>
  );
}
