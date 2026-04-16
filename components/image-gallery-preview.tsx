'use client';

import { useState, useEffect } from 'react';

interface ImageItem {
  id: string;
  url: string;
  prompt: string;
}

interface ImageGalleryPreviewProps {
  images: ImageItem[];
  onClose: () => void;
}

export function ImageGalleryPreview({ images, onClose }: ImageGalleryPreviewProps) {
  const [zoomedImage, setZoomedImage] = useState<ImageItem | null>(null);
  const [copiedPromptId, setCopiedPromptId] = useState<string | null>(null);
  const [copiedUrlId, setCopiedUrlId] = useState<string | null>(null);

  // 键盘快捷键
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (zoomedImage) {
          setZoomedImage(null);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [zoomedImage, onClose]);

  const copyToClipboard = (text: string, type: 'prompt' | 'url', id: string) => {
    navigator.clipboard.writeText(text).then(() => {
      if (type === 'prompt') {
        setCopiedPromptId(id);
        setTimeout(() => setCopiedPromptId(null), 2000);
      } else {
        setCopiedUrlId(id);
        setTimeout(() => setCopiedUrlId(null), 2000);
      }
    });
  };

  // Glass morphism 深色主题
  const glassClass = 'bg-slate-900/30 backdrop-blur-lg border border-white/10';

  return (
    <div className="fixed inset-0 bg-black/95 z-50 overflow-y-auto" style={{ background: '#0f1419' }}>
      {/* Header */}
      <div className={`sticky top-0 ${glassClass} border-b border-white/5 px-6 md:px-12 py-6 z-40`}>
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div>
            <h2 className="text-3xl md:text-4xl font-black tracking-tight text-white">图片预览</h2>
            <p className="text-xs text-slate-400 mt-2 font-semibold uppercase tracking-wider">{images.length} IMAGES</p>
          </div>
          <button
            onClick={onClose}
            className="p-3 hover:bg-white/10 rounded-lg transition-all text-slate-400 hover:text-white"
            title="关闭 (ESC)"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Gallery Grid */}
      <div className="px-6 md:px-12 py-8 md:py-12">
        <div className="max-w-7xl mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 md:gap-8">
          {images.map((image, index) => (
            <div
              key={image.id}
              className="group flex flex-col gap-3"
            >
              {/* Image Card */}
              <div
                className={`${glassClass} aspect-[4/5] overflow-hidden relative shadow-2xl transition-all duration-500 group-hover:-translate-y-1 cursor-pointer`}
                onClick={() => setZoomedImage(image)}
              >
                {/* Image */}
                <img
                  src={image.url}
                  alt={`image-${index}`}
                  className="w-full h-full object-cover group-hover:brightness-110 transition-all duration-300"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.opacity = '0.2';
                  }}
                />

                {/* Gradient Overlay */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

                {/* Index Badge */}
                <div className="absolute top-3 left-3 px-2 py-0.5 rounded text-[10px] font-black uppercase bg-slate-700/80 text-slate-300 backdrop-blur">
                  #{index + 1}
                </div>

                {/* Action Icons - 右下角两个图标 */}
                <div className="absolute bottom-3 right-3 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                  {/* Copy Prompt */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      copyToClipboard(image.prompt, 'prompt', image.id);
                    }}
                    className={`p-2 rounded backdrop-blur transition-all ${
                      copiedPromptId === image.id
                        ? 'bg-emerald-500/80 text-white'
                        : 'bg-slate-700/60 text-slate-300 hover:bg-slate-600/80'
                    }`}
                    title="复制 Prompt"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                    </svg>
                  </button>

                  {/* Copy URL */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      copyToClipboard(image.url, 'url', image.id);
                    }}
                    className={`p-2 rounded backdrop-blur transition-all ${
                      copiedUrlId === image.id
                        ? 'bg-emerald-500/80 text-white'
                        : 'bg-slate-700/60 text-slate-300 hover:bg-slate-600/80'
                    }`}
                    title="复制 URL"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.658 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Prompt Text */}
              <div className="px-1">
                <p className="text-[10px] md:text-xs text-slate-400 italic line-clamp-2 leading-relaxed">
                  "{image.prompt}"
                </p>
              </div>
            </div>
          ))}
        </div>

        {images.length === 0 && (
          <div className="flex flex-col items-center justify-center h-48 text-slate-500">
            <svg className="w-12 h-12 mb-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <p className="text-sm font-medium">暂无图片</p>
          </div>
        )}
      </div>

      {/* Zoomed Image Modal */}
      {zoomedImage && (
        <div
          className="fixed inset-0 bg-black/98 flex items-center justify-center z-[70] p-4"
          onClick={() => setZoomedImage(null)}
          style={{ background: 'rgba(0, 0, 0, 0.98)' }}
        >
          <div className="relative w-full h-full flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
            {/* Close Button */}
            <button
              onClick={() => setZoomedImage(null)}
              className="absolute top-6 right-6 p-3 bg-white/10 hover:bg-white/20 backdrop-blur rounded-lg transition-all z-10"
              title="关闭 (ESC)"
            >
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            {/* Image */}
            <img
              src={zoomedImage.url}
              alt="zoomed"
              className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg"
              onError={(e) => {
                (e.target as HTMLImageElement).style.opacity = '0.2';
              }}
            />

            {/* Action Icons - 右下角 */}
            <div className="absolute bottom-6 right-6 flex gap-3 backdrop-blur-md bg-slate-900/40 p-3 rounded-lg border border-white/10">
              {/* Copy Prompt */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  copyToClipboard(zoomedImage.prompt, 'prompt', zoomedImage.id);
                }}
                className={`p-2.5 rounded-lg transition-all ${
                  copiedPromptId === zoomedImage.id
                    ? 'bg-emerald-500/80 text-white'
                    : 'bg-slate-700/80 text-slate-300 hover:bg-slate-600/80'
                }`}
                title="复制 Prompt (已复制)"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
              </button>

              {/* Copy URL */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  copyToClipboard(zoomedImage.url, 'url', zoomedImage.id);
                }}
                className={`p-2.5 rounded-lg transition-all ${
                  copiedUrlId === zoomedImage.id
                    ? 'bg-emerald-500/80 text-white'
                    : 'bg-slate-700/80 text-slate-300 hover:bg-slate-600/80'
                }`}
                title="复制 URL"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.658 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                </svg>
              </button>
            </div>

            {/* Prompt Info at Bottom */}
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-6 md:p-8">
              <p className="text-slate-300 text-sm md:text-base leading-relaxed max-w-3xl">
                <span className="text-slate-500 text-xs uppercase tracking-wider block mb-2">Prompt</span>
                {zoomedImage.prompt}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
