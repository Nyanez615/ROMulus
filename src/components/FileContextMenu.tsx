import * as React from "react"
import { FolderOpen, Copy } from "lucide-react"
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu"
import { revealInFinder } from "@/lib/tauri"
import { useToast } from "@/hooks/use-toast"

export function FileContextMenu({
  path,
  children,
}: {
  path: string
  children: React.ReactNode
}) {
  const { toast } = useToast()

  async function handleReveal() {
    try {
      await revealInFinder(path)
    } catch {
      toast({ description: "Couldn't open — file may have been deleted." })
    }
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={handleReveal}>
          <FolderOpen className="w-3.5 h-3.5 mr-2 shrink-0" />
          Show in Folder
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => navigator.clipboard.writeText(path)}>
          <Copy className="w-3.5 h-3.5 mr-2 shrink-0" />
          Copy Path
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
