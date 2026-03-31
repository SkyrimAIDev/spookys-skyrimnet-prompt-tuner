"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

interface ExpandContentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  content: string;
}

export function ExpandContentModal({ open, onOpenChange, title, content }: ExpandContentModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[80vw] sm:max-w-[80vw] max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-sm font-mono">{title}</DialogTitle>
        </DialogHeader>
        <ScrollArea className="flex-1 min-h-0">
          <pre className="text-xs font-mono whitespace-pre-wrap break-words p-4">{content}</pre>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
