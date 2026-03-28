'use client';

import { useEffect, useRef, useState } from 'react';

export interface DropdownMenuItem {
  label: string;
  onClick: (e: React.MouseEvent) => void;
  disabled?: boolean;
  destructive?: boolean;
  icon?: string;
}

interface DropdownMenuProps {
  items: DropdownMenuItem[];
  trigger?: React.ReactNode;
  align?: 'left' | 'right';
}

export default function DropdownMenu({ items, trigger, align = 'right' }: DropdownMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  const handleItemClick = (item: DropdownMenuItem, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!item.disabled) {
      item.onClick(e);
      setIsOpen(false);
    }
  };

  return (
    <div className="relative" ref={menuRef}>
      {/* Trigger Button */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen(!isOpen);
        }}
        className="p-1.5 hover:bg-muted rounded-lg transition-colors"
        title="更多操作"
      >
        {trigger || (
          <svg
            className="w-4 h-4 text-muted-foreground"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <circle cx="12" cy="5" r="1.5" fill="currentColor" />
            <circle cx="12" cy="12" r="1.5" fill="currentColor" />
            <circle cx="12" cy="19" r="1.5" fill="currentColor" />
          </svg>
        )}
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div
          className={`absolute top-full mt-1 ${align === 'left' ? 'left-0' : 'right-0'} 
            bg-card border border-border rounded-lg shadow-lg z-50 min-w-[140px] py-1
            animate-in fade-in slide-in-from-top-1 duration-200`}
        >
          {items.map((item, index) => (
            <button
              key={index}
              onClick={(e) => handleItemClick(item, e)}
              disabled={item.disabled}
              className={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 
                ${item.disabled 
                  ? 'opacity-50 cursor-not-allowed' 
                  : item.destructive
                    ? 'hover:bg-red-500/10 text-red-400'
                    : 'hover:bg-muted text-foreground'
                }
                transition-colors`}
            >
              {item.icon && <span className="text-base">{item.icon}</span>}
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
