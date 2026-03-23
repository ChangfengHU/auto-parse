'use client';

/**
 * RPA 测试页面 - 使用可视化编辑器
 */

import { RPAEditor } from '@/components/rpa-editor';

export default function RPATestPage() {
  return (
    <div className="h-screen bg-gray-950">
      <RPAEditor />
    </div>
  );
}
